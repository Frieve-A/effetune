package com.frieve.effetune;

import android.content.Context;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Handler;
import android.os.SystemClock;
import java.io.IOException;
import java.util.HashMap;
import org.json.JSONArray;
import org.json.JSONObject;

final class MidiInput implements AutoCloseable {
    private final MidiManager manager;
    private final Handler control;
    private final AudioService.Events events;
    private final HashMap<String, MidiDevice> devices = new HashMap<>();
    private final java.util.HashSet<String> mappedDevices = new java.util.HashSet<>();
    private final HashMap<String, java.util.ArrayList<AudioService.Reply>> opening = new HashMap<>();
    private final HashMap<String, String> deviceKeys = new HashMap<>();
    private final HashMap<String, MidiOutputPort> ports = new HashMap<>();
    private final MidiManager.DeviceCallback callback = new MidiManager.DeviceCallback() {
        @Override public void onDeviceAdded(MidiDeviceInfo info) { openMapped(); JSONArray inputs = list().optJSONArray("inputs");
            if (inputs != null) for (int i = 0; i < inputs.length(); i++) { JSONObject port = inputs.optJSONObject(i); if (port != null && port.optString("id").startsWith(info.getId() + ":")) events.send("midi-connected", port); } }
        @Override public void onDeviceRemoved(MidiDeviceInfo info) {
            for (String key : ports.keySet().toArray(new String[0])) {
                if (key.startsWith(info.getId() + ":")) { close(key); events.send("midi-disconnected", AudioService.object("id", key, "name", deviceKey(info, key))); }
            }
            deviceKeys.keySet().removeIf(id -> id.startsWith(info.getId() + ":"));
        }
    };

    MidiInput(Context context, Handler control, AudioService.Events events) {
        manager = context.getSystemService(MidiManager.class); this.control = control; this.events = events;
        if (manager != null) manager.registerDeviceCallback(callback, control);
    }

    JSONObject list() {
        JSONArray inputs = new JSONArray();
        if (manager != null) for (MidiDeviceInfo info : manager.getDevices()) {
            for (MidiDeviceInfo.PortInfo port : info.getPorts()) {
                if (port.getType() == MidiDeviceInfo.PortInfo.TYPE_OUTPUT) inputs.put(AudioService.object(
                        "id", info.getId() + ":" + port.getPortNumber(), "key", deviceKey(info, info.getId() + ":" + port.getPortNumber()), "name", info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME, "MIDI input"),
                        "manufacturer", info.getProperties().getString(MidiDeviceInfo.PROPERTY_MANUFACTURER, "")));
            }
        }
        return AudioService.object("inputs", inputs, "outputs", new JSONArray());
    }

    void open(String id, AudioService.Reply reply) {
        if (ports.containsKey(id)) { reply.complete(AudioService.object("id", id), null); return; }
        if (opening.containsKey(id)) { opening.get(id).add(reply); return; }
        if (manager == null || ports.size() >= 16) { reply.complete(null, new AudioService.HostError("midi-unavailable", "This MIDI input is unavailable.")); return; }
        for (MidiDeviceInfo info : manager.getDevices()) {
            for (MidiDeviceInfo.PortInfo portInfo : info.getPorts()) {
                if (portInfo.getType() != MidiDeviceInfo.PortInfo.TYPE_OUTPUT || !id.equals(info.getId() + ":" + portInfo.getPortNumber())) continue;
                java.util.ArrayList<AudioService.Reply> waiting = new java.util.ArrayList<>(); waiting.add(reply); opening.put(id, waiting);
                manager.openDevice(info, device -> {
                    MidiOutputPort port = device == null ? null : device.openOutputPort(portInfo.getPortNumber());
                    if (port == null) {
                        if (device != null) try { device.close(); } catch (IOException ignored) { }
                        finishOpen(id, new AudioService.HostError("midi-unavailable", "The MIDI input could not be opened.")); return;
                    }
                    devices.put(id, device); ports.put(id, port);
                    String deviceName = deviceKey(info, id);
                    port.connect(new MidiReceiver() {
                        @Override public void onSend(byte[] bytes, int offset, int count, long timestamp) {
                            if (count > 4096) return;
                            JSONArray data = new JSONArray();
                            for (int i = 0; i < count; i++) data.put(bytes[offset + i] & 255);
                            JSONObject event = AudioService.object("id", id, "name", deviceName, "data", data, "timestamp", timestamp / 1_000_000.0,
                                    "receivedAt", SystemClock.elapsedRealtimeNanos() / 1_000_000.0);
                            control.post(() -> events.send("midi", event));
                        }
                    });
                    finishOpen(id, null);
                }, control);
                return;
            }
        }
        reply.complete(null, new AudioService.HostError("midi-unavailable", "Reconnect the MIDI device and try again."));
    }

    void configure(JSONObject config) throws Exception {
        mappedDevices.clear(); JSONArray mappings = config.getJSONArray("mappings");
        for (int i = 0; i < mappings.length(); i++) { JSONObject mapping = mappings.getJSONObject(i); if (!mapping.optString("device").isEmpty()) mappedDevices.add(mapping.getString("device")); }
        openMapped();
    }
    private void openMapped() {
        if (manager == null) return;
        for (MidiDeviceInfo info : manager.getDevices()) for (MidiDeviceInfo.PortInfo port : info.getPorts()) {
            if (port.getType() != MidiDeviceInfo.PortInfo.TYPE_OUTPUT) continue;
            String id = info.getId() + ":" + port.getPortNumber();
            if (mappedDevices.contains(deviceKey(info, id))) open(id, (result, error) -> { if (error != null) android.util.Log.w("EffeTuneMidi", "Mapped input could not open: " + error.code); });
        }
    }
    private void finishOpen(String id, AudioService.HostError error) {
        java.util.ArrayList<AudioService.Reply> waiting = opening.remove(id);
        if (waiting != null) for (AudioService.Reply reply : waiting) reply.complete(error == null ? AudioService.object("id", id) : null, error);
    }
    private String deviceKey(MidiDeviceInfo info, String id) {
        String existing = deviceKeys.get(id);
        if (existing != null) return existing;
        String name = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME, "MIDI input");
        String key = availableDeviceKey(name, deviceKeys.values());
        deviceKeys.put(id, key); return key;
    }

    static String availableDeviceKey(String name, java.util.Collection<String> occupied) {
        int ordinal = 1;
        String key = name;
        while (occupied.contains(key)) key = name + "\u0000" + ++ordinal;
        return key;
    }

    void close(String id) {
        MidiOutputPort port = ports.remove(id);
        MidiDevice device = devices.remove(id);
        try { if (port != null) port.close(); } catch (IOException ignored) { }
        try { if (device != null) device.close(); } catch (IOException ignored) { }
    }
    @Override public void close() {
        if (manager != null) manager.unregisterDeviceCallback(callback);
        for (String id : ports.keySet().toArray(new String[0])) close(id);
    }
}
