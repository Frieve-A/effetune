package com.frieve.effetune;

import android.util.Base64;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.HashSet;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

/** Asset staging belongs to control, and is invalidated when graph ownership changes. */
final class AssetTransfers {
    private static final int MAX_BYTES = 1024 * 1024 * 1024;
    private final File directory;
    AssetTransfers(Context context) { directory = new File(context.getFilesDir(), "pipeline-assets"); directory.mkdirs(); }
    private static final class Transfer {
        final File file;
        final int size;
        final int[] info;
        final int instance, slot, format;
        final String pluginId, type, signature;
        final JSONObject parameters;
        int offset;
        Transfer(File directory, int instance, int slot, String pluginId, String type, JSONObject args) throws Exception {
            size = args.getInt("byteLength");
            if (size < 1 || size > MAX_BYTES) throw new IllegalArgumentException("Asset is too large");
            this.instance = instance; this.slot = slot; this.format = args.getInt("formatTag");
            this.pluginId = pluginId; this.type = type;
            signature = args.optString("externalAssetSignature", "");
            if (signature.length() > 8192) throw new IllegalArgumentException("Asset definition is too large");
            parameters = assetParameters(args.optJSONObject("externalAssetParameters"));
            info = new int[]{args.optInt("channels", -1), args.optInt("frames", -1), args.optInt("topology", -1),
                    args.optInt("headBlock", 0), args.optInt("rateDivider", 1), args.optInt("pathCount", 0),
                    args.optInt("inputCount", 0), args.optInt("processingChannels", 1), args.optInt("footprintBytes", size), size};
            if (info[8] < 0 || info[8] > MAX_BYTES) throw new IllegalArgumentException("Asset preparation is too large");
            file = File.createTempFile("asset-", ".bin", directory);
        }
    }
    private final HashMap<String, Transfer> pending = new HashMap<>();
    private JSONObject active = new JSONObject();
    void discardPending() { for (Transfer transfer : pending.values()) transfer.file.delete(); pending.clear(); }
    JSONObject snapshot() throws Exception { return new JSONObject(active.toString()); }
    JSONObject compatible(JSONArray records) throws Exception {
        JSONObject result = new JSONObject();
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            String prefix = record.getString("type") + ":" + record.get("id") + ":";
            java.util.Iterator<String> keys = active.keys();
            while (keys.hasNext()) { String key = keys.next(); if (key.startsWith(prefix)) result.put(key, active.get(key)); }
        }
        return result;
    }
    static JSONObject assetParameters(JSONObject value) throws Exception {
        JSONObject result = value == null ? new JSONObject() : new JSONObject(value.toString());
        if (result.length() > 32 || result.toString().length() > 16384) throw new IllegalArgumentException("Asset definition is too large");
        java.util.Iterator<String> keys = result.keys();
        while (keys.hasNext()) {
            String key = keys.next(); Object item = result.get(key);
            if (!key.matches("[A-Za-z][A-Za-z0-9_]{0,63}") || key.equals("id") || key.equals("type") || key.equals("enabled")
                    || key.equals("inputBus") || key.equals("outputBus") || item instanceof JSONObject || item instanceof JSONArray
                    || item instanceof String && ((String) item).length() > 4096
                    || item instanceof Number && !Double.isFinite(((Number) item).doubleValue())) throw new IllegalArgumentException("Invalid asset definition");
        }
        return result;
    }
    static JSONObject definitions(JSONObject refs) {
        JSONObject result = new JSONObject();
        if (refs != null) {
            java.util.Iterator<String> keys = refs.keys();
            while (keys.hasNext()) {
                String key = keys.next(); JSONObject ref = refs.optJSONObject(key);
                if (ref != null) try { result.put(key, AudioService.object("id", ref.getString("id"), "type", ref.getString("type"),
                        "externalAssetSignature", ref.optString("externalAssetSignature", ""),
                        "externalAssetParameters", ref.optJSONObject("externalAssetParameters"))); } catch (Exception ignored) { }
            }
        }
        return result;
    }
    JSONArray retainedDefinitions(Iterable<JSONObject> states) {
        JSONArray result = new JSONArray(); HashSet<String> seen = new HashSet<>();
        ArrayList<JSONObject> refs = new ArrayList<>(); refs.add(active);
        for (JSONObject state : states) if (state != null) refs.add(state.optJSONObject("assetRefs"));
        for (JSONObject map : refs) {
            JSONObject definitions = definitions(map); java.util.Iterator<String> keys = definitions.keys();
            while (keys.hasNext()) { JSONObject definition = definitions.optJSONObject(keys.next()); if (seen.add(definition.optString("id"))) result.put(definition); }
        }
        return result;
    }
    private File file(JSONObject ref) throws Exception {
        String id = ref.getString("id");
        if (!id.matches("asset-[0-9]+\\.bin")) throw new IllegalArgumentException("Invalid asset reference");
        return new File(directory, id);
    }
    void select(JSONObject refs, HashMap<String, Integer> instances, HashMap<String, String> types, NativeEngine engine, boolean newGraph) throws Exception {
        java.util.Iterator<String> oldKeys = active.keys();
        if (!newGraph) while (oldKeys.hasNext()) {
            String key = oldKeys.next(); JSONObject previous = active.getJSONObject(key);
            Integer handle = instances.get(previous.getString("pluginId"));
            if (!refs.has(key) && handle != null && previous.getString("type").equals(types.get(previous.getString("pluginId")))) {
                if (engine.clearAsset(handle, previous.getInt("slot")) < 0) throw new IllegalStateException("Cannot clear prepared asset");
            }
        }
        java.util.Iterator<String> keys = refs.keys();
        while (keys.hasNext()) {
            String key = keys.next(); JSONObject ref = refs.getJSONObject(key);
            Integer handle = instances.get(ref.getString("pluginId"));
            if (handle == null || !ref.getString("type").equals(types.get(ref.getString("pluginId")))) throw new IllegalArgumentException("Stale asset reference");
            if (!newGraph && active.has(key) && active.getJSONObject(key).getString("id").equals(ref.getString("id"))) continue;
            int[] info = new int[10]; JSONArray values = ref.getJSONArray("info");
            for (int i = 0; i < info.length; i++) info[i] = values.getInt(i);
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file(ref), ParcelFileDescriptor.MODE_READ_ONLY)) {
                if (engine.setAssetFile(handle, ref.getInt("slot"), info, descriptor.getFd(), ref.getInt("size"), ref.getInt("format")) < 0) throw new IllegalStateException("Cannot restore prepared asset");
            }
        }
        active = new JSONObject(refs.toString());
    }
    void collect(Iterable<JSONObject> states) throws Exception {
        HashSet<String> keep = new HashSet<>();
        for (Transfer transfer : pending.values()) keep.add(transfer.file.getName());
        ArrayList<JSONObject> refs = new ArrayList<>(); refs.add(active);
        for (JSONObject state : states) if (state != null && state.has("assetRefs")) refs.add(state.getJSONObject("assetRefs"));
        for (JSONObject map : refs) { java.util.Iterator<String> keys = map.keys(); while (keys.hasNext()) keep.add(file(map.getJSONObject(keys.next())).getName()); }
        File[] files = directory.listFiles((parent, name) -> name.startsWith("asset-") && name.endsWith(".bin"));
        if (files != null) for (File candidate : files) if (!keep.contains(candidate.getName())) candidate.delete();
    }

    JSONObject command(String operation, JSONObject args, HashMap<String, Integer> instances, HashMap<String, String> types, NativeEngine engine) throws Exception {
        String id = String.valueOf(args.get("pluginId"));
        Integer instance = instances.get(id);
        if (instance == null) throw new AudioService.HostError("stale-pipeline", "The effect changed. Load its file again.");
        int slot = args.optInt("slot", 0);
        if (slot < 0 || slot > 255) throw new IllegalArgumentException("Invalid asset slot");
        String key = types.get(id) + ":" + id + ":" + slot;
        if (operation.equals("pipeline.asset.begin")) {
            long total = args.getInt("byteLength");
            for (java.util.Map.Entry<String, Transfer> entry : pending.entrySet()) if (!entry.getKey().equals(key)) total += entry.getValue().size;
            if (total > MAX_BYTES) throw new AudioService.HostError("asset-limit", "Finish loading the current effect file before loading another.");
            Transfer previous = pending.put(key, new Transfer(directory, instance, slot, id, types.get(id), args));
            if (previous != null) previous.file.delete();
        } else if (operation.equals("pipeline.asset.abort") || operation.equals("pipeline.asset.clear")) {
            Transfer previous = pending.remove(key);
            if (previous != null) previous.file.delete();
            if (operation.equals("pipeline.asset.clear") && engine.clearAsset(instance, slot) < 0) throw new AudioService.HostError("asset-invalid", "The effect file could not be cleared.");
            if (operation.equals("pipeline.asset.clear")) active.remove(key);
        }
        else {
            Transfer transfer = pending.get(key);
            if (transfer == null || transfer.instance != instance) throw new AudioService.HostError("stale-pipeline", "The effect changed. Load its file again.");
            if (operation.equals("pipeline.asset.chunk")) {
                String encoded = args.getString("data");
                if (encoded.length() > 349528) throw new IllegalArgumentException("Chunk too large");
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                if (args.getInt("offset") != transfer.offset || bytes.length > DocumentStore.CHUNK_BYTES
                        || transfer.offset + bytes.length > transfer.size) throw new IllegalArgumentException("Invalid asset range");
                try (FileOutputStream output = new FileOutputStream(transfer.file, true)) { output.write(bytes); }
                transfer.offset += bytes.length;
            } else if (operation.equals("pipeline.asset.commit")) {
                if (transfer.offset != transfer.size) throw new IllegalArgumentException("Incomplete asset");
                if (transfer.size < 32) throw new IllegalArgumentException("Asset header missing");
                byte[] headerBytes = new byte[32];
                try (RandomAccessFile input = new RandomAccessFile(transfer.file, "r")) { input.readFully(headerBytes); }
                ByteBuffer header = ByteBuffer.wrap(headerBytes).order(ByteOrder.LITTLE_ENDIAN);
                if (transfer.info[0] == -1) transfer.info[0] = header.getInt(4);
                if (transfer.info[1] == -1) transfer.info[1] = header.getInt(8);
                if (transfer.info[2] == -1) transfer.info[2] = header.getInt(16);
                int status;
                try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(transfer.file, ParcelFileDescriptor.MODE_READ_ONLY)) {
                    status = engine.setAssetFile(transfer.instance, transfer.slot, transfer.info, descriptor.getFd(), transfer.size, transfer.format);
                } catch (Exception error) { transfer.file.delete(); throw error; } finally { pending.remove(key); }
                if (status < 0) { transfer.file.delete(); throw new AudioService.HostError("asset-invalid", "This effect file could not be loaded."); }
                JSONArray info = new JSONArray(); for (int value : transfer.info) info.put(value);
                active.put(key, AudioService.object("id", transfer.file.getName(), "pluginId", id, "type", transfer.type,
                        "slot", slot, "format", transfer.format, "size", transfer.size, "info", info,
                        "externalAssetSignature", transfer.signature, "externalAssetParameters", transfer.parameters));
            } else throw new AudioService.HostError("unsupported-operation", "This effect file operation is unavailable.");
        }
        return AudioService.object("pluginId", args.get("pluginId"), "slot", slot, "state", operation.equals("pipeline.asset.commit") ? "ready" : operation.equals("pipeline.asset.clear") ? "empty" : "pending");
    }
}
