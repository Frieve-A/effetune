package com.frieve.effetune;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.Arrays;
import java.util.Collections;
import java.util.function.DoubleSupplier;
import org.json.JSONArray;
import org.json.JSONObject;

/** Service-owned mapping state. Descriptors come from the shared generated automation catalog. */
final class MidiMappings {
    interface Sink {
        JSONArray pipeline() throws Exception;
        void commit(JSONArray records, boolean physical) throws Exception;
        void action(String key, int direction) throws Exception;
        double readGlobal(String key) throws Exception;
        void writeGlobal(String key, double value) throws Exception;
    }

    static final Set<String> NATIVE_KINDS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList("cc", "note", "pitchbend", "mcuFader", "mcuVpot", "mcuButton", "clock", "timer")));
    private final Sink sink;
    private final DoubleSupplier random;
    private JSONArray mappings = new JSONArray();
    private final HashMap<String, String> protocols = new HashMap<>();
    private final HashMap<String, MappingState> states = new HashMap<>();
    private final HashMap<String, MidiStream> streams = new HashMap<>();
    private boolean learning;
    private long nextClock;
    private long nextWall;

    private static final class MappingState {
        String signature = "";
        String schedule = "";
        Object lastValue;
        double normalized;
        boolean accumulated;
        boolean threshold;
        long deadline;
        long occurrence;
        LocalDate nextDate;
        LocalDate lastDate;
        boolean expired;
        boolean fired;
        Object absolute;
        String absoluteSignature;
    }

    private static final class MidiStream {
        int status;
        int count;
        final int[] data = new int[2];
    }

    MidiMappings(Sink sink) { this(sink, Math::random); }
    MidiMappings(Sink sink, DoubleSupplier random) { this.sink = sink; this.random = random; }

    void configure(JSONObject config, long monotonicMs, long wallEpochMs) throws Exception {
        if (config.optInt("version") != 1) throw new IllegalArgumentException("Invalid MIDI configuration");
        JSONArray incoming = config.getJSONArray("mappings");
        if (incoming.length() > 4096) throw new IllegalArgumentException("Too many MIDI mappings");
        JSONArray accepted = new JSONArray();
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < incoming.length(); i++) {
            JSONObject mapping = new JSONObject(incoming.getJSONObject(i).toString());
            JSONObject source = mapping.getJSONObject("source");
            if (!NATIVE_KINDS.contains(source.getString("kind"))) continue;
            String id = mapping.getString("id");
            if (id.isEmpty() || !ids.add(id)) throw new IllegalArgumentException("Invalid MIDI mapping identity");
            JSONObject target = mapping.getJSONObject("target");
            String rule = target.optString("instance", "first");
            if (!Arrays.asList("first", "last", "all").contains(rule)) throw new IllegalArgumentException("Invalid MIDI target");
            JSONObject descriptor = mapping.optJSONObject("descriptor");
            if (!target.getString("param").equals("_enabled") && !target.getString("type").equals("_global") && descriptor == null) {
                throw new IllegalArgumentException("MIDI target descriptor is missing");
            }
            if (descriptor != null) validateDescriptor(descriptor);
            MappingState state = states.computeIfAbsent(id, key -> new MappingState());
            String signature = target.toString() + mapping.getJSONObject("map").toString();
            if (!signature.equals(state.signature)) {
                state.signature = signature;
                state.accumulated = false;
                state.absolute = null;
                state.threshold = false;
            }
            if (source.getString("kind").equals("timer") && !source.toString().equals(state.schedule)) {
                state.schedule = source.toString();
                armTimer(state, source, monotonicMs, wallEpochMs);
            }
            accepted.put(mapping);
        }
        states.keySet().retainAll(ids);
        protocols.clear();
        JSONArray devices = config.optJSONArray("devices");
        if (devices != null) for (int i = 0; i < devices.length(); i++) {
            JSONObject device = devices.getJSONObject(i);
            protocols.put(device.getString("key"), device.optString("protocol", "generic"));
        }
        mappings = accepted;
        learning = config.optBoolean("learning");
        if (nextClock == 0) nextClock = monotonicMs;
        if (nextWall == 0) nextWall = monotonicMs + 1000;
    }

    private static void validateDescriptor(JSONObject descriptor) throws Exception {
        String normalization = descriptor.getString("normalization");
        if (!Arrays.asList("linear", "log", "integer", "bool", "enum").contains(normalization)) throw new IllegalArgumentException("Invalid normalization");
        if (normalization.equals("enum")) {
            JSONArray values = descriptor.getJSONArray("values");
            if (values.length() == 0 || values.length() > 4096) throw new IllegalArgumentException("Invalid enumeration");
        } else {
            double minimum = descriptor.getDouble("minimum"), maximum = descriptor.getDouble("maximum");
            if (!Double.isFinite(minimum) || !Double.isFinite(maximum) || maximum <= minimum || normalization.equals("log") && minimum <= 0) {
                throw new IllegalArgumentException("Invalid target range");
            }
        }
        if (descriptor.optInt("element", 0) < 0 || descriptor.optInt("element", 0) > 4095) throw new IllegalArgumentException("Invalid target element");
    }

    void disconnect(String device) { streams.remove(device); }
    void setLearning(boolean active) { learning = active; }

    boolean consume(String device, byte[] bytes, long timestampMs) throws Exception {
        MidiStream stream = streams.computeIfAbsent(device, key -> new MidiStream());
        boolean consumed = false;
        for (byte value : bytes) {
            int data = value & 255;
            if (data >= 0xf8) continue;
            if (data >= 0x80) {
                stream.status = data < 0xf0 ? data : 0;
                stream.count = 0;
                continue;
            }
            if (stream.status == 0) continue;
            int type = stream.status & 0xf0;
            int length = type == 0xc0 || type == 0xd0 ? 1 : 2;
            stream.data[stream.count++] = data;
            if (stream.count < length) continue;
            stream.count = 0;
            consumed |= dispatch(device, stream.status, stream.data[0], length == 2 ? stream.data[1] : 0);
        }
        return consumed;
    }

    private boolean dispatch(String device, int status, int first, int second) throws Exception {
        int channel = status & 15, type = status & 0xf0, number = first;
        boolean mcu = "mcu".equals(protocols.get(device));
        String kind;
        double value;
        if (type == 0xe0) { kind = mcu ? "mcuFader" : "pitchbend"; value = first | second << 7; if (mcu && channel > 8) return false; }
        else if (type == 0xb0) {
            if (mcu) {
                if (first < 16 || first > 23) return false;
                kind = "mcuVpot"; number -= 16;
                value = second >= 1 && second <= 7 ? second : second >= 65 && second <= 71 ? -(second - 64) : 0;
            } else { kind = "cc"; value = second; }
        } else if (type == 0x90 || type == 0x80) {
            if (mcu && first >= 104 && first <= 112) return false;
            kind = mcu ? "mcuButton" : "note";
            value = type == 0x90 && second > 0 ? 1 : 0;
        } else return false;
        boolean matched = false;
        for (int i = 0; i < mappings.length(); i++) {
            JSONObject mapping = mappings.getJSONObject(i), source = mapping.getJSONObject("source");
            if (!device.equals(mapping.optString("device")) || !kind.equals(source.getString("kind")) || channel != source.optInt("channel")) continue;
            if (!kind.equals("pitchbend") && !kind.equals("mcuFader") && number != source.optInt("number")) continue;
            matched = true;
            if (learning) continue;
            if (kind.equals("pitchbend") || kind.equals("mcuFader")) apply(mapping, "absolute", value / 16383, true);
            else if (kind.equals("cc") && source.optString("mode").equals("abs")) apply(mapping, "absolute", value / 127, true);
            else if (kind.equals("note") || kind.equals("mcuButton")) apply(mapping, "button", value, true);
            else {
                double delta = value;
                if (kind.equals("cc")) {
                    int raw = (int) value;
                    switch (source.optString("mode")) {
                        case "rel2c": delta = raw == 64 ? 0 : raw < 64 ? raw : raw - 128; break;
                        case "relBin": delta = raw - 64; break;
                        case "relSign": delta = raw == 64 ? 0 : raw >= 65 ? -(raw - 64) : raw; break;
                        default: delta = 0;
                    }
                }
                if (delta != 0) apply(mapping, "relative", delta, true);
            }
        }
        return matched;
    }

    void tick(long monotonicMs, long wallEpochMs) throws Exception {
        boolean clockDue = monotonicMs >= nextClock, wallDue = monotonicMs >= nextWall;
        if (clockDue) nextClock = monotonicMs + 1000;
        if (wallDue) nextWall = monotonicMs + 1000;
        ZonedDateTime now = Instant.ofEpochMilli(wallEpochMs).atZone(ZoneId.systemDefault());
        for (int i = 0; i < mappings.length(); i++) {
            JSONObject mapping = mappings.getJSONObject(i), source = mapping.getJSONObject("source");
            String kind = source.getString("kind");
            if (kind.equals("clock") && clockDue) apply(mapping, "absolute", clockValue(source, now), false);
            if (!kind.equals("timer")) continue;
            MappingState state = states.get(mapping.getString("id"));
            String schedule = source.optString("schedule", "interval");
            boolean fire = false;
            if (schedule.equals("interval") && monotonicMs >= state.deadline) {
                state.deadline = monotonicMs + source.getLong("intervalMs"); fire = true;
            } else if (wallDue && schedule.equals("once") && !state.expired && !state.fired && wallEpochMs >= state.occurrence) {
                state.fired = true; fire = true;
            } else if (wallDue && schedule.equals("daily") && wallEpochMs >= occurrence(state.nextDate, source)
                    && !state.nextDate.equals(state.lastDate)) {
                state.lastDate = state.nextDate;
                state.nextDate = now.toLocalDate().plusDays(1); fire = true;
            }
            if (fire) apply(mapping, "timer", 1, false);
        }
    }

    private static void armTimer(MappingState state, JSONObject source, long monotonicMs, long wallEpochMs) throws Exception {
        state.fired = false; state.expired = false; state.lastDate = null;
        String schedule = source.optString("schedule", "interval");
        if (schedule.equals("interval")) {
            long interval = source.getLong("intervalMs");
            if (interval < 1000 || interval > 2147483647L) throw new IllegalArgumentException("Invalid timer interval");
            state.deadline = monotonicMs + interval;
        } else if (schedule.equals("once")) {
            state.occurrence = occurrence(LocalDate.parse(source.getString("date")), source);
            state.expired = state.occurrence <= wallEpochMs;
        } else if (schedule.equals("daily")) {
            state.nextDate = Instant.ofEpochMilli(wallEpochMs).atZone(ZoneId.systemDefault()).toLocalDate();
            if (occurrence(state.nextDate, source) <= wallEpochMs) state.nextDate = state.nextDate.plusDays(1);
        } else throw new IllegalArgumentException("Invalid timer schedule");
    }

    private static long occurrence(LocalDate date, JSONObject source) throws Exception {
        return LocalDateTime.of(date.getYear(), date.getMonthValue(), date.getDayOfMonth(), source.getInt("hour"), source.getInt("minute"), source.getInt("second"))
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    static double clockValue(JSONObject source, ZonedDateTime date) {
        double seconds = date.getSecond() + date.getNano() / 1e9;
        double phase = source.optString("component").equals("second") ? seconds / 60
                : source.optString("component").equals("minute") ? (date.getMinute() + seconds / 60) / 60
                : (date.getHour() + date.getMinute() / 60.0 + seconds / 3600) / 24;
        if (source.optString("shape").equals("sin")) return (Math.sin(2 * Math.PI * phase) + 1) / 2;
        if (source.optString("shape").equals("cos")) return (Math.cos(2 * Math.PI * phase) + 1) / 2;
        return phase;
    }

    private void apply(JSONObject mapping, String event, double value, boolean physical) throws Exception {
        JSONObject target = mapping.getJSONObject("target"), map = mapping.getJSONObject("map");
        JSONObject descriptor = mapping.optJSONObject("descriptor");
        MappingState state = states.get(mapping.getString("id"));
        boolean global = target.getString("type").equals("_global"), enabled = target.getString("param").equals("_enabled");
        String kind = enabled || global && descriptor == null ? "bool" : descriptor.getString("kind");
        if (global && descriptor == null) {
            if (event.equals("absolute")) {
                boolean active = value >= 0.5, wasActive = state.threshold; state.threshold = active;
                if (active && !wasActive) sink.action(target.getString("param"), map.optInt("dir", 1));
            } else if (event.equals("button") && value != 0) sink.action(target.getString("param"), map.optInt("dir", 1));
            else if (event.equals("relative")) for (int i = 0; i < Math.max(1, Math.round(Math.abs(value))); i++) sink.action(target.getString("param"), value < 0 ? -1 : 1);
            return;
        }
        JSONArray records = new JSONArray(sink.pipeline().toString());
        ArrayList<JSONObject> targets = new ArrayList<>();
        if (!global) for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (target.getString("type").equals(record.optString("type"))) targets.add(record);
        }
        String rule = target.optString("instance", "first");
        if (!rule.equals("all") && targets.size() > 1) {
            JSONObject chosen = targets.get(rule.equals("last") ? targets.size() - 1 : 0);
            targets.clear(); targets.add(chosen);
        }
        if (!global && targets.isEmpty()) return;
        Object current = global ? sink.readGlobal(target.getString("param")) : enabled ? targets.get(0).optBoolean("enabled", true) : read(targets.get(0).getJSONObject("parameters"), descriptor);
        Object next = current;
        boolean button = event.equals("button"), relative = event.equals("relative");
        int direction = map.optInt("dir", 1);
        if (event.equals("absolute")) {
            String signature = target.toString() + map.toString() + targets.stream().map(record -> record.optString("id")).reduce("", (a, b) -> a + ":" + b);
            if (Objects.equals(state.absolute, value) && signature.equals(state.absoluteSignature)) return;
            state.absolute = value; state.absoluteSignature = signature;
            next = enabled ? value >= 0.5 : denormalize(descriptor, normalize(descriptor, map.get("lo"))
                    + clamp(value, 0, 1) * (normalize(descriptor, map.get("hi")) - normalize(descriptor, map.get("lo"))));
        } else if (kind.equals("bool")) {
            if (button && value == 0 && !map.optString("buttonMode").equals("momentary")) return;
            boolean on = Boolean.TRUE.equals(current) || current instanceof Number && ((Number) current).doubleValue() != 0;
            int count = relative ? Math.max(1, (int) Math.round(Math.abs(value))) : 1;
            next = button && map.optString("buttonMode").equals("momentary") ? value != 0 : count % 2 == 0 ? on : !on;
        } else if (kind.equals("enum")) {
            if (button && value == 0) return;
            JSONArray choices = descriptor.getJSONArray("values");
            int lo = indexOf(choices, map.get("lo")), hi = indexOf(choices, map.get("hi"));
            int lower = Math.min(lo, hi), upper = Math.max(lo, hi), index = (int) clamp(indexOf(choices, current), lower, upper);
            int step = (relative ? value < 0 ? -1 : 1 : direction) * (hi < lo ? -1 : 1);
            int count = relative ? Math.max(1, (int) Math.round(Math.abs(value))) : 1;
            int offset = index + count * step;
            next = choices.get(relative ? (int) clamp(offset, lower, upper) : lower + Math.floorMod(offset - lower, upper - lower + 1));
        } else if (event.equals("timer") || button && !map.optString("behavior", "direct").equals("direct")) {
            if (button && value == 0) return;
            double lo = map.getDouble("lo"), hi = map.getDouble("hi"), minimum = Math.min(lo, hi), maximum = Math.max(lo, hi);
            double randomValue = clamp(random.getAsDouble(), 0, 1), number;
            String behavior = map.optString("behavior", "direct");
            if (behavior.equals("random")) {
                double step = descriptor.optDouble("step", 1);
                number = kind.equals("int") ? minimum + Math.floor(randomValue * (Math.round((maximum - minimum) / step) + 1)) * step : minimum + randomValue * (maximum - minimum);
            } else number = number(current, descriptor.optDouble("default")) + (behavior.equals("randomWalk") ? randomValue < 0.5 ? -1 : 1 : direction) * map.getDouble("amount");
            next = canonical(descriptor, clamp(number, minimum, maximum));
        } else if (button && descriptor.optJSONArray("valuesForButtons") != null) {
            if (value == 0) return;
            JSONArray choices = descriptor.getJSONArray("valuesForButtons");
            double lo = map.getDouble("lo"), hi = map.getDouble("hi");
            int step = direction * (hi < lo ? -1 : 1);
            double held = number(current, 1);
            for (int i = step > 0 ? 0 : choices.length() - 1; i >= 0 && i < choices.length(); i += step > 0 ? 1 : -1) {
                double candidate = choices.getDouble(i);
                if (step > 0 ? candidate > held : candidate < held) { next = clamp(candidate, Math.min(lo, hi), Math.max(lo, hi)); break; }
            }
        } else {
            if (button && value == 0) return;
            double delta = button ? direction : value;
            double lo = normalize(descriptor, map.get("lo")), hi = normalize(descriptor, map.get("hi"));
            String signature = state.signature + ":" + (global ? "global" : targets.get(0).getString("id"));
            if (!state.accumulated || !signature.equals(state.absoluteSignature) || !sameValue(current, state.lastValue)) state.normalized = normalize(descriptor, current);
            state.normalized = clamp(state.normalized + delta / 127 * map.optDouble("sensitivity", 1) * (hi < lo ? -1 : 1), Math.min(lo, hi), Math.max(lo, hi));
            next = denormalize(descriptor, state.normalized);
            state.lastValue = next; state.accumulated = true; state.absoluteSignature = signature;
        }
        if (global) sink.writeGlobal(target.getString("param"), number(next, 1));
        else {
            boolean changed = false;
            for (JSONObject record : targets) {
                Object held = enabled ? record.optBoolean("enabled", true) : read(record.getJSONObject("parameters"), descriptor);
                if (sameValue(held, next)) continue;
                if (enabled) record.put("enabled", next); else write(record.getJSONObject("parameters"), descriptor, next);
                changed = true;
            }
            if (changed) sink.commit(records, physical);
        }
    }

    private static Object read(JSONObject parameters, JSONObject descriptor) throws Exception {
        Object value;
        String container = descriptor.optString("containerKey"), member = descriptor.optString("memberKey");
        if (container.isEmpty()) value = parameters.opt(descriptor.getString("field"));
        else {
            JSONArray array = parameters.optJSONArray(container);
            value = array == null ? null : array.opt(descriptor.optInt("element"));
            if (!member.isEmpty()) value = value instanceof JSONObject ? ((JSONObject) value).opt(member) : null;
        }
        if (value == null || value == JSONObject.NULL) value = descriptor.opt("packedDefault");
        String transform = descriptor.optString("transform", "identity");
        double numeric = number(value, descriptor.optDouble("packedDefault"));
        if (transform.equals("naturalLog")) return Math.exp(numeric);
        if (transform.equals("log10")) return Math.pow(10, numeric);
        if (transform.equals("decibelsFromReference")) return descriptor.getDouble("transformReference") * Math.pow(10, numeric / 20);
        return value;
    }

    private static void write(JSONObject parameters, JSONObject descriptor, Object value) throws Exception {
        String transform = descriptor.optString("transform", "identity");
        double numeric = number(value, descriptor.optDouble("default"));
        if (transform.equals("naturalLog")) value = Math.log(numeric);
        else if (transform.equals("log10")) value = Math.log10(numeric);
        else if (transform.equals("decibelsFromReference")) value = 20 * Math.log10(numeric / descriptor.getDouble("transformReference"));
        String container = descriptor.optString("containerKey"), member = descriptor.optString("memberKey");
        if (container.isEmpty()) { parameters.put(descriptor.getString("field"), value); return; }
        JSONArray array = parameters.optJSONArray(container);
        if (array == null) array = new JSONArray();
        int element = descriptor.optInt("element");
        while (array.length() <= element) {
            Object seed = array.length() == 0 ? member.isEmpty() ? value : new JSONObject() : array.get(array.length() - 1);
            if (seed instanceof JSONObject) seed = new JSONObject(seed.toString());
            else if (seed instanceof JSONArray) seed = new JSONArray(seed.toString());
            array.put(seed);
        }
        if (member.isEmpty()) array.put(element, value);
        else {
            JSONObject item = array.optJSONObject(element);
            if (item == null) item = new JSONObject();
            item.put(member, value); array.put(element, item);
        }
        parameters.put(container, array);
    }

    static double normalize(JSONObject descriptor, Object value) throws Exception {
        String mode = descriptor.getString("normalization");
        if (mode.equals("bool")) {
            if (Boolean.TRUE.equals(value) || sameValue(value, 1)) return 1;
            if (Boolean.FALSE.equals(value) || sameValue(value, 0)) return 0;
            return descriptor.optBoolean("default") ? 1 : 0;
        }
        if (mode.equals("enum")) {
            JSONArray choices = descriptor.getJSONArray("values");
            int index = indexOf(choices, value);
            return (index < 0 ? indexOf(choices, descriptor.get("default")) : index) / (double) descriptor.getInt("stepCount");
        }
        double minimum = descriptor.getDouble("minimum"), maximum = descriptor.getDouble("maximum");
        double numeric = number(value, descriptor.getDouble("default"));
        if (mode.equals("log")) return Math.log(clamp(numeric, minimum, maximum) / minimum) / Math.log(maximum / minimum);
        if (mode.equals("integer")) {
            if (numeric != Math.rint(numeric) || Math.abs(numeric) > 9007199254740991d) numeric = descriptor.getDouble("default");
            return clamp((numeric - minimum) / descriptor.getDouble("step") / descriptor.getInt("stepCount"), 0, 1);
        }
        return clamp((numeric - minimum) / (maximum - minimum), 0, 1);
    }

    static Object denormalize(JSONObject descriptor, double value) throws Exception {
        value = Double.isFinite(value) ? clamp(value, 0, 1) : normalize(descriptor, descriptor.get("default"));
        switch (descriptor.getString("normalization")) {
            case "bool": return value >= 0.5;
            case "enum": return descriptor.getJSONArray("values").get((int) Math.round(value * descriptor.getInt("stepCount")));
            case "integer": return descriptor.getDouble("minimum") + Math.round(value * descriptor.getInt("stepCount")) * descriptor.getDouble("step");
            case "log": return descriptor.getDouble("minimum") * Math.pow(descriptor.getDouble("maximum") / descriptor.getDouble("minimum"), value);
            default: return descriptor.getDouble("minimum") + value * (descriptor.getDouble("maximum") - descriptor.getDouble("minimum"));
        }
    }

    private static double canonical(JSONObject descriptor, double value) throws Exception {
        double minimum = descriptor.getDouble("minimum"), maximum = descriptor.getDouble("maximum");
        value = clamp(value, minimum, maximum);
        if (descriptor.getString("kind").equals("int")) {
            double step = descriptor.getDouble("step");
            value = minimum + Math.round((value - minimum) / step) * step;
        }
        return clamp(value, minimum, maximum);
    }
    private static boolean sameValue(Object first, Object second) {
        return first instanceof Number && second instanceof Number
                ? ((Number) first).doubleValue() == ((Number) second).doubleValue() : Objects.equals(first, second);
    }
    private static int indexOf(JSONArray array, Object value) { for (int i = 0; i < array.length(); i++) if (sameValue(array.opt(i), value)) return i; return -1; }
    private static double number(Object value, double fallback) { return value instanceof Number && Double.isFinite(((Number) value).doubleValue()) ? ((Number) value).doubleValue() : fallback; }
    private static double clamp(double value, double minimum, double maximum) { return Math.max(minimum, Math.min(maximum, value)); }
}
