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
    private void decode(String extension, long seek, double speed, boolean preservePitch, JSONObject region) throws Exception { decode(extension, seek, speed, preservePitch, region, false); }
    private void decode(String extension, long seek, double speed, boolean preservePitch, JSONObject region, boolean network) throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context test = InstrumentationRegistry.getInstrumentation().getContext();
        File directory = new File(app.getCacheDir(), "imports"); assertTrue(directory.isDirectory() || directory.mkdirs());
        File file = new File(directory, "codec-" + UUID.randomUUID() + "." + extension);
        try (InputStream input = test.getAssets().open("audio/tone." + extension); FileOutputStream output = new FileOutputStream(file)) {
            byte[] buffer = new byte[8192]; int size; while ((size = input.read(buffer)) >= 0) output.write(buffer, 0, size);
        }
        Uri uri = FileProvider.getUriForFile(app, app.getPackageName() + ".files", file);
        HttpPeer peer = network ? new HttpPeer(file) : null;
        NativeEngine engine = new NativeEngine(48000, 4096);
        CountDownLatch ended = new CountDownLatch(1), closed = new CountDownLatch(1);
        AtomicReference<Exception> failure = new AtomicReference<>();
        long[] duration = new long[1];
        PcmDecoder decoder = new PcmDecoder(app, engine, new PcmDecoder.Listener() {
            @Override public void format(long generation, long value) { duration[0] = value; }
            @Override public void ended(long generation) { ended.countDown(); }
            @Override public void failed(long generation, Exception error) { failure.set(error); ended.countDown(); }
        });
        Throwable primaryFailure = null;
        try {
            JSONObject source = new JSONObject().put("uri", peer == null ? uri.toString() : "http://127.0.0.1:" + peer.server.getLocalPort() + "/tone.wav");
            if (peer != null) source.put("headers", new JSONObject().put("Authorization", "Bearer test-only"));
            if (region != null) source.put("region", region);
            long generation = engine.beginSource();
            // These short fixtures fit the bounded queue; no output device is needed to inspect decode completion.
            decoder.start(source, seek, speed, preservePitch, 0, generation);
            boolean completed = ended.await(10, TimeUnit.SECONDS);
            assertTrue(extension + " decoder timed out" + (peer == null ? "" : " HTTP requests=" + peer.requests + " unauthorized=" + peer.unauthorized + " peer=" + peer.thread.getState()), completed);
            assertNull(extension + " " + failure.get(), failure.get());
            int frames = engine.getQueuedFrames(); assertTrue(extension + " decoded no PCM", frames > 1000);
            double expected = ((region == null ? 250000 : 150000) - seek) * 48000.0 / 1000000 / speed;
            assertEquals(extension + " source timing", expected, frames, extension.equals("wav") ? 600 : 3000);
            assertTrue(duration[0] > 0);
            if (peer != null) { assertTrue(peer.requests > 0); assertEquals(0, peer.unauthorized); }
            engine.beginSource(); assertTrue(engine.start() >= 0);
            long deadline = android.os.SystemClock.elapsedRealtime() + 2000;
            while (engine.getQueuedFrames() != 0 && android.os.SystemClock.elapsedRealtime() < deadline) Thread.sleep(10);
            assertEquals("Consumer discards old-generation PCM", 0, engine.getQueuedFrames());
            assertEquals("Invalidated PCM never reaches output", 0, engine.getRenderedFrames());
            engine.stop();
        } catch (Exception | AssertionError error) { primaryFailure = error; throw error; }
        finally {
            if (peer != null) peer.close();
            decoder.closeAfterDecode(() -> { engine.close(); closed.countDown(); });
            if (!closed.await(10, TimeUnit.SECONDS)) {
                AssertionError cleanup = new AssertionError("Decoder did not close after its source was released");
                if (primaryFailure != null) primaryFailure.addSuppressed(cleanup); else throw cleanup;
            }
            assertTrue(file.delete());
        }
    }
    private static final class HttpPeer implements AutoCloseable {
        final java.net.ServerSocket server = new java.net.ServerSocket(0, 4, java.net.InetAddress.getByName("127.0.0.1"));
        final Thread thread;
        volatile int requests;
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
