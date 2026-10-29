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
        activity.dispatch(request, (result, error) -> {
            try {
                JSONObject response = new JSONObject().put("version", 1).put("id", request.getString("id"))
                        .put("ok", error == null);
                if (error == null) response.put("result", result == null ? JSONObject.NULL : result);
                else response.put("error", new JSONObject().put("code", error.code).put("message", error.getMessage()));
                activity.runOnUiThread(() -> {
                    if (!detached) proxy.postMessage(response.toString());
                });
            } catch (Exception failure) { Log.e("EffeTuneBridge", "Unable to send reply", failure); }
        });
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
