package com.frieve.effetune;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** A real, separately installed document provider for URI/grant workflow acceptance. */
public final class WorkflowDocumentsProvider extends DocumentsProvider {
    static final String AUTHORITY = "com.frieve.effetune.workflow.test.documents";
    private static final String APP_PACKAGE = "com.frieve.effetune.development";
    private static final String[] COLUMNS = { DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED, DocumentsContract.Document.COLUMN_FLAGS };
    private File root;
    @Override public boolean onCreate() { root = new File(getContext().getCacheDir(), "workflow-documents"); return root.isDirectory() || root.mkdirs(); }
    private File file(String id) throws FileNotFoundException {
        if (!id.equals("root") && (!id.startsWith("root/") || id.contains(".."))) throw new FileNotFoundException(id);
        return id.equals("root") ? root : new File(root, id.substring(5));
    }
    private void row(MatrixCursor cursor, String id) throws FileNotFoundException {
        File file = file(id); if (!file.exists()) throw new FileNotFoundException(id);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : cursor.getColumnNames()) {
            Object value = null;
            if (column.equals(COLUMNS[0])) value = id;
            else if (column.equals(COLUMNS[1])) value = file.getName();
            else if (column.equals(COLUMNS[2])) value = file.isDirectory() ? DocumentsContract.Document.MIME_TYPE_DIR : "application/octet-stream";
            else if (column.equals(COLUMNS[3])) value = file.length();
            else if (column.equals(COLUMNS[4])) value = file.lastModified();
            else if (column.equals(COLUMNS[5])) value = file.isDirectory() ? DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE : DocumentsContract.Document.FLAG_SUPPORTS_WRITE | DocumentsContract.Document.FLAG_SUPPORTS_DELETE;
            row.add(column, value);
        }
    }
    @Override public Cursor queryRoots(String[] projection) {
        MatrixCursor cursor = new MatrixCursor(new String[] { DocumentsContract.Root.COLUMN_ROOT_ID, DocumentsContract.Root.COLUMN_DOCUMENT_ID,
                DocumentsContract.Root.COLUMN_TITLE, DocumentsContract.Root.COLUMN_FLAGS });
        cursor.addRow(new Object[] { "workflow", "root", "EffeTune workflow test", DocumentsContract.Root.FLAG_SUPPORTS_CREATE }); return cursor;
    }
    @Override public Cursor queryDocument(String id, String[] projection) throws FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? COLUMNS : projection); row(cursor, id); return cursor;
    }
    @Override public Cursor queryChildDocuments(String id, String[] projection, String order) throws FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? COLUMNS : projection);
        File[] files = file(id).listFiles();
        if (files != null) { Arrays.sort(files); for (File file : files) row(cursor, id + "/" + file.getName()); }
        return cursor;
    }
    @Override public ParcelFileDescriptor openDocument(String id, String mode, CancellationSignal signal) throws FileNotFoundException {
        return ParcelFileDescriptor.open(file(id), ParcelFileDescriptor.parseMode(mode));
    }
    @Override public String createDocument(String parent, String mime, String name) throws FileNotFoundException {
        if (name.contains("/") || name.contains("\\") || name.equals("..")) throw new FileNotFoundException(name);
        String id = parent + "/" + name; File file = file(id);
        try { if (mime.equals(DocumentsContract.Document.MIME_TYPE_DIR)) file.mkdirs(); else if (!file.exists()) file.createNewFile(); }
        catch (Exception error) { throw new FileNotFoundException(error.toString()); }
        return id;
    }
    @Override public void deleteDocument(String id) throws FileNotFoundException { if (!file(id).delete()) throw new FileNotFoundException(id); }
    @Override public boolean isChildDocument(String parent, String child) { return child.startsWith(parent + "/"); }

    private static String fixtureDirectory(String directory) {
        if (directory == null || !directory.matches("workflow-[0-9a-f-]{36}")) throw new IllegalArgumentException("Invalid fixture directory");
        return directory;
    }

    public static final class Picker extends Activity {
        @Override public void onCreate(Bundle state) {
            super.onCreate(state);
            String directory = fixtureDirectory(getIntent().getStringExtra("workflowDirectory"));
            File root = new File(getCacheDir(), "workflow-documents");
            if (getIntent().getBooleanExtra("revokeOnly", false)) {
                revokeUriPermission(DocumentsContract.buildTreeDocumentUri(AUTHORITY, "root/" + directory),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                finish(); return;
            }
            if (getIntent().getBooleanExtra("cleanupOnly", false)) {
                deleteFixture(new File(root, directory)); finish(); return;
            }
            new File(root, directory).mkdirs();
            String[] files = getIntent().getStringArrayExtra("workflowFiles");
            if (files != null) {
                ClipData selected = null;
                for (String name : files) {
                    Uri fileUri = DocumentsContract.buildDocumentUri(AUTHORITY, "root/" + directory + "/" + name);
                    if (selected == null) selected = ClipData.newRawUri("Music", fileUri);
                    else selected.addItem(new ClipData.Item(fileUri));
                }
                Intent result = new Intent().addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                result.setClipData(selected);
                setResult(RESULT_OK, result); finish(); return;
            }
            Uri uri = DocumentsContract.buildTreeDocumentUri(AUTHORITY, "root/" + directory);
            Intent result = new Intent().setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            result.setClipData(ClipData.newRawUri("Workflow", uri)); setResult(RESULT_OK, result); finish();
        }
        private static void deleteFixture(File file) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteFixture(child);
            if (file.exists() && !file.delete()) throw new IllegalStateException("Fixture cleanup failed");
        }
    }
    public static final class ShareReceiver extends Activity {
        @Override public void onCreate(Bundle state) {
            super.onCreate(state);
            Intent send = getIntent().getParcelableExtra(Intent.EXTRA_INTENT);
            try {
                String directory = fixtureDirectory(getIntent().getStringExtra("workflowDirectory"));
                if (send == null || !Intent.ACTION_SEND.equals(send.getAction())) throw new IllegalArgumentException("Invalid fixture share");
                Uri uri = send.getParcelableExtra(Intent.EXTRA_STREAM);
                if (uri == null || !"content".equals(uri.getScheme()) || !(APP_PACKAGE + ".files").equals(uri.getAuthority())
                        || uri.getPathSegments().size() != 2 || !"imports".equals(uri.getPathSegments().get(0))
                        || !uri.getLastPathSegment().endsWith("-" + directory + ".effetune_backup")) {
                    throw new IllegalArgumentException("Invalid fixture share URI");
                }
                long bytes = 0;
                try (InputStream input = getContentResolver().openInputStream(uri)) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) >= 0) bytes += count;
                }
                File root = new File(new File(getCacheDir(), "workflow-documents"), directory); root.mkdirs();
                try (FileOutputStream output = new FileOutputStream(new File(root, "share-result.json"))) {
                    output.write(("{\"bytes\":" + bytes + ",\"mime\":\"" + send.getType() + "\",\"flags\":" + send.getFlags() + "}").getBytes(StandardCharsets.UTF_8));
                }
            } catch (Exception error) { android.util.Log.e("WorkflowShare", "Share receiver failed", error); }
            finish();
        }
    }
    public static final class ShareSender extends Activity {
        @Override public void onCreate(Bundle state) {
            super.onCreate(state);
            Uri uri = Uri.parse(getIntent().getStringExtra("uri"));
            if (!APP_PACKAGE.equals(getIntent().getStringExtra("targetPackage")) || !"content".equals(uri.getScheme())
                    || !AUTHORITY.equals(uri.getAuthority()) || !DocumentsContract.isDocumentUri(this, uri)) {
                throw new IllegalArgumentException("Invalid fixture backup target");
            }
            String document = DocumentsContract.getDocumentId(uri);
            String[] parts = document.split("/");
            if (parts.length != 3 || !"root".equals(parts[0])
                    || !parts[2].equals(fixtureDirectory(parts[1]) + ".effetune_backup")) {
                throw new IllegalArgumentException("Invalid fixture backup document");
            }
            Intent send = new Intent(Intent.ACTION_SEND).setClassName(APP_PACKAGE, "com.frieve.effetune.MainActivity")
                    .setType("application/octet-stream").putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri("Backup", uri)); startActivity(send); finish();
        }
    }
}
