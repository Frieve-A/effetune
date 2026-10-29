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
            java.lang.reflect.Method dispatch = AudioService.class.getDeclaredMethod("dispatchRemote", JSONObject.class, java.util.function.Consumer.class, java.util.function.BooleanSupplier.class);
            dispatch.setAccessible(true);
            for (String reason : new String[]{"rotate", "disable", "disconnect"}) {
                java.util.concurrent.CountDownLatch received = new java.util.concurrent.CountDownLatch(1);
                java.util.concurrent.atomic.AtomicReference<String> requestId = new java.util.concurrent.atomic.AtomicReference<>();
                service.attach(owner, (name, value) -> { if (name.equals("remote-request")) { requestId.set(value.optString("requestId")); received.countDown(); } }, true);
                AndroidHostTest.call(service, "remote.rendererReady", new JSONObject(), null, null);
                JSONObject before = AndroidHostTest.call(service, "snapshot.get", new JSONObject(), null, null);
                try (RemoteControlServer server = new RemoteControlServer(lease.context, 0, "test-token", "", "", (request, reply, current) ->
                        lease.control.post(() -> { try { dispatch.invoke(service, request, reply, current); } catch (Exception error) { throw new RuntimeException(error); } }));
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
        try (RemoteControlServer server = new RemoteControlServer(app, 0, "test-token", "", "", (request, reply, current) -> reply.accept(request))) {
            try (Socket socket = new Socket("127.0.0.1", server.port())) {
                socket.setSoTimeout(5000); request(socket, "GET /remote.html HTTP/1.1\r\nHost: localhost\r\n\r\n");
                String headers = headers(socket); assertTrue(headers, headers.startsWith("HTTP/1.1 200")); assertTrue(headers.contains("nosniff"));
            }
            try (Socket socket = websocket(server, "wrong", null)) {
                byte[] close = frame(socket); assertEquals(4401, (close[0] & 255) * 256 + (close[1] & 255));
            }
            try (Socket socket = new Socket("127.0.0.1", server.port())) {
                socket.setSoTimeout(5000); request(socket, upgrade(server.port(), "test-token", "https://untrusted.example"));
                assertEquals(-1, socket.getInputStream().read());
            }
            try (Socket socket = websocket(server, "test-token", null)) {
                text(socket, "{\"op\":\"hello\",\"v\":1,\"seq\":7}");
                JSONObject response = new JSONObject(new String(frame(socket), StandardCharsets.UTF_8)); assertEquals(7, response.getInt("seq"));
                server.rotate(); byte[] close = frame(socket); assertEquals(4401, (close[0] & 255) * 256 + (close[1] & 255));
            }
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
        try (RemoteControlServer server = new RemoteControlServer(app, 0, "test-token", certificate, key, (request, reply, current) -> reply.accept(request));
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
    private static String upgrade(int port, String token, String origin) {
        return "GET /?t=" + token + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" + (origin == null ? "" : "Origin: " + origin + "\r\n") + "\r\n";
    }
    private static Socket websocket(RemoteControlServer server, String token, String origin) throws Exception {
        Socket socket = new Socket("127.0.0.1", server.port()); socket.setSoTimeout(5000);
        request(socket, upgrade(server.port(), token, origin)); assertTrue(headers(socket).startsWith("HTTP/1.1 101")); return socket;
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
}
