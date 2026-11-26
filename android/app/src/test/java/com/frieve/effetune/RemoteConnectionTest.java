package com.frieve.effetune;

import static org.junit.Assert.*;
import org.junit.Test;

public final class RemoteConnectionTest {
    @Test public void nativeSocketAndBrowserUseTheCanonicalLocalOrigin() {
        assertEquals("https://player.local:47300/?t=a_b-",
                RemoteEffectsClient.target(" wss://PLAYER.local:47300/?t=a_b- ", true).toString());
        assertEquals("http://[::1]:47300", RemoteEffectsClient.target("http://[::1]:47300/", false).toString());
        assertTrue(RemoteEffectsClient.localHost("100.127.255.254"));
        assertFalse(RemoteEffectsClient.localHost("100.128.0.1"));
        assertFalse(RemoteEffectsClient.localHost("172.32.0.1"));
    }

    @Test public void storedCredentialsCannotBeAttachedToAnUnvalidatedAddress() {
        for (String link : new String[]{
                "file://localhost:47300/?t=abcd", "http://example.org:47300/?t=abcd",
                "http://player.local@outside.example:47300/?t=abcd", "http://192.168.1.8/?t=abcd",
                "https://player.local:443/?t=abcd",
                "http://localhost:65536/?t=abcd", "http://localhost:47300/?t=x",
                "http://localhost:47300/?t=abcd%0a", "http://localhost:47300/path?t=abcd"}) {
            assertThrows(IllegalArgumentException.class, () -> RemoteEffectsClient.target(link, true));
        }
        assertThrows(IllegalArgumentException.class, () -> RemoteEffectsClient.target("http://localhost:47300/?t=abcd", false));
    }

    @Test public void endpointRequiresAnUnprivilegedHttpsPort() throws Exception {
        assertEquals("https://music.example:47300", AudioService.remoteEndpoint("https://MUSIC.example:47300/"));
        assertEquals("invalid-port", assertThrows(AudioService.HostError.class,
                () -> AudioService.remoteEndpoint("https://music.example/")).code);
        assertEquals("invalid-endpoint", assertThrows(AudioService.HostError.class,
                () -> AudioService.remoteEndpoint("https://music.example:47300/music")).code);
    }
}
