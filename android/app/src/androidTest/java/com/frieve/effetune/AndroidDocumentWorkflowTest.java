package com.frieve.effetune;

import static org.junit.Assert.*;
import static com.frieve.effetune.AndroidWebHostTest.*;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidDocumentWorkflowTest {
    @Test public void realProviderGrantsRangesBatchFormatsBackupAndShares() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Context app = instrumentation.getTargetContext(), test = instrumentation.getContext();
        String directory = "workflow-" + UUID.randomUUID();
        Instrumentation.ActivityMonitor monitor = new Instrumentation.ActivityMonitor() {
            int musicPick;
            @Override public Instrumentation.ActivityResult onStartActivity(Intent intent) {
                if (Intent.ACTION_OPEN_DOCUMENT_TREE.equals(intent.getAction())) {
                    intent.setComponent(new ComponentName(test.getPackageName(), WorkflowDocumentsProvider.Picker.class.getName()));
                    intent.putExtra("workflowDirectory", directory);
                } else if (Intent.ACTION_OPEN_DOCUMENT.equals(intent.getAction())) {
                    assertTrue(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false));
                    intent.setComponent(new ComponentName(test.getPackageName(), WorkflowDocumentsProvider.Picker.class.getName()));
                    intent.putExtra("workflowDirectory", directory);
                    intent.putExtra("workflowFiles", musicPick++ == 0 ? new String[] { "selection.wav", "second.wav" }
                            : new String[] { "selection.wav", "selection.cue", "selection.lrc" });
                } else if (Intent.ACTION_CHOOSER.equals(intent.getAction())) {
                    intent.setComponent(new ComponentName(test.getPackageName(), WorkflowDocumentsProvider.ShareReceiver.class.getName()));
                    intent.putExtra("workflowDirectory", directory);
                }
                return null;
            }
        };
        instrumentation.addMonitor(monitor);
        Uri root = null, exported = null;
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            Intent[] scenarioIntent = new Intent[1];
            scenario.onActivity(activity -> scenarioIntent[0] = new Intent(activity.getIntent()));
            awaitReady(scenario); loadScript(scenario, test);
            execute(scenario, "window.__workflow.pick()"); root = Uri.parse(result(scenario).getString("uri"));
            String quotedRoot = JSONObject.quote(root.toString());
            execute(scenario, "window.__workflow.ranges(" + quotedRoot + ")"); JSONObject ranges = result(scenario);
            scenario.recreate(); awaitReady(scenario); loadScript(scenario, test);
            execute(scenario, "import('https://appassets.androidplatform.net/assets/web/js/android/bridge.js').then(async m=>{const b=m.getAndroidBridge();return {permission:await b.request('documents.permission',{uri:" + quotedRoot + "}),range:await b.request('documents.read',{uri:" + JSONObject.quote(ranges.getString("uri")) + ",offset:299999,length:1})};})");
            JSONObject restored = result(scenario); assertTrue(restored.getJSONObject("permission").getBoolean("granted"));
            assertEquals((byte) (299999 % 251), Base64.decode(restored.getJSONObject("range").getString("data"), Base64.DEFAULT)[0]);
            for (String[] format : new String[][] { {"wav", "pcm16"}, {"wav", "pcm24"}, {"wav", "float32"}, {"flac", "pcm16"}, {"flac", "pcm24"} }) {
                execute(scenario, "window.__workflow.exportFormat(" + quotedRoot + "," + JSONObject.quote(format[0]) + "," + JSONObject.quote(format[1]) + ")");
                JSONObject output = result(scenario); assertEquals(2, output.getInt("writes")); assertEquals("100%", output.getString("progress"));
            }
            execute(scenario, "window.__workflow.exportFormat(" + quotedRoot + ",'wav','pcm16',true)"); assertEquals(1, result(scenario).getInt("writes"));
            execute(scenario, "window.__workflow.musicSelection(" + quotedRoot + ")"); assertTrue(result(scenario).getBoolean("lyrics"));
            scenario.recreate(); awaitReady(scenario); loadScript(scenario, test);
            execute(scenario, "window.__workflow.restoredLyrics()"); assertTrue(result(scenario).getBoolean("lyrics"));
            try {
                execute(scenario, "window.__workflow.libraryLyrics(" + quotedRoot + ")"); assertTrue(result(scenario).getBoolean("lyrics"));
                scenario.recreate(); awaitReady(scenario); loadScript(scenario, test);
                execute(scenario, "window.__workflow.restoredLibraryLyrics()"); assertTrue(result(scenario).getBoolean("lyrics"));
            } finally { execute(scenario, "window.__workflow.cleanupLibraryLyrics()"); result(scenario); }
            DocumentStore documents = new DocumentStore(app.getContentResolver());
            JSONObject video = documents.create(new JSONObject().put("uri", root.toString()).put("name", "tone.mp4").put("mimeType", "video/mp4"));
            try (InputStream input = test.getAssets().open("audio/tone.mp4"); java.io.OutputStream output = app.getContentResolver().openOutputStream(Uri.parse(video.getString("uri")), "wt")) {
                byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            }
            execute(scenario, "window.__workflow.video(" + JSONObject.quote(video.getString("uri")) + ")"); assertTrue(result(scenario).getBoolean("advanced"));
            execute(scenario, "window.__workflow.backup(" + quotedRoot + "," + JSONObject.quote(directory) + ")");
            JSONObject backup = result(scenario); exported = Uri.parse(backup.getString("sharedUri"));
            JSONObject shareResult = waitForShare(documents, root);
            assertEquals(backup.getLong("size"), shareResult.getLong("bytes"));
            assertEquals("application/octet-stream", shareResult.getString("mime"));
            assertTrue((shareResult.getInt("flags") & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
            assertEquals(0, shareResult.getInt("flags") & Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            app.getContentResolver().releasePersistableUriPermission(root, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            app.startActivity(new Intent().setComponent(new ComponentName(test.getPackageName(), WorkflowDocumentsProvider.Picker.class.getName()))
                    .putExtra("workflowDirectory", directory).putExtra("revokeOnly", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            long revokedDeadline = android.os.SystemClock.elapsedRealtime() + 5000;
            boolean revoked = false;
            while (!revoked && android.os.SystemClock.elapsedRealtime() < revokedDeadline) {
                try { documents.read(new JSONObject().put("uri", ranges.getString("uri"))); Thread.sleep(50); }
                catch (SecurityException denied) { revoked = true; }
            }
            assertTrue("Provider did not revoke its temporary grant", revoked);
            assertFalse(documents.permission(new JSONObject().put("uri", root.toString())).getBoolean("granted"));
            try { documents.read(new JSONObject().put("uri", ranges.getString("uri"))); fail("Revoked URI remained readable"); } catch (Exception expected) { }
            Intent incoming = new Intent().setComponent(new ComponentName(test.getPackageName(), WorkflowDocumentsProvider.ShareSender.class.getName()))
                    .putExtra("uri", backup.getString("uri")).putExtra("targetPackage", app.getPackageName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            app.startActivity(incoming);
            long deadline = android.os.SystemClock.elapsedRealtime() + 15000;
            while (android.os.SystemClock.elapsedRealtime() < deadline && !"true".equals(evaluate(scenario,
                    "Boolean(document.querySelector('.backup-restore-overlay')?.textContent.includes(" + JSONObject.quote(directory) + "))"))) Thread.sleep(100);
            assertEquals("true", evaluate(scenario, "Boolean(document.querySelector('.backup-restore-overlay')?.textContent.includes(" + JSONObject.quote(directory) + "))"));
            execute(scenario, "window.pipelineManager.presetManager.deletePreset(" + JSONObject.quote(directory) + ").then(()=>({done:true}))"); result(scenario);
            try { documents.read(new JSONObject().put("uri", ranges.getString("uri"))); fail("Revoked URI remained readable"); } catch (Exception expected) { }
            execute(scenario, "window.__workflow.pick()"); assertEquals(root.toString(), result(scenario).getString("uri"));
            assertEquals(1, documents.read(new JSONObject().put("uri", ranges.getString("uri")).put("length", 1)).getInt("length"));
            Uri deleted = Uri.parse(ranges.getString("sample")); assertTrue(DocumentsContract.deleteDocument(app.getContentResolver(), deleted));
            try { documents.read(new JSONObject().put("uri", deleted.toString())); fail("Deleted URI remained readable"); } catch (Exception expected) { }
            // ActivityScenario matches lifecycle callbacks against the launch Intent.
            // Restore it only after testing the real ACTION_SEND/onNewIntent behavior.
            scenario.onActivity(activity -> { activity.setIntent(scenarioIntent[0]); activity.finish(); });
        } finally {
            instrumentation.removeMonitor(monitor);
            if (root != null) {
                try { deleteTree(app, root, root.toString()); } catch (SecurityException revoked) {
                    // The provider owner can clean its fixture after the grant-revocation assertions.
                    app.startActivity(new Intent().setComponent(new ComponentName(test.getPackageName(), WorkflowDocumentsProvider.Picker.class.getName()))
                            .putExtra("workflowDirectory", directory).putExtra("cleanupOnly", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } finally {
                    try { app.getContentResolver().releasePersistableUriPermission(root, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) { }
                }
            }
            if (exported != null) app.getContentResolver().delete(exported, null, null);
            for (android.content.UriPermission permission : app.getContentResolver().getPersistedUriPermissions()) {
                Uri uri = permission.getUri();
                if (WorkflowDocumentsProvider.AUTHORITY.equals(uri.getAuthority()) && DocumentsContract.isDocumentUri(app, uri)
                        && DocumentsContract.getDocumentId(uri).startsWith("root/" + directory + "/")) {
                    app.getContentResolver().releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
            }
            java.io.File imports = new java.io.File(app.getCacheDir(), "imports");
            java.io.File[] ownCopies = imports.listFiles((parent, name) -> name.endsWith(directory + ".effetune_backup"));
            if (ownCopies != null) for (java.io.File copy : ownCopies) assertTrue(copy.delete());
        }
    }
    private static void loadScript(ActivityScenario<MainActivity> scenario, Context test) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (InputStream input = test.getAssets().open("document-workflow.js")) { byte[] buffer = new byte[8192]; int size; while ((size = input.read(buffer)) >= 0) output.write(buffer, 0, size); }
        execute(scenario, output.toString("UTF-8")); assertTrue(result(scenario).getBoolean("ready"));
    }
    private static JSONObject waitForShare(DocumentStore documents, Uri root) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 10000;
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            try {
                JSONObject record = documents.resolve(new JSONObject().put("treeUri", root.toString()).put("relativePath", "share-result.json"));
                JSONObject bytes = documents.read(new JSONObject().put("uri", record.getString("uri")));
                return new JSONObject(new String(Base64.decode(bytes.getString("data"), Base64.DEFAULT), java.nio.charset.StandardCharsets.UTF_8));
            } catch (Exception pending) { Thread.sleep(100); }
        }
        throw new AssertionError("External receiver could not read the temporary share grant");
    }
    private static void deleteTree(Context context, Uri root, String uri) throws Exception {
        if (!DocumentsContract.getTreeDocumentId(Uri.parse(uri)).equals(DocumentsContract.getTreeDocumentId(root))) throw new AssertionError("Cleanup escaped its fixture tree");
        DocumentStore store = new DocumentStore(context.getContentResolver());
        JSONArray entries = store.list(new JSONObject().put("uri", uri)).getJSONArray("entries");
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i);
            if (entry.getBoolean("isDirectory")) deleteTree(context, root, entry.getString("uri"));
            else assertTrue(DocumentsContract.deleteDocument(context.getContentResolver(), Uri.parse(entry.getString("uri"))));
        }
        Uri target = Uri.parse(uri);
        if (!target.getPathSegments().contains("document")) target = DocumentsContract.buildDocumentUriUsingTree(target, DocumentsContract.getTreeDocumentId(target));
        assertTrue(DocumentsContract.deleteDocument(context.getContentResolver(), target));
    }
}
