package com.frieve.effetune;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import android.content.Context;
import android.content.ContextWrapper;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class AndroidPlaybackQueueStoreTest {
    @Test public void insertionAndBulkUndoPreserveTransportOrderAndEntryIds() throws Exception {
        Context context = new ContextWrapper(InstrumentationRegistry.getInstrumentation().getTargetContext()) {
            @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode, SQLiteDatabase.CursorFactory factory) {
                return SQLiteDatabase.create(factory);
            }
        };
        try (PlaybackQueueStore queue = new PlaybackQueueStore(context)) {
            queue.replace(tracks("A", "B", "C"));
            int playingId = queue.getJSONObject(1).getInt("queueEntryId");
            int[] originalOrder = {1, 0, 2};
            queue.insert(2, 1, tracks("X"), ordinal -> originalOrder[ordinal]);
            queue.insert(3, 2, tracks("Y"), ordinal -> { throw new AssertionError("Insertion must keep the existing order"); });
            assertOrder(queue, "B", "X", "Y", "A", "C");
            assertEquals(2, queue.playOrdinalOf(3));
            queue.delete(2);
            assertOrder(queue, "B", "Y", "A", "C");

            JSONObject saved = new JSONObject().put("index", 1).put("positionUs", 25_000_000);
            queue.begin(); queue.append(tracks("Provisional")); queue.commit(new JSONObject(), "operation", saved);
            queue.begin(); queue.append(tracks("Final", "Second")); queue.commit(new JSONObject(), "operation", null);
            queue.begin(); queue.append(tracks("Next provisional")); queue.commit(new JSONObject(), "next", new JSONObject());
            queue.restore("next");
            assertEquals("Final", queue.getJSONObject(0).getString("title"));
            assertEquals(25_000_000, queue.restore("operation").getLong("positionUs"));
            assertOrder(queue, "B", "Y", "A", "C");
            assertEquals(playingId, queue.getJSONObject(1).getInt("queueEntryId"));
        }
    }

    @Test public void importedSourceRequiresItsCacheFile() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(new File(context.getCacheDir(), "imports"), UUID.randomUUID().toString()).getCanonicalFile();
        assertTrue(directory.mkdirs());
        File file = new File(directory, "Song.flac");
        try {
            assertTrue(file.createNewFile());
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".files", file);
            assertTrue(MainActivity.importFileExists(context, uri));
            assertTrue(file.delete());
            assertFalse(MainActivity.importFileExists(context, uri));
        } finally {
            if (file.exists()) file.delete();
            directory.delete();
        }
    }

    private static JSONArray tracks(String... titles) throws Exception {
        JSONArray items = new JSONArray();
        for (String title : titles) items.put(new JSONObject().put("title", title).put("uri", "content://test/" + title));
        return items;
    }

    private static void assertOrder(PlaybackQueueStore queue, String... titles) throws Exception {
        assertEquals(titles.length, queue.length());
        for (int ordinal = 0; ordinal < titles.length; ordinal++) {
            assertEquals(titles[ordinal], queue.getJSONObject(queue.indexAtPlayOrdinal(ordinal)).getString("title"));
        }
    }
}
