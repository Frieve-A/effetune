package com.frieve.effetune;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidRemoteTest {
    @Test public void delayedRendererMutationIsRejectedAfterEveryAuthorityRevocation() throws Exception {
        try (AndroidHostTest.ServiceLease lease = new AndroidHostTest.ServiceLease()) {
            AudioService service = lease.service;
            Object owner = new Object();
            java.lang.reflect.Method dispatch = AudioService.class.getDeclaredMethod("dispatchRemote", JSONObject.class, java.util.function.Consumer.class, java.util.function.BooleanSupplier.class, java.util.function.BooleanSupplier.class);
            dispatch.setAccessible(true);
            for (String reason : new String[]{"rotate", "disable", "disconnect"}) {
                java.util.concurrent.CountDownLatch received = new java.util.concurrent.CountDownLatch(1);
                java.util.concurrent.atomic.AtomicReference<String> requestId = new java.util.concurrent.atomic.AtomicReference<>();
                service.attach(owner, (name, value) -> { if (name.equals("remote-request")) { requestId.set(value.optString("requestId")); received.countDown(); } }, true);
                AndroidHostTest.call(service, "remote.rendererReady", new JSONObject(), null, null);
                JSONObject before = AndroidHostTest.call(service, "snapshot.get", new JSONObject(), null, null);
                try (RemoteControlServer server = new RemoteControlServer(lease.context, 0, "test-token", "", "", (request, reply, current, writable) ->
                        lease.control.post(() -> { try { dispatch.invoke(service, request, reply, current, writable); } catch (Exception error) { throw new RuntimeException(error); } }));
                     Socket socket = websocket(server, "test-token", null)) {
                    text(socket, "{\"op\":\"playMusic\",\"seq\":1,\"items\":[{\"serverId\":\"test\",\"trackId\":\"delayed\"}]}");
                    assertTrue(received.await(5, java.util.concurrent.TimeUnit.SECONDS));
                    String id = requestId.get(), transaction = java.util.UUID.randomUUID().toString();
                    AndroidHostTest.call(service, "playback.queue.begin", new JSONObject().put("transactionId", transaction).put("index", 0).put("_remoteRequestId", id), null, null);
                    if (reason.equals("rotate")) server.rotate(); else if (reason.equals("disable")) {
                        server.close();
                        for (String fieldName : new String[]{"boss", "workers"}) {
                            java.lang.reflect.Field field = RemoteControlServer.class.getDeclaredField(fieldName); field.setAccessible(true);
                            assertTrue("Closed transport must release its owned event thread", ((io.netty.channel.nio.NioEventLoopGroup) field.get(server)).isTerminated());
                        }
                    } else socket.close();
                    if (reason.equals("disconnect")) { long deadline = android.os.SystemClock.elapsedRealtime() + 2000; while (server.clientCount() > 0 && android.os.SystemClock.elapsedRealtime() < deadline) Thread.sleep(10); }
                    java.util.concurrent.atomic.AtomicReference<AudioService.HostError> failure = new java.util.concurrent.atomic.AtomicReference<>();
                    AndroidHostTest.call(service, "playback.queue.append", new JSONObject().put("transactionId", transaction).put("_remoteRequestId", id)
                            .put("items", new org.json.JSONArray().put(new JSONObject().put("uri", "https://music.example/delayed"))), null, failure);
                    assertNotNull(reason, failure.get()); assertEquals(reason, "unauthorized", failure.get().code);
                    JSONObject after = AndroidHostTest.call(service, "snapshot.get", new JSONObject(), null, null);
                    assertEquals(reason, before.getJSONObject("playback").getInt("queueLength"), after.getJSONObject("playback").getInt("queueLength"));
                } finally { service.detach(owner); }
            }
        }
    }
    @Test public void authenticatedFramesStaticAssetsOriginAndTokenRotation() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (RemoteControlServer server = new RemoteControlServer(app, 0, "test-token", "", "", (request, reply, current, writable) -> reply.accept(request))) {
            try (Socket socket = new Socket("127.0.0.1", server.port())) {
                socket.setSoTimeout(5000); request(socket, "GET /remote.html HTTP/1.1\r\nHost: localhost\r\n\r\n");
                String headers = headers(socket); assertTrue(headers, headers.startsWith("HTTP/1.1 200")); assertTrue(headers.contains("nosniff"));
            }
            try (Socket socket = websocket(server, "wrong", null)) {
                byte[] close = frame(socket); assertEquals(4401, (close[0] & 255) * 256 + (close[1] & 255));
            }
            try (Socket socket = new Socket("127.0.0.1", server.port())) {
                socket.setSoTimeout(5000); request(socket, upgrade(server.port(), "test-token", "https://untrusted.example", "/"));
                assertEquals(-1, socket.getInputStream().read());
            }
            try (Socket socket = websocket(server, "test-token", null)) {
                text(socket, "{\"op\":\"hello\",\"v\":1,\"seq\":7}");
                JSONObject response = new JSONObject(new String(frame(socket), StandardCharsets.UTF_8)); assertEquals(7, response.getInt("seq"));
                server.rotate(); byte[] close = frame(socket); assertEquals(4401, (close[0] & 255) * 256 + (close[1] & 255));
            }
        }
    }

    @Test public void putIrDispatchesUploadedFile() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (RemoteControlServer server = new RemoteControlServer(app, 0, "test-token", "", "",
                (request, reply, current, writable) -> reply.accept(request));
             Socket socket = websocket(server, "test-token", null)) {
            JSONObject chunk = AudioService.object("op", "putIR", "seq", 1, "id", "0123456789abcdef01234567",
                    "total", 1, "index", 0, "bytes", 3, "name", "x", "ext", "wav", "data", "AQID");
            text(socket, chunk.toString());
            JSONObject dispatched = new JSONObject(new String(frame(socket), StandardCharsets.UTF_8));
            File file = new File(dispatched.getString("file"));
            try (DataInputStream input = new DataInputStream(new FileInputStream(file))) {
                byte[] bytes = new byte[3];
                input.readFully(bytes);
                assertArrayEquals(new byte[]{1, 2, 3}, bytes);
                assertEquals(-1, input.read());
            } finally { assertTrue(file.delete()); }
        }
    }

    @Test public void pairingGrantsRootAccessAndPwaRejectsPlayback() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        android.os.Handler control = new android.os.Handler(android.os.Looper.getMainLooper());
        ArrayBlockingQueue<String> prompts = new ArrayBlockingQueue<>(1);
        AudioService.Events events = (name, value) -> {
            if ("pairing-request".equals(name)) prompts.add(value.optString("requestId"));
        };
        String master = UUID.randomUUID().toString(), issued = "remote-test-issued";
        RemotePairing pairing = new RemotePairing(app, control, events, () -> true, () -> issued, master, "", "Test");
        RemoteControlServer.Dispatch dispatch = new RemoteControlServer.Dispatch() {
            @Override public RemotePairing pairing() { return pairing; }
            @Override public void request(JSONObject request, Consumer<JSONObject> reply, BooleanSupplier current, BooleanSupplier writable) {
                reply.accept(request);
            }
        };
        pairing.start();
        try (RemoteControlServer server = new RemoteControlServer(app, 0, master, "", "", dispatch)) {
            try (Socket socket = websocket(server, issued, null)) {
                byte[] close = frame(socket);
                assertEquals(4401, (close[0] & 255) * 256 + (close[1] & 255));
            }
            String token;
            try (Socket socket = new Socket("127.0.0.1", server.port())) {
                socket.setSoTimeout(5000);
                String body = new JSONObject().put("playerId", pairing.playerId).toString();
                request(socket, "POST " + RemotePairing.PAIR + " HTTP/1.1\r\nHost: 127.0.0.1:" + server.port()
                        + "\r\nX-EffeTune-Pairing: 1\r\nContent-Type: application/json\r\nContent-Length: " + body.length() + "\r\n\r\n" + body);
                String id = prompts.poll(5, TimeUnit.SECONDS);
                assertNotNull(id);
                control.post(() -> pairing.decide(id, true));
                assertTrue(headers(socket).startsWith("HTTP/1.1 200"));
                String response = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8)).readLine();
                JSONObject decision = new JSONObject(response);
                assertEquals("approved", decision.getString("status"));
                token = decision.getString("token");
                assertEquals(issued, token);
            }
            try (Socket socket = websocket(server, token, null)) {
                text(socket, "{\"op\":\"hello\",\"v\":1,\"seq\":1}");
                assertEquals(1, new JSONObject(new String(frame(socket), StandardCharsets.UTF_8)).getInt("seq"));
            }
            server.pwa = new PwaNetworkHost(app, control, events, () -> true, null, null, master, "", pairing.playerId, false, false);
            try (Socket socket = websocket(server, master, "https://effetune.frieve.com", PwaNetworkHost.PREFIX + "effects")) {
                text(socket, "{\"op\":\"playMusic\",\"seq\":2}");
                JSONObject ack = new JSONObject(new String(frame(socket), StandardCharsets.UTF_8));
                assertEquals("ack", ack.getString("op"));
                assertEquals(2, ack.getInt("seq"));
                assertFalse(ack.getBoolean("ok"));
                assertEquals("unauthorized", ack.getString("error"));
            }
        } finally { InstrumentationRegistry.getInstrumentation().runOnMainSync(pairing::close); }
    }

    @Test public void idleConnectionReportsWritableToDispatch() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (RemoteControlServer server = new RemoteControlServer(app, 0, "test-token", "", "",
                (request, reply, current, writable) -> reply.accept(AudioService.object("seq", request.opt("seq"), "writable", writable.getAsBoolean())));
             Socket socket = websocket(server, "test-token", null)) {
            text(socket, "{\"op\":\"hello\",\"v\":1,\"seq\":3}");
            assertTrue(new JSONObject(new String(frame(socket), StandardCharsets.UTF_8)).getBoolean("writable"));
        }
    }

    @Test public void configuredCertificateServesHttps() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context test = InstrumentationRegistry.getInstrumentation().getContext();
        String certificate = asset(test, "tls/localhost.crt"), key = asset(test, "tls/localhost.key");
        KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType()); trust.load(null);
        trust.setCertificateEntry("test", CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(certificate.getBytes(StandardCharsets.US_ASCII))));
        TrustManagerFactory managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); managers.init(trust);
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(null, managers.getTrustManagers(), null);
        try (RemoteControlServer server = new RemoteControlServer(app, 0, "test-token", certificate, key, (request, reply, current, writable) -> reply.accept(request));
             Socket socket = tls.getSocketFactory().createSocket("127.0.0.1", server.port())) {
            socket.setSoTimeout(5000); request(socket, "GET /remote.html HTTP/1.1\r\nHost: localhost\r\n\r\n");
            assertTrue(headers(socket).startsWith("HTTP/1.1 200"));
        }
    }

    private static String asset(Context context, String path) throws Exception {
        try (InputStream input = context.getAssets().open(path); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[4096]; int n; while ((n = input.read(bytes)) >= 0) output.write(bytes, 0, n);
            return output.toString("UTF-8");
        }
    }
    private static String upgrade(int port, String token, String origin, String path) {
        return "GET " + path + "?t=" + token + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" + (origin == null ? "" : "Origin: " + origin + "\r\n") + "\r\n";
    }
    private static Socket websocket(RemoteControlServer server, String token, String origin) throws Exception {
        return websocket(server, token, origin, "/");
    }
    private static Socket websocket(RemoteControlServer server, String token, String origin, String path) throws Exception {
        Socket socket = new Socket("127.0.0.1", server.port()); socket.setSoTimeout(5000);
        request(socket, upgrade(server.port(), token, origin, path)); assertTrue(headers(socket).startsWith("HTTP/1.1 101")); return socket;
    }
    private static void request(Socket socket, String request) throws Exception { socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII)); socket.getOutputStream().flush(); }
    private static String headers(Socket socket) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); int value;
        while ((value = socket.getInputStream().read()) >= 0 && bytes.size() < 16384) {
            bytes.write(value); String text = bytes.toString("US-ASCII"); if (text.endsWith("\r\n\r\n")) return text;
        }
        return bytes.toString("US-ASCII");
    }
    private static void text(Socket socket, String text) throws Exception {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8); assertTrue(bytes.length < 126);
        OutputStream output = socket.getOutputStream(); output.write(0x81); output.write(0x80 | bytes.length); output.write(new byte[4]); output.write(bytes); output.flush();
    }
    private static byte[] frame(Socket socket) throws Exception {
        DataInputStream input = new DataInputStream(socket.getInputStream()); assertTrue(input.readUnsignedByte() >= 128);
        int size = input.readUnsignedByte(); assertTrue(size < 128); if (size == 126) size = input.readUnsignedShort();
        assertTrue(size < 65536); byte[] data = new byte[size]; input.readFully(data); return data;
    }

    @Test public void musicResultForwardsPartialQueueFailureFromRenderer() throws Exception {
        try (AndroidHostTest.ServiceLease lease = new AndroidHostTest.ServiceLease()) {
            AudioService service = lease.service;
            Object owner = new Object();
            ArrayBlockingQueue<String> requests = new ArrayBlockingQueue<>(1);
            ArrayBlockingQueue<JSONObject> replies = new ArrayBlockingQueue<>(2);
            service.attach(owner, (name, data) -> {
                if (name.equals("remote-request")) requests.add(data.optString("requestId"));
            }, true);
            try {
                AndroidHostTest.call(service, "remote.rendererReady", new JSONObject(), null, null);
                java.lang.reflect.Method dispatch = AudioService.class.getDeclaredMethod("dispatchRemote",
                        JSONObject.class, Consumer.class, BooleanSupplier.class, BooleanSupplier.class);
                dispatch.setAccessible(true);
                Consumer<JSONObject> sendReply = replies::add;
                BooleanSupplier current = () -> true;
                lease.onControl(() -> {
                    dispatch.invoke(service, AudioService.object("op", "queueMusic", "seq", 7), sendReply, current, current);
                    return null;
                });
                String id = requests.poll(5, TimeUnit.SECONDS);
                assertNotNull(id);
                JSONObject ack = replies.poll(5, TimeUnit.SECONDS);
                assertNotNull(ack);
                assertEquals("ack", ack.getString("op"));
                JSONObject error = AudioService.object("code", "trackUnavailable", "message", "The track is unavailable.");
                JSONObject playback = AudioService.object("playerId", "local", "total", 64);
                AndroidHostTest.call(service, "remote.respond", AudioService.object("requestId", id, "_remoteRequestId", id,
                        "ok", false, "error", error, "outcome", "unknown", "playback", playback), null, null);
                JSONObject result = replies.poll(5, TimeUnit.SECONDS);
                assertNotNull(result);
                assertEquals("musicResult", result.getString("op"));
                assertEquals(7, result.getInt("seq"));
                assertFalse(result.getBoolean("ok"));
                assertEquals(error.toString(), result.getJSONObject("error").toString());
                assertEquals("unknown", result.getString("outcome"));
                assertEquals(playback.toString(), result.getJSONObject("playback").toString());
            } finally { service.detach(owner); }
        }
    }
}
