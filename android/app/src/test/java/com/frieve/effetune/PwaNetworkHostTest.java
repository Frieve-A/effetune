package com.frieve.effetune;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import static org.junit.Assert.*;

public final class PwaNetworkHostTest {
    @Test public void originMustBeThePublishedPwaOrACanonicalDevelopmentOrigin() {
        for (String origin : new String[]{"https://effetune.frieve.com", "http://localhost", "http://127.0.0.1:8000"})
            assertTrue(origin, PwaNetworkHost.allowedOrigin(origin));
        for (String origin : new String[]{null, "null", "https://effetune.frieve.com/", "http://localhost:80",
                "http://localhost:08000", "http://127.0.0.1:65536", "http://user@localhost", "http://localhost.example"})
            assertFalse(origin, PwaNetworkHost.allowedOrigin(origin));
    }

    @Test public void browserGrantExpiresAndSharingRevocationInvalidatesTheStableLocalGrant() {
        PwaNetworkHost.Grants table = new PwaNetworkHost.Grants();
        PwaNetworkHost.Grant local = new PwaNetworkHost.Grant("local", "t1", "shareToken", "", "", "raw", Long.MAX_VALUE, true);
        PwaNetworkHost.Grant external = new PwaNetworkHost.Grant("server", "t2", "resource", "", "", "mp3", 3600000L, false);
        String key = table.issue(local, 0), other = table.issue(external, 0);
        assertTrue(key.matches("[A-Za-z0-9_-]{32}"));
        assertNotEquals(key, other);
        assertSame(external, table.get(other, 3599999));
        assertNull(table.get(other, 3600000));
        assertEquals(key, table.issue(local, 3600000));
        table.clear();
        assertNull(table.get(key, 3600000));
        assertNotEquals(key, table.issue(local, 3600000));
    }

    @Test public void configuredHttpsAuthorityAddsOnlyItsExactHostAndPort() {
        String endpoint = "https://music.example:47300";
        for (String host : new String[]{"music.example:47300", "192.168.1.9:47300", "[::1]:47300", "studio.local"})
            assertTrue(host, PwaNetworkHost.allowedHost(host, endpoint));
        for (String host : new String[]{"music.example", "music.example:47301", "user@studio.local",
                "studio.local/path", "256.1.1.1", "localhost:65536", "public.example", null})
            assertFalse(host, PwaNetworkHost.allowedHost(host, endpoint));
        assertTrue(PwaNetworkHost.allowedHost("music.example:443", "https://music.example"));
    }

    @Test public void ingressEnforcesLanAccessAndRejectsUnknownRoutes() {
        PwaNetworkHost host = new PwaNetworkHost(null, null, null, () -> false, null, null,
                "test-token", "", "player", false, false);
        String origin = "https://effetune.frieve.com", auth = "Authorization: Bearer test-token";
        try {
            assertStatus(host, "GET", "info", "invalid.example", origin, auth, 403);
            assertStatus(host, "GET", "info", "localhost", "https://invalid.example", auth, 403);
            assertStatus(host, "GET", "info", "localhost", origin, "Authorization: Bearer incorrect", 401);
            assertStatus(host, "OPTIONS", "info", "localhost", origin, "Access-Control-Request-Method: DELETE", 403);
            assertStatus(host, "OPTIONS", "info", "localhost", origin, "Access-Control-Request-Method: GET", 204);
            assertStatus(host, "GET", "unknown", "localhost", origin, auth, 404);
        } finally {
            SubsonicHost.unwatchSources(host.sourceChanged);
        }
    }

    private static void assertStatus(PwaNetworkHost host, String method, String route, String authority,
                                     String origin, String header, int expected) {
        EmbeddedChannel channel = new EmbeddedChannel(new HttpServerCodec(),
                new PwaNetworkHost.Ingress(() -> host, false), new HttpObjectAggregator(16 * 1024));
        try {
            String request = method + " /pwa/v1/" + route + " HTTP/1.1\r\nHost: " + authority
                    + "\r\nOrigin: " + origin + "\r\n" + header + "\r\n\r\n";
            channel.writeInbound(Unpooled.copiedBuffer(request, StandardCharsets.US_ASCII));
            ByteBuf response = channel.readOutbound();
            assertNotNull(request, response);
            try {
                String statusLine = response.toString(StandardCharsets.US_ASCII).split("\r\n", 2)[0];
                assertTrue(request + statusLine, statusLine.startsWith("HTTP/1.1 " + expected + " "));
            } finally {
                response.release();
            }
        } finally {
            channel.finishAndReleaseAll();
        }
    }
}
