package com.frieve.effetune;

import android.content.Context;
import android.os.Handler;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.Log;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.*;
import org.xml.sax.InputSource;

final class UpnpRenderer implements NetworkOutput.Device {
    private static final String PREFIX = "urn:schemas-upnp-org:service:";
    private record Service(String type, URL url) {}
    private final String id, name;
    private final InetAddress address;
    private final Service transport, connection;
    UpnpRenderer(String id, String name, InetAddress address, Service transport, Service connection) {
        this.id = id; this.name = name; this.address = address; this.transport = transport; this.connection = connection;
    }
    public String id() { return id; }
    public String name() { return name; }
    public String type() { return "upnp"; }
    public InetAddress address() { return address; }

    private static String value(Element parent, String key) {
        for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling())
            if (key.equals(n.getLocalName())) return n.getTextContent().trim();
        return "";
    }

    private static String field(Document xml, String key) {
        Node node = xml.getElementsByTagNameNS("*", key).item(0);
        return node == null ? "" : node.getTextContent().trim();
    }

    private static HttpURLConnection open(URL url) throws IOException {
        return (HttpURLConnection) url.openConnection(Proxy.NO_PROXY);
    }

    private static Document xml(HttpURLConnection c, String action, String body) throws Exception {
        try {
            c.setConnectTimeout(3500); c.setReadTimeout(3500);
            c.setInstanceFollowRedirects(false); c.setUseCaches(false);
            if (action != null) {
                c.setRequestMethod("POST"); c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
                c.setRequestProperty("SOAPACTION", "\"" + action + "\"");
                byte[] data = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(data.length);
                try (OutputStream out = c.getOutputStream()) { out.write(data); }
            }
            if (c.getResponseCode() / 100 != 2) throw new IOException("UPnP HTTP " + c.getResponseCode());
            ByteArrayOutputStream data = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] block = new byte[4096];
                int count;
                while ((count = in.read(block)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                    if (data.size() + count > 512 * 1024) throw new IOException("UPnP document too large");
                    data.write(block, 0, count);
                }
            }
            String text = data.toString("UTF-8");
            if (text.contains("<!DOCTYPE")) throw new IOException("DTD is unsupported");
            DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setNamespaceAware(true); f.setExpandEntityReferences(false);
            return f.newDocumentBuilder().parse(new InputSource(new StringReader(text)));
        } finally { c.disconnect(); }
    }

    private static URL endpoint(URL base, String location, InetAddress sender) throws Exception {
        URL url = new URL(base, location);
        if (!(url.getProtocol().equals("http") || url.getProtocol().equals("https")) ||
                url.getUserInfo() != null || url.getRef() != null || !InetAddress.getByName(url.getHost()).equals(sender))
            throw new IOException("UPnP address does not match advertisement");
        return new URL(url.getProtocol(), sender.getHostAddress(), url.getPort(), url.getFile());
    }

    private static List<UpnpRenderer> describe(Document xml, URL location, InetAddress sender) throws Exception {
        String declared = field(xml, "URLBase");
        URL base = declared.isEmpty() ? location : endpoint(location, declared, sender);
        List<UpnpRenderer> devices = new ArrayList<>();
        NodeList nodes = xml.getElementsByTagNameNS("*", "device");
        for (int i = 0; i < nodes.getLength(); i++) {
            Element device = (Element) nodes.item(i);
            Service av = null, cm = null;
            for (Node list = device.getFirstChild(); list != null; list = list.getNextSibling()) {
                if (!"serviceList".equals(list.getLocalName())) continue;
                for (Node n = list.getFirstChild(); n != null; n = n.getNextSibling()) {
                    if (!"service".equals(n.getLocalName())) continue;
                    Element service = (Element) n;
                    String type = value(service, "serviceType");
                    if (!type.matches("urn:schemas-upnp-org:service:(AVTransport|ConnectionManager):[0-9]+")) continue;
                    String path = value(service, "controlURL");
                    if (path.isEmpty()) continue;
                    Service info = new Service(type, endpoint(base, path, sender));
                    if (type.startsWith(PREFIX + "AVTransport:")) av = info; else cm = info;
                }
            }
            String id = value(device, "UDN"), name = value(device, "friendlyName");
            if (av != null && !id.isEmpty()) devices.add(new UpnpRenderer(id, name.isEmpty() ? id : name, sender, av, cm));
        }
        return devices;
    }

    static final class Discovery implements AutoCloseable {
        private static final String TARGET = PREFIX + "AVTransport:1";
        private final Handler control;
        private final NetworkOutput.Discovery output;
        private final Ssdp ssdp;
        private final Consumer<Ssdp.Packet> observer = this::received;
        private final ExecutorService descriptions =
                Executors.newSingleThreadExecutor(r -> new Thread(r, "EffeTune-UPnP-description"));
        private record Seen(String location, long expires) {}
        private final Map<String, Seen> seen = new HashMap<>();
        private final Map<String, Long> loading = new HashMap<>();
        private boolean watching;
        private volatile boolean closed;
        private volatile HttpURLConnection reading;

        Discovery(Context context, Handler control, NetworkOutput.Discovery output) {
            this.control = control; this.output = output; this.ssdp = ((AudioService) context).ssdp;
        }

        void start() { maintain.run(); }

        private final Runnable maintain = new Runnable() {
            @Override public void run() {
                if (!watching) {
                    try { ssdp.watch(TARGET, observer); watching = true; }
                    catch (IOException | RuntimeException error) { Log.d("EffeTuneNetwork", "SSDP search failed", error); }
                }
                long now = SystemClock.elapsedRealtime();
                seen.entrySet().removeIf(entry -> {
                    if (entry.getValue().expires() > now) return false;
                    output.lost(entry.getKey());
                    return true;
                });
                control.postDelayed(this, 30000);
            }
        };

        private void received(Ssdp.Packet packet) {
            if (!packet.nts().isEmpty() || packet.location().isEmpty()) return;
            String key = packet.address().getHostAddress() + "\n" + packet.location();
            long expires = SystemClock.elapsedRealtime() + packet.maxAge() * 1000L;
            boolean known = false;
            for (Map.Entry<String, Seen> entry : seen.entrySet()) {
                if (entry.getValue().location().equals(key)) { entry.setValue(new Seen(key, expires)); known = true; }
            }
            if (known || loading.size() >= 256 || loading.put(key, expires) != null) return;
            descriptions.execute(() -> {
                List<UpnpRenderer> devices = Collections.emptyList();
                try {
                    URL location = endpoint(null, packet.location(), packet.address());
                    HttpURLConnection connection = open(location);
                    reading = connection;
                    if (closed) { connection.disconnect(); return; }
                    devices = describe(xml(connection, null, null), location, packet.address());
                }
                catch (Exception error) { Log.d("EffeTuneNetwork", "Cannot read renderer description", error); }
                finally { reading = null; }
                List<UpnpRenderer> result = devices;
                control.post(() -> {
                    if (closed) return;
                    long deadline = loading.remove(key);
                    for (UpnpRenderer device : result) {
                        seen.put(device.id, new Seen(key, deadline));
                        output.found(device);
                    }
                });
            });
        }

        @Override public void close() {
            closed = true;
            ssdp.unwatch(observer);
            control.removeCallbacks(maintain);
            descriptions.shutdownNow();
            HttpURLConnection pending = reading;
            if (pending != null) pending.disconnect();
            loading.clear();
            seen.clear();
        }
    }

    private Document soap(Service service, String action, String... args) throws Exception {
        StringBuilder fields = new StringBuilder();
        for (int i = 0; i < args.length; i += 2) fields.append('<').append(args[i]).append('>')
                .append(TextUtils.htmlEncode(args[i + 1])).append("</").append(args[i]).append('>');
        String body = "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" " +
                "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:" + action + " xmlns:u=\"" +
                service.type() + "\">" + fields + "</u:" + action + "></s:Body></s:Envelope>";
        return xml(open(service.url()), service.type() + "#" + action, body);
    }

    private String mime() throws Exception {
        String sink = "";
        if (connection != null) {
            try { sink = field(soap(connection, "GetProtocolInfo"), "Sink"); }
            catch (IOException error) { Log.d("EffeTuneNetwork", "Renderer did not list sink formats", error); }
        }
        if (sink.isEmpty()) return "audio/flac";
        for (String mime : new String[]{"audio/flac", "audio/x-flac"}) {
            for (String item : sink.split(",")) {
                String[] parts = item.trim().split(":", 4);
                if (parts.length == 4 && (parts[0].equalsIgnoreCase("http-get") || parts[0].equals("*"))
                        && (parts[2].equalsIgnoreCase(mime) || parts[2].equals("*") || parts[2].equals("audio/*"))) return mime;
            }
        }
        throw new NetworkOutput.Failure("format");
    }

    private String mediaUri() {
        for (String[] query : new String[][]{{"GetPositionInfo", "TrackURI"}, {"GetMediaInfo", "CurrentURI"}}) {
            try {
                String uri = field(soap(transport, query[0], "InstanceID", "0"), query[1]);
                if (!uri.isEmpty()) return uri;
            } catch (Exception ignored) { /* Some renderers implement only one of the two queries. */ }
        }
        return "";
    }

    @Override public void play(NetworkOutput.Session session) throws Exception {
        NetworkStreamServer.Stream stream = session.stream;
        String mime = mime();
        if (stream.closed) return;
        stream.prepareFlac(mime);
        String didl = "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" " +
                "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\" " +
                "xmlns:et=\"urn:effetune-org:metadata-1-0\"><item id=\"effetune-network-output\" parentID=\"0\" restricted=\"1\">" +
                "<dc:title>EffeTune</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class>" +
                "<et:streamKind>live-pcm-v1</et:streamKind><res protocolInfo=\"http-get:*:" + mime + ":" +
                NetworkStreamServer.FEATURES + "\">" + stream.url + "</res></item></DIDL-Lite>";
        if (stream.closed) return;
        soap(transport, "SetAVTransportURI", "InstanceID", "0", "CurrentURI", stream.url, "CurrentURIMetaData", didl);
        try {
            if (stream.closed) return;
            soap(transport, "Play", "InstanceID", "0", "Speed", "1");
            int lost = 0;
            while (!stream.closed) {
                Thread.sleep(2000);
                if (stream.closed) break;
                if (stream.failure != null) throw new NetworkOutput.Failure(stream.failure);
                try {
                    String state = field(soap(transport, "GetTransportInfo", "InstanceID", "0"), "CurrentTransportState");
                    String uri = mediaUri();
                    if (!uri.isEmpty() && !uri.equals(stream.url)) throw new NetworkOutput.Failure("taken");
                    if (state.equals("PLAYING")) { session.state = "playing"; lost = 0; }
                    if (state.equals("STOPPED") || state.equals("NO_MEDIA_PRESENT")) throw new NetworkOutput.Failure("offline");
                } catch (IOException error) { if (++lost >= 3) throw error; }
            }
        } finally {
            if (stream.closed && stream.url.equals(mediaUri())) soap(transport, "Stop", "InstanceID", "0");
        }
    }
}
