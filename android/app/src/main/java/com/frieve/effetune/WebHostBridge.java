package com.frieve.effetune;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import org.json.JSONObject;

/** The only JavaScript entry point. Never expose Java objects with addJavascriptInterface. */
final class WebHostBridge {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int MESSAGE_LIMIT_BYTES = 1024 * 1024;
    private final MainActivity activity;
    private JavaScriptReplyProxy reply;
    private boolean detached;

    WebHostBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            throw new IllegalStateException("Update Android System WebView to use EffeTune.");
        }
        WebViewCompat.addWebMessageListener(webView, "effetuneAndroid", Collections.singleton(ORIGIN),
                (view, message, origin, mainFrame, proxy) -> receive(message, origin, mainFrame, proxy));
    }

    private void receive(WebMessageCompat message, Uri origin, boolean mainFrame, JavaScriptReplyProxy proxy) {
        if (detached || !mainFrame || !ORIGIN.equals(origin.toString())) return;
        String raw = message.getData();
        if (raw == null || raw.length() > 1024 * 1024) return;
        JSONObject request;
        try {
            request = new JSONObject(raw);
            if (request.getInt("version") != 1 || !(request.get("id") instanceof String)
                    || request.getString("id").length() > 128 || request.getString("id").isEmpty()
                    || !(request.get("command") instanceof String)
                    || !(request.opt("payload") instanceof JSONObject)) return;
        } catch (Exception error) {
            Log.w("EffeTuneBridge", "Rejected malformed bridge request", error);
            return;
        }
        reply = proxy;
        String id = request.optString("id");
        activity.dispatch(request, new AudioService.Reply() {
            @Override public void permissionWaiting(boolean waiting) {
                postReply(proxy, AudioService.object("version", 1, "id", id, "permissionWaiting", waiting));
            }

            @Override public void complete(JSONObject result, AudioService.HostError error) {
                if (error == null) postReply(proxy, AudioService.object("version", 1, "id", id, "ok", true,
                        "result", result == null ? JSONObject.NULL : result));
                else postReply(proxy, AudioService.object("version", 1, "id", id, "ok", false,
                        "error", AudioService.object("code", error.code, "message", error.getMessage())));
            }
        });
    }

    private void postReply(JavaScriptReplyProxy proxy, JSONObject response) {
        activity.runOnUiThread(() -> {
            if (detached) return;
            try {
                String encoded = response.toString();
                if (exceedsMessageLimit(encoded)) {
                    encoded = AudioService.object("version", 1, "id", response.optString("id"), "ok", false,
                            "error", AudioService.object("code", "response-too-large",
                                    "message", "The response is too large. Select fewer files and try again.")).toString();
                }
                proxy.postMessage(encoded);
            }
            catch (RuntimeException failure) { Log.w("EffeTuneBridge", "Unable to send reply", failure); }
        });
    }

    private static boolean exceedsMessageLimit(String message) {
        int bytes = 0;
        for (int i = 0; i < message.length(); i++) {
            char value = message.charAt(i);
            if (value < 0x80) bytes++;
            else if (value < 0x800) bytes += 2;
            else if (Character.isHighSurrogate(value) && i + 1 < message.length()
                    && Character.isLowSurrogate(message.charAt(i + 1))) {
                bytes += 4;
                i++;
            } else if (Character.isSurrogate(value)) bytes++;
            else bytes += 3;
            if (bytes > MESSAGE_LIMIT_BYTES) return true;
        }
        return false;
    }

    void event(String name, JSONObject data) {
        activity.runOnUiThread(() -> {
            if (detached || reply == null) return;
            try { reply.postMessage(new JSONObject().put("version", 1).put("event", name).put("data", data).toString()); }
            catch (Exception error) { Log.w("EffeTuneBridge", "Unable to send event", error); }
        });
    }

    void detach() { detached = true; reply = null; }
}
