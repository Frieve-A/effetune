package com.frieve.effetune;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.util.Base64;
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
import io.netty.handler.timeout.WriteTimeoutHandler;
import io.netty.util.concurrent.GlobalEventExecutor;
import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.io.StringReader;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilderFactory;
import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.InputSource;

final class LibraryShareServer implements Closeable {
    private static final String TAG = "EffeTuneShare";
    private static final String CONTENT = "ContentDirectory", CONNECTION = "ConnectionManager";
    private static final String DEVICE = "urn:schemas-upnp-org:device:MediaServer:1";
    private static final String SOAP = "http://schemas.xmlsoap.org/soap/envelope/";
    private static final String VERSION = "<specVersion><major>1</major><minor>0</minor></specVersion>";
    private static final String XML_TYPE = "text/xml; charset=utf-8";
    private static final String SOURCE_PROTOCOLS = String.join(",",
            "http-get:*:audio/midi:*", "http-get:*:audio/x-dsf:*", "http-get:*:audio/x-dff:*", "http-get:*:audio/flac:*",
            "http-get:*:audio/mpeg:*", "http-get:*:audio/wav:*", "http-get:*:audio/mp4:*", "http-get:*:audio/aac:*",
            "http-get:*:audio/ogg:*", "http-get:*:audio/webm:*");
    private static final Pattern RANGE = Pattern.compile("bytes=([0-9]*)-([0-9]*)");
    private static final String TOKEN = "[a-zA-Z0-9_-]{1,128}", MIME = "[A-Za-z0-9!#$&^_.+%-]+/[A-Za-z0-9!#$&^_.+%-]+";
    private static final int PART_BYTES = 512 * 1024, RESOURCE_LIMIT = 32 * 1024 * 1024;
    private static final String SHARING_KEY = "networkMusicSharing", NAME_KEY = "openHomeFriendlyName";
    private static final String PAGE_FIELDS = " Filter StartingIndex RequestedCount SortCriteria";
    private static final String PAGE_RESULT = "Result NumberReturned TotalMatches UpdateID";
    // Action, input arguments, output arguments, in the desktop SCPD order.
    private static final String[][] CONTENT_ACTIONS = {
            {"GetSearchCapabilities", "", "SearchCaps"}, {"GetSortCapabilities", "", "SortCaps"},
            {"GetSystemUpdateID", "", "Id"}, {"Browse", "ObjectID BrowseFlag" + PAGE_FIELDS, PAGE_RESULT},
            {"Search", "ContainerID SearchCriteria" + PAGE_FIELDS, PAGE_RESULT},
            {"X_EffeTune_Search", "ContainerID Query" + PAGE_FIELDS, PAGE_RESULT}};
    private static final String[][] CONNECTION_ACTIONS = {
            {"GetProtocolInfo", "", "Source Sink"}, {"GetCurrentConnectionIDs", "", "ConnectionIDs"},
            {"GetCurrentConnectionInfo", "ConnectionID", "RcsID AVTransportID ProtocolInfo PeerConnectionManager PeerConnectionID Direction Status"}};
    private static final String CONTENT_XML = scpd(CONTENT_ACTIONS), CONNECTION_XML = scpd(CONNECTION_ACTIONS);
    private final ContentResolver resolver;
    private final Context app;
    private final MediaGateway gateway;
    private final Runnable sourcesChanged;
    private final SharedPreferences prefs;
    private final Handler control;
    private final Ssdp ssdp;
    private final AudioService.Events events;
    private final Runnable foregroundChanged;
    private final String defaultName, id;
    private JSONArray folders = new JSONArray();
    private Session session;
    // The session serves the advertised library and/or files the page opened for a player.
    private boolean pageReady, files;
    private volatile boolean sharing;
    private volatile long updateId;

    LibraryShareServer(Context context, Handler control, Ssdp ssdp, MediaGateway gateway, AudioService.Events events, Runnable foregroundChanged) {
        this.control = control;
        this.ssdp = ssdp;
        this.app = context.getApplicationContext();
        this.gateway = gateway;
        this.events = events;
        this.foregroundChanged = foregroundChanged;
        resolver = context.getContentResolver();
        prefs = context.getSharedPreferences("audio", Context.MODE_PRIVATE);
        String name = Settings.Global.getString(resolver, Settings.Global.DEVICE_NAME);
        String model = Build.MODEL == null || Build.MODEL.trim().isEmpty() ? "EffeTune" : Build.MODEL.trim();
        defaultName = name == null || name.trim().isEmpty() ? model : name.trim();
        String savedId = prefs.getString("networkMusicDeviceId", null);
        id = savedId == null ? "uuid:" + UUID.randomUUID() : savedId;
        if (savedId == null) prefs.edit().putString("networkMusicDeviceId", id).apply();
        sourcesChanged = () -> control.post(this::revokeRemovedSources);
        SubsonicHost.watchSources(sourcesChanged);
    }

    void restore() {
        try {
            JSONObject settings = new JSONObject(prefs.getString(SHARING_KEY, "{}"));
            if (settings.optJSONArray("folderIds") != null) folders = settings.getJSONArray("folderIds");
            if (settings.optBoolean("enabled")) apply(true, files);
        } catch (Exception error) { Log.w(TAG, "Cannot restore library sharing", error); }
    }

    boolean isEnabled() { return session != null; }

    String pwaLibraryId() { return id; }
    boolean pwaSharing() { return sharing; }

    void servePwa(Channel ch, String token, boolean artwork, String range, boolean head, BooleanSupplier current) {
        if (session == null || !sharing || !current.getAsBoolean()) { respond(ch, 404, null, head); return; }
        session.serveResource(ch, token, artwork, range, head, current);
    }

    boolean servesPlayerGrants() { return session != null && session.playerGrants != null; }

    boolean isShareOrigin(String origin) {
        return session != null && session.listeners.keySet().stream().anyMatch(ip -> session.url(ip).equals(origin));
    }

    String publishPlayerGrants(PwaNetworkHost.PlayerGrants owner, InetAddress incoming, String playerAddress,
                               BooleanSupplier current) throws Exception {
        InetAddress local = playerAddress.isEmpty() ? incoming : playerRoute(playerAddress);
        if (local.isLoopbackAddress() || !NetworkStreamServer.lan(local)) {
            android.net.ConnectivityManager networks = app.getSystemService(android.net.ConnectivityManager.class);
            android.net.LinkProperties links = networks.getLinkProperties(networks.getActiveNetwork());
            if (links != null) for (android.net.LinkAddress link : links.getLinkAddresses()) {
                if (NetworkStreamServer.lan(link.getAddress()) && !link.getAddress().isLoopbackAddress()) {
                    local = link.getAddress();
                    break;
                }
            }
        }
        if (!NetworkStreamServer.lan(local) || local.isLoopbackAddress()) throw new IOException("No LAN route for the player");
        openSession();
        try {
            session.listen(local);
            if (!current.getAsBoolean()) throw PwaNetworkHost.denied();
            if (session.playerGrants != owner) {
                session.playerGrants = owner;
                foregroundChanged.run();
            }
            return session.url(local);
        } catch (Exception error) {
            apply(sharing, files);
            throw error;
        }
    }

    void releasePlayerGrants(PwaNetworkHost.PlayerGrants owner) {
        if (session == null || session.playerGrants != owner) return;
        session.playerGrants = null;
        try { apply(sharing, files); }
        catch (Exception error) { Log.w(TAG, "Cannot release player resources", error); }
    }

    private String friendlyName() {
        String name = prefs.getString(NAME_KEY, "").trim();
        return name.isEmpty() ? defaultName : name;
    }

    private JSONObject status() {
        String url = sharing ? session.baseUrl() : null;
        return AudioService.object("enabled", sharing, "friendlyName", friendlyName(), "id", id, "updateId", updateId,
                "baseUrl", url == null ? JSONObject.NULL : url, "folderIds", folders, "hasFiles", hasPlayerFiles());
    }

    private boolean hasPlayerFiles() { return files || session != null && session.hasPlayerFiles(); }

    private Media media(String token, JSONObject args, boolean registered) throws Exception {
        String target = args.has("target") ? args.getString("target") : null;
        String playerId = target == null ? args.optString("playerId", null) : args.getString("playerId");
        Set<String> owners = registered ? new HashSet<>() : null;
        // A publication without a destination is retained until the sharing generation changes.
        if (registered && playerId != null) owners.add(playerId);
        if (!token.matches(TOKEN)) throw new IllegalArgumentException("Invalid media token");
        if (args.has("serverId")) {
            String server = args.getString("serverId");
            if (!registered || target == null || !SubsonicHost.hasSource(app, server))
                throw new AudioService.HostError("unavailable", "This music server connection is unavailable.");
            Subsonic relay = new Subsonic(server, args.getString("trackId"), args.optString("coverArtId"), args.getString("format"), target, playerId);
            return new Media(token, null, null, -1, target, owners, updateId, relay);
        }
        Uri uri = Uri.parse(args.getString("uri"));
        String mime = args.getString("mime");
        long size = args.getLong("size");
        if (!"content".equals(uri.getScheme()) || uri.getAuthority() == null || uri.getAuthority().isEmpty() || size < -1 || !mime.matches(MIME))
            throw new IllegalArgumentException("Invalid shared media");
        return new Media(token, uri, mime, size, target, owners, updateId, null);
    }

    JSONObject command(String name, JSONObject args) throws Exception {
        switch (name) {
            case "share.status":
                pageReady = true;
                return status();
            case "share.start":
            case "share.stop": {
                boolean enable = name.equals("share.start");
                JSONArray next = args.has("folderIds") ? args.getJSONArray("folderIds") : folders;
                String nextName = args.has("friendlyName") ? args.getString("friendlyName").trim() : null;
                if (nextName != null && (nextName.length() > 128 || nextName.chars().anyMatch(c -> c < 32 || c == 127)))
                    throw new IllegalArgumentException("Invalid device name");
                // Like the desktop host, every saved sharing change revokes the published catalog URLs.
                changed();
                apply(enable, files);
                folders = next;
                SharedPreferences.Editor settings = prefs.edit().putString(SHARING_KEY,
                        AudioService.object("enabled", enable, "folderIds", folders).toString());
                if (nextName != null) settings.putString(NAME_KEY, nextName.isEmpty() ? null : nextName);
                settings.apply();
                pageReady = true;
                return status();
            }
            case "share.publish": {
                Media file = media(args.getString("token"), args, true);
                if (file.target() == null) {
                    if (!sharing || args.getLong("updateId") != updateId) throw new IllegalStateException("Library changed");
                    session.publish(file);
                    return AudioService.object("token", file.token());
                }
                InetAddress local = playerRoute(file.target());
                if (!files) apply(sharing, true);
                try {
                    session.listen(local);
                    file = session.publish(file);
                    String base = session.url(local);
                    JSONObject result = AudioService.object("uri", base + "/media/" + file.token(), "token", file.token());
                    if (file.relay() != null && !file.relay().art().isEmpty()) result.put("artwork", base + "/artwork/" + file.token());
                    return result;
                } catch (Exception error) {
                    if (!session.hasFiles()) apply(sharing, false);
                    throw error;
                }
            }
            case "share.revoke": {
                Set<String> tokens = new HashSet<>();
                boolean prune = args.has("keep");
                JSONArray list = args.getJSONArray(prune ? "keep" : "tokens");
                for (int i = 0; i < list.length(); i++) tokens.add(list.getString(i));
                if (session != null) {
                    String playerId = prune ? args.getString("playerId") : null;
                    session.revoke(file -> prune ? !tokens.contains(file.token()) && file.releasePlayer(playerId) : tokens.contains(file.token()));
                    if (files && !session.hasFiles()) apply(sharing, false);
                }
                return AudioService.object("hasFiles", hasPlayerFiles());
            }
            case "share.respond": {
                return session == null ? AudioService.object("accepted", false) : session.answer(args.getString("requestId"), args);
            }
            case "share.notify":
                changed();
                return AudioService.object("updateId", updateId);
            case "share.route": {
                InetAddress local = playerRoute(args.getString("host"));
                return AudioService.object("address", local.getHostAddress(), "baseUrl", session == null ? JSONObject.NULL : session.url(local));
            }
            default: throw new IllegalArgumentException("Unknown sharing command");
        }
    }

    private static InetAddress playerRoute(String host) throws IOException {
        if (!host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) throw new IllegalArgumentException("Invalid player address");
        InetAddress player = InetAddress.getByName(host), local;
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.connect(player, 1900);
            local = socket.getLocalAddress();
        }
        if (!NetworkStreamServer.lan(player) || !(local instanceof Inet4Address) || local.isLoopbackAddress()
                || !NetworkStreamServer.lan(local)) throw new IOException("No local network route to the player");
        return local;
    }

    private void openSession() throws Exception {
        if (session != null) return;
        Session next = new Session();
        try { next.open(); }
        catch (Exception error) { next.close(); throw error; }
        session = next;
    }

    private void apply(boolean nextSharing, boolean nextFiles) throws Exception {
        if (nextSharing || nextFiles) openSession();
        Exception failure = null;
        if (nextSharing && !sharing) {
            Session next = session;
            try {
                ssdp.advertise(id, Arrays.asList("upnp:rootdevice", id, DEVICE, serviceType(CONTENT), serviceType(CONNECTION)),
                        address -> next.listeners.containsKey(address) ? next.url(address) + "/description.xml" : null,
                        next::refreshListeners);
            } catch (Exception error) {
                ssdp.stopAdvertising();
                failure = error;
                nextSharing = false;
            }
        } else if (sharing && !nextSharing) {
            ssdp.stopAdvertising();
            synchronized (session.subscribers) { session.subscribers.clear(); }
        }
        sharing = nextSharing;
        files = nextFiles;
        if (!sharing && !files && session != null && !servesPlayerGrants()) {
            session.close();
            session = null;
        }
        foregroundChanged.run();
        if (failure != null) throw failure;
    }

    private void changed() {
        updateId = (updateId + 1) & 0xffffffffL;
        if (session != null) {
            session.revoke(file -> file.target() == null);
            session.failRequests();
            session.broadcast();
        }
    }

    void pageGone() {
        pageReady = false;
        if (session != null) session.failRequests();
    }

    private void revokeRemovedSources() {
        if (!files) return;
        session.revoke(file -> file.relay() != null && !SubsonicHost.hasSource(app, file.relay().server()));
        if (!session.hasFiles()) {
            try { apply(sharing, false); }
            catch (Exception error) { Log.w(TAG, "Cannot release player resources", error); }
        }
    }

    void respondPart(JSONObject args, AudioService.Reply reply) throws Exception {
        if (session == null) reply.complete(AudioService.object("accepted", false), null);
        else session.respondPart(args.getString("requestId"), args, reply);
    }

    @Override public void close() {
        SubsonicHost.unwatchSources(sourcesChanged);
        if (session != null) session.playerGrants = null;
        try { apply(false, false); }
        catch (Exception error) { Log.w(TAG, "Cannot stop library sharing", error); }
    }

    private static String serviceType(String service) { return "urn:schemas-upnp-org:service:" + service + ":1"; }
    private static String xml(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
    }
    private String description() {
        StringBuilder services = new StringBuilder();
        for (String name : Arrays.asList(CONTENT, CONNECTION)) services.append("<service><serviceType>").append(serviceType(name))
                .append("</serviceType><serviceId>urn:upnp-org:serviceId:").append(name).append("</serviceId><SCPDURL>/")
                .append(name).append(".xml</SCPDURL><controlURL>/control/").append(name).append("</controlURL><eventSubURL>/event/")
                .append(name).append("</eventSubURL></service>");
        return "<?xml version=\"1.0\"?><root xmlns=\"urn:schemas-upnp-org:device-1-0\">" + VERSION +
                "<device><deviceType>" + DEVICE + "</deviceType><friendlyName>" + xml(friendlyName()) +
                "</friendlyName><manufacturer>EffeTune</manufacturer><modelName>EffeTune Music Library</modelName><UDN>" +
                xml(id) + "</UDN><serviceList>" + services + "</serviceList></device></root>";
    }

    private static String scpd(String[][] definitions) {
        StringBuilder actions = new StringBuilder(), vars = new StringBuilder();
        Set<String> fields = new LinkedHashSet<>();
        for (String[] action : definitions) {
            actions.append("<action><name>").append(action[0]).append("</name><argumentList>");
            for (int i = 1; i <= 2; i++) {
                if (action[i].isEmpty()) continue;
                for (String key : action[i].split(" ")) {
                    fields.add(key);
                    actions.append("<argument><name>").append(key).append("</name><direction>").append(i == 1 ? "in" : "out")
                            .append("</direction><relatedStateVariable>A_ARG_TYPE_").append(key).append("</relatedStateVariable></argument>");
                }
            }
            actions.append("</argumentList></action>");
        }
        for (String key : fields) {
            String type = switch (key) {
                case "Id", "StartingIndex", "RequestedCount", "NumberReturned", "TotalMatches", "UpdateID" -> "ui4";
                case "ConnectionID", "RcsID", "AVTransportID", "PeerConnectionID" -> "i4";
                default -> "string";
            };
            vars.append("<stateVariable sendEvents=\"no\"><name>A_ARG_TYPE_").append(key).append("</name><dataType>")
                    .append(type).append("</dataType></stateVariable>");
        }
        String[][] events = definitions == CONTENT_ACTIONS ? new String[][]{{"SystemUpdateID", "ui4", "0"}} :
                new String[][]{{"SourceProtocolInfo", "string", SOURCE_PROTOCOLS}, {"SinkProtocolInfo", "string", ""}, {"CurrentConnectionIDs", "string", ""}};
        for (String[] event : events) vars.append("<stateVariable sendEvents=\"yes\"><name>").append(event[0])
                .append("</name><dataType>").append(event[1]).append("</dataType><defaultValue>").append(event[2])
                .append("</defaultValue></stateVariable>");
        return "<?xml version=\"1.0\"?><scpd xmlns=\"urn:schemas-upnp-org:service-1-0\">" + VERSION + "<actionList>" + actions +
                "</actionList><serviceStateTable>" + vars + "</serviceStateTable></scpd>";
    }

    private static String fault(int code) {
        return "<s:Envelope xmlns:s=\"" + SOAP + "\"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring>" +
                "<detail><UPnPError xmlns=\"urn:schemas-upnp-org:control-1-0\"><errorCode>" + code + "</errorCode><errorDescription>" +
                (code == 501 ? "Action Failed" : "Request could not be completed") +
                "</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>";
    }

    private static String actionName(String body) throws Exception {
        if (body.contains("<!DOCTYPE")) throw new IOException("DOCTYPE in SOAP request");
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setExpandEntityReferences(false);
        Element envelope = factory.newDocumentBuilder().parse(new InputSource(new StringReader(body))).getDocumentElement();
        for (Node child = envelope.getFirstChild(); child != null; child = child.getNextSibling()) {
            if (!"Body".equals(child.getLocalName()) || !SOAP.equals(child.getNamespaceURI())) continue;
            for (Node action = child.getFirstChild(); action != null; action = action.getNextSibling())
                if (action instanceof Element) return action.getLocalName();
        }
        return "";
    }

    // A target limits a file opened for one player to that player's address, like the desktop file server.
    private record Subsonic(String server, String track, String art, String format, String target, String playerId) {}
    private record Media(String token, Uri uri, String mime, long size, String target, Set<String> owners,
                         long generation, Subsonic relay) {
        boolean registered() { return owners != null; }
        boolean releasePlayer(String playerId) {
            if (!registered() || !owners.contains(playerId)) return false;
            // The last owner matches both the registration and any streams being revoked.
            if (owners.size() == 1) return true;
            owners.remove(playerId);
            return false;
        }
    }
    // A request waiting for the page: a SOAP action when token is null, otherwise a media or artwork resource.
    private static final class Asked {
        final Channel ch;
        final String token, range;
        final boolean head;
        final BooleanSupplier current;
        final long generation;
        Runnable deadline;
        int offset, end;
        boolean writing;
        Asked(Channel ch, String token, String range, boolean head, BooleanSupplier current, long generation) {
            this.ch = ch; this.token = token; this.range = range; this.head = head;
            this.current = current; this.generation = generation;
        }
    }
    private static final class Subscriber {
        final String sid, service, callback;
        final InetAddress remote;
        long expires, seq;
        Subscriber(String sid, String service, String callback, InetAddress remote) {
            this.sid = sid; this.service = service; this.callback = callback; this.remote = remote;
        }
    }

    private static long[] range(String header, long size) {
        if (header == null) return new long[]{0, size - 1};
        Matcher match = RANGE.matcher(header);
        if (!match.matches() || size == 0) return null;
        String first = match.group(1), last = match.group(2);
        try {
            long start = first.isEmpty() ? Math.max(0, size - Long.parseLong(last)) : Long.parseLong(first);
            long end = first.isEmpty() || last.isEmpty() ? size - 1 : Math.min(Long.parseLong(last), size - 1);
            return start >= size || end < start ? null : new long[]{start, end};
        } catch (NumberFormatException invalid) { return null; }
    }

    private static void respond(Channel ch, int status, String xml, boolean head) {
        byte[] bytes = xml == null ? new byte[0] : xml.getBytes(StandardCharsets.UTF_8);
        FullHttpResponse out = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.valueOf(status),
                head ? Unpooled.EMPTY_BUFFER : Unpooled.wrappedBuffer(bytes));
        if (xml != null) out.headers().set("Content-Type", XML_TYPE);
        out.headers().set("Connection", "close").set("Content-Length", bytes.length);
        ch.writeAndFlush(out).addListener(ChannelFutureListener.CLOSE);
    }

    private static void unsatisfiable(Channel ch, long size) {
        FullHttpResponse out = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.valueOf(416));
        out.headers().set("Content-Range", "bytes */" + size).set("Content-Length", 0).set("Connection", "close");
        ch.writeAndFlush(out).addListener(ChannelFutureListener.CLOSE);
    }

    private static HttpResponse mediaHeaders(String mime, String header, long[] span, long size) {
        HttpResponse out = new DefaultHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.valueOf(header == null ? 200 : 206));
        out.headers().set("Connection", "close").set("Content-Length", span[1] - span[0] + 1).set("Content-Type", mime)
                .set("Accept-Ranges", "bytes");
        // Artwork is a whole image, as on the desktop server; media is a DLNA stream.
        if (!mime.startsWith("image/")) out.headers().set("transferMode.dlna.org", "Streaming");
        if (header != null) out.headers().set("Content-Range", "bytes " + span[0] + "-" + span[1] + "/" + size);
        return out;
    }

    private static String property(String key, String value) {
        return "<e:property><" + key + ">" + xml(value) + "</" + key + "></e:property>";
    }

    private final class Session implements Closeable {
        private final LanHttp.EventLoops loops = new LanHttp.EventLoops();
        private final ChannelGroup channels = new DefaultChannelGroup(GlobalEventExecutor.INSTANCE, true);
        private final Map<InetAddress, Channel> listeners = new LinkedHashMap<>();
        private final Map<String, Media> media = new LinkedHashMap<>();
        private volatile PwaNetworkHost.PlayerGrants playerGrants;
        private final Map<Subsonic, Media> relays = new HashMap<>();
        private final Map<Channel, Media> streaming = new ConcurrentHashMap<>();
        private final ConcurrentHashMap<String, Asked> pending = new ConcurrentHashMap<>();
        private final Map<String, Subscriber> subscribers = new LinkedHashMap<>();
        private final ThreadPoolExecutor readers = new ThreadPoolExecutor(0, 4, 30, TimeUnit.SECONDS,
                new SynchronousQueue<>(), task -> new Thread(task, "EffeTune-shared-file"));
        // NOTIFY is not an HttpURLConnection method, so events go out one at a time on a plain socket.
        private final ThreadPoolExecutor notifier = new ThreadPoolExecutor(0, 1, 30, TimeUnit.SECONDS,
                new LinkedBlockingQueue<>(256), task -> new Thread(task, "EffeTune-share-events"),
                new ThreadPoolExecutor.DiscardPolicy());
        private ServerBootstrap bootstrap;
        private int port;
        private volatile boolean closed;

        void open() throws Exception {
            bootstrap = new ServerBootstrap().group(loops.get()).channel(NioServerSocketChannel.class)
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override protected void initChannel(SocketChannel ch) {
                            channels.add(ch);
                            if (!NetworkStreamServer.lan(ch.remoteAddress().getAddress())) { ch.close(); return; }
                            ch.pipeline().addLast("deadline", new ReadTimeoutHandler(10));
                            ch.pipeline().addLast(new WriteTimeoutHandler(30), new HttpServerCodec(),
                                    new HttpObjectAggregator(65536), new Request());
                        }
                    });
            Channel local = bind(InetAddress.getByName("127.0.0.1"));
            port = ((InetSocketAddress) local.localAddress()).getPort();
        }

        Channel bind(InetAddress ip) throws Exception {
            Channel listener = bootstrap.bind(new InetSocketAddress(ip, port)).sync().channel();
            channels.add(listener);
            return listener;
        }

        void refreshListeners(List<InetAddress> addresses) {
            listeners.entrySet().removeIf(entry -> {
                if (addresses.contains(entry.getKey())) return false;
                entry.getValue().close();
                return true;
            });
            for (InetAddress ip : addresses) {
                if (!NetworkStreamServer.lan(ip) || ip.isLoopbackAddress() || listeners.containsKey(ip)) continue;
                try { listeners.put(ip, bind(ip)); }
                catch (Exception error) { Log.w(TAG, "Cannot bind library interface", error); }
            }
        }

        // Files opened for a player use a listener on the address that routes to it.
        void listen(InetAddress ip) throws Exception { if (!listeners.containsKey(ip)) listeners.put(ip, bind(ip)); }

        String url(InetAddress address) { return "http://" + address.getHostAddress() + ":" + port; }
        String baseUrl() { return listeners.isEmpty() ? null : url(listeners.keySet().iterator().next()); }

        synchronized Media publish(Media file) {
            if (file.relay() != null) {
                Media existing = relays.get(file.relay());
                if (existing != null) return existing;
            }
            Media current = media.get(file.token());
            if (file.target() == null && current != null && current.target() == null && current.registered() && file.registered()) {
                if (file.owners().isEmpty()) current.owners().clear();
                else if (!current.owners().isEmpty()) current.owners().addAll(file.owners());
                return current;
            }
            if (current == null && media.size() >= 4096) {
                Media cached = media.values().stream().filter(item -> !item.registered()).findFirst().orElse(null);
                if (cached != null) media.remove(cached.token());
                else if (file.registered()) throw new IllegalStateException("Shared media limit reached");
                else return null;
            }
            Media previous = media.put(file.token(), file);
            if (previous != null && previous.relay() != null) relays.remove(previous.relay());
            if (file.relay() != null) relays.put(file.relay(), file);
            return file;
        }

        synchronized boolean hasFiles() { return media.values().stream().anyMatch(file -> file.target() != null); }

        synchronized boolean hasPlayerFiles() {
            return media.values().stream().anyMatch(file -> file.registered() && !file.owners().isEmpty());
        }

        synchronized Media lookup(String token) { return media.get(token); }

        void revoke(java.util.function.Predicate<Media> match) {
            synchronized (this) {
                media.values().removeIf(file -> {
                    if (!match.test(file)) return false;
                    if (file.relay() != null) relays.remove(file.relay());
                    return true;
                });
            }
            streaming.forEach((ch, file) -> { if (match.test(file) && streaming.remove(ch, file)) ch.close(); });
        }

        void ask(Channel ch, String service, String action, String body, Asked asked) {
            String requestId = UUID.randomUUID().toString();
            asked.deadline = () -> abandon(requestId);
            synchronized (pending) {
                if (closed || pending.size() >= 64) { fail(asked); return; }
                pending.put(requestId, asked);
            }
            control.post(() -> {
                if (!pending.containsKey(requestId)) return;
                if (session != this || !pageReady || !current(asked)) { abandon(requestId); return; }
                String base = url(((InetSocketAddress) ch.localAddress()).getAddress());
                control.postDelayed(asked.deadline, 10000);
                ch.closeFuture().addListener(done -> control.post(() -> forget(requestId)));
                events.send("share-request", AudioService.object(
                        "requestId", requestId, "service", service, "action", action, "body", body,
                        "baseUrl", base, "updateId", updateId));
            });
        }

        private void fail(Asked asked) {
            if (asked.end > 0) asked.ch.close();
            else if (asked.token == null) respond(asked.ch, 500, fault(501), false);
            else respond(asked.ch, 404, null, asked.head);
        }

        private Asked forget(String requestId) {
            Asked asked = pending.remove(requestId);
            if (asked != null) control.removeCallbacks(asked.deadline);
            return asked;
        }

        private void abandon(String requestId) {
            Asked asked = forget(requestId);
            if (asked != null && asked.ch.isActive()) fail(asked);
        }

        private boolean current(Asked asked) {
            return asked != null && asked.ch.isActive() && sharing && asked.generation == updateId
                    && (asked.current == null || asked.current.getAsBoolean());
        }

        JSONObject answer(String requestId, JSONObject args) throws Exception {
            Asked asked = pending.get(requestId);
            if (!current(asked)) { abandon(requestId); return AudioService.object("accepted", false); }
            try {
                boolean failed = args.optBoolean("failed");
                if (!failed && asked.token != null && !args.has("uri") && asked.end == 0) {
                    int size = args.getInt("size");
                    String mime = args.getString("mime");
                    if (size <= 0 || size > RESOURCE_LIMIT || !mime.matches(MIME)) throw new IOException("Invalid shared body");
                    long[] span = range(asked.range, size);
                    if (span == null) unsatisfiable(asked.ch, size);
                    else {
                        asked.ch.writeAndFlush(mediaHeaders(mime, asked.range, span, size));
                        if (!asked.head) {
                            asked.offset = (int) span[0];
                            asked.end = (int) span[1] + 1;
                            control.removeCallbacks(asked.deadline);
                            control.postDelayed(asked.deadline, 10000);
                            return AudioService.object("accepted", true, "offset", asked.offset, "end", asked.end);
                        }
                        asked.ch.writeAndFlush(LastHttpContent.EMPTY_LAST_CONTENT).addListener(ChannelFutureListener.CLOSE);
                    }
                } else if (asked.end > 0 || failed && asked.token != null) fail(asked);
                else if (asked.token == null) {
                    String body = failed ? args.optString("body", "") : args.getString("body");
                    respond(asked.ch, failed ? 500 : 200, failed && body.isEmpty() ? fault(501) : body, false);
                } else {
                    Media file = media(asked.token, args, false);
                    if (file.target() != null) throw new IOException("Invalid library target");
                    if (lookup(file.token()) == null) publish(file);
                    serve(asked.ch, file, false, asked.range, asked.head);
                }
                forget(requestId);
                return AudioService.object("accepted", true);
            } catch (Exception error) {
                abandon(requestId);
                throw error;
            }
        }

        void failRequests() { for (String id : pending.keySet()) abandon(id); }

        void respondPart(String id, JSONObject args, AudioService.Reply reply) throws Exception {
            Asked asked = pending.get(id);
            if (!current(asked)) { abandon(id); reply.complete(AudioService.object("accepted", false), null); return; }
            try {
                String encoded = args.getString("data");
                int length = Math.min(PART_BYTES, asked.end - asked.offset);
                if (asked.writing || length <= 0 || args.getInt("offset") != asked.offset || encoded.length() != 4 * ((length + 2) / 3))
                    throw new IOException("Invalid shared body offset or length");
                byte[] data = Base64.decode(encoded, Base64.NO_WRAP);
                if (data.length != length) throw new IOException("Invalid shared body part");
                control.removeCallbacks(asked.deadline);
                asked.offset += length;
                asked.writing = true;
                boolean last = asked.offset == asked.end;
                ChannelFuture write = asked.ch.writeAndFlush(last ? new DefaultLastHttpContent(Unpooled.wrappedBuffer(data))
                        : new DefaultHttpContent(Unpooled.wrappedBuffer(data)));
                write.addListener(done -> control.post(() -> {
                    boolean accepted = done.isSuccess() && current(asked) && pending.get(id) == asked;
                    if (!accepted || last) { forget(id); asked.ch.close(); }
                    else { asked.writing = false; control.postDelayed(asked.deadline, 10000); }
                    reply.complete(AudioService.object("accepted", accepted), null);
                }));
            } catch (Exception error) { abandon(id); throw error; }
        }

        private void serve(Channel ch, Media file, boolean artwork, String header, boolean head) {
            InetAddress remote = ((InetSocketAddress) ch.remoteAddress()).getAddress();
            if (file.target() != null && !file.target().equals(remote.getHostAddress())) { respond(ch, 403, null, head); return; }
            Subsonic relay = file.relay();
            if (relay != null) {
                if (artwork && relay.art().isEmpty()) { respond(ch, 404, null, head); return; }
                streaming.put(ch, file);
                ch.closeFuture().addListener(done -> streaming.remove(ch));
                if (closed || lookup(file.token()) != file) { respond(ch, 404, null, head); return; }
                gateway.serveResource(ch, () -> LanHttp.Target.resolve(SubsonicHost.pwaResource(app, relay.server(),
                        relay.track(), relay.art(), relay.format(), artwork), null, true),
                        head, artwork, header, () -> !closed && streaming.containsKey(ch), false);
                return;
            }
            if (artwork) { respond(ch, 404, null, head); return; }
            try {
                Future<?> transfer = readers.submit(() -> serveMedia(ch, file, header, head));
                ch.closeFuture().addListener(done -> transfer.cancel(true));
            }
            catch (RejectedExecutionException busy) { respond(ch, 503, null, head); }
        }

        private void serveResource(Channel ch, String token, boolean artwork, String range, boolean head, BooleanSupplier current) {
            long generation = updateId;
            Media file = lookup(token);
            if (file != null && (!artwork || file.target() != null)) {
                if (current != null && file.target() != null) respond(ch, 404, null, head);
                else serve(ch, file, artwork, range, head);
            } else if (sharing) {
                // Artwork and archive entries come from the page; artwork is always a whole image.
                ask(ch, "Resource", artwork ? "artwork" : "media", token, new Asked(ch, token, artwork ? null : range, head, current, generation));
            } else respond(ch, 404, null, head);
        }

        // GENA follows the desktop server: 64 subscribers, 30-minute leases, and callbacks only to the subscriber.
        private void subscription(Channel ch, FullHttpRequest req, String service) {
            InetAddress remote = ((InetSocketAddress) ch.remoteAddress()).getAddress();
            String sid = req.headers().get("SID"), method = req.method().name();
            Subscriber entry;
            boolean renewed;
            synchronized (subscribers) {
                long now = System.currentTimeMillis();
                subscribers.values().removeIf(item -> item.expires < now);
                Subscriber previous = sid == null ? null : subscribers.get(sid);
                if ("UNSUBSCRIBE".equals(method) && previous != null && previous.remote.equals(remote)) {
                    subscribers.remove(sid);
                    respond(ch, 200, null, false);
                    return;
                }
                if (!"SUBSCRIBE".equals(method)) { respond(ch, 405, null, false); return; }
                entry = previous != null && previous.remote.equals(remote) ? previous : null;
                String callback = req.headers().get("CALLBACK", "").replaceAll("^<|>$", "");
                if (sid == null && subscribers.size() < 64 && "upnp:event".equals(req.headers().get("NT")) && callback.matches("[!-~]+")) {
                    try {
                        URL url = new URL(callback);
                        if ("http".equals(url.getProtocol()) && url.getHost().equals(remote.getHostAddress()))
                            entry = new Subscriber("uuid:" + UUID.randomUUID(), service, callback, remote);
                    } catch (IOException invalid) { /* Invalid callbacks are rejected without making a request. */ }
                }
                if (entry == null) { respond(ch, 412, null, false); return; }
                entry.expires = now + 1800000;
                subscribers.put(entry.sid, entry);
                renewed = previous != null;
            }
            FullHttpResponse out = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, HttpResponseStatus.OK);
            out.headers().set("SID", entry.sid).set("TIMEOUT", "Second-1800").set("Content-Length", 0).set("Connection", "close");
            ch.writeAndFlush(out).addListener(ChannelFutureListener.CLOSE);
            if (!renewed) publishEvent(entry);
        }

        void broadcast() {
            List<Subscriber> all;
            synchronized (subscribers) { all = new ArrayList<>(subscribers.values()); }
            for (Subscriber entry : all) publishEvent(entry);
        }

        private void publishEvent(Subscriber entry) {
            long seq;
            synchronized (subscribers) {
                if (entry.expires < System.currentTimeMillis()) return;
                seq = entry.seq++;
            }
            String properties = CONTENT.equals(entry.service) ? property("SystemUpdateID", Long.toString(updateId))
                    : property("SourceProtocolInfo", SOURCE_PROTOCOLS) + property("SinkProtocolInfo", "") + property("CurrentConnectionIDs", "");
            byte[] body = ("<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\">" + properties + "</e:propertyset>")
                    .getBytes(StandardCharsets.UTF_8);
            notifier.execute(() -> {
                try (Socket socket = new Socket()) {
                    URL url = new URL(entry.callback);
                    int port = url.getPort() < 0 ? 80 : url.getPort();
                    socket.connect(new InetSocketAddress(entry.remote, port), 3000);
                    socket.setSoTimeout(3000);
                    OutputStream out = socket.getOutputStream();
                    out.write(("NOTIFY " + (url.getFile().isEmpty() ? "/" : url.getFile()) + " HTTP/1.1\r\nHOST: " + url.getHost() + ":" + port +
                            "\r\nNT: upnp:event\r\nNTS: upnp:propchange\r\nSID: " + entry.sid + "\r\nSEQ: " + seq +
                            "\r\nContent-Type: text/xml\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n")
                            .getBytes(StandardCharsets.ISO_8859_1));
                    out.write(body);
                    out.flush();
                    socket.getInputStream().read();
                } catch (IOException error) { Log.d(TAG, "Library event notification failed", error); }
            });
        }

        private final class Request extends SimpleChannelInboundHandler<FullHttpRequest> {
            private boolean handled;
            @Override protected void channelRead0(ChannelHandlerContext ctx, FullHttpRequest req) {
                if (handled) return;
                handled = true;
                Channel ch = ctx.channel();
                if (closed || !req.decoderResult().isSuccess()) { respond(ch, 400, null, false); return; }
                ctx.pipeline().remove("deadline");
                String path = req.uri().split("\\?", 2)[0];
                boolean head = HttpMethod.HEAD.equals(req.method());
                if (path.startsWith(PwaNetworkHost.PREFIX)) {
                    PwaNetworkHost.PlayerGrants owner = playerGrants;
                    if (owner == null) respond(ch, 404, null, head);
                    else owner.serve(ch, req);
                    return;
                }
                String[] route = path.split("/", -1);
                boolean resource = route.length == 3 && (route[1].equals("media") || route[1].equals("artwork"));
                // A session kept only for files opened for players serves nothing but those files.
                if (!sharing && !resource) { respond(ch, 404, null, head); return; }
                if (HttpMethod.POST.equals(req.method()) && path.startsWith("/control/")) {
                    String service = path.substring("/control/".length());
                    if (!CONTENT.equals(service) && !CONNECTION.equals(service)) { respond(ch, 404, null, false); return; }
                    soap(ch, service, req.content().toString(StandardCharsets.UTF_8));
                    return;
                }
                if (path.startsWith("/event/")) {
                    String service = path.substring("/event/".length());
                    if (!CONTENT.equals(service) && !CONNECTION.equals(service)) { respond(ch, 404, null, false); return; }
                    subscription(ch, req, service);
                    return;
                }
                if (!head && !HttpMethod.GET.equals(req.method())) { respond(ch, 405, null, false); return; }
                if (resource) {
                    String token = route[2];
                    if (!token.matches(TOKEN)) { respond(ch, 404, null, head); return; }
                    serveResource(ch, token, route[1].equals("artwork"), req.headers().get("Range"), head, null);
                    return;
                }
                switch (path) {
                    case "/description.xml", "/device.xml" -> control.post(() -> {
                        if (!closed && ch.isActive()) respond(ch, 200, description(), head);
                    });
                    case "/ContentDirectory.xml" -> respond(ch, 200, CONTENT_XML, head);
                    case "/ConnectionManager.xml" -> respond(ch, 200, CONNECTION_XML, head);
                    default -> respond(ch, 404, null, head);
                }
            }

            @Override public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
                Log.d(TAG, "Library HTTP connection closed", cause);
                ctx.close();
            }
        }

        private void soap(Channel ch, String service, String body) {
            String action;
            try { action = actionName(body); }
            catch (Exception invalid) { respond(ch, 500, fault(401), false); return; }
            if (CONTENT.equals(service)) {
                for (String[] definition : CONTENT_ACTIONS) if (definition[0].equals(action)) {
                    ask(ch, service, action, body, new Asked(ch, null, null, false, null, updateId));
                    return;
                }
            } else {
                String fields;
                switch (action) {
                    case "GetProtocolInfo" -> fields = "<Source>" + SOURCE_PROTOCOLS + "</Source><Sink></Sink>";
                    case "GetCurrentConnectionIDs" -> fields = "<ConnectionIDs></ConnectionIDs>";
                    case "GetCurrentConnectionInfo" -> { respond(ch, 500, fault(706), false); return; }
                    default -> { respond(ch, 500, fault(401), false); return; }
                }
                respond(ch, 200, "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"" + SOAP + "\"><s:Body><u:" + action +
                        "Response xmlns:u=\"" + serviceType(service) + "\">" + fields + "</u:" + action + "Response></s:Body></s:Envelope>", false);
                return;
            }
            respond(ch, 500, fault(401), false);
        }

        private void serveMedia(Channel ch, Media file, String header, boolean head) {
            CancellationSignal cancel = new CancellationSignal();
            streaming.put(ch, file);
            ch.closeFuture().addListener(done -> { cancel.cancel(); streaming.remove(ch); });
            boolean committed = false;
            try {
                if (closed || !ch.isActive()) return;
                if (file.target() == null ? file.generation() != updateId || !sharing : lookup(file.token()) != file) {
                    respond(ch, 404, null, head);
                    return;
                }
                ParcelFileDescriptor fd = resolver.openFileDescriptor(file.uri(), "r", cancel);
                if (fd == null) throw new IOException("Media provider unavailable");
                try (ParcelFileDescriptor.AutoCloseInputStream stream = new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
                    FileChannel input = stream.getChannel();
                    long stat = fd.getStatSize();
                    long size = stat < 0 ? file.size() : stat;
                    if (size < 0) throw new IOException("Unknown shared file length");
                    long[] span = range(header, size);
                    if (span == null) { unsatisfiable(ch, size); return; }
                    long length = span[1] - span[0] + 1;
                    long skip = 0;
                    if (!head && span[0] > 0) {
                        try { input.position(span[0]); }
                        catch (IOException notSeekable) {
                            if (stat >= 0) throw notSeekable;
                            // A provider can return a pipe for a document with a known length.
                            skip = span[0];
                        }
                    }
                    committed = true;
                    ch.writeAndFlush(mediaHeaders(file.mime(), header, span, size)).sync();
                    if (!head && length > 0) {
                        ByteBuffer block = ByteBuffer.allocate(64 * 1024);
                        while (length > 0 && !closed && ch.isActive()) {
                            block.clear();
                            block.limit((int) Math.min(skip > 0 ? skip : length, block.capacity()));
                            int count = input.read(block);
                            if (count <= 0) throw new IOException("Shared file ended early");
                            if (skip > 0) { skip -= count; continue; }
                            ch.writeAndFlush(new DefaultHttpContent(Unpooled.wrappedBuffer(block.array(), 0, count))).sync();
                            length -= count;
                        }
                    }
                    ch.writeAndFlush(LastHttpContent.EMPTY_LAST_CONTENT).addListener(ChannelFutureListener.CLOSE);
                }
            } catch (Exception error) {
                if (!closed && ch.isActive()) {
                    Log.d(TAG, "Shared media read failed", error);
                    if (!committed) respond(ch, 404, null, head); else ch.close();
                }
            }
        }

        @Override public void close() {
            closed = true;
            channels.close();
            readers.shutdownNow();
            notifier.shutdownNow();
            synchronized (this) { media.clear(); relays.clear(); }
            synchronized (subscribers) { subscribers.clear(); }
            failRequests();
            listeners.clear();
            loops.close();
        }
    }
}
