package com.frieve.effetune;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeFalse;

import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AndroidLibraryShareTest {
    private static HttpURLConnection request(String url, String method) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(3000);
        connection.setReadTimeout(5000);
        return connection;
    }

    private static byte[] body(HttpURLConnection connection) throws Exception {
        try (InputStream input = connection.getInputStream()) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] chunk = new byte[1024];
            int count;
            while ((count = input.read(chunk)) != -1) bytes.write(chunk, 0, count);
            return bytes.toByteArray();
        }
    }

    @Test public void pwaPlayerGrantsServeLanMediaAndRevokeWithSharingOff() throws Exception {
        try (AndroidHostTest.ServiceLease lease = new AndroidHostTest.ServiceLease()) {
            JSONObject status = AndroidHostTest.call(lease.service, "share.status", new JSONObject(), null, null);
            assumeFalse("Requires no active sharing", status.getBoolean("enabled") || status.getBoolean("hasFiles"));
            String address = AndroidHostTest.call(lease.service, "share.route", AudioService.object("host", "192.168.1.1"), null, null).getString("address");
            File imports = new File(lease.context.getCacheDir(), "imports");
            assertTrue(imports.isDirectory() || imports.mkdirs());
            File file = File.createTempFile("pwa-source-", ".wav", imports);
            String token = NetworkStreamServer.token();
            try (RemoteControlServer server = new RemoteControlServer(lease.context, 0, "test-token", "", "",
                    (request, reply, current, writable) -> reply.accept(request))) {
                Files.write(file.toPath(), new byte[]{0, 1, 2, 3, 4, 5});
                String source = FileProvider.getUriForFile(lease.context, lease.context.getPackageName() + ".files", file).toString();
                JSONObject upstream = AndroidHostTest.call(lease.service, "share.publish", AudioService.object("token", token,
                        "uri", source, "mime", "audio/wav", "size", 6, "target", address, "playerId", "fixture"), null, null);
                JSONObject cover = AndroidHostTest.call(lease.service, "share.publish", AudioService.object("token", NetworkStreamServer.token(),
                        "uri", source, "mime", "image/png", "size", 6, "target", address, "playerId", "fixture"), null, null);
                java.util.concurrent.BlockingQueue<JSONObject> events = new java.util.concurrent.ArrayBlockingQueue<>(1);
                PwaNetworkHost host = new PwaNetworkHost(lease.context, lease.control,
                        (name, value) -> { if (name.equals("pwa-request")) events.offer(value); }, () -> true,
                        (LibraryShareServer) lease.field("libraryShare"), (MediaGateway) lease.field("mediaGateway"),
                        "test-token", "", "phone", true, true);
                server.pwa = host;
                String uri, bound, browserArt;
                try (java.net.Socket client = new java.net.Socket(address, server.port())) {
                    client.setSoTimeout(5000);
                    String json = "{\"serverId\":\"upnp\",\"trackId\":\"song\",\"audience\":\"player\",\"target\":{\"hostId\":\"other\",\"playerId\":\"renderer\"}}";
                    client.getOutputStream().write(("POST /pwa/v1/resolve HTTP/1.1\r\nHost: " + address + ":" + server.port()
                            + "\r\nOrigin: https://effetune.frieve.com\r\nAuthorization: Bearer test-token\r\nContent-Type: application/json\r\nContent-Length: "
                            + json.length() + "\r\n\r\n" + json).getBytes(StandardCharsets.US_ASCII));
                    JSONObject event = events.poll(5, java.util.concurrent.TimeUnit.SECONDS);
                    assertNotNull(event);
                    String id = event.getString("requestId");
                    JSONObject issued = lease.onControl(() -> {
                        java.util.concurrent.atomic.AtomicReference<JSONObject> result = new java.util.concurrent.atomic.AtomicReference<>();
                        JSONObject args = AudioService.object("requestId", id, "serverId", "upnp", "trackId", "song",
                                "audience", "player", "target", AudioService.object("uri", upstream.getString("uri"), "address", address),
                                "player", AudioService.object("hostId", "other", "playerId", "renderer", "protocolInfo", "http-get:*:audio/wav:*"));
                        AudioService.Reply capture = (value, error) -> { assertNull(error); result.set(value); };
                        host.command("pwa.issueGrant", args, capture);
                        JSONObject pair = AudioService.object("peer", result.get().getString("uri"));
                        args.getJSONObject("player").put("hostId", status.getString("id")).put("address", address);
                        args.getJSONObject("target").put("artwork", cover.getString("uri"));
                        host.command("pwa.issueGrant", args, capture);
                        pair.put("bound", result.get().getString("uri"));
                        URL art = new URL(result.get().getString("artwork"));
                        JSONObject display = AudioService.object("audience", "browser", "requestId", id, "playerId", "renderer",
                                "origin", art.getProtocol() + "://" + art.getAuthority(),
                                "playerArtworkToken", art.getPath().substring(art.getPath().lastIndexOf('/') + 1));
                        host.command("pwa.issueGrant", display, capture);
                        assertEquals("", result.get().getString("uri"));
                        pair.put("browserArt", result.get().getString("artwork"));
                        host.command("pwa.issueGrant", display, capture);
                        assertEquals(pair.getString("browserArt"), result.get().getString("artwork"));
                        host.command("pwa.respond", AudioService.object("requestId", id, "status", 200, "body", pair),
                                (value, error) -> assertNull(error));
                        return pair;
                    });
                    uri = issued.getString("peer");
                    bound = issued.getString("bound");
                    browserArt = issued.getString("browserArt");
                }
                assertEquals(address, new URL(uri).getHost());
                assertNull(new URL(uri).getQuery());
                assertFalse(uri.contains(token));
                String loopback = "http://127.0.0.1:" + new URL(bound).getPort() + new URL(bound).getPath();
                HttpURLConnection wrongPlayer = request(loopback, "GET");
                try { assertEquals(403, wrongPlayer.getResponseCode()); } finally { wrongPlayer.disconnect(); }
                assertEquals(server.port(), new URL(browserArt).getPort());
                String controllerArt = "http://127.0.0.1:" + server.port() + new URL(browserArt).getPath();
                HttpURLConnection image = request(controllerArt, "GET");
                image.setRequestProperty("Origin", "https://effetune.frieve.com");
                try {
                    assertEquals("image/png", image.getContentType());
                    assertArrayEquals(new byte[]{0, 1, 2, 3, 4, 5}, body(image));
                } finally { image.disconnect(); }
                HttpURLConnection notMedia = request(controllerArt.replace("/artwork/", "/media/"), "GET");
                notMedia.setRequestProperty("Origin", "https://effetune.frieve.com");
                try { assertEquals(404, notMedia.getResponseCode()); } finally { notMedia.disconnect(); }
                HttpURLConnection ownerCheck = request(loopback.replace("/media/", "/grant/"), "GET");
                try { assertEquals(200, ownerCheck.getResponseCode()); } finally { ownerCheck.disconnect(); }
                String ticket = uri.replace("/media/", "/grant/");
                HttpURLConnection check = request(ticket, "GET");
                try {
                    assertEquals(200, check.getResponseCode());
                    JSONObject grant = new JSONObject(new String(body(check), StandardCharsets.UTF_8));
                    assertEquals("player", grant.getString("audience"));
                    assertEquals("other", grant.getJSONObject("target").getString("hostId"));
                    assertEquals("renderer", grant.getJSONObject("target").getString("playerId"));
                } finally { check.disconnect(); }
                HttpURLConnection whole = request(bound, "GET");
                try {
                    assertEquals(200, whole.getResponseCode());
                    assertArrayEquals(new byte[]{0, 1, 2, 3, 4, 5}, body(whole));
                } finally { whole.disconnect(); }
                HttpURLConnection range = request(uri, "GET");
                try {
                    range.setRequestProperty("Range", "bytes=2-4");
                    assertEquals(206, range.getResponseCode());
                    assertEquals("bytes 2-4/6", range.getHeaderField("Content-Range"));
                    assertArrayEquals(new byte[]{2, 3, 4}, body(range));
                } finally { range.disconnect(); }
                lease.onControl(() -> { host.permissions(false, true, false); host.permissions(true, true, false); return null; });
                for (String revoked : new String[]{ticket, uri, bound}) {
                    HttpURLConnection denied = request(revoked, "GET");
                    try { assertEquals(404, denied.getResponseCode()); } finally { denied.disconnect(); }
                }
            } finally {
                try { AndroidHostTest.call(lease.service, "share.revoke", AudioService.object("playerId", "fixture", "keep", new org.json.JSONArray()), null, null); }
                finally { Files.deleteIfExists(file.toPath()); }
            }
        }
    }

    @Test public void describesLibraryAndServesPublishedRange() throws Exception {
        try (AndroidHostTest.ServiceLease lease = new AndroidHostTest.ServiceLease()) {
            JSONObject before = AndroidHostTest.call(lease.service, "share.status", new JSONObject(), null, null);
            assumeFalse("Requires a test device with sharing disabled", before.getBoolean("enabled"));
            File imports = new File(lease.context.getCacheDir(), "imports");
            assertTrue(imports.isDirectory() || imports.mkdirs());
            File file = File.createTempFile("library-share-", ".wav", imports);
            try {
                Files.write(file.toPath(), new byte[]{0, 1, 2, 3, 4, 5});
                JSONObject status = AndroidHostTest.call(lease.service, "share.start", new JSONObject(), null, null);
                assertFalse("Requires a LAN IPv4 address", status.isNull("baseUrl"));
                String base = "http://127.0.0.1:" + new URL(status.getString("baseUrl")).getPort();
                HttpURLConnection desc = request(base + "/description.xml", "GET");
                try {
                    assertEquals(200, desc.getResponseCode());
                    assertTrue(new String(body(desc), StandardCharsets.UTF_8).contains("<controlURL>/control/ContentDirectory</controlURL>"));
                } finally { desc.disconnect(); }
                HttpURLConnection protocol = request(base + "/control/ConnectionManager", "POST");
                try {
                    protocol.setDoOutput(true);
                    protocol.setRequestProperty("Content-Type", "text/xml");
                    String soap = "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body>" +
                            "<u:GetProtocolInfo xmlns:u=\"urn:schemas-upnp-org:service:ConnectionManager:1\"/></s:Body></s:Envelope>";
                    try (OutputStream output = protocol.getOutputStream()) { output.write(soap.getBytes(StandardCharsets.UTF_8)); }
                    assertEquals(200, protocol.getResponseCode());
                    assertTrue(new String(body(protocol), StandardCharsets.UTF_8).contains("http-get:*:audio/flac:*"));
                } finally { protocol.disconnect(); }

                String uri = FileProvider.getUriForFile(lease.context, lease.context.getPackageName() + ".files", file).toString();
                String token = NetworkStreamServer.token();
                AndroidHostTest.call(lease.service, "share.publish", AudioService.object("token", token,
                        "uri", uri, "mime", "audio/wav", "size", -1, "updateId", status.getLong("updateId")), null, null);
                String media = base + "/media/" + token;
                HttpURLConnection range = request(media, "GET");
                try {
                    range.setRequestProperty("Range", "bytes=2-4");
                    assertEquals(206, range.getResponseCode());
                    assertEquals("bytes 2-4/6", range.getHeaderField("Content-Range"));
                    assertArrayEquals(new byte[]{2, 3, 4}, body(range));
                } finally { range.disconnect(); }
                HttpURLConnection head = request(media, "HEAD");
                try {
                    head.setRequestProperty("Range", "bytes=-2");
                    assertEquals(206, head.getResponseCode());
                    assertEquals("bytes 4-5/6", head.getHeaderField("Content-Range"));
                    assertEquals(2, head.getContentLength());
                    assertEquals(0, body(head).length);
                } finally { head.disconnect(); }
                HttpURLConnection pastEnd = request(media, "GET");
                try {
                    pastEnd.setRequestProperty("Range", "bytes=6-");
                    assertEquals(416, pastEnd.getResponseCode());
                    assertEquals("bytes */6", pastEnd.getHeaderField("Content-Range"));
                } finally { pastEnd.disconnect(); }

                java.util.concurrent.BlockingQueue<JSONObject> waiting = new java.util.concurrent.LinkedBlockingQueue<>();
                lease.service.attach(lease, (name, event) -> { if (name.equals("share-request")) waiting.offer(event); }, false);
                try {
                    String other = NetworkStreamServer.token();
                    try (java.net.Socket client = new java.net.Socket("127.0.0.1", new URL(base).getPort())) {
                        client.getOutputStream().write(("GET /media/" + other + " HTTP/1.1\r\nHost: localhost\r\n\r\n")
                                .getBytes(StandardCharsets.US_ASCII));
                        JSONObject asked = waiting.poll(5, java.util.concurrent.TimeUnit.SECONDS);
                        assertNotNull(asked);
                        AndroidHostTest.call(lease.service, "share.notify", new JSONObject(), null, null);
                        JSONObject late = AndroidHostTest.call(lease.service, "share.respond", AudioService.object(
                                "requestId", asked.getString("requestId"), "uri", uri, "size", 6, "mime", "audio/wav"), null, null);
                        assertFalse(late.getBoolean("accepted"));
                    }
                    JSONObject publication = AudioService.object("uri", uri, "mime", "audio/wav", "size", 6,
                            "updateId", (status.getLong("updateId") + 1) & 0xffffffffL);
                    String queued = NetworkStreamServer.token(), pwa = NetworkStreamServer.token();
                    for (String key : new String[]{queued, pwa}) {
                        publication.put("token", key);
                        for (String player : new String[]{"first", "second"}) {
                            publication.put("playerId", player);
                            AndroidHostTest.call(lease.service, "share.publish", publication, null, null);
                        }
                    }
                    publication.remove("playerId");
                    AndroidHostTest.call(lease.service, "share.publish", publication, null, null);
                    lease.service.rendererGone(lease);
                    for (String revoked : new String[]{token, other}) {
                        HttpURLConnection missing = request(base + "/media/" + revoked, "HEAD");
                        try { assertEquals(404, missing.getResponseCode()); } finally { missing.disconnect(); }
                    }
                    for (String player : new String[]{"first", "second"}) {
                        AndroidHostTest.call(lease.service, "share.revoke", AudioService.object("playerId", player,
                                "keep", new org.json.JSONArray()), null, null);
                        HttpURLConnection remaining = request(base + "/media/" + queued, "HEAD");
                        try { assertEquals(player.equals("first") ? 200 : 404, remaining.getResponseCode()); }
                        finally { remaining.disconnect(); }
                    }
                    HttpURLConnection shared = request(base + "/media/" + pwa, "GET");
                    try { assertArrayEquals(new byte[]{0, 1, 2, 3, 4, 5}, body(shared)); }
                    finally { shared.disconnect(); }
                } finally { lease.service.detach(lease); }

                AndroidHostTest.call(lease.service, "share.stop", new JSONObject(), null, null);
                String target = new URL(status.getString("baseUrl")).getHost();
                JSONObject route = AndroidHostTest.call(lease.service, "share.route", AudioService.object("host", target), null, null);
                assertTrue(route.isNull("baseUrl"));
                JSONObject published = AndroidHostTest.call(lease.service, "share.publish", AudioService.object("token", token,
                        "uri", uri, "mime", "audio/wav", "size", 6, "target", target, "playerId", "test-player"), null, null);
                try {
                    AndroidHostTest.call(lease.service, "share.notify", new JSONObject(), null, null);
                    HttpURLConnection opened = request(published.getString("uri"), "GET");
                    try { assertArrayEquals(new byte[]{0, 1, 2, 3, 4, 5}, body(opened)); } finally { opened.disconnect(); }
                } finally {
                    JSONObject pruned = AndroidHostTest.call(lease.service, "share.revoke",
                            AudioService.object("playerId", "test-player", "keep", new org.json.JSONArray()), null, null);
                    assertFalse(pruned.getBoolean("hasFiles"));
                }
                assertTrue(AndroidHostTest.call(lease.service, "share.route", AudioService.object("host", target), null, null).isNull("baseUrl"));
            } finally {
                try { AndroidHostTest.call(lease.service, "share.stop", new JSONObject(), null, null); }
                finally { Files.deleteIfExists(file.toPath()); }
            }
        }
    }

    @Test public void relaysSubsonicRangeOnlyToTheRegisteredPlayer() throws Exception {
        try (AndroidHostTest.ServiceLease lease = new AndroidHostTest.ServiceLease();
             java.net.ServerSocket stub = new java.net.ServerSocket(0, 2, java.net.InetAddress.getByName("127.0.0.1"))) {
            JSONObject before = AndroidHostTest.call(lease.service, "share.status", new JSONObject(), null, null);
            assumeFalse("Requires sharing off and no individually published files", before.getBoolean("enabled") || before.getBoolean("hasFiles"));
            String target = AndroidHostTest.call(lease.service, "share.route", AudioService.object("host", "192.168.1.1"), null, null).getString("address");
            stub.setSoTimeout(10000);
            java.util.concurrent.FutureTask<Void> upstream = new java.util.concurrent.FutureTask<>(() -> {
                for (boolean ping : new boolean[]{true, false}) {
                    try (java.net.Socket socket = stub.accept()) {
                        socket.setSoTimeout(5000);
                        java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(
                                socket.getInputStream(), StandardCharsets.US_ASCII));
                        String first = reader.readLine();
                        assertTrue(first.startsWith(ping ? "GET /rest/ping.view?" : "GET /rest/stream.view?"));
                        assertTrue(first.contains("u=tester") && first.contains("t="));
                        boolean requestedRange = false;
                        for (String header; (header = reader.readLine()) != null && !header.isEmpty(); )
                            if (header.equalsIgnoreCase("Range: bytes=2-4")) requestedRange = true;
                        if (!ping) {
                            assertTrue(requestedRange);
                            assertTrue(first.contains("id=song") && first.contains("format=raw"));
                        }
                        byte[] bytes = ping ? "{\"subsonic-response\":{\"status\":\"ok\"}}".getBytes(StandardCharsets.UTF_8) : new byte[]{2, 3, 4};
                        String headers = ping ? "200 OK\r\nContent-Type: application/json" :
                                "206 Partial Content\r\nContent-Type: audio/flac\r\nContent-Range: bytes 2-4/6";
                        OutputStream out = socket.getOutputStream();
                        out.write(("HTTP/1.1 " + headers + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n")
                                .getBytes(StandardCharsets.US_ASCII));
                        out.write(bytes);
                    }
                }
                return null;
            });
            Thread worker = new Thread(upstream, "Test Subsonic source");
            worker.start();
            String serverId = null;
            try {
                java.util.concurrent.atomic.AtomicReference<JSONObject> saved = new java.util.concurrent.atomic.AtomicReference<>();
                SubsonicHost.dispatch(lease.context, "subsonic.add", AudioService.object("url", "http://127.0.0.1:" + stub.getLocalPort(),
                        "user", "tester", "password", "fixture"), (value, error) -> { assertNull(error); saved.set(value); });
                serverId = saved.get().getString("id");
                String token = NetworkStreamServer.token();
                JSONObject result = AndroidHostTest.call(lease.service, "share.publish", AudioService.object("token", token,
                        "serverId", serverId, "trackId", "song", "coverArtId", "cover", "format", "raw",
                        "target", target, "playerId", "test-renderer"), null, null);
                URL url = new URL(result.getString("uri"));
                assertNull(url.getQuery());
                assertNull(url.getUserInfo());
                assertEquals("/media/" + token, url.getPath());
                assertEquals("/artwork/" + token, new URL(result.getString("artwork")).getPath());
                JSONObject repeated = AndroidHostTest.call(lease.service, "share.publish", AudioService.object(
                        "token", NetworkStreamServer.token(), "serverId", serverId, "trackId", "song", "coverArtId", "cover",
                        "format", "raw", "target", target, "playerId", "test-renderer"), null, null);
                assertEquals(url.toString(), repeated.getString("uri"));
                HttpURLConnection denied = request("http://127.0.0.1:" + url.getPort() + url.getPath(), "GET");
                try { assertEquals(403, denied.getResponseCode()); } finally { denied.disconnect(); }
                HttpURLConnection range = request(url.toString(), "GET");
                try {
                    range.setRequestProperty("Range", "bytes=2-4");
                    assertEquals(206, range.getResponseCode());
                    assertEquals("bytes 2-4/6", range.getHeaderField("Content-Range"));
                    assertArrayEquals(new byte[]{2, 3, 4}, body(range));
                } finally { range.disconnect(); }
                upstream.get(5, java.util.concurrent.TimeUnit.SECONDS);
            } finally {
                try {
                    if (serverId != null) {
                        SubsonicHost.dispatch(lease.context, "subsonic.remove", AudioService.object("id", serverId),
                                (value, error) -> assertNull(error));
                        assertFalse(AndroidHostTest.call(lease.service, "share.status", new JSONObject(), null, null).getBoolean("hasFiles"));
                    }
                } finally {
                    stub.close();
                    worker.join(6000);
                    assertFalse(worker.isAlive());
                }
            }
        }
    }
}
