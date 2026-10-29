package com.frieve.effetune;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Build;
import android.util.Log;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.webkit.ConsoleMessage;
import android.widget.TextView;
import androidx.webkit.WebViewAssetLoader;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.InputStream;
import java.io.FileOutputStream;
import android.webkit.MimeTypeMap;
import java.util.UUID;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.json.JSONArray;

public final class MainActivity extends Activity {
    private static final int PICK_DOCUMENT = 11;
    private static final int REQUEST_MIC = 12;
    private static final int PICK_WEB_DOCUMENT = 13;
    private static final int REQUEST_LAN = 14;
    private WebView webView;
    private WebHostBridge bridge;
    private AudioService service;
    private boolean visible;
    private boolean destroyed;
    private boolean bound;
    private AudioService.Reply pickerReply;
    private boolean pickerMultiple;
    private AudioService.Reply permissionReply;
    private JSONObject permissionRequest;
    private ValueCallback<Uri[]> webFileReply;
    private final ArrayList<Runnable> serviceReady = new ArrayList<>();
    private final ExecutorService documents = Executors.newSingleThreadExecutor();
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((AudioService.LocalBinder) binder).getService();
            service.attach(MainActivity.this, (name1, data) -> {
                if (bridge != null) bridge.event(name1, data);
            }, visible);
            for (Runnable operation : serviceReady) operation.run();
            serviceReady.clear();
        }
        @Override public void onServiceDisconnected(ComponentName name) { service = null; }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        bindService(new Intent(this, AudioService.class), connection, BIND_AUTO_CREATE);
        bound = true;
        createWebView();
    }

    private void createWebView() {
        webView = new WebView(this);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // The bundled UI supports explicitly paired HTTP music servers on the LAN.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d("EffeTuneWeb", message.sourceId() + ":" + message.lineNumber() + " " + message.message());
                return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> reply, FileChooserParams params) {
                if (webFileReply != null) webFileReply.onReceiveValue(null);
                webFileReply = reply;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                String[] accepted = params.getAcceptTypes();
                ArrayList<String> mimeTypes = new ArrayList<>();
                boolean unknown = false;
                for (String type : accepted) for (String part : type.split(",")) {
                    String mime = part.startsWith(".") ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(part.substring(1)) : part;
                    if (mime == null || !mime.contains("/")) unknown = true;
                    else mimeTypes.add(mime);
                }
                if (!unknown && !mimeTypes.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toArray(new String[0]));
                try { startActivityForResult(intent, PICK_WEB_DOCUMENT); }
                catch (Exception error) { webFileReply = null; reply.onReceiveValue(null); }
                return true;
            }
        });
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("https".equals(url.getScheme()) && "appassets.androidplatform.net".equals(url.getHost())
                        && url.getPort() == -1 && "/media".equals(url.getPath())) {
                    try {
                        Uri document = DocumentStore.documentUri(url.getQueryParameter("uri"));
                        DocumentStore store = new DocumentStore(getContentResolver());
                        if (!document.getAuthority().equals(getPackageName() + ".files")
                                && !store.permission(AudioService.object("uri", document.toString())).optBoolean("granted")) throw new SecurityException("Media permission required");
                        return store.media(document, request.getRequestHeaders());
                    } catch (Exception error) {
                        Log.w("EffeTuneMedia", "Unable to read video", error);
                        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", new HashMap<>(), null);
                    }
                }
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                if (response != null) {
                    HashMap<String, String> headers = new HashMap<>();
                    headers.put("Cross-Origin-Opener-Policy", "same-origin");
                    headers.put("Cross-Origin-Embedder-Policy", "require-corp");
                    response.setResponseHeaders(headers);
                }
                return response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                        && uri.getPort() == -1 && uri.getPath() != null && uri.getPath().startsWith("/assets/")) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (Exception error) { Log.w("EffeTune", "No browser available", error); }
                }
                return true;
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (bridge != null) bridge.detach();
                view.destroy();
                webView = null;
                createWebView();
                return true;
            }
        });
        try {
            bridge = new WebHostBridge(this, webView);
            setContentView(webView);
            webView.loadUrl(WebHostBridge.ORIGIN + "/assets/web/effetune.html");
        } catch (IllegalStateException error) {
            TextView message = new TextView(this);
            message.setText(error.getMessage());
            setContentView(message);
        }
    }

    void dispatch(JSONObject request, AudioService.Reply reply) {
        if (destroyed) {
            reply.complete(null, new AudioService.HostError("unavailable", "This window has closed."));
            return;
        }
        String command = request.optString("command");
        JSONObject payload = request.optJSONObject("payload");
        if (command.equals("documents.share")) {
            try {
                Uri uri = DocumentStore.documentUri(payload.getString("uri"));
                if (!uri.getAuthority().equals(getPackageName() + ".files")) throw new SecurityException("Share requires an exported file");
                Intent send = new Intent(Intent.ACTION_SEND).setType(payload.optString("mimeType", "application/octet-stream"))
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newRawUri("EffeTune", uri));
                startActivity(Intent.createChooser(send, "Share file"));
                reply.complete(new JSONObject(), null);
            } catch (Exception error) { reply.complete(null, new AudioService.HostError("unavailable", "This file could not be shared. Try saving it first.")); }
            return;
        }
        if (command.equals("documents.pick") && payload.optString("kind").equals("export")) {
            new AlertDialog.Builder(this).setTitle(payload.optString("name", "Export file"))
                    .setItems(new String[]{"Save file", "Share file"}, (dialog, which) -> {
                        if (which == 0) {
                            try { payload.put("kind", "save"); } catch (Exception ignored) { }
                            dispatch(request, reply);
                        } else dispatch(AudioService.object("command", "documents.createTemporary", "payload", payload), (result, error) -> {
                            if (result != null) try { result.put("share", true); } catch (Exception ignored) { }
                            reply.complete(result, error);
                        });
                    }).setOnCancelListener(dialog -> reply.complete(null, new AudioService.HostError("cancelled", "Export was cancelled."))).show();
            return;
        }
        if (command.equals("remote.openPanel") && service != null) {
            service.command(AudioService.object("command", "remote.getStatus", "payload", new JSONObject()), (status, error) -> runOnUiThread(() -> {
                if (error != null || !visible) { reply.complete(status, error); return; }
                StringBuilder addressText = new StringBuilder();
                if (status.optJSONArray("addresses") != null) for (int i = 0; i < status.optJSONArray("addresses").length(); i++) {
                    if (i > 0) addressText.append('\n');
                    addressText.append(status.optJSONArray("addresses").optString(i));
                }
                String addresses = addressText.toString();
                new AlertDialog.Builder(this).setTitle("Remote Control")
                        .setMessage(status.optBoolean("enabled") ? "Connect from a trusted device on the same network.\n\n" + addresses : "Allow a trusted device on your local network to control EffeTune.")
                        .setPositiveButton(status.optBoolean("enabled") ? "Turn off" : "Turn on", (dialog, which) -> dispatch(
                                AudioService.object("command", "remote.configure", "payload", AudioService.object("enabled", !status.optBoolean("enabled"))), (result, failure) -> {
                                    if (failure != null) runOnUiThread(() -> new AlertDialog.Builder(this).setMessage(failure.getMessage()).setPositiveButton("OK", null).show());
                                }))
                        .setNeutralButton("Copy connection details", (dialog, which) -> getSystemService(ClipboardManager.class)
                                .setPrimaryClip(ClipData.newPlainText("EffeTune Remote Control", addresses + "\nToken: " + status.optString("token"))))
                        .setItems(new String[]{"Use a TLS certificate", "Use HTTP without TLS", "Replace access token"}, (dialog, which) -> {
                            if (which == 0) chooseRemoteTls(status);
                            else dispatch(AudioService.object("command", which == 2 ? "remote.rotateToken" : "remote.configure", "payload",
                                    which == 2 ? new JSONObject() : AudioService.object("enabled", status.optBoolean("enabled"), "certificatePem", "", "privateKeyPem", "")),
                                    (result, failure) -> reportRemoteFailure(failure));
                        })
                        .setNegativeButton("Close", null).show();
                reply.complete(status, null);
            }), true);
            return;
        }
        if ((command.equals("network.ensurePermission") || (command.equals("remote.configure") && payload.optBoolean("enabled"))) && Build.VERSION.SDK_INT >= 37
                && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED) {
            if (!visible || permissionReply != null || (command.equals("network.ensurePermission") && !payload.optBoolean("request"))) { reply.complete(null, new AudioService.HostError("permission-required", "Connect to the music source in EffeTune to allow local network access.")); return; }
            permissionRequest = request; permissionReply = reply;
            requestPermissions(new String[]{"android.permission.ACCESS_LOCAL_NETWORK"}, REQUEST_LAN);
            return;
        }
        if (command.equals("network.ensurePermission")) { reply.complete(AudioService.object("granted", true), null); return; }
        if (command.equals("documents.pick")) {
            if (!visible || pickerReply != null) { reply.complete(null, new AudioService.HostError("busy", "Finish the current file selection first.")); return; }
            pickerReply = reply;
            pickerMultiple = payload.optBoolean("multiple");
            String kind = payload.optString("kind", "file");
            Intent intent = new Intent(kind.equals("tree") ? Intent.ACTION_OPEN_DOCUMENT_TREE
                    : kind.equals("save") ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            if (!kind.equals("tree")) {
                intent.setType(payload.optString("mimeType", "*/*"));
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                if (kind.equals("file") && pickerMultiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                if (kind.equals("save")) intent.putExtra(Intent.EXTRA_TITLE, payload.optString("name", "EffeTune"));
            }
            try { startActivityForResult(intent, PICK_DOCUMENT); }
            catch (Exception error) { pickerReply = null; reply.complete(null, new AudioService.HostError("unavailable", "File selection is unavailable.")); }
            return;
        }
        if (command.startsWith("documents.")) {
            executeDocument(() -> {
                try {
                    DocumentStore store = new DocumentStore(getContentResolver());
                    JSONObject result;
                    switch (command) {
                        case "documents.read": result = store.read(payload); break;
                        case "documents.write": result = store.write(payload); break;
                        case "documents.list": result = store.list(payload); break;
                        case "documents.create": result = store.create(payload); break;
                        case "documents.stat": result = store.metadata(DocumentStore.documentUri(payload.getString("uri"))); break;
                        case "documents.resolve": result = store.resolve(payload); break;
                        case "documents.permission": result = store.permission(payload); break;
                        case "documents.compareRoots": result = store.compareRoots(payload); break;
                        case "documents.takeShared": {
                            Intent incoming = getIntent();
                            result = new JSONObject();
                            if (incoming != null && Intent.ACTION_SEND.equals(incoming.getAction())) {
                                Uri source = incoming.getParcelableExtra(Intent.EXTRA_STREAM);
                                if (source == null || !"content".equals(source.getScheme())) throw new IllegalArgumentException("Share requires a content URI");
                                JSONObject metadata = store.metadata(source);
                                File file = createTemporaryFile(metadata.optString("name", "shared-file"));
                                try (InputStream input = getContentResolver().openInputStream(source); FileOutputStream output = new FileOutputStream(file)) {
                                    if (input == null) throw new IllegalArgumentException("Shared file unavailable");
                                    byte[] buffer = new byte[256 * 1024];
                                    int count;
                                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                                }
                                Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
                                result = metadata.put("uri", uri.toString()).put("size", file.length());
                                incoming.setAction(null);
                            }
                            break;
                        }
                        case "documents.createTemporary": {
                            String name = payload.optString("name", "document");
                            File file = createTemporaryFile(name);
                            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
                            result = new JSONObject().put("uri", uri.toString()).put("name", name); break;
                        }
                        default: throw new IllegalArgumentException("This file operation is unavailable.");
                    }
                    reply.complete(result, null);
                } catch (Exception error) {
                    Log.w("EffeTuneFiles", "Document operation failed", error);
                    reply.complete(null, new AudioService.HostError("document-unavailable", "The file or folder cannot be accessed. Select it again."));
                }
            });
            return;
        }
        if (command.equals("audio.input") && payload.optInt("deviceId", -1) >= 0
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            if (!visible || permissionReply != null) { reply.complete(null, new AudioService.HostError("permission-required", "Open EffeTune to allow microphone access.")); return; }
            permissionRequest = request;
            permissionReply = reply;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_MIC);
            return;
        }
        if (service == null) {
            if (serviceReady.size() < 32) serviceReady.add(() -> dispatch(request, reply));
            else reply.complete(null, new AudioService.HostError("service-unavailable", "Audio is starting. Try again shortly."));
            return;
        }
        service.command(request, reply, visible);
    }

    private File createTemporaryFile(String name) throws Exception {
        File directory = new File(getCacheDir(), "imports");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Import storage unavailable");
        if (name.contains("/") || name.contains("\\") || name.length() > 255) throw new IllegalArgumentException("Invalid file name");
        File file = new File(directory, UUID.randomUUID() + "-" + name);
        if (!file.createNewFile()) throw new IllegalStateException("Import could not be created");
        return file;
    }

    private void executeDocument(Runnable operation) {
        // Serialize submission with Activity destruction, including file-picker worker callbacks.
        runOnUiThread(() -> {
            if (!destroyed) documents.execute(operation);
        });
    }

    private void reportRemoteFailure(Exception error) {
        if (error == null) return;
        Log.w("EffeTuneRemote", "Remote settings failed", error);
        runOnUiThread(() -> new AlertDialog.Builder(this).setMessage("Remote Control could not be updated. Check the selected certificate and network connection, then try again.")
                .setPositiveButton("OK", null).show());
    }

    private void chooseRemoteTls(JSONObject status) {
        new AlertDialog.Builder(this).setMessage("Select the PEM certificate, then its unencrypted PEM private key. Keep the private key confidential.")
                .setPositiveButton("Select certificate", (dialog, which) -> pickRemotePem(certificate ->
                        runOnUiThread(() -> new AlertDialog.Builder(this).setMessage("Now select the PEM private key.")
                                .setPositiveButton("Select private key", (keyDialog, keyWhich) -> pickRemotePem(privateKey ->
                                        dispatch(AudioService.object("command", "remote.configure", "payload", AudioService.object(
                                                "enabled", status.optBoolean("enabled"), "certificatePem", certificate, "privateKeyPem", privateKey)),
                                                (result, failure) -> reportRemoteFailure(failure))))
                                .setNegativeButton("Cancel", null).show())))
                .setNegativeButton("Cancel", null).show();
    }

    private void pickRemotePem(java.util.function.Consumer<String> consume) {
        dispatch(AudioService.object("command", "documents.pick", "payload", AudioService.object("kind", "file")), (selected, failure) -> {
            if (failure != null) { reportRemoteFailure(failure); return; }
            executeDocument(() -> {
                try {
                    JSONObject result = new DocumentStore(getContentResolver()).read(AudioService.object("uri", selected.getString("uri"), "offset", 0, "length", 256 * 1024));
                    if (!result.getBoolean("eof")) throw new IllegalArgumentException("Certificate is too large");
                    String pem = new String(Base64.decode(result.getString("data"), Base64.DEFAULT), StandardCharsets.UTF_8);
                    runOnUiThread(() -> consume.accept(pem));
                } catch (Exception error) { reportRemoteFailure(error); }
            });
        });
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (bridge != null) bridge.event("shared-document", new JSONObject());
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_WEB_DOCUMENT) {
            ValueCallback<Uri[]> reply = webFileReply;
            webFileReply = null;
            if (reply != null) reply.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            return;
        }
        if (requestCode != PICK_DOCUMENT || pickerReply == null) return;
        AudioService.Reply reply = pickerReply;
        boolean multiple = pickerMultiple;
        pickerReply = null;
        if (resultCode != RESULT_OK || data == null || (data.getData() == null && data.getClipData() == null)) {
            reply.complete(null, new AudioService.HostError("cancelled", "File selection was cancelled."));
            return;
        }
        ArrayList<Uri> selected = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) selected.add(data.getClipData().getItemAt(i).getUri());
        } else selected.add(data.getData());
        try {
            for (Uri uri : selected) getContentResolver().takePersistableUriPermission(uri, data.getFlags()
                    & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
            executeDocument(() -> {
                try {
                    DocumentStore store = new DocumentStore(getContentResolver());
                    JSONArray records = new JSONArray();
                    for (Uri uri : selected) records.put(store.metadata(uri));
                    reply.complete(multiple ? AudioService.object("files", records) : records.getJSONObject(0), null);
                }
                catch (Exception error) { reply.complete(null, new AudioService.HostError("document-unavailable", "The selected file cannot be read.")); }
            });
        } catch (Exception error) {
            Log.w("EffeTuneFiles", "Unable to retain document access", error);
            reply.complete(null, new AudioService.HostError("document-unavailable", "This provider cannot keep file access. Select another location."));
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if ((code != REQUEST_MIC && code != REQUEST_LAN) || permissionReply == null) return;
        AudioService.Reply reply = permissionReply;
        JSONObject request = permissionRequest;
        permissionReply = null;
        permissionRequest = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) dispatch(request, reply);
        else reply.complete(null, new AudioService.HostError("permission-denied", code == REQUEST_LAN
                ? "Local network access was not allowed. You can enable it in Android settings."
                : "Microphone access was not allowed. You can enable it in Android settings."));
    }

    @Override protected void onStart() { super.onStart(); visible = true; if (service != null) service.setVisible(this, true); }
    @Override protected void onStop() { visible = false; if (service != null) service.setVisible(this, false); super.onStop(); }
    @Override protected void onDestroy() {
        destroyed = true;
        if (bridge != null) bridge.detach();
        if (service != null) service.detach(this);
        if (bound) unbindService(connection);
        if (webView != null) webView.destroy();
        if (webFileReply != null) webFileReply.onReceiveValue(null);
        serviceReady.clear();
        pickerReply = null;
        permissionReply = null;
        permissionRequest = null;
        documents.shutdownNow();
        super.onDestroy();
    }
}
