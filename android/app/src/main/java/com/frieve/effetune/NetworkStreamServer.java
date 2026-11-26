package com.frieve.effetune;

import android.os.SystemClock;
import android.media.MediaCodec;
import android.util.Log;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.channel.group.ChannelGroup;
import io.netty.channel.group.DefaultChannelGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.*;
import io.netty.handler.timeout.ReadTimeoutHandler;
import io.netty.util.concurrent.GlobalEventExecutor;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

final class NetworkStreamServer implements AutoCloseable {
    static final int RATE = 44100;
    static final String PCM = "application/vnd.effetune.live-pcm-v1";
    static final String FEATURES = "DLNA.ORG_OP=00;DLNA.ORG_FLAGS=01700000000000000000000000000000";
    private final LanHttp.EventLoops loops = new LanHttp.EventLoops();
    private final ChannelGroup channels = new DefaultChannelGroup(GlobalEventExecutor.INSTANCE, true);
    private final ConcurrentHashMap<String, Stream> streams = new ConcurrentHashMap<>();
    private final int port;

    static String token() { return UUID.randomUUID().toString().replace("-", ""); }
    static boolean lan(InetAddress ip) {
        return ip instanceof Inet4Address && (ip.isSiteLocalAddress() || ip.isLinkLocalAddress() || ip.isLoopbackAddress());
    }

    NetworkStreamServer() throws Exception {
        try {
            Channel listener = new ServerBootstrap().group(loops.get()).channel(NioServerSocketChannel.class)
                    .childOption(ChannelOption.TCP_NODELAY, true)
                    .childOption(ChannelOption.WRITE_BUFFER_WATER_MARK, new WriteBufferWaterMark(512 * 1024, 2 * 1024 * 1024))
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override protected void initChannel(SocketChannel channel) {
                            channels.add(channel);
                            channel.pipeline().addLast("deadline", new ReadTimeoutHandler(10));
                            channel.pipeline().addLast(new HttpServerCodec(), new HttpObjectAggregator(1024), new Handler());
                        }
                    }).bind("0.0.0.0", 0).sync().channel();
            channels.add(listener);
            port = ((InetSocketAddress) listener.localAddress()).getPort();
        } catch (Exception error) { close(); throw error; }
    }

    final class Stream implements AutoCloseable {
        final String id = token();
        final String url;
        volatile String contentType;
        volatile boolean closed;
        volatile String failure;
        private Channel client;
        private String connection, receiver, probe;
        private InetAddress peer;
        private long frames, writtenAt, probeAt, lastRevision;
        private double lastPosition;
        private record Segment(long start, int count, double tapMs, long revision, int delay) {}
        private final ArrayDeque<Segment> timeline = new ArrayDeque<>();
        private boolean raw;
        private MediaCodec prepared;
        private FlacEncoder encoder;
        volatile int feedbackLatency = -1;
        volatile long feedbackAt, feedbackRevision;

        Stream(InetAddress target, String mime) throws Exception {
            contentType = mime;
            try (DatagramSocket route = new DatagramSocket()) {
                route.connect(target, 9);
                url = "http://" + route.getLocalAddress().getHostAddress() + ":" + port + "/live/" + id;
            }
            streams.put(id, this);
        }

        synchronized double positionMs() {
            return client != null && client.isActive() && frames > 0
                    ? frames * 1000.0 / RATE + SystemClock.elapsedRealtime() - writtenAt : Double.NaN;
        }

        void prepareFlac(String mime) throws NetworkOutput.Failure {
            MediaCodec codec = FlacEncoder.open();
            synchronized (this) {
                if (closed) codec.release();
                else { prepared = codec; contentType = mime; }
            }
        }

        synchronized void attach(Channel channel, InetAddress ip, boolean pcm, HttpResponse headers) {
            if (closed) { channel.close(); return; }
            disconnect();
            client = channel;
            peer = ip;
            raw = pcm;
            frames = 0;
            lastPosition = lastRevision = 0;
            if (pcm) {
                connection = token();
                headers.headers().set("x-effetune-live-connection", connection);
            }
            channel.writeAndFlush(headers);
            if (!pcm && "audio/wav".equals(contentType)) {
                channel.write(Unpooled.wrappedBuffer(wavHeader()));
                frames = RATE * 2;
                channel.writeAndFlush(Unpooled.wrappedBuffer(new byte[(int) frames * 4]));
            } else if (!pcm) {
                encoder = new FlacEncoder(prepared, bytes -> {
                    if (channel.isActive() && channel.isWritable()) channel.writeAndFlush(Unpooled.wrappedBuffer(bytes));
                    else if (channel.isActive()) channel.close();
                }, error -> {
                    Log.w("EffeTuneNetwork", "FLAC encoding failed", error);
                    synchronized (this) {
                        if (client == channel) { failure = "encoder"; disconnect(); }
                    }
                });
                prepared = null;
            } else if (prepared != null) {
                prepared.release(); prepared = null;
            }
            writtenAt = SystemClock.elapsedRealtime();
            channel.closeFuture().addListener(done -> {
                synchronized (this) {
                    if (client == channel) {
                        disconnect();
                        if ("audio/wav".equals(contentType)) failure = "offline";
                    }
                }
            });
        }

        synchronized void write(short[] data, int count, double tapMs, long revision, int delay) {
            if (client == null || !client.isActive()) return;
            if (!client.isWritable()) { failure = "offline"; disconnect(); return; }
            byte[] bytes = new byte[count * 4];
            ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(data, 0, count * 2);
            if (raw) {
                timeline.addLast(new Segment(frames, count, tapMs, revision, delay));
                if (timeline.size() > 512) timeline.removeFirst();
            }
            writtenAt = SystemClock.elapsedRealtime();
            frames += count;
            if (encoder == null) client.writeAndFlush(Unpooled.wrappedBuffer(bytes));
            else if (!encoder.write(bytes)) { failure = "offline"; disconnect(); }
        }

        synchronized JSONObject feedback(JSONObject msg, InetAddress ip) {
            String session = msg.optString("sessionId");
            if (!raw || client == null || !ip.equals(peer) || !msg.optString("connectionId").equals(connection)
                    || !session.matches("[A-Za-z0-9_-]{32}") || (receiver != null && !receiver.equals(session))) return null;
            long now = SystemClock.elapsedRealtime();
            if (!msg.has("probeId")) {
                receiver = session; probe = token(); probeAt = now;
                return AudioService.object("probeId", probe);
            }
            if (!msg.optString("probeId").equals(probe)) return null;
            probe = null;
            double position = msg.optDouble("positionFrames", 0);
            long revision = msg.optLong("revision", -1);
            if (now - probeAt > 300 || position <= lastPosition || position > frames || revision < lastRevision) return null;
            lastPosition = position; lastRevision = revision;
            int suffix = 0;
            for (String key : new String[]{"dspMs", "softwareOutputMs", "physicalOutputMs"}) {
                double ms = msg.optDouble(key, -1);
                if (ms < 0 || ms > 10000) { feedbackLatency = -1; return new JSONObject(); }
                suffix += (int) Math.round(ms);
            }
            long frame = (long) position - 1;
            for (Segment packet : timeline) {
                long offset = frame - packet.start();
                if (offset < 0 || offset >= packet.count() || !Double.isFinite(packet.tapMs())) continue;
                double latency = (now + probeAt) * 0.5 - packet.tapMs() - (offset + packet.delay()) * 1000.0 / RATE;
                if (latency < -175 || latency > 9000) break;
                int measured = (int) Math.round(Math.max(0, latency)) + suffix;
                if (feedbackRevision != packet.revision() || Math.abs(measured - feedbackLatency) >= 25 || feedbackLatency < 0)
                    feedbackLatency = measured;
                feedbackRevision = packet.revision();
                feedbackAt = now;
                break;
            }
            return new JSONObject();
        }

        private void disconnect() {
            if (encoder != null) { encoder.close(); encoder = null; }
            Channel previous = client;
            client = null;
            if (previous != null) previous.close();
            connection = receiver = probe = null;
            timeline.clear(); feedbackLatency = -1;
        }

        @Override public synchronized void close() {
            closed = true;
            streams.remove(id);
            if (prepared != null) { prepared.release(); prepared = null; }
            disconnect();
        }
    }

    private static byte[] wavHeader() {
        ByteBuffer b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(-1).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
        b.putInt(16).putShort((short) 1).putShort((short) 2).putInt(RATE).putInt(RATE * 4);
        b.putShort((short) 4).putShort((short) 16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(-1);
        return b.array();
    }

    private final class Handler extends SimpleChannelInboundHandler<FullHttpRequest> {
        @Override protected void channelRead0(ChannelHandlerContext ctx, FullHttpRequest req) throws Exception {
            InetAddress ip = ((InetSocketAddress) ctx.channel().remoteAddress()).getAddress();
            if (!lan(ip)) { finish(ctx, 403, null); return; }
            String[] path = req.uri().split("\\?", 2)[0].split("/", -1);
            Stream stream = path.length >= 3 && path[1].equals("live") ? streams.get(path[2]) : null;
            if (stream == null) { finish(ctx, 404, null); return; }
            if (path.length == 4 && path[3].equals("feedback")) {
                if (!HttpMethod.POST.equals(req.method())) { finish(ctx, 405, null); return; }
                if (!"application/json".equals(req.headers().get("Content-Type"))) { finish(ctx, 400, null); return; }
                JSONObject reply;
                try { reply = stream.feedback(new JSONObject(req.content().toString(StandardCharsets.UTF_8)), ip); }
                catch (org.json.JSONException error) { finish(ctx, 400, null); return; }
                finish(ctx, reply == null ? 409 : reply.length() == 0 ? 204 : 200, reply);
                return;
            }
            if (path.length != 3) { finish(ctx, 404, null); return; }
            if (!HttpMethod.GET.equals(req.method()) && !HttpMethod.HEAD.equals(req.method())) { finish(ctx, 405, null); return; }
            boolean pcm = !"audio/wav".equals(stream.contentType) && PCM.equals(req.headers().get("Accept"));
            HttpResponse response = new DefaultHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.OK);
            response.headers().set("Content-Type", pcm ? PCM : stream.contentType).set("Connection", "close")
                    .set("Cache-Control", "no-cache").set("transferMode.dlna.org", "Streaming")
                    .set("contentFeatures.dlna.org", FEATURES);
            if (HttpMethod.HEAD.equals(req.method())) { ctx.writeAndFlush(response).addListener(ChannelFutureListener.CLOSE); return; }
            ctx.pipeline().remove("deadline");
            ctx.channel().config().setAutoRead(false);
            stream.attach(ctx.channel(), ip, pcm, response);
        }

        private void finish(ChannelHandlerContext ctx, int status, JSONObject result) {
            byte[] bytes = status == 200 ? result.toString().getBytes(StandardCharsets.UTF_8) : new byte[0];
            FullHttpResponse res = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.valueOf(status), Unpooled.wrappedBuffer(bytes));
            res.headers().set("Connection", "close").set("Cache-Control", "no-store").set("Content-Length", bytes.length);
            if (bytes.length > 0) res.headers().set("Content-Type", "application/json");
            ctx.writeAndFlush(res).addListener(ChannelFutureListener.CLOSE);
        }
    }

    @Override public void close() {
        for (Stream stream : streams.values()) stream.close();
        channels.close();
        loops.close();
    }
}
