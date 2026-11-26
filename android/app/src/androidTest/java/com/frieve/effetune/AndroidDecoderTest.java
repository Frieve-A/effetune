package com.frieve.effetune;

import static org.junit.Assert.*;
import android.content.Context;
import android.net.Uri;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidDecoderTest {
    @Test public void platformCodecsDecodeToBoundedNativeQueue() throws Exception {
        for (String extension : new String[]{"wav", "m4a", "mp3", "flac", "ogg", "opus", "aac", "mp4", "m4v", "mov", "mkv", "webm", "3gp"}) decode(extension, 0, 1, false, null);
    }
    @Test public void seekCueAndPitchPreservingSpeedUseSourceClock() throws Exception {
        decode("wav", 100000, 1, false, null);
        decode("wav", 0, 2, true, null);
        decode("wav", 0, 1, false, new JSONObject().put("startFrame", 2400).put("endFrame", 9600));
    }
    @Test public void authenticatedHttpRangeSourceSeeksThroughPlatformDecoder() throws Exception { decode("wav", 100000, 1, false, null, true); }
    @Test public void localAndNetworkDsdSeekIntoNativeQueue() throws Exception {
        decode("dsf", 5000, 1, true, null);
        decode("dff", 5000, 1, true, null, true);
    }
    @Test public void damagedDstReportsTheFramesAlreadyWrittenToTheQueue() throws Exception {
        decode("dff", 0, 1, true, null, false, 0);
        decode("dff", 0, 1, true, null, false, 2);
    }

    // One 1/75-second stereo packet. The right channel is the complement of the left.
    private static byte dsdByte(int i, int channel, boolean lsb) {
        int b = (i * 13 + (i >> 5) * 7) & 255;
        if (channel == 1) b ^= 255;
        return (byte) (lsb ? b : Integer.reverse(b) >>> 24);
    }
    private static byte[] fourcc(String text) { return text.getBytes(StandardCharsets.US_ASCII); }
    private static byte[] dsf(int rate, boolean lsb) {
        int samples = rate / 75, bytes = samples / 8, blocks = (bytes + 4095) / 4096;
        ByteBuffer file = ByteBuffer.allocate(92 + blocks * 8192).order(ByteOrder.LITTLE_ENDIAN);
        file.put(fourcc("DSD ")).putLong(28).putLong(file.capacity()).putLong(0);
        file.put(fourcc("fmt ")).putLong(52).putInt(1).putInt(0).putInt(2).putInt(2);
        file.putInt(rate).putInt(lsb ? 1 : 8).putLong(samples).putInt(4096).putInt(0);
        file.put(fourcc("data")).putLong(12 + blocks * 8192);
        for (int i = 0; i < bytes; i++) for (int ch = 0; ch < 2; ch++)
            file.put(92 + (i / 4096 * 2 + ch) * 4096 + i % 4096, dsdByte(i, ch, lsb));
        return file.array();
    }
    private static byte[] chunk(String id, byte[] payload) {
        return ByteBuffer.allocate(12 + payload.length + (payload.length & 1)).put(fourcc(id))
                .putLong(payload.length).put(payload).array();
    }
    private static byte[] join(byte[]... parts) {
        int size = 0;
        for (byte[] part : parts) size += part.length;
        ByteBuffer result = ByteBuffer.allocate(size);
        for (byte[] part : parts) result.put(part);
        return result.array();
    }
    private static byte[] dff(int rate, boolean dst) {
        return dff(rate, dst, -1);
    }
    private static byte[] dff(int rate, boolean dst, int goodBeforeDamage) {
        String compression = dst ? "DST " : "DSD ";
        byte[] properties = chunk("PROP", join(fourcc("SND "), chunk("FS  ", ByteBuffer.allocate(4).putInt(rate).array()),
                chunk("CHNL", join(new byte[]{0, 2}, fourcc("SLFTSRGT"))), chunk("CMPR", join(fourcc(compression), new byte[1]))));
        byte[] audio = new byte[rate / 75 / 8 * 2];
        for (int i = 0; i < audio.length; i++) audio[i] = dsdByte(i / 2, i % 2, false);
        if (dst) {
            int frames = goodBeforeDamage < 0 ? 1 : goodBeforeDamage + 1;
            byte[][] packets = new byte[frames + 1][];
            packets[0] = chunk("FRTE", ByteBuffer.allocate(6).putInt(frames).putShort((short) 75).array());
            byte[] good = chunk("DSTF", join(new byte[1], audio));
            for (int i = 0; i < frames; i++) packets[i + 1] = i == goodBeforeDamage ? chunk("DSTF", new byte[2]) : good;
            audio = join(packets);
        }
        return chunk("FRM8", join(fourcc("DSD "), properties, chunk(compression, audio)));
    }

    @Test public void dsdMatchesWebPcmAtBothEdgesAndAfterSeek() throws Exception {
        // Reference samples from createDsdDecoder(..., {outputSampleRate: 48000}) on the same bits.
        int[] frames = {0, 1, 73, 327, 638, 639};
        double[][] expected = {
            {-0.198010415, -0.157742709, 0.078864068, -0.007781526, -0.142559215, -0.051925369},
            {-0.128662437, -0.020313967, 0.002996225, -0.018962702, -0.001581544, -0.017993135},
            {-0.060589779, -0.016584750, -0.015663806, -0.026818473, 0.009056813, 0.037899312}
        };
        for (int stage = 0; stage < 3; stage++) {
            int rate = 2822400 << stage;
            for (byte[] fixture : new byte[][]{dsf(rate, true), dsf(rate, false), dff(rate, false), dff(rate, true)}) {
                DsdFile source = new DsdFile(new DsdInput() {
                    { size = fixture.length; }
                    @Override void read(long offset, byte[] out, int dest, int count) throws java.io.IOException {
                        checkRange(offset, count);
                        System.arraycopy(fixture, (int) offset, out, dest, count);
                    }
                    @Override public void close() { }
                });
                assertEquals(rate / 75, source.samples);
                long handle = source.openConverter(48000);
                ByteBuffer pcm = ByteBuffer.allocateDirect(640 * 8).order(ByteOrder.nativeOrder());
                try {
                    source.convert(handle, 0, 640, pcm);
                    for (int i = 0; i < frames.length; i++) {
                        assertEquals(expected[stage][i], pcm.getFloat(frames[i] * 8), 1e-7);
                        assertEquals(-expected[stage][i], pcm.getFloat(frames[i] * 8 + 4), 1e-7);
                    }
                    source.convert(handle, 327, 1, pcm);
                    assertEquals(expected[stage][3], pcm.getFloat(0), 1e-7);
                } finally { DsdFile.destroy(handle); }
            }
        }
    }
    private void decode(String extension, long seek, double speed, boolean preservePitch, JSONObject region) throws Exception { decode(extension, seek, speed, preservePitch, region, false); }
    private void decode(String extension, long seek, double speed, boolean preservePitch, JSONObject region, boolean network) throws Exception {
        decode(extension, seek, speed, preservePitch, region, network, -1);
    }
    private void decode(String extension, long seek, double speed, boolean preservePitch, JSONObject region, boolean network, int goodBeforeDamage) throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context test = InstrumentationRegistry.getInstrumentation().getContext();
        File directory = new File(app.getCacheDir(), "imports"); assertTrue(directory.isDirectory() || directory.mkdirs());
        File file = new File(directory, "codec-" + UUID.randomUUID() + "." + extension);
        boolean dsd = extension.equals("dsf") || extension.equals("dff");
        try (FileOutputStream output = new FileOutputStream(file)) {
            if (dsd) output.write(extension.equals("dsf") ? dsf(2822400, true) : dff(2822400, true, goodBeforeDamage));
            else try (InputStream input = test.getAssets().open("audio/tone." + extension)) {
                byte[] buffer = new byte[8192]; int size; while ((size = input.read(buffer)) >= 0) output.write(buffer, 0, size);
            }
        }
        Uri uri = FileProvider.getUriForFile(app, app.getPackageName() + ".files", file);
        HttpPeer peer = network ? new HttpPeer(file) : null;
        NativeEngine engine = new NativeEngine(48000, 4096);
        CountDownLatch ended = new CountDownLatch(1);
        AtomicReference<Exception> failure = new AtomicReference<>();
        long[] duration = new long[1], written = new long[1];
        PcmDecoder decoder = new PcmDecoder(app, engine, new PcmDecoder.Listener() {
            @Override public void format(long generation, long value) { duration[0] = value; }
            @Override public void ended(long generation, long frames) { written[0] = frames; ended.countDown(); }
            @Override public void failed(long generation, long frames, Exception error) { written[0] = frames; failure.set(error); ended.countDown(); }
        });
        try {
            Uri decodeUri = peer == null ? uri : Uri.parse("http://127.0.0.1:" + peer.server.getLocalPort() + "/stream");
            JSONObject source = new JSONObject().put("uri", decodeUri.toString());
            if (peer != null && !dsd) source.put("type", "audio/wav");
            if (peer != null) source.put("headers", new JSONObject().put("Authorization", "Bearer test-only"));
            if (region != null) source.put("region", region);
            long generation = engine.beginSource();
            // These short fixtures fit the bounded queue; no output device is needed to inspect decode completion.
            decoder.setPaused(false);
            decoder.start(source, decodeUri, seek, speed, preservePitch, 0, generation);
            boolean completed = ended.await(10, TimeUnit.SECONDS);
            assertTrue(extension + " decoder timed out" + (peer == null ? "" : " HTTP requests=" + peer.requests + " unauthorized=" + peer.unauthorized + " peer=" + peer.thread.getState()), completed);
            if (goodBeforeDamage >= 0) {
                assertNotNull(failure.get());
                assertEquals(goodBeforeDamage == 0 ? 0 : 1024, written[0]);
                assertEquals(written[0], engine.getQueuedFrames());
                return;
            }
            assertNull(extension + " " + failure.get(), failure.get());
            int frames = engine.getQueuedFrames(); assertTrue(extension + " decoded no PCM", frames > 0);
            // Gapless chaining places the next track at exactly the frames the decoder reports.
            assertEquals(extension + " reported frames", frames, written[0]);
            double expected = ((region == null ? 250000 : 150000) - seek) * 48000.0 / 1000000 / speed;
            if (dsd) {
                assertEquals(13334, duration[0]);
                assertEquals(640 - seek * 48000 / 1000000, frames);
            } else {
                assertTrue(extension + " decoded too few frames", frames > 1000);
                assertEquals(extension + " source timing", expected, frames, extension.equals("wav") ? 600 : 3000);
            }
            assertTrue(duration[0] > 0);
            if (peer != null) { assertTrue(peer.requests > 0); assertEquals(0, peer.unauthorized); }
            if (peer != null && !dsd) assertEquals("Known WAV needs no DSD signature request", 0, peer.signatureRequests);
            engine.beginSource(); assertTrue(engine.start() >= 0);
            long deadline = android.os.SystemClock.elapsedRealtime() + 2000;
            while (engine.getQueuedFrames() != 0 && android.os.SystemClock.elapsedRealtime() < deadline) Thread.sleep(10);
            assertEquals("Consumer discards old-generation PCM", 0, engine.getQueuedFrames());
            assertEquals("Invalidated PCM never reaches output", 0, engine.getRenderedFrames());
            engine.stop();
        } finally {
            if (peer != null) peer.close();
            decoder.close();
            engine.close();
            assertTrue(file.delete());
        }
    }
    private static final class HttpPeer implements AutoCloseable {
        final java.net.ServerSocket server = new java.net.ServerSocket(0, 4, java.net.InetAddress.getByName("127.0.0.1"));
        final Thread thread;
        volatile int requests;
        volatile int signatureRequests;
        volatile int unauthorized;
        HttpPeer(File file) throws Exception {
            byte[] data = java.nio.file.Files.readAllBytes(file.toPath());
            thread = new Thread(() -> {
                while (!server.isClosed()) try (java.net.Socket socket = server.accept()) {
                    socket.setSoTimeout(5000);
                    java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(), java.nio.charset.StandardCharsets.US_ASCII));
                    String line = reader.readLine(); if (line == null) continue;
                    boolean authorized = false; int start = 0, end = data.length - 1;
                    while (!(line = reader.readLine()).isEmpty()) {
                        if (line.equalsIgnoreCase("Authorization: Bearer test-only")) authorized = true;
                        if (line.toLowerCase(java.util.Locale.ROOT).startsWith("range: bytes=")) {
                            String[] range = line.substring(line.indexOf('=') + 1).split("-", -1); start = Integer.parseInt(range[0]);
                            if (!range[1].isEmpty()) end = Math.min(end, Integer.parseInt(range[1]));
                        }
                    }
                    requests++;
                    if (start == 0 && end == 15) signatureRequests++;
                    java.io.OutputStream output = socket.getOutputStream();
                    if (!authorized) { unauthorized++; output.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII)); }
                    else if (start >= data.length) output.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + data.length + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                    else {
                        output.write(("HTTP/1.1 206 Partial Content\r\nContent-Type: audio/wav\r\nAccept-Ranges: bytes\r\nContent-Range: bytes " + start + "-" + end + "/" + data.length + "\r\nContent-Length: " + (end - start + 1) + "\r\nConnection: close\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                        output.write(data, start, end - start + 1);
                    }
                    output.flush();
                } catch (Exception error) { if (!server.isClosed()) throw new RuntimeException(error); }
            }, "Test HTTP source"); thread.start();
        }
        @Override public void close() throws Exception { server.close(); thread.join(5000); assertFalse(thread.isAlive()); }
    }

}
