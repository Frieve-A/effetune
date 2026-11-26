package com.frieve.effetune;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.SystemClock;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/** Owns the Subsonic registrations and the WebView's same-origin Subsonic resources. */
final class SubsonicHost {
    private static final String TAG = "EffeTuneSubsonic";
    private static final String KEY_ALIAS = "effetune.subsonic";
    private static final int RESPONSE_LIMIT = 4 * 1024 * 1024;
    private static final Map<String, String> RESPONSE_HEADERS = new HashMap<>();
    static {
        RESPONSE_HEADERS.put("Cache-Control", "no-store");
        RESPONSE_HEADERS.put("Cross-Origin-Resource-Policy", "same-origin");
        RESPONSE_HEADERS.put("X-Content-Type-Options", "nosniff");
        RESPONSE_HEADERS.put("Content-Security-Policy", "sandbox; default-src 'none'");
    }
    private static SecretKey encryptionKey;
    private static final java.util.Set<Runnable> sourceObservers = new java.util.concurrent.CopyOnWriteArraySet<>();

    static void watchSources(Runnable observer) { sourceObservers.add(observer); }
    static void unwatchSources(Runnable observer) { sourceObservers.remove(observer); }
    private static void sourcesChanged() {
        for (Runnable observer : sourceObservers) observer.run();
    }

    static boolean hasSource(Context context, String id) { return store(context).contains(id); }

    static String pwaResource(Context context, String serverId, String trackId, String coverArtId, String format, boolean artwork) throws Exception {
        JSONObject saved = source(store(context), serverId);
        return (artwork ? endpoint(saved, "getCoverArt", "id", coverArtId, "size", "512")
                : endpoint(saved, "stream", "id", trackId, "format", format)).toExternalForm();
    }

    private SubsonicHost() {}

    static void dispatch(Context context, String command, JSONObject payload, AudioService.Reply reply) {
        try {
            SharedPreferences store = store(context);
            JSONObject result;
            switch (command) {
                case "subsonic.list": {
                    JSONArray sources = new JSONArray();
                    for (String id : store.getAll().keySet()) {
                        try { sources.put(publicSource(source(store, id))); }
                        catch (Exception e) { log("Unable to read a saved connection", e); }
                    }
                    result = new JSONObject().put("sources", sources);
                    break;
                }
                case "subsonic.add": {
                    JSONObject source = newSource(payload);
                    ping(source);
                    String id = source.getString("id");
                    if (!store.edit().putString(id, encrypt(id, source)).commit()) throw storageFailure();
                    sourcesChanged();
                    result = publicSource(source);
                    break;
                }
                case "subsonic.remove":
                    if (!store.edit().remove(payload.getString("id")).commit()) throw storageFailure();
                    sourcesChanged();
                    result = new JSONObject();
                    break;
                case "subsonic.test":
                    ping(source(store, payload.getString("id")));
                    result = new JSONObject();
                    break;
                default:
                    throw new AudioService.HostError("unavailable", "Choose a music server connection.");
            }
            reply.complete(result, null);
        } catch (AudioService.HostError e) {
            reply.complete(null, e);
        } catch (Exception e) {
            log("Unable to complete a connection operation", e);
            reply.complete(null, storageFailure());
        }
    }

    static Uri playbackUri(Context context, JSONObject value) throws AudioService.HostError {
        Uri uri = Uri.parse(value.optString("uri"));
        if (!isAppResource(uri) || !"/subsonic/stream".equals(uri.getPath())) return uri;
        try {
            JSONObject source = source(store(context), uri.getQueryParameter("source"));
            URL stream = endpoint(source, "stream", "id", uri.getQueryParameter("id"), "format", "raw");
            // Only the decoder receives the authenticated URL. The queue keeps its original reference.
            return Uri.parse(stream.toExternalForm());
        } catch (Exception e) {
            log("Unable to prepare a music server track", e);
            throw new AudioService.HostError("source-unavailable", "This music server track is unavailable.");
        }
    }

    static WebResourceResponse intercept(Context context, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if (path == null || !path.startsWith("/subsonic/") || !isAppResource(url)) return null;
        if (request.isForMainFrame() || !"GET".equals(request.getMethod())) return resourceError(403, "Forbidden");
        try {
            JSONObject source = source(store(context), url.getQueryParameter("source"));
            if ("/subsonic/artwork".equals(path)) {
                byte[] data = download(endpoint(source, "getCoverArt", "id", url.getQueryParameter("id"),
                        "size", "512"), "image/*");
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(data, 0, data.length, options);
                if (options.outMimeType == null || !options.outMimeType.startsWith("image/")) {
                    return resourceError(404, "Not Found");
                }
                return resource(options.outMimeType, null, data);
            }
            String method = path.substring("/subsonic/".length());
            URL endpoint;
            switch (method) {
                case "getSong":
                case "getAlbum":
                case "getPlaylist":
                    endpoint = endpoint(source, method, "id", url.getQueryParameter("id"));
                    break;
                case "getPlaylists":
                    endpoint = endpoint(source, method);
                    break;
                case "getAlbumList2":
                    endpoint = endpoint(source, method, "type", "alphabeticalByName",
                            "size", url.getQueryParameter("size"), "offset", url.getQueryParameter("offset"));
                    break;
                case "search3":
                    endpoint = endpoint(source, method, "query", url.getQueryParameter("query"),
                            "songCount", url.getQueryParameter("songCount"), "songOffset", url.getQueryParameter("songOffset"),
                            "albumCount", "0", "artistCount", "0");
                    break;
                default:
                    return resourceError(404, "Not Found");
            }
            return resource("application/json", "UTF-8", download(endpoint, "application/json"));
        } catch (Exception e) {
            log("Unable to retrieve a music server resource", e);
            return resourceError(502, "Bad Gateway");
        }
    }

    private static boolean isAppResource(Uri uri) {
        return WebHostBridge.ORIGIN.equals(uri.getScheme() + "://" + uri.getEncodedAuthority());
    }

    private static JSONObject newSource(JSONObject payload) throws Exception {
        String user = payload.getString("user");
        String password = payload.getString("password");
        URI url;
        try { url = URI.create(payload.getString("url")); }
        catch (IllegalArgumentException e) { throw unreachable(); }
        if (!("https".equals(url.getScheme()) || "http".equals(url.getScheme())) || url.getHost() == null
                || url.getRawUserInfo() != null || url.getRawQuery() != null || url.getRawFragment() != null
                || user.isEmpty() || password.isEmpty() || password.length() > 4096) throw unreachable();
        String path = url.getRawPath().replaceFirst("/$", "").replaceFirst("/rest$", "");
        String name = payload.optString("name").trim();
        if (name.isEmpty()) name = url.getHost();
        return new JSONObject().put("id", "subsonic:" + UUID.randomUUID())
                .put("name", name.substring(0, Math.min(128, name.length())))
                .put("url", url.getScheme() + "://" + url.getRawAuthority() + path + "/")
                .put("user", user).put("password", password);
    }

    private static JSONObject publicSource(JSONObject source) throws Exception {
        return new JSONObject().put("id", source.getString("id")).put("name", source.getString("name"))
                .put("url", source.getString("url")).put("user", source.getString("user"));
    }

    private static URL endpoint(JSONObject source, String method, String... args) throws Exception {
        String salt = UUID.randomUUID().toString().replace("-", "");
        byte[] hash = MessageDigest.getInstance("MD5")
                .digest((source.getString("password") + salt).getBytes(StandardCharsets.UTF_8));
        StringBuilder token = new StringBuilder(hash.length * 2);
        for (byte value : hash) {
            token.append(Character.forDigit((value & 0xff) >>> 4, 16));
            token.append(Character.forDigit(value & 0xf, 16));
        }
        Uri.Builder url = Uri.parse(source.getString("url") + "rest/" + method + ".view").buildUpon()
                .appendQueryParameter("u", source.getString("user")).appendQueryParameter("t", token.toString())
                .appendQueryParameter("s", salt).appendQueryParameter("v", "1.16.1")
                .appendQueryParameter("c", "EffeTune").appendQueryParameter("f", "json");
        for (int i = 0; i < args.length; i += 2) {
            if (args[i + 1] == null) throw new IllegalArgumentException("Missing Subsonic parameter");
            url.appendQueryParameter(args[i], args[i + 1]);
        }
        return new URL(url.build().toString());
    }

    private static void ping(JSONObject source) throws AudioService.HostError {
        JSONObject response;
        try {
            byte[] data = download(endpoint(source, "ping"), "application/json");
            response = new JSONObject(new String(data, StandardCharsets.UTF_8)).getJSONObject("subsonic-response");
        } catch (Exception e) {
            log("Unable to test a music server connection", e);
            throw unreachable();
        }
        if ("ok".equals(response.optString("status"))) return;
        JSONObject error = response.optJSONObject("error");
        int code = error == null ? 0 : error.optInt("code");
        if (code == 40 || code == 41) {
            throw new AudioService.HostError("subsonicAuthentication", "Check the username and password.");
        }
        throw unreachable();
    }

    private static byte[] download(URL url, String accept) throws IOException {
        // Subsonic sends its authentication token in the query string. Keep it on the configured server.
        long deadline = SystemClock.elapsedRealtime() + 15_000;
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setRequestProperty("Accept", accept);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300 || connection.getContentLengthLong() > RESPONSE_LIMIT) {
                throw new IOException("Invalid Subsonic response");
            }
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (SystemClock.elapsedRealtime() > deadline) throw new IOException("Subsonic request timed out");
                    if (output.size() + count > RESPONSE_LIMIT) throw new IOException("Subsonic response exceeds limit");
                    output.write(buffer, 0, count);
                }
                return output.toByteArray();
            }
        } finally { connection.disconnect(); }
    }

    private static WebResourceResponse resource(String mime, String encoding, byte[] data) {
        return new WebResourceResponse(mime, encoding, 200, "OK", RESPONSE_HEADERS, new ByteArrayInputStream(data));
    }

    private static WebResourceResponse resourceError(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, RESPONSE_HEADERS, null);
    }

    private static SharedPreferences store(Context context) {
        return context.getSharedPreferences("subsonic-sources", Context.MODE_PRIVATE);
    }

    private static JSONObject source(SharedPreferences store, String id) throws Exception {
        String saved = id == null ? null : store.getString(id, null);
        if (saved == null) throw new AudioService.HostError("unavailable", "This music server connection is unavailable.");
        String[] parts = saved.split(":", 2);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
        byte[] data = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
        return new JSONObject(new String(data, StandardCharsets.UTF_8));
    }

    private static String encrypt(String id, JSONObject source) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
        byte[] data = cipher.doFinal(source.toString().getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(data, Base64.NO_WRAP);
    }

    private static synchronized SecretKey key(boolean create) throws Exception {
        if (encryptionKey != null) return encryptionKey;
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        encryptionKey = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (encryptionKey != null) return encryptionKey;
        if (!create) throw storageFailure();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
        encryptionKey = generator.generateKey();
        return encryptionKey;
    }

    private static AudioService.HostError unreachable() {
        return new AudioService.HostError("unreachable", "Check the music server address and network connection.");
    }

    private static AudioService.HostError storageFailure() {
        return new AudioService.HostError("unavailable", "Music server connections could not be accessed.");
    }

    private static void log(String message, Exception error) {
        // Exception messages may contain the authenticated URL.
        Log.w(TAG, message + " (" + error.getClass().getSimpleName() + ")");
    }
}
