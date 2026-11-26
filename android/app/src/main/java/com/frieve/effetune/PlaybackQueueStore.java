package com.frieve.effetune;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.util.LinkedHashMap;
import java.util.function.IntUnaryOperator;
import org.json.JSONArray;
import org.json.JSONObject;

/** Durable queue entries only. The shared Web catalog remains the music index. */
final class PlaybackQueueStore implements AutoCloseable {
    private static final String[] TABLES = {"queue_a", "queue_b", "queue_c", "queue_d"};
    private static final class Checkpoint {
        final String table;
        final int size;
        final JSONObject settings;

        Checkpoint(String table, int size, JSONObject settings) {
            this.table = table; this.size = size; this.settings = settings;
        }
    }
    private final SQLiteDatabase database;
    private final LinkedHashMap<String, Checkpoint> checkpoints = new LinkedHashMap<>();
    private String active;
    private String staging;
    private int size;
    private int stagedSize;
    private int nextId;
    private boolean explicitOrder;

    PlaybackQueueStore(Context context) {
        database = context.openOrCreateDatabase("playback-queue.db", Context.MODE_PRIVATE, null);
        for (String table : TABLES) database.execSQL("CREATE TABLE IF NOT EXISTS " + table
                + " (ordinal INTEGER PRIMARY KEY, entry_id INTEGER UNIQUE NOT NULL, source TEXT NOT NULL)");
        database.execSQL("CREATE TABLE IF NOT EXISTS play_order (queue_name TEXT NOT NULL, ordinal INTEGER NOT NULL, entry_id INTEGER NOT NULL,"
                + " PRIMARY KEY(queue_name,ordinal), UNIQUE(queue_name,entry_id))");
        database.execSQL("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), active TEXT NOT NULL, size INTEGER NOT NULL, settings TEXT NOT NULL)");
        database.execSQL("INSERT OR IGNORE INTO state VALUES (1, 'queue_a', 0, '{}')");
        try (Cursor cursor = database.rawQuery("SELECT active,size FROM state WHERE id=1", null)) {
            cursor.moveToFirst(); active = cursor.getString(0); size = cursor.getInt(1);
        }
        if (!java.util.Arrays.asList(TABLES).contains(active)) throw new IllegalStateException("Invalid queue storage");
        // Undo belongs to the current app session. Only the active table survives a restart.
        clearInactiveTables();
        explicitOrder = hasOrder(active);
        try (Cursor cursor = database.rawQuery("SELECT MAX(entry_id) FROM " + active, null)) {
            cursor.moveToFirst(); nextId = cursor.isNull(0) ? 1 : cursor.getInt(0) + 1;
        }
    }

    int length() { return size; }
    // Only fields needed to look up a measurement or read local tags cross this bridge.
    static JSONObject gainEntry(JSONObject source, int id) throws Exception {
        return new JSONObject().put("queueEntryId", id).put("uri", source.getString("uri"))
                .put("title", source.opt("title")).put("libraryTrackId", source.opt("libraryTrackId"))
                .put("scoreUri", source.opt("scoreUri")).put("scoreName", source.opt("scoreName"))
                .put("replayGainFactor", source.optDouble("replayGainFactor", 1));
    }

    JSONArray gainPage(int afterId) throws Exception {
        JSONArray items = new JSONArray();
        try (Cursor cursor = database.rawQuery("SELECT entry_id,source FROM " + active
                + " WHERE entry_id>? ORDER BY entry_id LIMIT 32", new String[]{Integer.toString(afterId)})) {
            while (cursor.moveToNext()) items.put(gainEntry(new JSONObject(cursor.getString(1)), cursor.getInt(0)));
        }
        return items;
    }

    void updateReplayGainFactors(JSONArray items) throws Exception {
        if (items.length() > 32) throw new IllegalArgumentException("Invalid gain batch");
        database.beginTransaction();
        try {
            for (int i = 0; i < items.length(); i++) {
                JSONObject update = items.getJSONObject(i);
                int id = update.getInt("queueEntryId");
                double factor = update.getDouble("replayGainFactor");
                if (id < 1 || !Float.isFinite((float) factor) || factor < 0) throw new IllegalArgumentException("Invalid track gain");
                try (Cursor row = database.rawQuery("SELECT source FROM " + active + " WHERE entry_id=?", new String[]{Integer.toString(id)})) {
                    if (!row.moveToFirst()) continue;
                    JSONObject stored = new JSONObject(row.getString(0));
                    if (stored.optDouble("replayGainFactor", 1) != factor) {
                        stored.put("replayGainFactor", factor);
                        database.execSQL("UPDATE " + active + " SET source=? WHERE entry_id=?", new Object[]{stored.toString(), id});
                    }
                }
            }
            database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
    }

    JSONObject getJSONObject(int index) throws Exception {
        if (index < 0 || index >= size) throw new IllegalArgumentException("Invalid queue index");
        return readEntry(active, index);
    }

    private JSONObject readEntry(String table, int index) throws Exception {
        try (Cursor cursor = database.rawQuery("SELECT source,entry_id FROM " + table + " WHERE ordinal=?", new String[]{Integer.toString(index)})) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Queue entry is unavailable");
            return new JSONObject(cursor.getString(0)).put("queueEntryId", cursor.getInt(1));
        }
    }
    JSONObject optJSONObject(int index) {
        try { return getJSONObject(index); } catch (Exception error) { return new JSONObject(); }
    }

    void begin() {
        for (String table : TABLES) {
            if (table.equals(active) || checkpoints.values().stream().anyMatch(saved -> table.equals(saved.table))) continue;
            staging = table;
            clearTable(staging);
            stagedSize = 0;
            return;
        }
        throw new IllegalStateException("No queue staging table is available");
    }
    void append(JSONArray items) throws Exception {
        if (staging == null || items.length() > 64 || (long) stagedSize + items.length() > Integer.MAX_VALUE) throw new IllegalArgumentException("Invalid queue batch");
        database.beginTransaction();
        try {
            for (int i = 0; i < items.length(); i++) database.execSQL("INSERT INTO " + staging + " VALUES (?,?,?)", new Object[]{stagedSize + i, nextId++, items.getJSONObject(i).toString()});
            database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
        stagedSize += items.length();
    }
    int stagedLength() { return staging == null ? -1 : stagedSize; }
    JSONObject stagedItem(int index) throws Exception {
        if (staging == null || index < 0 || index >= stagedSize) throw new IllegalArgumentException("Invalid staged queue index");
        try (Cursor cursor = database.rawQuery("SELECT source FROM " + staging + " WHERE ordinal=?", new String[]{Integer.toString(index)})) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Staged queue entry is unavailable");
            return new JSONObject(cursor.getString(0));
        }
    }
    void commit(JSONObject settings) {
        commit(settings, null, null);
    }

    void commit(JSONObject settings, String operationId, JSONObject previousSettings) {
        if (staging == null) throw new IllegalStateException("No queue is being prepared");
        database.execSQL("UPDATE state SET active=?,size=?,settings=? WHERE id=1", new Object[]{staging, stagedSize, settings.toString()});
        if (operationId != null && !checkpoints.containsKey(operationId)) {
            // Keep the last published Undo while a second Bulk Play is provisional.
            if (checkpoints.size() == 2) checkpoints.remove(checkpoints.keySet().iterator().next());
            checkpoints.put(operationId, new Checkpoint(active, size, previousSettings));
        }
        active = staging; size = stagedSize; explicitOrder = false; staging = null;
    }

    boolean hasCheckpoint(String operationId) { return checkpoints.containsKey(operationId); }

    int retainedLength() {
        int count = 0;
        for (Checkpoint saved : checkpoints.values()) count += saved.size + (saved.settings.has("detachedSource") ? 1 : 0);
        return count;
    }

    JSONArray retainedUris(int offset, int limit) throws Exception {
        JSONArray page = new JSONArray();
        for (Checkpoint saved : checkpoints.values()) {
            JSONObject detached = saved.settings.optJSONObject("detachedSource");
            int length = saved.size + (detached == null ? 0 : 1);
            if (offset >= length) { offset -= length; continue; }
            for (; offset < length && page.length() < limit; offset++) {
                JSONObject source = offset == saved.size ? detached : readEntry(saved.table, offset);
                page.put(new JSONObject().put("uri", source.getString("uri")));
            }
            if (page.length() == limit) break;
            offset = 0;
        }
        return page;
    }

    JSONObject restore(String operationId) {
        Checkpoint saved = checkpoints.get(operationId);
        if (saved == null) return null;
        database.execSQL("UPDATE state SET active=?,size=?,settings=? WHERE id=1",
                new Object[]{saved.table, saved.size, saved.settings.toString()});
        checkpoints.remove(operationId);
        active = saved.table; size = saved.size; explicitOrder = hasOrder(active);
        return saved.settings;
    }

    private void clearTable(String table) {
        database.execSQL("DELETE FROM " + table);
        database.execSQL("DELETE FROM play_order WHERE queue_name=?", new Object[]{table});
    }

    private void clearInactiveTables() {
        for (String table : TABLES) if (!table.equals(active)) clearTable(table);
    }
    void abort() { staging = null; stagedSize = 0; }
    void replace(JSONArray items) throws Exception {
        begin();
        for (int first = 0; first < items.length(); first += 64) {
            JSONArray batch = new JSONArray();
            for (int i = first; i < items.length() && i < first + 64; i++) batch.put(items.getJSONObject(i));
            append(batch);
        }
        commit(new JSONObject());
    }
    JSONObject settings() throws Exception {
        try (Cursor cursor = database.rawQuery("SELECT settings FROM state WHERE id=1", null)) { cursor.moveToFirst(); return new JSONObject(cursor.getString(0)); }
    }
    void saveSettings(JSONObject settings) { database.execSQL("UPDATE state SET settings=? WHERE id=1", new Object[]{settings.toString()}); }
    int indexOfId(int id) {
        try (Cursor cursor = database.rawQuery("SELECT ordinal FROM " + active + " WHERE entry_id=?", new String[]{Integer.toString(id)})) { return cursor.moveToFirst() ? cursor.getInt(0) : -1; }
    }
    private boolean hasOrder(String table) {
        try (Cursor cursor = database.rawQuery("SELECT 1 FROM play_order WHERE queue_name=? LIMIT 1", new String[]{table})) {
            return cursor.moveToFirst();
        }
    }

    boolean hasExplicitOrder() { return explicitOrder; }

    int indexAtPlayOrdinal(int ordinal) {
        try (Cursor cursor = database.rawQuery("SELECT q.ordinal FROM play_order p JOIN " + active
                + " q ON q.entry_id=p.entry_id WHERE p.queue_name=? AND p.ordinal=?",
                new String[]{active, Integer.toString(ordinal)})) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Missing queue order");
            return cursor.getInt(0);
        }
    }

    int playOrdinalOf(int index) {
        try (Cursor cursor = database.rawQuery("SELECT p.ordinal FROM " + active
                + " q JOIN play_order p ON p.entry_id=q.entry_id WHERE p.queue_name=? AND q.ordinal=?",
                new String[]{active, Integer.toString(index)})) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Missing queue order");
            return cursor.getInt(0);
        }
    }

    void clearOrder() {
        if (!explicitOrder) return;
        database.execSQL("DELETE FROM play_order WHERE queue_name=?", new Object[]{active});
        explicitOrder = false;
    }

    void delete(int index) {
        if (index < 0 || index >= size) throw new IllegalArgumentException("Invalid queue entry");
        database.beginTransaction();
        try {
            if (explicitOrder) {
                int ordinal = playOrdinalOf(index);
                database.execSQL("DELETE FROM play_order WHERE queue_name=? AND ordinal=?", new Object[]{active, ordinal});
                database.execSQL("UPDATE play_order SET ordinal=-ordinal-1 WHERE queue_name=? AND ordinal>?", new Object[]{active, ordinal});
                database.execSQL("UPDATE play_order SET ordinal=-ordinal-2 WHERE queue_name=? AND ordinal<0", new Object[]{active});
            }
            database.execSQL("DELETE FROM " + active + " WHERE ordinal=?", new Object[]{index});
            database.execSQL("UPDATE " + active + " SET ordinal=-ordinal-1 WHERE ordinal>?", new Object[]{index});
            database.execSQL("UPDATE " + active + " SET ordinal=-ordinal-2 WHERE ordinal<0");
            database.execSQL("UPDATE state SET size=size-1 WHERE id=1");
            database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
        size--;
        if (size == 0) explicitOrder = false;
    }
    void insert(int index, int playOrdinal, JSONArray items, IntUnaryOperator order) throws Exception {
        if (index < 0 || index > size || items.length() > 64) throw new IllegalArgumentException("Invalid queue insertion");
        database.beginTransaction();
        try {
            if (playOrdinal >= 0) {
                if (!explicitOrder) {
                    try (android.database.sqlite.SQLiteStatement statement = database.compileStatement("INSERT INTO play_order"
                            + " SELECT ?,?,entry_id FROM " + active + " WHERE ordinal=?")) {
                        statement.bindString(1, active);
                        for (int i = 0; i < size; i++) {
                            statement.bindLong(2, i); statement.bindLong(3, order.applyAsInt(i)); statement.executeInsert();
                        }
                    }
                }
                database.execSQL("UPDATE play_order SET ordinal=-ordinal-1 WHERE queue_name=? AND ordinal>=?", new Object[]{active, playOrdinal});
                database.execSQL("UPDATE play_order SET ordinal=-ordinal-1+? WHERE queue_name=? AND ordinal<0", new Object[]{items.length(), active});
            }
            database.execSQL("UPDATE " + active + " SET ordinal=-ordinal-1 WHERE ordinal>=?", new Object[]{index});
            database.execSQL("UPDATE " + active + " SET ordinal=-ordinal-1+? WHERE ordinal<0", new Object[]{items.length()});
            for (int i = 0; i < items.length(); i++) {
                int id = nextId++;
                database.execSQL("INSERT INTO " + active + " VALUES (?,?,?)", new Object[]{index + i, id, items.getJSONObject(i).toString()});
                if (playOrdinal >= 0) database.execSQL("INSERT INTO play_order VALUES (?,?,?)", new Object[]{active, playOrdinal + i, id});
            }
            database.execSQL("UPDATE state SET size=size+? WHERE id=1", new Object[]{items.length()});
            database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
        size += items.length();
        explicitOrder = playOrdinal >= 0 && size > 0;
    }
    @Override public void close() { database.close(); }
}
