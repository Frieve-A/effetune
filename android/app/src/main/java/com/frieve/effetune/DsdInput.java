package com.frieve.effetune;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.system.ErrnoException;
import android.system.Os;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Bounded positional reads, including SAF asset slices and authenticated HTTP ranges. */
abstract class DsdInput implements AutoCloseable {
    long size;
    abstract void read(long offset, byte[] target, int dest, int length) throws IOException;
    @Override public abstract void close() throws IOException;

    static DsdInput open(Context context, Uri uri, Map<String, String> headers, CancellationSignal signal) throws IOException {
        if ("content".equals(uri.getScheme())) {
            AssetFileDescriptor asset = context.getContentResolver().openAssetFileDescriptor(uri, "r", signal);
            if (asset == null) throw new IOException("Missing DSD source");
            return new DsdInput() {
                { size = asset.getLength(); }
                @Override void read(long offset, byte[] target, int dest, int length) throws IOException {
                    try {
                        checkRange(offset, length);
                        while (length > 0) {
                            int n = Os.pread(asset.getFileDescriptor(), target, dest, length,
                                    asset.getStartOffset() + offset);
                            if (n <= 0) throw new IOException("Short DSD read");
                            offset += n; dest += n; length -= n;
                        }
                    } catch (ErrnoException e) { throw new IOException(e); }
                }
                @Override public void close() throws IOException { asset.close(); }
            };
        }
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) throw new IOException("Invalid DSD URI");
        return new Network(new URL(uri.toString()), headers);
    }

    final void checkRange(long offset, int length) throws IOException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
        if (offset < 0 || length < 0 || offset > size - length) throw new IOException("Invalid DSD range");
    }

    private static final class Network extends DsdInput {
        private static final Pattern RANGE = Pattern.compile("bytes ([0-9]{1,16})-([0-9]{1,16})/([0-9]{1,16})");
        private static final int PAGE_BYTES = 256 * 1024;
        private final URL url;
        private final Map<String, String> headers;
        private byte[] page = new byte[16];
        private long pageStart;
        private int valid;
        private String validator;
        Network(URL url, Map<String, String> headers) throws IOException {
            this.url = url; this.headers = headers; size = -1;
            load(0, 16);
        }
        private void load(long start, int requested) throws IOException {
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            try {
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(10000);
                for (Map.Entry<String, String> header : headers.entrySet())
                    connection.setRequestProperty(header.getKey(), header.getValue());
                connection.setRequestProperty("Accept-Encoding", "identity");
                connection.setRequestProperty("Range", "bytes=" + start + "-" + (start + requested - 1));
                if (connection.getResponseCode() != 206) throw new IOException("DSD source requires HTTP ranges");
                String range = connection.getHeaderField("Content-Range");
                Matcher match = RANGE.matcher(range == null ? "" : range);
                if (!match.matches()) throw new IOException("Invalid DSD response range");
                long total = Long.parseLong(match.group(3));
                int count = (int) Math.min((long) requested, total - start);
                String next = connection.getHeaderField("ETag");
                if (next == null) next = connection.getHeaderField("Last-Modified");
                if (count < 1 || Long.parseLong(match.group(1)) != start || Long.parseLong(match.group(2)) != start + count - 1
                        || (size >= 0 && size != total) || (validator != null && !validator.equals(next)))
                    throw new IOException("DSD source changed during playback");
                if (page.length < count) page = new byte[count];
                try (InputStream stream = connection.getInputStream()) {
                    for (int filled = 0; filled < count;) {
                        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                        int n = stream.read(page, filled, count - filled);
                        if (n <= 0) throw new IOException("Short DSD HTTP read");
                        filled += n;
                    }
                }
                pageStart = start; valid = count; size = total; validator = next;
            } finally { connection.disconnect(); }
        }
        @Override void read(long offset, byte[] target, int dest, int length) throws IOException {
            checkRange(offset, length);
            while (length > 0) {
                if (offset < pageStart || offset >= pageStart + valid) load(offset, PAGE_BYTES);
                int index = (int) (offset - pageStart);
                int take = Math.min(length, valid - index);
                System.arraycopy(page, index, target, dest, take);
                offset += take; dest += take; length -= take;
            }
        }
        @Override public void close() { }
    }
}
