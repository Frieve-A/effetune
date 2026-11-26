package com.frieve.effetune;

import android.content.Context;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Handler;
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
    private final HashMap<String, MidiInputPort> outputs = new HashMap<>();
    final MidiScoreOutput score = new MidiScoreOutput();
    private final HashMap<String, String> outputKeys = new HashMap<>();
    private String selectedOutput = "", selectedId;
    private boolean selectingOutput;
    private final MidiManager.DeviceCallback callback = new MidiManager.DeviceCallback() {
        @Override public void onDeviceAdded(MidiDeviceInfo info) {
            openMapped();
            openSelectedOutput();
            for (MidiDeviceInfo.PortInfo port : info.getPorts()) events.send("midi-connected", describe(info, port));
        }
        @Override public void onDeviceRemoved(MidiDeviceInfo info) {
            for (MidiDeviceInfo.PortInfo port : info.getPorts()) {
                JSONObject record = describe(info, port);
                close(record.optString("id"));
                events.send("midi-disconnected", record);
            }
            deviceKeys.keySet().removeIf(id -> id.startsWith(info.getId() + ":"));
            outputKeys.keySet().removeIf(id -> id.startsWith(info.getId() + ":"));
        }
    };

    MidiInput(Context context, Handler control, AudioService.Events events) {
        manager = context.getSystemService(MidiManager.class); this.control = control; this.events = events;
        if (manager != null) manager.registerDeviceCallback(callback, control);
    }

    JSONObject list() {
        JSONArray inputs = new JSONArray(), destinations = new JSONArray();
        if (manager != null) for (MidiDeviceInfo info : manager.getDevices()) {
            for (MidiDeviceInfo.PortInfo port : info.getPorts()) {
                (port.getType() == MidiDeviceInfo.PortInfo.TYPE_OUTPUT ? inputs : destinations).put(describe(info, port));
            }
        }
        return AudioService.object("inputs", inputs, "outputs", destinations, "selectedOutputKey", selectedOutput);
    }

    private JSONObject describe(MidiDeviceInfo info, MidiDeviceInfo.PortInfo port) {
        boolean input = port.getType() == MidiDeviceInfo.PortInfo.TYPE_OUTPUT;
        String id = info.getId() + ":" + (input ? "" : "out:") + port.getPortNumber();
        String name = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME, "MIDI");
        if (port.getName() != null && !port.getName().isEmpty() && !port.getName().equals(name)) name += " " + port.getName();
        if (!input && !outputKeys.containsKey(id)) outputKeys.put(id, availableDeviceKey(name, outputKeys.values()));
        return AudioService.object("id", id, "key", input ? deviceKey(info, id) : outputKeys.get(id),
                "type", input ? "input" : "output", "name", input ? info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME, "MIDI input") : name,
                "manufacturer", info.getProperties().getString(MidiDeviceInfo.PROPERTY_MANUFACTURER, ""));
    }

    void restoreOutput(String key) {
        selectedOutput = key;
        openSelectedOutput();
    }

    String selectedOutputKey() { return selectedOutput; }

    void selectOutput(String key, AudioService.Reply reply) {
        if (selectingOutput) {
            reply.complete(null, new AudioService.HostError("midi-unavailable", "Wait for the MIDI output to finish opening and try again."));
            return;
        }
        if (key.isEmpty()) {
            confirmOutputSelection(key, null, reply);
            return;
        }
        String id = outputId(key);
        if (id == null) {
            reply.complete(null, new AudioService.HostError("midi-unavailable", "Reconnect the MIDI output and try again."));
            return;
        }
        selectingOutput = true;
        open(id, (result, error) -> {
            selectingOutput = false;
            if (error != null) reply.complete(null, error);
            else confirmOutputSelection(key, id, reply);
        });
    }

    private void confirmOutputSelection(String key, String id, AudioService.Reply reply) {
        if (selectedId != null && !selectedId.equals(id)) close(selectedId);
        selectedOutput = key;
        selectedId = id;
        score.setPort(id == null ? null : outputs.get(id));
        reply.complete(AudioService.object("selectedOutputKey", selectedOutput), null);
    }

    private void openSelectedOutput() {
        if (selectedOutput.isEmpty() || selectedId != null) return;
        String id = outputId(selectedOutput);
        if (id == null) return;
        selectedId = id;
        open(id, (result, error) -> {
            if (!id.equals(selectedId)) return;
            if (error == null) score.setPort(outputs.get(id));
            else { selectedId = null; android.util.Log.w("EffeTuneMidi", "Selected output could not open"); }
        });
    }

    private String outputId(String key) {
        if (manager == null) return null;
        for (MidiDeviceInfo info : manager.getDevices()) for (MidiDeviceInfo.PortInfo port : info.getPorts()) {
            if (port.getType() != MidiDeviceInfo.PortInfo.TYPE_INPUT) continue;
            JSONObject record = describe(info, port);
            if (record.optString("key").equals(key)) return record.optString("id");
        }
        return null;
    }

    void send(JSONObject args, AudioService.Reply reply) throws Exception {
        String id = args.getString("id");
        if (!id.contains(":out:")) throw new IllegalArgumentException("Invalid MIDI destination");
        byte[] data = android.util.Base64.decode(args.getString("data"), android.util.Base64.DEFAULT);
        double delayMs = args.optDouble("delayMs", 0);
        if (data.length == 0 || !Double.isFinite(delayMs) || delayMs < 0 || delayMs > 60000)
            throw new IllegalArgumentException("Invalid MIDI output");
        long at = System.nanoTime() + (long) (delayMs * 1_000_000);
        open(id, (result, error) -> {
            if (error != null) { reply.complete(null, error); return; }
            try {
                outputs.get(id).send(data, 0, data.length, at);
                reply.complete(new JSONObject(), null);
            } catch (IOException failure) {
                close(id);
                reply.complete(null, new AudioService.HostError("midi-unavailable", "Reconnect the MIDI output and try again."));
            }
        });
    }

    void open(String id, AudioService.Reply reply) {
        if (devices.containsKey(id)) { reply.complete(AudioService.object("id", id), null); return; }
        if (opening.containsKey(id)) { opening.get(id).add(reply); return; }
        if (manager == null || ports.size() >= 16) { reply.complete(null, new AudioService.HostError("midi-unavailable", "This MIDI input is unavailable.")); return; }
        for (MidiDeviceInfo info : manager.getDevices()) {
            for (MidiDeviceInfo.PortInfo portInfo : info.getPorts()) {
                if (!id.equals(describe(info, portInfo).optString("id"))) continue;
                java.util.ArrayList<AudioService.Reply> waiting = new java.util.ArrayList<>(); waiting.add(reply); opening.put(id, waiting);
                MidiManager.OnDeviceOpenedListener opened = device -> {
                    if (opening.get(id) != waiting) {
                        if (device != null) try { device.close(); } catch (IOException ignored) { }
                        return;
                    }
                    if (device != null && portInfo.getType() == MidiDeviceInfo.PortInfo.TYPE_INPUT) {
                        MidiInputPort output = device.openInputPort(portInfo.getPortNumber());
                        if (output != null) {
                            devices.put(id, device); outputs.put(id, output); finishOpen(id, null);
                        } else {
                            try { device.close(); } catch (IOException ignored) { }
                            finishOpen(id, new AudioService.HostError("midi-unavailable", "The MIDI output is in use."));
                        }
                        return;
                    }
                    MidiOutputPort port = device == null ? null : device.openOutputPort(portInfo.getPortNumber());
                    if (port == null) {
                        if (device != null) try { device.close(); } catch (IOException ignored) { }
                        finishOpen(id, new AudioService.HostError("midi-unavailable", "The MIDI input could not be opened.")); return;
                    }
                    devices.put(id, device); ports.put(id, port);
                    String deviceName = deviceKey(info, id);
                    port.connect(new PortReceiver(id, deviceName, port));
                    finishOpen(id, null);
                };
                try { manager.openDevice(info, opened, control); }
                catch (SecurityException | IllegalArgumentException error) {
                    android.util.Log.w("EffeTuneMidi", "MIDI device could not open", error);
                    finishOpen(id, new AudioService.HostError("midi-unavailable", "Reconnect the MIDI device and try again."));
                }
                return;
            }
        }
        reply.complete(null, new AudioService.HostError("midi-unavailable", "Reconnect the MIDI device and try again."));
    }

    // MidiReceiver delivers arbitrary fragments. Web MIDI consumers expect complete messages.
    private final class PortReceiver extends MidiReceiver {
        private final String id, name;
        private final MidiOutputPort port;
        private int status, length;
        private JSONArray packet;
        PortReceiver(String id, String name, MidiOutputPort port) {
            this.id = id; this.name = name; this.port = port;
        }
        @Override public void onSend(byte[] bytes, int offset, int count, long timestamp) {
            for (int i = offset; i < offset + count; i++) {
                int value = bytes[i] & 255;
                if (value >= 0xf8) continue;
                if (value == 0xf7 && status == 0xf0) {
                    if (packet != null) emit(packet.put(value), timestamp);
                    status = 0; packet = null; continue;
                }
                if (value >= 0x80) {
                    status = value < 0xf0 || value == 0xf0 ? value : 0;
                    length = (value & 0xe0) == 0xc0 ? 2 : 3;
                    packet = status == 0 ? null : new JSONArray().put(status);
                    continue;
                }
                if (status == 0 || status == 0xf0 && packet == null) continue;
                if (packet == null) packet = new JSONArray().put(status);
                packet.put(value);
                if (status != 0xf0 && packet.length() == length) {
                    emit(packet, timestamp); packet = null;
                } else if (packet.length() >= 65536) packet = null;
            }
        }
        private void emit(JSONArray message, long timestamp) {
            JSONObject event = AudioService.object("id", id, "name", name, "data", message,
                    "timestamp", timestamp / 1_000_000.0, "receivedAt", System.nanoTime() / 1_000_000.0);
            control.post(() -> { if (ports.get(id) == port) events.send("midi", event); });
        }
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
        if (id.equals(selectedId)) { score.setPort(null); selectedId = null; }
        finishOpen(id, new AudioService.HostError("midi-unavailable", "The MIDI device disconnected."));
        MidiInputPort output = outputs.remove(id);
        try { if (output != null) output.close(); } catch (IOException ignored) { }
        MidiOutputPort port = ports.remove(id);
        MidiDevice device = devices.remove(id);
        try { if (port != null) port.close(); } catch (IOException ignored) { }
        try { if (device != null) device.close(); } catch (IOException ignored) { }
    }
    void closePagePort(String id) {
        if (!id.equals(selectedId)) close(id);
    }
    @Override public void close() {
        if (manager != null) manager.unregisterDeviceCallback(callback);
        for (String id : opening.keySet().toArray(new String[0])) close(id);
        for (String id : devices.keySet().toArray(new String[0])) close(id);
    }
}
