package com.frieve.effetune;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;

/** Durable queue entries only. The shared Web catalog remains the music index. */
final class PlaybackQueueStore implements AutoCloseable {
    private final SQLiteDatabase database;
    private String active;
    private String staging;
    private int size;
    private int stagedSize;
    private int nextId;

    PlaybackQueueStore(Context context) {
        database = context.openOrCreateDatabase("playback-queue.db", Context.MODE_PRIVATE, null);
        database.execSQL("CREATE TABLE IF NOT EXISTS queue_a (ordinal INTEGER PRIMARY KEY, entry_id INTEGER UNIQUE NOT NULL, source TEXT NOT NULL)");
        database.execSQL("CREATE TABLE IF NOT EXISTS queue_b (ordinal INTEGER PRIMARY KEY, entry_id INTEGER UNIQUE NOT NULL, source TEXT NOT NULL)");
        database.execSQL("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), active TEXT NOT NULL, size INTEGER NOT NULL, settings TEXT NOT NULL)");
        database.execSQL("INSERT OR IGNORE INTO state VALUES (1, 'queue_a', 0, '{}')");
        try (Cursor cursor = database.rawQuery("SELECT active,size FROM state WHERE id=1", null)) {
            cursor.moveToFirst(); active = cursor.getString(0); size = cursor.getInt(1);
        }
        if (!active.equals("queue_a") && !active.equals("queue_b")) throw new IllegalStateException("Invalid queue storage");
        try (Cursor cursor = database.rawQuery("SELECT MAX(entry_id) FROM (SELECT entry_id FROM queue_a UNION ALL SELECT entry_id FROM queue_b)", null)) { cursor.moveToFirst(); nextId = cursor.isNull(0) ? 1 : cursor.getInt(0) + 1; }
    }

    int length() { return size; }
    JSONObject getJSONObject(int index) throws Exception {
        if (index < 0 || index >= size) throw new IllegalArgumentException("Invalid queue index");
        try (Cursor cursor = database.rawQuery("SELECT source,entry_id FROM " + active + " WHERE ordinal=?", new String[]{Integer.toString(index)})) {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Queue entry is unavailable");
            return new JSONObject(cursor.getString(0)).put("queueEntryId", cursor.getInt(1));
        }
    }
    JSONObject optJSONObject(int index) {
        try { return getJSONObject(index); } catch (Exception error) { return new JSONObject(); }
    }

    void begin() {
        staging = active.equals("queue_a") ? "queue_b" : "queue_a";
        database.execSQL("DELETE FROM " + staging); stagedSize = 0;
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
        if (staging == null) throw new IllegalStateException("No queue is being prepared");
        database.execSQL("UPDATE state SET active=?,size=?,settings=? WHERE id=1", new Object[]{staging, stagedSize, settings.toString()});
        active = staging; size = stagedSize; staging = null;
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
    void delete(int index) {
        if (index < 0 || index >= size) throw new IllegalArgumentException("Invalid queue entry");
        database.beginTransaction();
        try {
            database.execSQL("DELETE FROM " + active + " WHERE ordinal=?", new Object[]{index});
            database.execSQL("UPDATE " + active + " SET ordinal=-ordinal-1 WHERE ordinal>?", new Object[]{index});
            database.execSQL("UPDATE " + active + " SET ordinal=-ordinal-2 WHERE ordinal<0");
            database.execSQL("UPDATE state SET size=size-1 WHERE id=1");
            database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
        size--;
    }
    void insert(int index, JSONArray items) throws Exception {
        if (index < 0 || index > size || items.length() > 64) throw new IllegalArgumentException("Invalid queue insertion");
        database.beginTransaction();
        try {
            database.execSQL("UPDATE " + active + " SET ordinal=-ordinal-1 WHERE ordinal>=?", new Object[]{index});
            database.execSQL("UPDATE " + active + " SET ordinal=-ordinal-1+? WHERE ordinal<0", new Object[]{items.length()});
            for (int i = 0; i < items.length(); i++) database.execSQL("INSERT INTO " + active + " VALUES (?,?,?)", new Object[]{index + i, nextId++, items.getJSONObject(i).toString()});
            database.execSQL("UPDATE state SET size=size+? WHERE id=1", new Object[]{items.length()});
            database.setTransactionSuccessful();
        } finally { database.endTransaction(); }
        size += items.length();
    }
    @Override public void close() { database.close(); }
}
