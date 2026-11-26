package com.frieve.effetune;

import android.os.Handler;
import android.util.Log;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** One registered relay, one HTTP reader and one native input clock. */
final class LivePcmInput {
    // A reconnect for the same relay token must follow the preceding GET's disconnect.
    // There is no core thread and the idle worker expires immediately.
    private static final ThreadPoolExecutor READERS = new ThreadPoolExecutor(0, 1, 0, TimeUnit.MILLISECONDS,
            new LinkedBlockingQueue<>(), task -> new Thread(task, "EffeTune-live-PCM"));
    final String id;
    long routeGeneration = -1;
    private final Handler control;
    private final NativeEngine engine;
    private final Consumer<LivePcmInput> ended;
    private final HttpURLConnection connection;
    private Future<?> reader;
    private AudioService.Reply pending;
    private volatile boolean closed;

    LivePcmInput(String id, String url, Handler control, NativeEngine engine, AudioService.Reply reply,
                 Consumer<LivePcmInput> ended) throws IOException {
        this.id = id;
        this.control = control;
        this.engine = engine;
        this.ended = ended;
        pending = reply;
        connection = (HttpURLConnection) new URL(url).openConnection(Proxy.NO_PROXY);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", NetworkStreamServer.PCM);
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);
        engine.setLiveInput(true);
    }

    void start() { reader = READERS.submit(this::receive); }

    private void receive() {
        try {
            if (closed) return;
            String connectionId = connection.getHeaderField("X-EffeTune-Live-Connection");
            if (connection.getResponseCode() != 200 || !NetworkStreamServer.PCM.equals(connection.getContentType())
                    || connectionId == null || !connectionId.matches("[0-9a-f]{32}"))
                throw new IOException("Invalid live PCM response");
            try (InputStream stream = connection.getInputStream()) {
                byte[] bytes = new byte[4096 * 4];
                float[] pcm = new float[4096 * 2];
                int carry = 0;
                boolean announced = false;
                while (!closed) {
                    int n = stream.read(bytes, carry, bytes.length - carry);
                    if (n < 0) break;
                    int size = n + carry, frames = size / 4;
                    for (int i = 0; i < frames * 2; i++)
                        pcm[i] = ((bytes[2 * i] & 255) | bytes[2 * i + 1] << 8) / 32768f;
                    carry = size % 4;
                    System.arraycopy(bytes, frames * 4, bytes, 0, carry);
                    if (frames == 0) continue;
                    int credit = 0;
                    while (!closed && (credit = write(pcm, frames)) == 0) Thread.sleep(4);
                    if (closed) break;
                    if (!announced && credit == 2) {
                        announced = true;
                        control.post(() -> reply(connectionId));
                    }
                }
            }
        } catch (IOException | InterruptedException | RuntimeException error) {
            if (!closed) Log.d("EffeTuneNetwork", "Live PCM reader ended", error);
        } finally {
            connection.disconnect();
            control.post(() -> ended.accept(this));
        }
    }

    // Closing on control fences the last JNI write before the engine can be replaced.
    private synchronized int write(float[] pcm, int frames) {
        return closed ? 0 : engine.writeLivePcm(pcm, frames);
    }

    private void reply(String connectionId) {
        if (pending == null) return;
        pending.complete(AudioService.object("connectionId", connectionId == null ? org.json.JSONObject.NULL : connectionId), null);
        pending = null;
    }

    void close() {
        synchronized (this) { closed = true; }
        if (reader != null) reader.cancel(true);
        connection.disconnect();
        engine.setLiveInput(false);
        reply(null);
    }
}
