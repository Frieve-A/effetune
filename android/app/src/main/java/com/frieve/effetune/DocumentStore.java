package com.frieve.effetune;

import android.content.ContentResolver;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import android.webkit.WebResourceResponse;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded access to documents selected through the system picker. */
final class DocumentStore {
    static final int CHUNK_BYTES = 256 * 1024;
    // Copy and compare calls stay short so other document requests are not delayed.
    static final int RANGE_BYTES = 4 * 1024 * 1024;
    private final ContentResolver resolver;

    DocumentStore(ContentResolver resolver) { this.resolver = resolver; }

    static Uri documentUri(String value) {
        Uri uri = Uri.parse(value);
        if (!"content".equals(uri.getScheme()) || uri.getAuthority() == null) {
            throw new IllegalArgumentException("Select a file or folder first.");
        }
        return uri;
    }

    JSONObject metadata(Uri uri) throws Exception {
        return metadata(uri, null);
    }

    JSONObject metadata(Uri uri, android.os.CancellationSignal signal) throws Exception {
        JSONObject result = new JSONObject().put("uri", uri.toString());
        Uri queryUri = DocumentsContract.isTreeUri(uri)
                ? DocumentsContract.buildDocumentUriUsingTree(uri, folderId(uri)) : uri;
        int flags = 0;
        try (Cursor cursor = resolver.query(queryUri, null, null, null, null, signal)) {
            if (cursor != null && cursor.moveToFirst()) {
                int name = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int size = cursor.getColumnIndex(OpenableColumns.SIZE);
                int modified = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                int flagColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_FLAGS);
                result.put("name", name < 0 ? "Document" : cursor.getString(name));
                result.put("size", size < 0 || cursor.isNull(size) ? JSONObject.NULL : cursor.getLong(size));
                result.put("lastModified", modified < 0 || cursor.isNull(modified) ? 0 : cursor.getLong(modified));
                if (flagColumn >= 0 && !cursor.isNull(flagColumn)) flags = cursor.getInt(flagColumn);
            }
        }
        String mime = resolver.getType(queryUri);
        boolean directory = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
        // Writable means a file can be overwritten, or a folder can receive new files.
        int writeFlag = directory ? DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE : DocumentsContract.Document.FLAG_SUPPORTS_WRITE;
        return result.put("mimeType", mime).put("isDirectory", directory).put("writable", (flags & writeFlag) != 0)
                .put("canRename", (flags & DocumentsContract.Document.FLAG_SUPPORTS_RENAME) != 0)
                .put("canDelete", (flags & DocumentsContract.Document.FLAG_SUPPORTS_DELETE) != 0);
    }

    JSONObject read(JSONObject args) throws Exception {
        Uri uri = documentUri(args.getString("uri"));
        long offset = args.optLong("offset", 0);
        int length = args.optInt("length", CHUNK_BYTES);
        if (offset < 0 || length < 1 || length > CHUNK_BYTES) throw new IllegalArgumentException("Invalid file range.");
        byte[] bytes = new byte[length];
        int count = 0;
        boolean eof = false;
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("The selected file is unavailable.");
            eof = !skip(input, offset);
            while (!eof && count < length) {
                int read = input.read(bytes, count, length - count);
                if (read < 0) eof = true;
                else count += read;
            }
            if (!eof) eof = input.read() < 0;
        }
        return new JSONObject().put("data", Base64.encodeToString(Arrays.copyOf(bytes, count), Base64.NO_WRAP))
                .put("offset", offset).put("length", count).put("eof", eof);
    }

    /** Skips to an offset, returning false when the stream ends first. */
    private static boolean skip(InputStream input, long count) throws IOException {
        while (count > 0) {
            long skipped = input.skip(count);
            if (skipped == 0) {
                if (input.read() < 0) return false;
                skipped = 1;
            }
            count -= skipped;
        }
        return true;
    }

    private static boolean readFully(InputStream input, byte[] buffer, int length) throws IOException {
        for (int count = 0; count < length;) {
            int read = input.read(buffer, count, length - count);
            if (read < 0) return false;
            count += read;
        }
        return true;
    }

    private static long rangeLength(JSONObject args) throws Exception {
        long length = args.getLong("length");
        if (length < 0 || length > RANGE_BYTES) throw new IllegalArgumentException("Invalid file range.");
        return length;
    }

    /** Appends a source range to the staged document. */
    JSONObject copyRange(JSONObject args) throws Exception {
        Uri source = documentUri(args.getString("source")), target = documentUri(args.getString("target"));
        long offset = args.getLong("offset"), length = rangeLength(args);
        if (offset < 0) throw new IllegalArgumentException("Invalid file range.");
        byte[] buffer = new byte[CHUNK_BYTES];
        long copied = 0;
        try (InputStream input = resolver.openInputStream(source)) {
            if (input == null || !skip(input, offset)) throw new IOException("The source file ended early.");
            try (OutputStream output = resolver.openOutputStream(target, "wa")) {
                if (output == null) throw new IllegalStateException("The selected file cannot be saved.");
                while (copied < length) {
                    int count = (int) Math.min(buffer.length, length - copied);
                    if (!readFully(input, buffer, count)) throw new IOException("The source file ended early.");
                    output.write(buffer, 0, count);
                    copied += count;
                }
            }
        }
        return new JSONObject().put("copied", copied);
    }

    JSONObject compareRange(JSONObject args) throws Exception {
        Uri left = documentUri(args.getString("left")), right = documentUri(args.getString("right"));
        long leftOffset = args.getLong("leftOffset"), rightOffset = args.getLong("rightOffset"), length = rangeLength(args);
        if (leftOffset < 0 || rightOffset < 0) throw new IllegalArgumentException("Invalid file range.");
        boolean equal = true;
        try (InputStream a = resolver.openInputStream(left); InputStream b = resolver.openInputStream(right)) {
            if (a == null || b == null) throw new IllegalStateException("The selected file is unavailable.");
            byte[] x = new byte[CHUNK_BYTES], y = new byte[CHUNK_BYTES];
            equal = skip(a, leftOffset) && skip(b, rightOffset);
            for (long done = 0; equal && done < length;) {
                int count = (int) Math.min(CHUNK_BYTES, length - done);
                equal = readFully(a, x, count) && readFully(b, y, count)
                        && ByteBuffer.wrap(x, 0, count).equals(ByteBuffer.wrap(y, 0, count));
                done += count;
            }
        }
        return new JSONObject().put("equal", equal);
    }

    WebResourceResponse media(Uri uri, Map<String, String> requestHeaders) throws Exception {
        JSONObject stat = metadata(uri);
        long size = stat.getLong("size");
        long first = 0, last = size - 1;
        String range = requestHeaders.get("Range");
        if (range == null) range = requestHeaders.get("range");
        if (range != null) {
            if (!range.startsWith("bytes=") || range.contains(",")) throw new IllegalArgumentException("Invalid media range");
            String[] bounds = range.substring(6).split("-", -1);
            if (bounds.length != 2 || bounds[0].isEmpty()) throw new IllegalArgumentException("Invalid media range");
            first = Long.parseLong(bounds[0]);
            if (!bounds[1].isEmpty()) last = Math.min(last, Long.parseLong(bounds[1]));
            if (first < 0 || first > last) throw new IllegalArgumentException("Invalid media range");
        }
        InputStream input = resolver.openInputStream(uri);
        if (input == null) throw new IOException("Media is unavailable");
        try {
            final long byteCount = last - first + 1;
            final long end = last + 1;
            InputStream bounded = new FilterInputStream(input) {
                // WebView seeks intercepted streams using the request Range itself.
                // Keep the original offset here, and bound reads at the range end.
                long remaining = end;
                @Override public int available() throws IOException {
                    return remaining > Integer.MAX_VALUE ? 0 : (int) Math.min(remaining, in.available());
                }
                @Override public long skip(long count) throws IOException {
                    long skipped = in.skip(Math.min(count, remaining));
                    remaining -= skipped; return skipped;
                }
                @Override public int read() throws IOException {
                    if (remaining <= 0) return -1;
                    int value = super.read(); if (value >= 0) remaining--; return value;
                }
                @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                    if (remaining <= 0) return -1;
                    int count = in.read(buffer, offset, (int) Math.min(length, remaining));
                    if (count > 0) remaining -= count; return count;
                }
            };
            HashMap<String, String> headers = new HashMap<>();
            headers.put("Accept-Ranges", "bytes"); headers.put("Content-Length", Long.toString(byteCount));
            headers.put("Cross-Origin-Resource-Policy", "same-origin");
            if (range != null) headers.put("Content-Range", "bytes " + first + "-" + last + "/" + size);
            return new WebResourceResponse(stat.optString("mimeType", "application/octet-stream"), null,
                    range == null ? 200 : 206, range == null ? "OK" : "Partial Content", headers, bounded);
        } catch (Exception error) { input.close(); throw error; }
    }

    JSONObject write(JSONObject args) throws Exception {
        Uri uri = documentUri(args.getString("uri"));
        String encoded = args.getString("data");
        if (encoded.length() > (CHUNK_BYTES + 2) / 3 * 4) throw new IllegalArgumentException("The file chunk is too large.");
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        if (bytes.length > CHUNK_BYTES) throw new IllegalArgumentException("The file chunk is too large.");
        try (OutputStream output = resolver.openOutputStream(uri, args.optBoolean("append") ? "wa" : "wt")) {
            if (output == null) throw new IllegalStateException("The selected file cannot be saved.");
            output.write(bytes);
        }
        return new JSONObject().put("bytesWritten", bytes.length);
    }

    private static String documentName(JSONObject args) throws Exception {
        String name = args.getString("name");
        if (name.isEmpty() || name.length() > 255 || name.contains("/") || name.contains("\\")) {
            throw new IllegalArgumentException("Choose a file name without folders.");
        }
        return name;
    }

    JSONObject create(JSONObject args) throws Exception {
        Uri tree = documentUri(args.getString("uri"));
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree,
                args.optString("documentId", folderId(tree)));
        Uri created = DocumentsContract.createDocument(resolver, parent,
                args.optString("mimeType", "application/octet-stream"), documentName(args));
        if (created == null) throw new IllegalStateException("The folder does not allow creating files.");
        try {
            return metadata(created);
        } catch (Exception error) {
            // The caller still needs the URI to remove the file if its capabilities are unavailable.
            Log.w("EffeTune", "Could not read metadata for a newly created document", error);
            return new JSONObject().put("uri", created.toString());
        }
    }

    private Uri rename(Uri uri, String name) throws IOException {
        Uri renamed = DocumentsContract.renameDocument(resolver, uri, name);
        if (renamed == null) throw new IOException("The selected file could not be renamed.");
        return renamed;
    }

    private boolean removeAfterReplace(Uri uri) {
        try {
            return DocumentsContract.deleteDocument(resolver, uri);
        } catch (Exception error) {
            Log.w("EffeTune", "Could not remove a document after tag replacement", error);
            return false;
        }
    }

    /** Owns the verified temporary file from submission through commit or rollback. */
    JSONObject replace(JSONObject args) throws Exception {
        Uri original = documentUri(args.getString("uri"));
        Uri temporary = documentUri(args.getString("temporary"));
        if (original.equals(temporary)) throw new IllegalArgumentException("Choose two different files.");
        JSONObject result = new JSONObject().put("status", "failed");
        Uri backup = null, installed = null;
        String originalName = null, temporaryName = null;
        try {
            JSONObject staged = metadata(temporary);
            long size = args.getLong("temporarySize");
            JSONObject current = metadata(original);
            if (current.optLong("size", -1) != args.getLong("expectSize")
                    || current.optLong("lastModified") != args.getLong("expectLastModified")
                    || staged.optLong("size", -1) != size
                    || staged.optLong("lastModified") != args.getLong("temporaryLastModified")) {
                return result.put("status", "changed");
            }
            originalName = documentName(current);
            temporaryName = documentName(staged);
            backup = rename(original, "." + UUID.randomUUID() + ".effetune-backup");
            // With a stable document ID, replacing the file would change its catalog URI.
            if (original.equals(backup)) return result.put("status", "unavailable");
            installed = rename(temporary, originalName);
            temporary = null;
            if (!original.equals(installed)) return result.put("status", "unavailable");
            JSONObject written = metadata(installed);
            if (!originalName.equals(written.optString("name")) || written.optLong("size", -1) != size
                    || written.optLong("lastModified") <= 0) throw new IOException("Could not verify the installed document.");
            result.put("size", size).put("lastModified", written.getLong("lastModified")).put("status", "written");
            installed = null;
            if (!removeAfterReplace(backup)) result.put("backupRemaining", true);
            backup = null;
        } catch (Exception error) {
            Log.w("EffeTune", "Could not replace the document after verifying its tags", error);
        } finally {
            if (installed != null) {
                try {
                    temporary = rename(installed, temporaryName);
                    installed = null;
                } catch (Exception error) {
                    Log.w("EffeTune", "Could not move the replacement out of the way", error);
                    result.put("temporaryRemaining", true);
                }
            }
            if (backup != null) {
                try {
                    // Keep a playable replacement in place if it could not be moved off the original URI.
                    if (original.equals(installed) || !original.equals(rename(backup, originalName))) {
                        result.put("backupRemaining", true);
                    }
                } catch (Exception error) {
                    Log.w("EffeTune", "Could not restore the original document", error);
                    result.put("backupRemaining", true);
                }
            }
            if (temporary != null && !original.equals(temporary) && !removeAfterReplace(temporary)) {
                result.put("temporaryRemaining", true);
            }
        }
        return result;
    }

    JSONObject delete(JSONObject args) throws Exception {
        boolean deleted = DocumentsContract.deleteDocument(resolver, documentUri(args.getString("uri")));
        return new JSONObject().put("deleted", deleted);
    }

    JSONObject list(JSONObject args) throws Exception {
        Uri tree = documentUri(args.getString("uri"));
        String documentId = args.optString("documentId", folderId(tree));
        int offset = args.optInt("offset", 0);
        int limit = args.optInt("limit", 128);
        if (offset < 0 || limit < 1 || limit > 256) throw new IllegalArgumentException("Invalid folder range.");
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId);
        JSONArray entries = new JSONArray();
        boolean more = false;
        try (Cursor cursor = resolver.query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED}, null, null, null)) {
            if (cursor != null && cursor.moveToPosition(offset)) {
                do {
                    if (entries.length() == limit) { more = true; break; }
                    String id = cursor.getString(0);
                    entries.put(new JSONObject().put("documentId", id)
                            .put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString())
                            .put("name", cursor.getString(1)).put("mimeType", cursor.getString(2))
                            .put("isDirectory", DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(2)))
                            .put("size", cursor.isNull(3) ? JSONObject.NULL : cursor.getLong(3))
                            .put("lastModified", cursor.getLong(4)));
                } while (cursor.moveToNext());
            }
        }
        return new JSONObject().put("entries", entries).put("nextOffset", more ? offset + entries.length() : JSONObject.NULL);
    }

    private static String folderId(Uri uri) {
        return uri.getPathSegments().contains("document") ? DocumentsContract.getDocumentId(uri) : DocumentsContract.getTreeDocumentId(uri);
    }

    JSONObject resolve(JSONObject args) throws Exception {
        Uri tree = documentUri(args.getString("treeUri"));
        String path = args.getString("relativePath");
        if (path.startsWith("/") || path.contains("\\") || path.length() > 4096) throw new IllegalArgumentException("Invalid relative file path.");
        String current = folderId(tree);
        for (String part : path.split("/")) {
            if (part.isEmpty() || part.equals(".")) continue;
            if (part.equals("..")) throw new IllegalArgumentException("The file must be inside the selected folder.");
            String found = null;
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, current);
            try (Cursor cursor = resolver.query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (cursor == null) throw new IOException("The document provider is unavailable.");
                while (cursor.moveToNext()) if (part.equals(cursor.getString(1))) { found = cursor.getString(0); break; }
            }
            if (found == null) throw new AudioService.HostError("document-not-found", "The file is no longer in this folder.");
            current = found;
        }
        return metadata(DocumentsContract.buildDocumentUriUsingTree(tree, current));
    }

    JSONObject permission(JSONObject args) throws Exception {
        Uri uri = documentUri(args.getString("uri"));
        boolean write = args.optBoolean("write");
        boolean granted = false;
        for (UriPermission permission : resolver.getPersistedUriPermissions()) {
            if (!permission.isReadPermission() || (write && !permission.isWritePermission())) continue;
            Uri root = permission.getUri();
            if (root.equals(uri) || (root.getAuthority().equals(uri.getAuthority())
                    && DocumentsContract.isTreeUri(root) && DocumentsContract.isTreeUri(uri)
                    && DocumentsContract.getTreeDocumentId(root).equals(DocumentsContract.getTreeDocumentId(uri)))) { granted = true; break; }
        }
        return new JSONObject().put("granted", granted);
    }

    JSONObject compareRoots(JSONObject args) throws Exception {
        Uri left = documentUri(args.getString("left")), right = documentUri(args.getString("right"));
        String relation = "unrelated";
        if (left.getAuthority().equals(right.getAuthority())) {
            String leftId = folderId(left), rightId = folderId(right);
            if (leftId.equals(rightId)) relation = "same";
            else {
                Uri leftDocument = DocumentsContract.buildDocumentUriUsingTree(left, leftId);
                Uri rightDocument = DocumentsContract.buildDocumentUriUsingTree(right, rightId);
                if (DocumentsContract.isChildDocument(resolver, leftDocument, rightDocument)) relation = "ancestor";
                else if (DocumentsContract.isChildDocument(resolver, rightDocument, leftDocument)) relation = "descendant";
            }
        }
        return new JSONObject().put("relation", relation);
    }
}
