package com.frieve.effetune;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class MidiMappingsTest {
    @Test public void reconnectReusesVacatedControllerIdentityWithoutCollidingWithPeers() {
        ArrayList<String> occupied = new ArrayList<>();
        occupied.add(MidiInput.availableDeviceKey("Controller", occupied));
        occupied.add(MidiInput.availableDeviceKey("Controller", occupied));
        assertEquals("Controller\u00002", occupied.get(1));
        occupied.remove(0);
        assertEquals("Controller", MidiInput.availableDeviceKey("Controller", occupied));
        occupied.add("Controller");
        assertEquals("Controller\u00003", MidiInput.availableDeviceKey("Controller", occupied));
    }
    private static final class Sink implements MidiMappings.Sink {
        JSONArray records = new JSONArray();
        final ArrayList<String> actions = new ArrayList<>();
        int commits;
        boolean physical;
        double speed = 1;
        Sink() throws Exception {
            records.put(record(1, 0)).put(record(2, 40));
        }
        public JSONArray pipeline() { return records; }
        public void commit(JSONArray value, boolean physical) { records = value; commits++; this.physical = physical; }
        public void action(String key, int direction) { actions.add(key + ":" + direction); }
        public double readGlobal(String key) { return speed; }
        public void writeGlobal(String key, double value) { speed = value; }
        double value(int index) throws Exception { return records.getJSONObject(index).getJSONObject("parameters").getDouble("value"); }
    }

    private static JSONObject record(int id, double value) throws Exception {
        return new JSONObject().put("id", id).put("type", "TestPlugin").put("enabled", true)
                .put("parameters", new JSONObject().put("value", value));
    }
    private static JSONObject descriptor() throws Exception {
        return new JSONObject().put("key", "value").put("field", "value").put("element", 0)
                .put("kind", "float").put("normalization", "linear").put("minimum", 0).put("maximum", 127)
                .put("default", 0).put("packedDefault", 0).put("step", 1).put("stepCount", 127);
    }
    private static JSONObject source(String kind, int number) throws Exception {
        return new JSONObject().put("kind", kind).put("channel", 0).put("number", number).put("mode", "abs");
    }
    private static JSONObject mapping(String id, JSONObject source) throws Exception {
        return new JSONObject().put("id", id).put("device", "Controller").put("source", source)
                .put("target", new JSONObject().put("type", "TestPlugin").put("instance", "first").put("param", "value").put("element", 0))
                .put("descriptor", descriptor()).put("map", new JSONObject().put("lo", 0).put("hi", 127)
                        .put("dir", 1).put("sensitivity", 1).put("behavior", "direct").put("amount", 1).put("buttonMode", "toggle"));
    }
    private static JSONObject config(JSONObject... mappings) throws Exception {
        JSONArray items = new JSONArray();
        for (JSONObject mapping : mappings) items.put(mapping);
        return new JSONObject().put("version", 1).put("devices", new JSONArray()).put("mappings", items);
    }
    private static byte[] bytes(int... values) {
        byte[] result = new byte[values.length];
        for (int i = 0; i < values.length; i++) result[i] = (byte) values[i];
        return result;
    }

    @Test public void normalizationMatchesSharedGeneratedCatalog() throws Exception {
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getTargetContext().getAssets().open("web/android-automation-fixtures.json")) {
            byte[] buffer = new byte[8192]; int size;
            while ((size = input.read(buffer)) >= 0) data.write(buffer, 0, size);
        }
        JSONArray fixtures = new JSONArray(data.toString("UTF-8"));
        assertTrue(fixtures.length() >= 5);
        for (int i = 0; i < fixtures.length(); i++) {
            JSONObject fixture = fixtures.getJSONObject(i), descriptor = fixture.getJSONObject("descriptor");
            JSONArray values = fixture.getJSONArray("values");
            for (int j = 0; j < values.length(); j++) {
                JSONObject point = values.getJSONObject(j);
                Object expected = point.get("plain"), actual = MidiMappings.denormalize(descriptor, point.getDouble("normalized"));
                String label = descriptor.toString();
                if (expected instanceof Number) assertEquals(label, ((Number) expected).doubleValue(), ((Number) actual).doubleValue(), Math.abs(((Number) expected).doubleValue()) * 1e-12 + 1e-12);
                else assertEquals(label, expected, actual);
                assertEquals(label, MidiMappings.normalize(descriptor, expected), MidiMappings.normalize(descriptor, actual), 1e-12);
            }
        }
    }

    @Test public void fragmentedRunningStatusAndRealtimeMessagesPreserveMappings() throws Exception {
        Sink sink = new Sink(); MidiMappings engine = new MidiMappings(sink);
        JSONObject mapping = mapping("cc", source("cc", 7));
        mapping.getJSONObject("target").put("instance", "all");
        engine.configure(config(mapping), 0, 0);
        assertFalse(engine.consume("Controller", bytes(0xb0, 7), 0));
        assertTrue(engine.consume("Controller", bytes(0xf8, 31, 7, 95), 0));
        assertEquals(95, sink.value(0), 1e-9); assertEquals(95, sink.value(1), 1e-9);
        assertTrue(sink.physical);
        engine.disconnect("Controller");
        assertFalse(engine.consume("Controller", bytes(7, 127), 0));
        assertEquals(95, sink.value(0), 1e-9);
        engine.setLearning(true);
        assertTrue(engine.consume("Controller", bytes(0xb0, 7, 0), 0));
        assertEquals(95, sink.value(0), 1e-9);
        engine.setLearning(false);
        engine.consume("Controller", bytes(7, 0), 0);
        assertEquals(0, sink.value(0), 0);
    }

    @Test public void relativeIntegerAccumulatorSurvivesJsonNumberRepresentations() throws Exception {
        Sink sink = new Sink(); MidiMappings engine = new MidiMappings(sink);
        JSONObject mapping = mapping("relative", source("cc", 1).put("mode", "rel2c"));
        mapping.getJSONObject("descriptor").put("kind", "int").put("normalization", "integer").put("maximum", 10).put("stepCount", 10);
        mapping.getJSONObject("map").put("hi", 10);
        engine.configure(config(mapping), 0, 0);
        for (int i = 0; i < 8; i++) engine.consume("Controller", bytes(0xb0, 1, 1), 0);
        assertEquals(1, sink.value(0), 0);
        for (int i = 0; i < 8; i++) engine.consume("Controller", bytes(0xb0, 1, 127), 0);
        assertEquals(0, sink.value(0), 0);
        for (String mode : new String[] { "relBin", "relSign" }) {
            mapping.getJSONObject("source").put("mode", mode);
            mapping.getJSONObject("descriptor").put("kind", "float").put("normalization", "linear").put("maximum", 127);
            mapping.getJSONObject("map").put("hi", 127);
            engine.configure(config(mapping), 0, 0);
            engine.consume("Controller", bytes(0xb0, 1, mode.equals("relBin") ? 65 : 1), 0);
            assertEquals(1, sink.value(0), 1e-9);
            engine.consume("Controller", bytes(0xb0, 1, mode.equals("relBin") ? 63 : 65), 0);
            assertEquals(0, sink.value(0), 1e-9);
        }
    }

    @Test public void noteMomentaryAndNumericEnumsFollowSharedEdges() throws Exception {
        Sink sink = new Sink(); MidiMappings engine = new MidiMappings(sink);
        JSONObject enabled = mapping("enabled", source("note", 60));
        enabled.getJSONObject("target").put("param", "_enabled").put("instance", "last"); enabled.remove("descriptor");
        enabled.getJSONObject("map").put("buttonMode", "momentary");
        JSONObject enumeration = mapping("enum", source("note", 61));
        enumeration.getJSONObject("descriptor").put("kind", "enum").put("normalization", "enum").put("values", new JSONArray().put(0).put(2).put(4)).put("stepCount", 2);
        enumeration.getJSONObject("map").put("lo", 4).put("hi", 0);
        engine.configure(config(enabled, enumeration), 0, 0);
        engine.consume("Controller", bytes(0x80, 60, 0), 0);
        assertTrue(sink.records.getJSONObject(0).getBoolean("enabled"));
        assertFalse(sink.records.getJSONObject(1).getBoolean("enabled"));
        engine.consume("Controller", bytes(0x90, 60, 127, 61, 127), 0);
        assertTrue(sink.records.getJSONObject(1).getBoolean("enabled"));
        assertEquals(4, sink.value(0), 0);
        engine.consume("Controller", bytes(0x90, 61, 127), 0);
        assertEquals(2, sink.value(0), 0);
    }

    @Test public void mcuAndPitchBendUseNativeMessageDomains() throws Exception {
        Sink sink = new Sink(); MidiMappings engine = new MidiMappings(sink);
        JSONObject fader = mapping("fader", source("mcuFader", 0));
        JSONObject vpot = mapping("vpot", source("mcuVpot", 0));
        JSONObject button = mapping("button", source("mcuButton", 1));
        button.getJSONObject("target").put("type", "_global").put("param", "track"); button.remove("descriptor");
        JSONObject config = config(fader, vpot, button);
        config.getJSONArray("devices").put(new JSONObject().put("key", "Controller").put("protocol", "mcu"));
        engine.configure(config, 0, 0);
        engine.consume("Controller", bytes(0xe0, 127, 127, 0xb0, 16, 65, 0x90, 1, 127), 0);
        assertEquals(126, sink.value(0), 1e-9); assertEquals("track:1", sink.actions.get(0));
        assertFalse(engine.consume("Controller", bytes(0x90, 104, 127), 0));
        engine.configure(config(mapping("pitch", source("pitchbend", 0))), 0, 0);
        engine.consume("Controller", bytes(0xe0, 0, 0), 0);
        assertEquals(0, sink.value(0), 0);
    }

    @Test public void transformedContainerWritesPreserveOtherMembersAndInstances() throws Exception {
        Sink sink = new Sink(); MidiMappings engine = new MidiMappings(sink);
        sink.records.getJSONObject(0).getJSONObject("parameters").put("bands", new JSONArray().put(new JSONObject().put("gain", 0).put("width", 3)));
        JSONObject mapping = mapping("nested", source("cc", 1));
        mapping.getJSONObject("descriptor").put("containerKey", "bands").put("memberKey", "gain").put("element", 2)
                .put("transform", "naturalLog").put("minimum", 1).put("maximum", 10).put("default", 1).put("normalization", "log");
        mapping.getJSONObject("map").put("lo", 1).put("hi", 10);
        engine.configure(config(mapping), 0, 0);
        engine.consume("Controller", bytes(0xb0, 1, 127), 0);
        JSONArray bands = sink.records.getJSONObject(0).getJSONObject("parameters").getJSONArray("bands");
        assertEquals(Math.log(10), bands.getJSONObject(2).getDouble("gain"), 1e-12);
        assertEquals(3, bands.getJSONObject(2).getInt("width")); assertEquals(0, bands.getJSONObject(0).getDouble("gain"), 0);
        assertEquals(40, sink.value(1), 0);
    }

    @Test public void clocksAndTimersPreserveDeadlinesAndDoNotReplayMissedIntervals() throws Exception {
        Sink sink = new Sink(); MidiMappings engine = new MidiMappings(sink, () -> 0.75);
        JSONObject timer = mapping("timer", new JSONObject().put("kind", "timer").put("schedule", "interval").put("intervalMs", 1000));
        timer.getJSONObject("map").put("amount", 3);
        long wall = ZonedDateTime.of(2026, 10, 28, 12, 0, 0, 0, ZoneId.systemDefault()).toInstant().toEpochMilli();
        engine.configure(config(timer), 100, wall);
        engine.tick(1099, wall + 999); assertEquals(0, sink.commits);
        engine.configure(config(timer), 1000, wall + 900);
        engine.tick(1100, wall + 1000); assertEquals(3, sink.value(0), 0); assertFalse(sink.physical);
        engine.tick(10000, wall + 9900); assertEquals(6, sink.value(0), 0);
        engine.tick(10000, wall + 9900); assertEquals(6, sink.value(0), 0);
        timer.getJSONObject("source").put("schedule", "once").put("date", "2026-10-28").put("hour", 12).put("minute", 0).put("second", 15);
        engine.configure(config(timer), 10000, wall + 10000);
        engine.tick(15000, wall + 15000); assertEquals(9, sink.value(0), 0);
        engine.tick(16000, wall + 16000); assertEquals(9, sink.value(0), 0);
        timer.getJSONObject("source").put("schedule", "daily").put("hour", 13).put("second", 0);
        engine.configure(config(timer), 16000, wall + 16000);
        engine.tick(17000, wall + 3600000); assertEquals(12, sink.value(0), 0);
        engine.tick(18000, wall + 3600001); assertEquals(12, sink.value(0), 0);
        JSONObject clock = new JSONObject().put("component", "second").put("shape", "sin");
        ZonedDateTime time = ZonedDateTime.of(2026, 10, 28, 0, 0, 15, 0, ZoneId.systemDefault());
        assertEquals(1, MidiMappings.clockValue(clock, time), 1e-12);
        clock.put("shape", "cos"); assertEquals(0.5, MidiMappings.clockValue(clock, time), 1e-12);
        clock.put("shape", "ramp"); assertEquals(0.25, MidiMappings.clockValue(clock, time), 1e-12);
        clock.put("kind", "clock");
        engine.configure(config(mapping("clock", clock)), 19000, time.toInstant().toEpochMilli());
        engine.tick(19000, time.toInstant().toEpochMilli());
        assertEquals(31.75, sink.value(0), 1e-12);
        JSONObject random = mapping("random", source("note", 60));
        random.getJSONObject("map").put("lo", 0).put("hi", 100).put("behavior", "random");
        engine.configure(config(random), 20000, wall);
        engine.consume("Controller", bytes(0x90, 60, 127), 0);
        assertEquals(75, sink.value(0), 1e-12);
        random.getJSONObject("map").put("behavior", "randomWalk").put("amount", 2);
        engine.configure(config(random), 20000, wall);
        engine.consume("Controller", bytes(0x90, 60, 127), 0);
        assertEquals(77, sink.value(0), 1e-12);
    }

    @Test public void globalThresholdAndPlaybackSpeedButtonsUseSharedSteps() throws Exception {
        Sink sink = new Sink(); MidiMappings engine = new MidiMappings(sink);
        JSONObject action = mapping("action", source("cc", 1));
        action.getJSONObject("target").put("type", "_global").put("param", "masterBypass"); action.remove("descriptor");
        JSONObject speed = mapping("speed", source("note", 60));
        speed.getJSONObject("target").put("type", "_global").put("param", "playbackSpeed");
        speed.getJSONObject("descriptor").put("normalization", "log").put("minimum", 0.25).put("maximum", 4).put("default", 1)
                .put("valuesForButtons", new JSONArray().put(0.5).put(1).put(1.25).put(2));
        speed.getJSONObject("map").put("lo", 0.5).put("hi", 2);
        engine.configure(config(action, speed), 0, 0);
        engine.consume("Controller", bytes(0xb0, 1, 127, 1, 100, 1, 0, 1, 127, 0x90, 60, 127), 0);
        assertEquals(2, sink.actions.size()); assertEquals(1.25, sink.speed, 0);
    }
}
