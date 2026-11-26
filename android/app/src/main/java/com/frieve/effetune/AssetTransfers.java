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
import java.util.Set;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

/** Asset staging belongs to control, and is invalidated when graph ownership changes. */
final class AssetTransfers {
    private static final int MAX_BYTES = 1024 * 1024 * 1024;
    private final File directory;
    private final int branch;
    AssetTransfers(Context context) {
        this(new File(context.getFilesDir(), "pipeline-assets"));
        // Only the primary service owner starts before any blind-test transfers exist.
        collectFiles("blind-", java.util.Collections.emptySet());
    }
    AssetTransfers(Context context, int branch) { this(new File(context.getFilesDir(), "pipeline-assets"), branch); }
    AssetTransfers(File directory) { this(directory, 0); }
    private AssetTransfers(File directory, int branch) { this.directory = directory; this.branch = branch; directory.mkdirs(); }
    private static final class Transfer {
        final File file;
        final int size;
        final int[] info;
        final int instance, slot, format;
        final long operationRevision;
        final String batch;
        final String pluginId, type, signature;
        final JSONObject parameters;
        int offset;
        Transfer(File directory, int instance, int slot, String pluginId, String type, JSONObject args, int branch) throws Exception {
            size = args.getInt("byteLength");
            if (size < 1 || size > MAX_BYTES) throw new IllegalArgumentException("Asset is too large");
            this.instance = instance; this.slot = slot; this.format = args.getInt("formatTag");
            operationRevision = args.optLong("operationRevision", -1);
            batch = args.optString("_assetBatch", null);
            this.pluginId = pluginId; this.type = type;
            signature = args.optString("externalAssetSignature", "");
            parameters = assetParameters(args.optJSONObject("externalAssetParameters"));
            info = new int[]{args.optInt("channels", -1), args.optInt("frames", -1), args.optInt("topology", -1),
                    args.optInt("headBlock", 0), args.optInt("rateDivider", 1), args.optInt("pathCount", 0),
                    args.optInt("inputCount", 0), args.optInt("processingChannels", 1), args.optInt("footprintBytes", size), size};
            if (info[8] < 0 || info[8] > MAX_BYTES) throw new IllegalArgumentException("Asset preparation is too large");
            file = File.createTempFile(branch == 0 ? "asset-" : "blind-", ".bin", directory);
        }
    }
    private final HashMap<String, Transfer> pending = new HashMap<>();
    private final HashMap<String, Submission> submitted = new HashMap<>();
    private long nextToken;
    private JSONObject active = new JSONObject();
    private static final class Submission {
        final long token, operationRevision;
        final boolean historyEntry;
        JSONObject replacement;
        Submission(long token, long operationRevision, JSONObject replacement, boolean historyEntry) {
            this.token = token;
            this.operationRevision = operationRevision;
            this.replacement = replacement;
            this.historyEntry = historyEntry;
        }
    }
    record Notice(long operationRevision, boolean committed, boolean historyEntry, String rejectedAssetId) { }

    private long token() {
        nextToken = nextToken % 0xffffffffL + 1;
        return nextToken;
    }

    Notice resolve(String key, long token, boolean rejected, boolean completed) throws Exception {
        Submission current = submitted.get(key);
        if (current == null || current.token != token) return null;
        boolean committed = completed && !rejected && current.replacement != null;
        if (committed) {
            active.put(key, current.replacement);
            current.replacement = null;
        }
        String rejectedAssetId = null;
        if (completed && rejected) {
            submitted.remove(key);
            if (current.replacement != null) rejectedAssetId = current.replacement.getString("id");
        }
        return new Notice(current.operationRevision, committed, current.historyEntry, rejectedAssetId);
    }
    void discardPending() { for (Transfer transfer : pending.values()) transfer.file.delete(); pending.clear(); }
    JSONObject snapshot() throws Exception { return new JSONObject(active.toString()); }
    boolean readyForTest(JSONObject required, NativeEngine engine, HashMap<Integer, JSONObject> streams) throws Exception {
        java.util.Iterator<String> keys = required.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Submission current = submitted.get(key);
            if (current == null || pending.containsKey(key) || current.replacement != null) return false;
            JSONObject ref = active.optJSONObject(key);
            if (ref == null || !required.getString(key).equals(ref.optString("externalAssetSignature"))) return false;
            int pluginId = ref.getInt("pluginId");
            JSONObject stream = streams.get(pluginId);
            if (ref.getInt("slot") == 0 && stream != null && !stream.optBoolean("supplied")) return false;
            int state = engine.assetState(pluginId, ref.getInt("slot"), branch) & 255;
            if (state == 4) throw new IllegalStateException("Asset preparation failed");
            if (state != 3) return false;
        }
        return true;
    }
    static JSONObject compatible(JSONArray records, JSONObject refs) throws Exception {
        JSONObject result = new JSONObject();
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            String prefix = record.getString("type") + ":" + record.get("id") + ":";
            java.util.Iterator<String> keys = refs.keys();
            while (keys.hasNext()) { String key = keys.next(); if (key.startsWith(prefix)) result.put(key, refs.get(key)); }
        }
        return result;
    }

    JSONObject preparationParameters(JSONObject requested) throws Exception {
        JSONObject result = new JSONObject();
        java.util.Iterator<String> keys = requested.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            result.put(key, active.has(key) ? active.getJSONObject(key) : requested.getJSONObject(key));
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
    /** Keys of the references whose coefficients were made for another rate. */
    static JSONArray stale(JSONObject refs, int rate) {
        JSONArray result = new JSONArray();
        java.util.Iterator<String> keys = refs.keys();
        while (keys.hasNext()) {
            String key = keys.next(); JSONObject ref = refs.optJSONObject(key);
            if (ref != null && ref.optInt("sampleRate", rate) != rate) result.put(key);
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
    boolean select(JSONObject refs, HashMap<String, Integer> instances, HashMap<String, String> types, NativeEngine engine, Set<String> created, boolean replacePending) throws Exception {
        // Coefficients made for another rate stay referenced by the record; the renderer sends this rate's.
        JSONArray stale = stale(refs, engine.getSampleRate());
        if (stale.length() > 0) refs = new JSONObject(refs.toString());
        for (int i = 0; i < stale.length(); i++) refs.remove(stale.getString(i));
        JSONObject selected = new JSONObject(active.toString());
        boolean parametersChanged = false;
        HashMap<String, Submission> selectedSubmissions = new HashMap<>(submitted);
        HashMap<String, JSONObject> previousRefs = new HashMap<>();
        java.util.Iterator<String> oldKeys = active.keys();
        while (oldKeys.hasNext()) {
            String key = oldKeys.next();
            previousRefs.put(key, active.getJSONObject(key));
        }
        for (var entry : submitted.entrySet()) {
            if (entry.getValue().replacement != null) {
                previousRefs.putIfAbsent(entry.getKey(), entry.getValue().replacement);
            }
        }
        for (var entry : previousRefs.entrySet()) {
            String key = entry.getKey();
            JSONObject previous = entry.getValue();
            String id = previous.getString("pluginId");
            Integer handle = instances.get(id);
            boolean retained = handle != null && !created.contains(id) && previous.getString("type").equals(types.get(id));
            if (!retained || !refs.has(key) && (replacePending || active.has(key))) {
                if (retained && engine.clearAsset(handle, previous.getInt("slot"), branch) < 0) {
                    throw new IllegalStateException("Cannot clear prepared asset");
                }
                selected.remove(key);
                selectedSubmissions.remove(key);
            }
        }
        java.util.Iterator<String> keys = refs.keys();
        while (keys.hasNext()) {
            String key = keys.next(); JSONObject ref = refs.getJSONObject(key);
            Integer handle = instances.get(ref.getString("pluginId"));
            if (handle == null || !ref.getString("type").equals(types.get(ref.getString("pluginId")))) throw new IllegalArgumentException("Stale asset reference");
            Submission current = selectedSubmissions.get(key);
            JSONObject previous = selected.optJSONObject(key);
            boolean sameRef = previous != null && previous.getString("id").equals(ref.getString("id"));
            if (!replacePending && current != null && current.replacement != null) {
                continue;
            } else if (current == null || current.replacement == null) {
                if (sameRef) continue;
            } else if (!current.historyEntry && current.replacement.getString("id").equals(ref.getString("id"))) {
                continue;
            }
            int[] info = new int[10]; JSONArray values = ref.getJSONArray("info");
            for (int i = 0; i < info.length; i++) info[i] = values.getInt(i);
            long token = token();
            int status;
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file(ref), ParcelFileDescriptor.MODE_READ_ONLY)) {
                status = engine.setAssetFile(handle, ref.getInt("slot"), info, descriptor.getFd(), ref.getInt("size"), ref.getInt("format"), token, branch);
            }
            if (status < 0) throw new IllegalStateException("Cannot restore prepared asset");
            if (status == 0) {
                selected.put(key, ref);
                parametersChanged |= previous != null && !sameRef;
            }
            selectedSubmissions.put(key, new Submission(token, -1, status == 0 ? null : ref, false));
        }
        active = selected;
        submitted.clear();
        submitted.putAll(selectedSubmissions);
        return parametersChanged;
    }
    void collect(Iterable<JSONObject> states) throws Exception {
        HashSet<String> keep = new HashSet<>();
        for (Transfer transfer : pending.values()) keep.add(transfer.file.getName());
        for (Submission current : submitted.values()) {
            if (current.replacement != null) keep.add(file(current.replacement).getName());
        }
        ArrayList<JSONObject> refs = new ArrayList<>(); refs.add(active);
        for (JSONObject state : states) if (state != null && state.has("assetRefs")) refs.add(state.getJSONObject("assetRefs"));
        for (JSONObject map : refs) { java.util.Iterator<String> keys = map.keys(); while (keys.hasNext()) keep.add(file(map.getJSONObject(keys.next())).getName()); }
        collectFiles("asset-", keep);
    }

    private void collectFiles(String prefix, java.util.Set<String> keep) {
        File[] files = directory.listFiles((parent, name) -> name.startsWith(prefix) && name.endsWith(".bin"));
        if (files != null) for (File candidate : files) if (!keep.contains(candidate.getName())) candidate.delete();
    }

    JSONObject command(String operation, JSONObject args, HashMap<String, Integer> instances, HashMap<String, String> types, NativeEngine engine) throws Exception {
        String id = String.valueOf(args.get("pluginId"));
        Integer instance = instances.get(id);
        if (instance == null) throw new AudioService.HostError("stale-pipeline", "The effect changed. Load its file again.");
        return command(operation, args, instance, types.get(id), null, engine);
    }

    JSONObject command(String operation, JSONObject args, int instance, String type, String inactiveSlot, NativeEngine engine) throws Exception {
        String id = String.valueOf(args.get("pluginId"));
        int slot = args.optInt("slot", 0);
        if (slot < 0 || slot > 255) throw new IllegalArgumentException("Invalid asset slot");
        String key = (inactiveSlot == null ? "" : inactiveSlot + ":") + type + ":" + id + ":" + slot;
        Transfer owner = pending.get(key);
        if (owner != null && !operation.equals("pipeline.asset.begin") && !operation.equals("pipeline.asset.clear")
                && !java.util.Objects.equals(owner.batch, args.optString("_assetBatch", null)))
            throw new AudioService.HostError("revision-conflict", "The effect file changed.");
        String state = "pending";
        if (operation.equals("pipeline.asset.begin")) {
            long total = args.getInt("byteLength");
            for (java.util.Map.Entry<String, Transfer> entry : pending.entrySet()) if (!entry.getKey().equals(key)) total += entry.getValue().size;
            if (total > MAX_BYTES) throw new AudioService.HostError("asset-limit", "Finish loading the current effect file before loading another.");
            Transfer previous = pending.put(key, new Transfer(directory, instance, slot, id, type, args, branch));
            if (previous != null) previous.file.delete();
        } else if (operation.equals("pipeline.asset.abort") || operation.equals("pipeline.asset.clear")) {
            Transfer previous = pending.remove(key);
            if (previous != null) previous.file.delete();
            if (operation.equals("pipeline.asset.clear")) {
                if (inactiveSlot == null) {
                    if (engine.clearAsset(instance, slot, branch) < 0) throw new AudioService.HostError("asset-invalid", "The effect file could not be cleared.");
                    active.remove(key);
                    submitted.remove(key);
                }
                state = "empty";
            }
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
                JSONArray info = new JSONArray(); for (int value : transfer.info) info.put(value);
                JSONObject ref = AudioService.object("id", transfer.file.getName(), "pluginId", id, "type", transfer.type,
                        "slot", slot, "format", transfer.format, "size", transfer.size, "info", info,
                        "externalAssetSignature", transfer.signature, "externalAssetParameters", transfer.parameters);
                // Coefficients whose header names this engine's rate are restored only at that rate.
                if (header.getInt(12) == Math.round(engine.getSampleRate() / (float) transfer.info[4])) ref.put("sampleRate", engine.getSampleRate());
                pending.remove(key);
                // A parked slot keeps its file on disk. Native preparation starts when the slot gets a graph.
                if (inactiveSlot != null) return AudioService.object("state", "stored", "reference", ref);
                int status;
                long token = token();
                try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(transfer.file, ParcelFileDescriptor.MODE_READ_ONLY)) {
                    status = engine.setAssetFile(transfer.instance, transfer.slot, transfer.info, descriptor.getFd(), transfer.size, transfer.format, token, branch);
                } catch (Exception error) { transfer.file.delete(); throw error; }
                if (status < 0) { transfer.file.delete(); throw new AudioService.HostError("asset-invalid", "This effect file could not be loaded."); }
                if (branch == 1) transfer.file.delete(); // The graph owns the bytes until the test ends.
                if (status == 0) {
                    active.put(key, ref);
                    state = "ready";
                }
                submitted.put(key, new Submission(token, transfer.operationRevision, status == 0 ? null : ref, true));
                if (branch == 0) return AudioService.object("pluginId", args.get("pluginId"), "slot", slot, "state", state, "reference", ref);
            } else throw new AudioService.HostError("unsupported-operation", "This effect file operation is unavailable.");
        }
        return AudioService.object("pluginId", args.get("pluginId"), "slot", slot, "state", state);
    }
}
