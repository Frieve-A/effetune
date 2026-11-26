package com.frieve.effetune;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetFileDescriptor;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.IBinder;
import android.os.Build;
import android.util.Log;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
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
import android.window.OnBackInvokedDispatcher;
import androidx.webkit.WebViewAssetLoader;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import java.io.File;
import java.io.InputStream;
import java.io.FileOutputStream;
import android.webkit.MimeTypeMap;
import java.util.UUID;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.json.JSONArray;

public final class MainActivity extends Activity {
    private static final int PICK_DOCUMENT = 11;
    private static final int REQUEST_MIC = 12;
    private static final int PICK_WEB_DOCUMENT = 13;
    private static final int REQUEST_LAN = 14;
    private static final int REQUEST_CAMERA = 15;
    private WebView webView;
    private WebHostBridge bridge;
    private AudioService service;
    private boolean visible;
    private boolean visualizerExpanded;
    private boolean destroyed;
    private boolean bound;
    private volatile Intent consumedShare;
    // A copy can outlive its Activity. Task removal cancels queued and active imports together.
    private static final HashSet<CancellationSignal> sharedImports = new HashSet<>();
    private AudioService.Reply pickerReply;
    private boolean pickerMultiple;
    private AudioService.Reply permissionReply;
    private JSONObject permissionRequest;
    private int permissionRequestCode;
    private int pageGeneration;
    private PermissionRequest cameraRequest;
    private boolean requestingCameraPermission;
    private ValueCallback<Uri[]> webFileReply;
    private final ArrayList<Runnable> serviceReady = new ArrayList<>();
    private final ExecutorService documents = Executors.newSingleThreadExecutor();
    private final ExecutorService subsonicCommands = Executors.newSingleThreadExecutor();
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
        WindowCompat.enableEdgeToEdge(getWindow());
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            // Pass only the overlap that remains inside the WebView, including the keyboard.
            return insets.inset(bars.left, bars.top, bars.right, bars.bottom);
        });
        if (state != null && state.getBoolean("shareConsumed")) consumedShare = getIntent();
        bindService(new Intent(this, AudioService.class), connection, BIND_AUTO_CREATE);
        bound = true;
        createWebView();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putBoolean("shareConsumed", consumedShare != null && consumedShare == getIntent());
    }

    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        if (webView != null) webView.getSettings().setTextZoom(Math.round(config.fontScale * 100));
    }

    private void navigateBack() {
        WebView view = webView;
        if (view == null) {
            moveTaskToBack(true);
            return;
        }
        view.evaluateJavascript("window.effetuneHandleBack?.() === true", handled -> {
            if (destroyed || webView != view || !visible || "true".equals(handled)) return;
            if (view.canGoBack()) view.goBack();
            else moveTaskToBack(true);
        });
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { navigateBack(); }

    private void showVisualizerFullscreen(boolean fullscreen) {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(fullscreen ? WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                : WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
        if (fullscreen) controller.hide(WindowInsetsCompat.Type.systemBars());
        else controller.show(WindowInsetsCompat.Type.systemBars());
    }

    private void createWebView() {
        if (visualizerExpanded) {
            visualizerExpanded = false;
            showVisualizerFullscreen(false);
        }
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
            @Override public void onPermissionRequest(PermissionRequest request) {
                Uri origin = request.getOrigin();
                String[] resources = request.getResources();
                if (!WebHostBridge.ORIGIN.equals(origin.getScheme() + "://" + origin.getEncodedAuthority())
                        || resources.length != 1 || !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resources[0])
                        || !visible || permissionRequestCode != 0 || cameraRequest != null) {
                    request.deny();
                } else if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    cameraRequest = request;
                    if (!requestingCameraPermission) {
                        requestingCameraPermission = true;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQUEST_CAMERA);
                    }
                }
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (cameraRequest == request) cameraRequest = null;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d("EffeTuneWeb", message.sourceId() + ":" + message.lineNumber() + " " + message.message());
                return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> reply, FileChooserParams params) {
                if (webFileReply != null) webFileReply.onReceiveValue(null);
                webFileReply = reply;
                int mode = params.getMode();
                boolean save = mode == FileChooserParams.MODE_SAVE;
                Intent intent;
                if (mode == FileChooserParams.MODE_OPEN_FOLDER) {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                } else {
                    intent = new Intent(save ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE);
                    ArrayList<String> mimeTypes = new ArrayList<>();
                    boolean unknown = false;
                    for (String type : params.getAcceptTypes()) for (String part : type.split(",")) {
                        String mime = part.startsWith(".") ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(part.substring(1)) : part;
                        if (mime == null || !mime.contains("/")) unknown = true;
                        else mimeTypes.add(mime);
                    }
                    if (save) {
                        String name = params.getFilenameHint();
                        intent.putExtra(Intent.EXTRA_TITLE, name);
                        String mime = name == null ? null : MimeTypeMap.getSingleton()
                                .getMimeTypeFromExtension(name.substring(name.lastIndexOf('.') + 1));
                        if (mime == null && !mimeTypes.isEmpty()) mime = mimeTypes.get(0);
                        intent.setType(mime != null ? mime : "application/octet-stream");
                    } else {
                        intent.setType("*/*");
                        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, mode == FileChooserParams.MODE_OPEN_MULTIPLE);
                        if (!unknown && !mimeTypes.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toArray(new String[0]));
                    }
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                if (save || (Build.VERSION.SDK_INT >= 37 && params.getPermissionMode() == FileChooserParams.PERMISSION_MODE_READ_WRITE)) {
                    intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                }
                try { startActivityForResult(intent, PICK_WEB_DOCUMENT); }
                catch (Exception error) { webFileReply = null; reply.onReceiveValue(null); }
                return true;
            }
        });
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse subsonic = SubsonicHost.intercept(MainActivity.this, request);
                if (subsonic != null) return subsonic;
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
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageGeneration++;
                cancelPermissionRequest();
                String path = Uri.parse(url).getPath();
                boolean featurePage = "/assets/web/features/effetune_bench.html".equals(path)
                        || "/assets/web/features/measurement/measurement.html".equals(path);
                Runnable navigation = () -> service.pageStarted(MainActivity.this, featurePage);
                if (service == null) serviceReady.add(navigation); else navigation.run();
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
                pageGeneration++;
                cancelPermissionRequest();
                if (service != null) service.rendererGone(MainActivity.this);
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
        if (command.equals("window.systemBars")) {
            boolean light = payload.optBoolean("light");
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            controller.setAppearanceLightStatusBars(light);
            controller.setAppearanceLightNavigationBars(light);
            findViewById(android.R.id.content).setBackgroundColor(light ? Color.WHITE : Color.BLACK);
            boolean expanded = payload.optBoolean("expanded");
            if (visualizerExpanded != expanded) {
                visualizerExpanded = expanded;
                if (visible) showVisualizerFullscreen(expanded);
            }
            reply.complete(null, null);
            return;
        }
        if (command.equals("documents.share")) {
            try {
                Intent send = new Intent(Intent.ACTION_SEND);
                if (payload.has("text")) {
                    send.setType("text/plain").putExtra(Intent.EXTRA_TEXT, payload.getString("text"));
                } else {
                    Uri uri = DocumentStore.documentUri(payload.getString("uri"));
                    if (!uri.getAuthority().equals(getPackageName() + ".files")) throw new SecurityException("Share requires an exported file");
                    send.setType(payload.optString("mimeType", "application/octet-stream"))
                            .putExtra(Intent.EXTRA_STREAM, uri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    send.setClipData(ClipData.newRawUri("EffeTune", uri));
                }
                startActivity(Intent.createChooser(send, payload.optString("title", null))
                        .putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, new ComponentName[]{getComponentName()}));
                reply.complete(new JSONObject(), null);
            } catch (Exception error) { reply.complete(null, new AudioService.HostError("unavailable", "The sharing screen could not be opened.")); }
            return;
        }
        // WebView denies the web clipboard read permission, so pasting reads the system clipboard here.
        if (command.equals("clipboard.readText")) {
            ClipData clip = visible ? getSystemService(ClipboardManager.class).getPrimaryClip() : null;
            CharSequence text = clip == null || clip.getItemCount() == 0 ? null : clip.getItemAt(0).coerceToText(this);
            reply.complete(AudioService.object("text", text == null ? "" : text.toString()), null);
            return;
        }
        if (command.equals("documents.pick") && payload.optString("kind").equals("export")) {
            new AlertDialog.Builder(this).setTitle(payload.optString("name", "Export file"))
                    .setItems(new String[]{payload.optString("saveLabel", "Save file"), payload.optString("shareLabel", "Share file")}, (dialog, which) -> {
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
        if ((command.equals("network.ensurePermission") || (command.equals("remote.configure") && payload.optBoolean("enabled"))) && Build.VERSION.SDK_INT >= 37
                && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED) {
            if (!visible || permissionRequestCode != 0 || requestingCameraPermission || (command.equals("network.ensurePermission") && !payload.optBoolean("request"))) { reply.complete(null, new AudioService.HostError("permission-required", "Connect to the music source in EffeTune to allow local network access.")); return; }
            requestHostPermission(request, reply, "android.permission.ACCESS_LOCAL_NETWORK", REQUEST_LAN);
            return;
        }
        if (command.equals("network.ensurePermission")) { reply.complete(AudioService.object("granted", true), null); return; }
        if (command.startsWith("subsonic.")) { subsonicCommands.execute(() -> SubsonicHost.dispatch(this, command, payload, reply)); return; }
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
            Intent incoming = command.equals("documents.takeShared") ? getIntent() : null;
            CancellationSignal importSignal = incoming == null ? null : new CancellationSignal();
            if (importSignal != null) synchronized (sharedImports) { sharedImports.add(importSignal); }
            executeDocument(() -> {
                try {
                    DocumentStore store = new DocumentStore(getContentResolver());
                    JSONObject result;
                    switch (command) {
                        case "documents.read": result = store.read(payload); break;
                        case "documents.write": result = store.write(payload); break;
                        case "documents.copyRange": result = store.copyRange(payload); break;
                        case "documents.compareRange": result = store.compareRange(payload); break;
                        case "documents.list": result = store.list(payload); break;
                        case "documents.create": result = store.create(payload); break;
                        case "documents.replace": result = store.replace(payload); break;
                        case "documents.delete": result = store.delete(payload); break;
                        case "documents.stat": result = store.metadata(DocumentStore.documentUri(payload.getString("uri"))); break;
                        case "documents.resolve": result = store.resolve(payload); break;
                        case "documents.permission": result = store.permission(payload); break;
                        case "documents.compareRoots": result = store.compareRoots(payload); break;
                        case "documents.takeShared": {
                            result = takeShared(store, incoming, importSignal);
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
                } catch (AudioService.HostError error) {
                    reply.complete(null, error);
                } catch (Exception error) {
                    Log.w("EffeTuneFiles", "Document operation failed", error);
                    reply.complete(null, new AudioService.HostError("document-unavailable", "The file or folder cannot be accessed. Select it again."));
                }
            });
            return;
        }
        // Ask when a measurement is chosen or an input is opened. Releasing an input needs no permission.
        boolean openingInput = (command.equals("audio.input") || command.equals("measurement.input")) && payload.optInt("deviceId", -1) >= 0;
        if ((command.equals("measurement.options") || openingInput)
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            if (!visible || permissionRequestCode != 0 || requestingCameraPermission) { reply.complete(null, new AudioService.HostError("permission-required", "Open EffeTune to allow microphone access.")); return; }
            requestHostPermission(request, reply, Manifest.permission.RECORD_AUDIO, REQUEST_MIC);
            return;
        }
        if (service == null) {
            if (serviceReady.size() < 32) serviceReady.add(() -> dispatch(request, reply));
            else reply.complete(null, new AudioService.HostError("service-unavailable", "Audio is starting. Try again shortly."));
            return;
        }
        if (command.equals("remote.selectConnectionFile")) {
            selectRemoteConnectionFile(payload.optString("kind"), reply);
            return;
        }
        service.command(request, reply, visible);
    }

    /** Documents handed over by "Open with" (VIEW) or a single or multiple share; empty for any other launch. */
    @SuppressWarnings("deprecation")
    private static ArrayList<Uri> sharedUris(Intent intent) {
        ArrayList<Uri> uris = new ArrayList<>();
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) uris.add(intent.getData());
        else if (Intent.ACTION_SEND.equals(action)) uris.add(intent.getParcelableExtra(Intent.EXTRA_STREAM));
        else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (streams != null) uris.addAll(streams);
        }
        return uris;
    }

    private static File importDirectory(Context context) { return new File(context.getCacheDir(), "imports"); }

    static boolean importFileExists(Context context, Uri uri) {
        java.util.List<String> parts = uri.getPathSegments();
        if (parts.size() != 3 || !"imports".equals(parts.get(0))) return false;
        File file = new File(new File(importDirectory(context), parts.get(1)), parts.get(2));
        try {
            return uri.equals(FileProvider.getUriForFile(context, context.getPackageName() + ".files", file))
                    && file.isFile();
        } catch (IllegalArgumentException invalidPath) { return false; }
    }

    static void cancelSharedImports() {
        ArrayList<CancellationSignal> pending;
        synchronized (sharedImports) {
            if (sharedImports.isEmpty()) return;
            pending = new ArrayList<>(sharedImports);
            sharedImports.clear();
        }
        // Closing a provider's descriptor may block. Keep it off the lifecycle and audio threads.
        java.util.concurrent.CompletableFuture.runAsync(() -> {
            for (CancellationSignal signal : pending) signal.cancel();
        });
    }

    private JSONObject takeShared(DocumentStore store, Intent incoming, CancellationSignal signal) throws Exception {
        JSONArray files = new JSONArray();
        ArrayList<File> pending = new ArrayList<>();
        try {
            for (Uri source : sharedUris(incoming == consumedShare ? null : incoming)) {
                signal.throwIfCanceled();
                if (source == null || !"content".equals(source.getScheme())) throw new IllegalArgumentException("Share requires a content URI");
                JSONObject metadata = store.metadata(source, signal);
                try (AssetFileDescriptor descriptor = getContentResolver().openAssetFileDescriptor(source, "r", signal)) {
                    if (descriptor == null) throw new IllegalArgumentException("Shared file unavailable");
                    try (InputStream input = descriptor.createInputStream()) {
                        signal.setOnCancelListener(() -> {
                            try { input.close(); }
                            catch (java.io.IOException error) { Log.w("EffeTuneFiles", "Cannot close shared input", error); }
                        });
                        signal.throwIfCanceled();
                        File file = createTemporaryFile(metadata.optString("name", "shared-file"));
                        pending.add(file);
                        try (FileOutputStream output = new FileOutputStream(file)) {
                            byte[] buffer = new byte[256 * 1024];
                            int count;
                            while ((count = input.read(buffer)) != -1) {
                                signal.throwIfCanceled();
                                output.write(buffer, 0, count);
                            }
                        } finally { signal.setOnCancelListener(null); }
                        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
                        files.put(metadata.put("uri", uri.toString()).put("size", file.length()));
                    }
                }
            }
            synchronized (sharedImports) {
                if (signal != null && !sharedImports.remove(signal)) throw new android.os.OperationCanceledException();
                if (!pending.isEmpty()) consumedShare = incoming;
                pending.clear();
            }
            return AudioService.object("files", files);
        } finally {
            synchronized (sharedImports) { sharedImports.remove(signal); }
            for (File file : pending) {
                if (!file.delete() || !file.getParentFile().delete()) Log.w("EffeTuneFiles", "Cannot remove incomplete import");
            }
        }
    }

    /** Deletes import copies made before {@code createdBefore} that the persisted playback queue no longer references. */
    static void deleteUnusedImports(Context context, PlaybackQueueStore queue, long createdBefore) {
        File[] directories = importDirectory(context).listFiles();
        if (directories == null) return;
        HashSet<String> used = new HashSet<>();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i); used.add(item.optString("uri")); used.add(item.optString("scoreUri")); }
        for (File directory : directories) {
            boolean oldDirectory = directory.lastModified() < createdBefore;
            File[] files = directory.listFiles();
            if (files == null) continue;
            for (File file : files) {
                if (file.lastModified() >= createdBefore) continue;
                if (used.contains(FileProvider.getUriForFile(context, context.getPackageName() + ".files", file).toString())) continue;
                if (!file.delete()) Log.w("EffeTuneFiles", "Unused import could not be deleted");
            }
            File[] remaining = directory.listFiles();
            if (oldDirectory && remaining != null && remaining.length == 0 && !directory.delete()) Log.w("EffeTuneFiles", "Empty import directory could not be deleted");
        }
    }

    private File createTemporaryFile(String name) throws Exception {
        if (name.contains("/") || name.contains("\\") || name.length() > 255) throw new IllegalArgumentException("Invalid file name");
        File directory = new File(importDirectory(this), UUID.randomUUID().toString());
        if (!directory.mkdirs()) throw new IllegalStateException("Import storage unavailable");
        File file = new File(directory, name);
        if (!file.createNewFile()) throw new IllegalStateException("Import could not be created");
        return file;
    }

    private void executeDocument(Runnable operation) {
        // Serialize submission with Activity destruction, including file-picker worker callbacks.
        runOnUiThread(() -> {
            if (!destroyed) documents.execute(operation);
        });
    }

    private void selectRemoteConnectionFile(String kind, AudioService.Reply reply) {
        if (!kind.equals("certificate") && !kind.equals("key")) {
            reply.complete(null, new AudioService.HostError("invalid-kind", "Choose a certificate or private key."));
            return;
        }
        dispatch(AudioService.object("command", "documents.pick", "payload", AudioService.object("kind", "file")), (selected, failure) -> {
            if (failure != null) { reply.complete(null, failure); return; }
            executeDocument(() -> {
                try {
                    JSONObject result = new DocumentStore(getContentResolver()).read(AudioService.object("uri", selected.getString("uri"), "offset", 0, "length", 256 * 1024));
                    if (!result.getBoolean("eof")) throw new IllegalArgumentException("PEM document is too large");
                    String pem = new String(Base64.decode(result.getString("data"), Base64.DEFAULT), StandardCharsets.UTF_8);
                    runOnUiThread(() -> {
                        if (service != null && !destroyed) service.selectRemoteConnectionFile(kind, selected.optString("name"), pem, reply);
                        else reply.complete(null, new AudioService.HostError("unavailable", "Reopen EffeTune and try selecting the file again."));
                    });
                } catch (Exception error) {
                    Log.w("EffeTuneRemote", "Could not read the selected connection file", error);
                    reply.complete(null, new AudioService.HostError("document-unavailable", "Choose a readable certificate or private key."));
                }
            });
        });
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        consumedShare = null;
        setIntent(intent);
        if (bridge != null) bridge.event("shared-document", new JSONObject());
    }

    private static Uri[] selectedDocumentUris(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null) return null;
        ClipData clip = data.getClipData();
        if (clip != null) {
            ArrayList<Uri> uris = new ArrayList<>(clip.getItemCount());
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
            if (!uris.isEmpty()) return uris.toArray(new Uri[0]);
        }
        Uri uri = data.getData();
        return uri == null ? null : new Uri[]{uri};
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_WEB_DOCUMENT) {
            ValueCallback<Uri[]> reply = webFileReply;
            webFileReply = null;
            if (reply != null) reply.onReceiveValue(selectedDocumentUris(resultCode, data));
            return;
        }
        if (requestCode != PICK_DOCUMENT || pickerReply == null) return;
        AudioService.Reply reply = pickerReply;
        boolean multiple = pickerMultiple;
        pickerReply = null;
        Uri[] selected = selectedDocumentUris(resultCode, data);
        if (selected == null) {
            reply.complete(null, new AudioService.HostError("cancelled", "File selection was cancelled."));
            return;
        }
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

    private void requestHostPermission(JSONObject request, AudioService.Reply reply, String permission, int code) {
        permissionRequest = request;
        permissionReply = reply;
        permissionRequestCode = code;
        reply.permissionWaiting(true);
        requestPermissions(new String[]{permission}, code);
    }

    private void cancelPermissionRequest() {
        AudioService.Reply reply = permissionReply;
        permissionRequest = null;
        permissionReply = null;
        if (reply != null) reply.complete(null, new AudioService.HostError("cancelled", "The permission request was cancelled."));
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == REQUEST_CAMERA) {
            requestingCameraPermission = false;
            PermissionRequest pending = cameraRequest;
            cameraRequest = null;
            if (pending != null) {
                if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                    pending.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else pending.deny();
            }
            return;
        }
        if (code != permissionRequestCode) return;
        permissionRequestCode = 0;
        if (results.length == 0) { cancelPermissionRequest(); return; }
        AudioService.Reply reply = permissionReply;
        JSONObject request = permissionRequest;
        permissionReply = null;
        permissionRequest = null;
        if (reply == null) return;
        if (results[0] == PackageManager.PERMISSION_GRANTED) {
            reply.permissionWaiting(false);
            int owner = pageGeneration;
            Runnable granted = () -> {
                if (owner != pageGeneration || destroyed) {
                    reply.complete(null, new AudioService.HostError("cancelled", "The permission request was cancelled."));
                    return;
                }
                dispatch(request, reply);
            };
            if (service != null || request.optString("command").equals("network.ensurePermission")) granted.run();
            else if (serviceReady.size() < 32) serviceReady.add(granted);
            else reply.complete(null, new AudioService.HostError("service-unavailable", "Audio is starting. Try again shortly."));
        } else reply.complete(null, new AudioService.HostError("permission-denied", code == REQUEST_LAN
                ? "Local network access was not allowed. You can enable it in Android settings."
                : "Microphone access was not allowed. You can enable it in Android settings."));
    }

    @Override protected void onStart() {
        super.onStart();
        visible = true;
        if (visualizerExpanded) showVisualizerFullscreen(true);
        if (service != null) service.setVisible(this, true);
    }
    @Override protected void onStop() {
        visible = false;
        if (visualizerExpanded) showVisualizerFullscreen(false);
        if (service != null) service.setVisible(this, false);
        super.onStop();
    }
    @Override protected void onDestroy() {
        destroyed = true;
        cancelPermissionRequest();
        if (isFinishing()) cancelSharedImports();
        if (cameraRequest != null) {
            cameraRequest.deny();
            cameraRequest = null;
        }
        if (bridge != null) bridge.detach();
        if (service != null) service.detach(this);
        if (bound) unbindService(connection);
        if (webView != null) webView.destroy();
        if (webFileReply != null) webFileReply.onReceiveValue(null);
        serviceReady.clear();
        pickerReply = null;
        documents.shutdown();
        subsonicCommands.shutdownNow();
        super.onDestroy();
    }
}
