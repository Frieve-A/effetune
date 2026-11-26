package com.frieve.effetune;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.util.Log;
import java.io.Closeable;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.StandardProtocolFamily;
import java.net.StandardSocketOptions;
import java.nio.ByteBuffer;
import java.nio.channels.DatagramChannel;
import java.nio.channels.MembershipKey;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/** Socket ownership, subscriptions and advertisements are serialized on the service control handler. */
final class Ssdp implements Closeable {
    private static final InetSocketAddress GROUP = new InetSocketAddress("239.255.255.250", 1900);
    private static final Pattern MAX_AGE = Pattern.compile("max-age\\s*=\\s*(\\d+)", Pattern.CASE_INSENSITIVE);
    private static final String HOST = "HOST: 239.255.255.250:1900\r\n";
    record Packet(String location, String usn, String st, String nt, String nts, InetAddress address, int maxAge) {
        JSONObject json() {
            return AudioService.object("location", location, "usn", usn, "st", st, "nt", nt,
                    "nts", nts, "address", address.getHostAddress(), "maxAge", maxAge);
        }
    }
    private final Handler control;
    private final WifiManager.MulticastLock lock;
    private final Map<Consumer<Packet>, String> watchers = new LinkedHashMap<>();
    private final Consumer<Packet> page;
    private final Map<NetworkInterface, MembershipKey> memberships = new HashMap<>();
    private List<InetAddress> addresses = Collections.emptyList();
    private DatagramChannel listener, replies;
    private Selector selector;
    private Closeable socketLock;
    private record Advertisement(String id, List<String> targets, Function<InetAddress, String> location,
                                 Consumer<List<InetAddress>> interfaces) {}
    private final Set<Advertisement> advertisements = Collections.newSetFromMap(new IdentityHashMap<>());
    private Lease libraryAdvertisement;
    private boolean closed;

    Ssdp(Context context, Handler control, Consumer<JSONObject> pageEvent) {
        this.control = control;
        page = packet -> pageEvent.accept(packet.json());
        WifiManager wifi = context.getApplicationContext().getSystemService(WifiManager.class);
        lock = wifi == null ? null : wifi.createMulticastLock("EffeTuneSSDP");
        if (lock != null) lock.setReferenceCounted(true);
    }

    interface Lease extends Closeable { @Override void close(); }

    Lease acquireMulticast() {
        if (closed) throw new IllegalStateException("SSDP closed");
        if (lock != null) lock.acquire();
        return new Lease() {
            boolean held = true;
            @Override public void close() {
                if (held && !closed && lock != null) lock.release();
                held = false;
            }
        };
    }

    void searchPage(boolean enabled) throws IOException {
        if (!enabled) stopPage();
        else watch("ssdp:all", page);
    }

    void stopPage() { unwatch(page); }

    void watch(String target, Consumer<Packet> observer) throws IOException {
        open();
        watchers.put(observer, target);
        search(target);
        if (watchers.size() == 1) {
            control.removeCallbacks(repeatSearch);
            control.postDelayed(repeatSearch, 30000);
        }
    }

    void unwatch(Consumer<Packet> observer) {
        watchers.remove(observer);
        if (watchers.isEmpty()) control.removeCallbacks(repeatSearch);
        closeIfIdle();
    }

    void advertise(String id, List<String> advertisedTargets, Function<InetAddress, String> description) throws IOException {
        advertise(id, advertisedTargets, description, addresses -> {});
    }

    void advertise(String id, List<String> advertisedTargets, Function<InetAddress, String> description,
                   Consumer<List<InetAddress>> refreshListeners) throws IOException {
        if (libraryAdvertisement != null) libraryAdvertisement.close();
        libraryAdvertisement = register(id, advertisedTargets, description, refreshListeners);
    }

    Lease register(String id, List<String> targets, Function<InetAddress, String> location,
                   Consumer<List<InetAddress>> interfaces) throws IOException {
        open();
        Advertisement ad = new Advertisement(id, new ArrayList<>(targets), location, interfaces);
        advertisements.add(ad);
        try {
            interfaces.accept(addresses);
            announce(ad, "ssdp:alive");
        } catch (RuntimeException error) {
            advertisements.remove(ad);
            closeIfIdle();
            throw error;
        }
        if (advertisements.size() == 1) control.postDelayed(repeatAlive, 60000);
        return () -> removeAdvertisement(ad);
    }

    void stopAdvertising() {
        if (libraryAdvertisement != null) libraryAdvertisement.close();
        libraryAdvertisement = null;
    }

    private void removeAdvertisement(Advertisement ad) {
        if (!advertisements.remove(ad)) return;
        if (selector != null) announce(ad, "ssdp:byebye");
        if (advertisements.isEmpty()) control.removeCallbacks(repeatAlive);
        closeIfIdle();
    }

    private final Runnable repeatSearch = new Runnable() {
        @Override public void run() {
            if (refreshSockets()) for (String target : new LinkedHashSet<>(watchers.values())) search(target);
            control.postDelayed(this, 30000);
        }
    };
    private final Runnable repeatAlive = new Runnable() {
        @Override public void run() {
            if (refreshSockets()) for (Advertisement ad : new ArrayList<>(advertisements)) {
                ad.interfaces.accept(addresses);
                announce(ad, "ssdp:alive");
            }
            if (!advertisements.isEmpty()) control.postDelayed(this, 60000);
        }
    };

    private void open() throws IOException {
        if (closed) throw new IOException("SSDP closed");
        if (selector != null) return;
        try {
            socketLock = acquireMulticast();
            selector = Selector.open();
            listener = DatagramChannel.open(StandardProtocolFamily.INET);
            listener.setOption(StandardSocketOptions.SO_REUSEADDR, true);
            bind(listener, 1900);
            replies = DatagramChannel.open(StandardProtocolFamily.INET);
            bind(replies, 0);
            updateInterfaces();
            Selector active = selector;
            new Thread(() -> receive(active), "EffeTune-SSDP").start();
        } catch (IOException | RuntimeException failure) {
            closeSockets();
            throw failure;
        }
    }

    private boolean refreshSockets() {
        try {
            if (selector == null) open();
            else updateInterfaces();
            return true;
        } catch (IOException | RuntimeException error) { diagnostic(error); return false; }
    }

    private void bind(DatagramChannel channel, int port) throws IOException {
        channel.setOption(StandardSocketOptions.IP_MULTICAST_TTL, 2);
        channel.bind(new InetSocketAddress("0.0.0.0", port));
        channel.configureBlocking(false);
        channel.register(selector, SelectionKey.OP_READ);
    }

    private void updateInterfaces() {
        List<InetAddress> current = new ArrayList<>();
        Set<NetworkInterface> joined = new HashSet<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface nic = interfaces.nextElement();
                if (!nic.isUp() || nic.isLoopback() || !nic.supportsMulticast()) continue;
                for (InetAddress address : Collections.list(nic.getInetAddresses())) {
                    if (!(address instanceof Inet4Address)) continue;
                    current.add(address);
                    joined.add(nic);
                    if (!memberships.containsKey(nic)) {
                        try { memberships.put(nic, listener.join(GROUP.getAddress(), nic)); }
                        catch (IOException error) { diagnostic(error); }
                    }
                }
            }
            memberships.entrySet().removeIf(entry -> {
                if (joined.contains(entry.getKey())) return false;
                entry.getValue().drop();
                return true;
            });
            addresses = current;
        } catch (IOException | SecurityException error) { diagnostic(error); }
    }

    private void search(String target) {
        String message = "M-SEARCH * HTTP/1.1\r\n" + HOST + "MAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + target + "\r\n\r\n";
        for (InetAddress address : addresses) send(replies, address, GROUP, message);
    }

    private void sendAdvertisement(Advertisement ad, InetAddress address, InetSocketAddress to, String target, String prefix) {
        String url = ad.location.apply(address);
        if (url != null) send(listener, address, to, prefix + "USN: " + ad.id +
                (ad.id.equals(target) ? "" : "::" + target) + "\r\nLOCATION: " + url +
                "\r\nCACHE-CONTROL: max-age=180\r\nSERVER: EffeTune/1.0 UPnP/1.0\r\n\r\n");
    }

    private void announce(Advertisement ad, String nts) {
        for (InetAddress address : addresses) for (String target : ad.targets)
            sendAdvertisement(ad, address, GROUP, target, "NOTIFY * HTTP/1.1\r\n" + HOST + "NT: " + target + "\r\nNTS: " + nts + "\r\n");
    }

    private void send(DatagramChannel channel, InetAddress address, InetSocketAddress to, String message) {
        try {
            if (to.equals(GROUP)) {
                NetworkInterface nic = NetworkInterface.getByInetAddress(address);
                if (nic == null) return;
                channel.setOption(StandardSocketOptions.IP_MULTICAST_IF, nic);
            }
            channel.send(StandardCharsets.UTF_8.encode(message), to);
        } catch (IOException | IllegalArgumentException | SecurityException error) { diagnostic(error); }
    }

    private void receive(Selector active) {
        ByteBuffer buf = ByteBuffer.allocate(16385);
        try {
            while (active.isOpen()) {
                active.select();
                Iterator<SelectionKey> keys = active.selectedKeys().iterator();
                while (keys.hasNext()) {
                    SelectionKey key = keys.next();
                    keys.remove();
                    buf.clear();
                    InetSocketAddress remote = (InetSocketAddress) ((DatagramChannel) key.channel()).receive(buf);
                    if (remote == null || !NetworkStreamServer.lan(remote.getAddress()) || !buf.hasRemaining()) continue;
                    buf.flip();
                    String message = StandardCharsets.ISO_8859_1.decode(buf).toString();
                    control.post(() -> { if (selector == active) packet(message, remote); });
                }
            }
        } catch (IOException | RuntimeException error) {
            control.post(() -> {
                if (selector == active) { diagnostic(error); closeSockets(); }
            });
        }
    }

    private void packet(String message, InetSocketAddress remote) {
        String[] lines = message.split("\r\n");
        if (lines.length < 2) return;
        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon > 0) headers.put(lines[i].substring(0, colon).toLowerCase(Locale.ROOT), lines[i].substring(colon + 1).trim());
        }
        String st = headers.getOrDefault("st", "");
        if ("M-SEARCH * HTTP/1.1".equals(lines[0])) {
            if ("\"ssdp:discover\"".equals(headers.get("man"))) for (Advertisement ad : advertisements) {
                for (String target : ad.targets) if (st.equals("ssdp:all") || st.equals(target))
                    for (InetAddress address : addresses) sendAdvertisement(ad, address, remote, target,
                            "HTTP/1.1 200 OK\r\nEXT:\r\nST: " + target + "\r\n");
            }
            return;
        }
        if (!"NOTIFY * HTTP/1.1".equals(lines[0]) && !lines[0].startsWith("HTTP/1.1 200")) return;
        String nt = headers.getOrDefault("nt", ""), nts = headers.getOrDefault("nts", "");
        int ttl = 180;
        Matcher match = MAX_AGE.matcher(headers.getOrDefault("cache-control", ""));
        if (match.find() && match.group(1).length() < 10) ttl = Math.min(1800, Integer.parseInt(match.group(1)));
        Packet packet = new Packet(headers.getOrDefault("location", ""), headers.getOrDefault("usn", ""),
                st, nt, nts, remote.getAddress(), ttl);
        for (Map.Entry<Consumer<Packet>, String> watcher : watchers.entrySet()) {
            String target = watcher.getValue();
            if (target.equals("ssdp:all") || target.equals(st) || target.equals(nt) || (st.isEmpty() && nt.isEmpty()))
                watcher.getKey().accept(packet);
        }
    }

    private void closeIfIdle() {
        if (watchers.isEmpty() && advertisements.isEmpty()) closeSockets();
    }

    private static void diagnostic(Exception error) { Log.d("EffeTuneNetwork", "SSDP transport", error); }
    private void closeSockets() {
        for (Closeable item : new Closeable[]{selector, listener, replies, socketLock}) {
            if (item != null) try { item.close(); } catch (IOException error) { diagnostic(error); }
        }
        selector = null; listener = null; replies = null; socketLock = null;
        memberships.clear();
        addresses = Collections.emptyList();
    }

    @Override public void close() {
        stopAdvertising();
        for (Advertisement ad : new ArrayList<>(advertisements)) removeAdvertisement(ad);
        watchers.clear();
        control.removeCallbacks(repeatSearch);
        closeSockets();
        while (lock != null && lock.isHeld()) lock.release();
        closed = true;
    }
}
