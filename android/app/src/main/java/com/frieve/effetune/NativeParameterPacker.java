package com.frieve.effetune;

import android.content.Context;
import android.util.Base64;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import org.json.JSONArray;
import org.json.JSONObject;

/** Interprets the existing generator's normalized parameter schema. */
final class NativeParameterPacker {
    private final HashMap<String, JSONObject> specifications = new HashMap<>();
    private JSONObject names = new JSONObject();
    private JSONObject temporal;

    NativeParameterPacker(Context context) throws Exception {
        try (InputStream input = context.getAssets().open("web/android-dsp-contract.json")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) >= 0) { if (output.size() + count > 4 * 1024 * 1024) throw new IllegalStateException("DSP contract too large"); output.write(buffer, 0, count); }
            JSONObject contract = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            temporal = contract.getJSONObject("temporal");
            JSONArray specs = contract.getJSONArray("specs");
            for (int i = 0; i < specs.length(); i++) specifications.put(specs.getJSONObject(i).getString("type"), specs.getJSONObject(i));
            JSONObject displayNames = contract.optJSONObject("names");
            if (displayNames != null) { java.util.Iterator<String> types = displayNames.keys(); while (types.hasNext()) { String type = types.next(); names.put(displayNames.getString(type), type); } }
            names.put("Section", "SectionPlugin");
        }
    }

    JSONObject catalog(JSONArray effects) throws Exception {
        JSONObject next = new JSONObject();
        if (effects.length() > 128) throw new IllegalArgumentException("Invalid effect catalog");
        for (int i = 0; i < effects.length(); i++) {
            JSONObject effect = effects.getJSONObject(i);
            String name = effect.getString("name"), type = effect.getString("type");
            if (name.isEmpty() || name.length() > 128 || (!type.equals("SectionPlugin") && !specifications.containsKey(type))) throw new IllegalArgumentException("Unknown effect");
            next.put(name, type);
        }
        names = next; return next;
    }
    void restoreNames(JSONObject value) throws Exception { java.util.Iterator<String> keys = value.keys(); while (keys.hasNext()) { String name = keys.next(), type = value.getString(name); if (specifications.containsKey(type) || type.equals("SectionPlugin")) names.put(name, type); } }
    JSONArray effectNames() { return names.names() == null ? new JSONArray() : names.names(); }
    boolean needsAssetPreparation(String type) { JSONObject spec = specifications.get(type); return spec != null && spec.optJSONArray("assets") != null && spec.optJSONArray("assets").length() != 0; }

    JSONObject prepareChain(JSONArray chain, boolean bypass, String slot) throws Exception {
        if (chain.length() > 128) throw new IllegalArgumentException("Too many effects");
        JSONArray records = new JSONArray();
        for (int i = 0; i < chain.length(); i++) {
            JSONObject state = chain.getJSONObject(i);
            String name = state.getString("nm");
            String type = names.optString(name, "");
            if (type.isEmpty()) throw new AudioService.HostError("unknown effect", "This effect is unavailable.");
            JSONObject params = new JSONObject(state.toString());
            params.remove("nm"); params.remove("en");
            if (params.has("ch")) params.put("channel", params.remove("ch"));
            if (params.has("ib")) params.put("inputBus", params.remove("ib"));
            if (params.has("ob")) params.put("outputBus", params.remove("ob"));
            JSONObject record = AudioService.object("id", i + 1, "name", name, "type", type, "enabled", state.optBoolean("en", true), "parameters", params);
            packRecord(record); records.put(record);
        }
        return prepareRecords(records, bypass, slot);
    }

    JSONObject prepareRecords(JSONArray records, boolean bypass, String slot) throws Exception {
        int count = 0;
        for (int i = 0; i < records.length(); i++) if (!records.getJSONObject(i).getString("type").equals("SectionPlugin")) count++;
        ByteBuffer descriptor = ByteBuffer.allocate(8 + count * 12).order(ByteOrder.LITTLE_ENDIAN).putInt(1).putInt(count);
        boolean section = true;
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (record.getString("type").equals("SectionPlugin")) { section = record.optBoolean("enabled", true); continue; }
            JSONObject params = record.getJSONObject("parameters");
            int input = params.optInt("inputBus", 0), output = params.optInt("outputBus", 0);
            if (input < 0 || input > 4 || output < 0 || output > 4) throw new IllegalArgumentException("Invalid routing bus");
            descriptor.putInt(record.getInt("id")).put((byte) (record.optBoolean("enabled", true) ? 1 : 0)).put((byte) input).put((byte) output)
                    .put((byte) channel(params.opt("channel"))).put((byte) (section ? 1 : 0)).put(new byte[3]);
        }
        return AudioService.object("plugins", records, "descriptor", Base64.encodeToString(descriptor.array(), Base64.NO_WRAP), "masterBypass", bypass, "slot", slot,
                "temporalMustProcess", mustProcessPipeline(records, bypass));
    }

    boolean mustProcessPipeline(JSONArray records, boolean bypass) throws Exception {
        if (bypass) return false;
        boolean section = true;
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (record.getString("type").equals("SectionPlugin")) section = record.optBoolean("enabled", true);
            else if (section && mustProcess(record)) return true;
        }
        return false;
    }

    boolean mustProcess(JSONObject record) throws Exception {
        if (!record.optBoolean("enabled", true) || record.getString("type").equals("SectionPlugin")) return false;
        JSONObject policy = temporal.getJSONObject(record.getString("type"));
        JSONArray conditions = policy.optJSONArray("mustProcessWhen");
        if (conditions == null) return policy.getString("capability").equals("must-process") || policy.getString("capability").equals("age-by-skipped-frames");
        JSONObject params = record.getJSONObject("parameters");
        JSONArray fields = specifications.get(record.getString("type")).getJSONArray("fields");
        for (int i = 0; i < conditions.length(); i++) {
            JSONObject condition = conditions.getJSONObject(i); String key = condition.getString("key");
            Object actual = key.equals("enabled") ? record.optBoolean("enabled", true) : params.opt(key);
            if (actual == null || actual == JSONObject.NULL) {
                for (int f = 0; f < fields.length(); f++) { JSONObject field = fields.getJSONObject(f); JSONArray keys = field.getJSONArray("keys"); for (int n = 0; n < keys.length(); n++) if (key.equals(keys.getString(n))) actual = field.getJSONArray("defaults").get(n); }
            }
            Object expected = condition.get("value"); String operator = condition.getString("operator");
            boolean equal = actual instanceof Number && expected instanceof Number ? ((Number) actual).doubleValue() == ((Number) expected).doubleValue() : java.util.Objects.equals(actual, expected);
            if (operator.equals("!==")) { if (equal) return false; }
            else if (operator.equals("===")) { if (!equal) return false; }
            else {
                if (!(actual instanceof Number) || !(expected instanceof Number)) return false;
                double left = ((Number) actual).doubleValue(), right = ((Number) expected).doubleValue();
                if (!(operator.equals(">") ? left > right : operator.equals("<") ? left < right : operator.equals(">=") ? left >= right : left <= right)) return false;
            }
        }
        return true;
    }

    void packRecord(JSONObject record) throws Exception {
        String type = record.getString("type");
        if (type.equals("SectionPlugin")) { record.put("parameterValues", new JSONArray()).put("layoutHash", 0); return; }
        JSONObject spec = specifications.get(type);
        if (spec == null) throw new IllegalArgumentException("Unknown effect type");
        JSONObject params = record.getJSONObject("parameters");
        JSONArray packed = new JSONArray();
        JSONArray fields = spec.getJSONArray("fields");
        for (int i = 0; i < fields.length(); i++) {
            JSONObject field = fields.getJSONObject(i);
            JSONArray keys = field.getJSONArray("keys"), defaults = field.getJSONArray("defaults");
            for (int element = 0; element < keys.length(); element++) {
                Object value = params.opt(keys.getString(element));
                JSONArray array = params.optJSONArray(field.optString("arrayKey", ""));
                JSONArray objects = params.optJSONArray(field.optString("objectArrayKey", ""));
                if (array != null) value = array.opt(element);
                else if (objects != null) { JSONObject item = objects.optJSONObject(element); value = item == null ? null : item.opt(field.optString("memberKey")); }
                Object fallback = defaults.get(element);
                String kind = field.getString("kind");
                double number;
                if (kind.equals("bool")) number = Boolean.TRUE.equals(value) || (value instanceof Number && ((Number) value).doubleValue() == 1) ? 1 : Boolean.FALSE.equals(value) || (value instanceof Number && ((Number) value).doubleValue() == 0) ? 0 : Boolean.TRUE.equals(fallback) ? 1 : 0;
                else if (kind.equals("enum")) {
                    JSONArray choices = field.getJSONArray("values");
                    int choice = -1, defaultChoice = -1;
                    for (int n = 0; n < choices.length(); n++) { if (choices.get(n).equals(value)) choice = n; if (choices.get(n).equals(fallback)) defaultChoice = n; }
                    if (choice < 0 && value != null && value != JSONObject.NULL && field.optBoolean("rejectInvalid")) throw new IllegalArgumentException("Invalid enum value");
                    number = choice < 0 ? defaultChoice : choice;
                } else {
                    number = value instanceof Number ? ((Number) value).doubleValue() : Double.NaN;
                    if (!Double.isFinite(number) || (kind.equals("int") && (number != Math.rint(number) || Math.abs(number) > 9007199254740991.0))) number = ((Number) fallback).doubleValue();
                    else number = Math.max(field.getDouble("min"), Math.min(field.getDouble("max"), number));
                }
                packed.put((double) (float) number);
            }
        }
        record.put("parameterValues", packed).put("layoutHash", spec.getLong("hash"));
        JSONObject structured = spec.optJSONObject("structured");
        if (structured != null) {
            if (!structured.getString("codec").equals("matrix-routes-v1")) throw new IllegalArgumentException("Unsupported structured parameters");
            Object candidate = params.opt(structured.getString("key"));
            String text = candidate instanceof String ? (String) candidate : structured.getString("defaultValue");
            ByteBuffer bytes = ByteBuffer.allocate(4 + structured.getInt("maxItems") * 3).order(ByteOrder.LITTLE_ENDIAN); bytes.putInt(1);
            int routes = 0;
            for (int offset = 0; offset < text.length();) {
                int phase = 0;
                if (text.charAt(offset) == 'p') { phase = 1; offset++; }
                if (offset + 1 >= text.length()) break;
                int input = "0123456789abcdef".indexOf(text.charAt(offset)), output = "0123456789abcdef".indexOf(text.charAt(offset + 1));
                if (input >= 0 && output >= 0) {
                    if (routes == structured.getInt("maxItems")) throw new IllegalArgumentException("Too many matrix routes");
                    bytes.put((byte) input).put((byte) output).put((byte) phase); routes++;
                }
                offset += 2;
            }
            bytes.putShort(2, (short) routes);
            record.put("parameterBytes", Base64.encodeToString(java.util.Arrays.copyOf(bytes.array(), 4 + routes * 3), Base64.NO_WRAP));
        }
    }

    private int channel(Object value) {
        if (value == null || value == JSONObject.NULL) return -1;
        String text = value.toString();
        if (text.equals("A")) return -2;
        if (text.equals("L")) return 0;
        if (text.equals("R")) return 1;
        String[] pairs = {"34", "56", "78", "910", "1112", "1314", "1516"};
        for (int i = 0; i < pairs.length; i++) if (text.equals(pairs[i])) return 17 + i;
        int channel = Integer.parseInt(text);
        if (channel < 1 || channel > 16) throw new IllegalArgumentException("Invalid channel");
        return channel - 1;
    }
}
