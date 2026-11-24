package com.chipichapa.sele.android;

import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.json.JSONException;

/** A broadcast query can reach peers when a router filters multicast DNS. */
final class LanBroadcastDiscovery implements AutoCloseable {
    private static final int PORT = 4589;
    private static final int PACKET_SIZE = 512;
    private final DatagramSocket socket;
    private final Thread worker;
    private final Map<String, SeenComputer> seen = new HashMap<>();

    private static final class SeenComputer {
        final JSObject computer;
        final long expiresAt = SystemClock.elapsedRealtime() + 15000;

        SeenComputer(JSObject computer) { this.computer = computer; }
    }

    LanBroadcastDiscovery(ConnectivityManager connectivity) throws IOException {
        socket = new DatagramSocket(null);
        try {
            socket.setBroadcast(true);
            socket.bind(new InetSocketAddress(0));
        } catch (IOException | RuntimeException error) {
            socket.close();
            throw error;
        }
        worker = new Thread(() -> discover(connectivity), "Sele LAN discovery");
        worker.setDaemon(true);
        worker.start();
    }

    private void discover(ConnectivityManager connectivity) {
        while (!socket.isClosed()) {
            try {
                Network active = connectivity.getActiveNetwork();
                LinkProperties link = active == null ? null : connectivity.getLinkProperties(active);
                String interfaceName = link == null ? null : link.getInterfaceName();
                if (interfaceName != null) {
                    NetworkInterface adapter = NetworkInterface.getByName(interfaceName);
                    if (adapter != null) query(adapter.getInterfaceAddresses());
                }
            } catch (IOException | SecurityException error) {
                if (!socket.isClosed()) android.util.Log.w("SeleDiscovery", "Broadcast query failed", error);
            }
            try { Thread.sleep(5000); }
            catch (InterruptedException stopped) { return; }
        }
    }

    private void query(List<InterfaceAddress> addresses) throws IOException {
        String nonce = UUID.randomUUID().toString().replace("-", "");
        byte[] request = new byte[PACKET_SIZE];
        Arrays.fill(request, (byte) ' ');
        byte[] header = ("SELE-DISCOVER-1 " + nonce).getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(header, 0, request, 0, header.length);
        boolean sent = false;
        for (InterfaceAddress address : addresses) {
            if (address.getBroadcast() == null) continue;
            socket.send(new DatagramPacket(request, request.length, address.getBroadcast(), PORT));
            sent = true;
        }
        if (!sent) return;

        long deadline = SystemClock.elapsedRealtime() + 800;
        DatagramPacket response = new DatagramPacket(new byte[PACKET_SIZE + 1], PACKET_SIZE + 1);
        for (int received = 0; received < 64; received++) {
            long remaining = deadline - SystemClock.elapsedRealtime();
            if (remaining <= 0) return;
            socket.setSoTimeout((int) remaining);
            response.setLength(response.getData().length);
            try { socket.receive(response); }
            catch (SocketTimeoutException done) { return; }
            addResponse(response, nonce);
        }
    }

    private synchronized void addResponse(DatagramPacket packet, String nonce) {
        InetAddress address = packet.getAddress();
        if (packet.getPort() != PORT || packet.getLength() > PACKET_SIZE || !(address instanceof Inet4Address) ||
            !(address.isSiteLocalAddress() || address.isLinkLocalAddress())) return;
        try {
            JSObject reply = new JSObject(new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8));
            String id = reply.getString("id", "");
            String name = reply.getString("name", "");
            int port = reply.optInt("port", 0);
            if (!nonce.equals(reply.getString("nonce")) || !id.matches("[a-f0-9-]{36}") ||
                name.isEmpty() || name.length() > 80 || port < 1024 || port > 65535) return;
            String origin = "https://" + address.getHostAddress() + ":" + port;
            JSObject computer = new JSObject();
            computer.put("id", id);
            computer.put("name", name);
            computer.put("origin", origin);
            seen.put(id + " " + origin, new SeenComputer(computer));
        } catch (JSONException ignored) { }
    }

    synchronized void appendServices(com.getcapacitor.JSArray result) {
        long now = SystemClock.elapsedRealtime();
        seen.values().removeIf(entry -> entry.expiresAt <= now);
        for (SeenComputer entry : seen.values()) result.put(entry.computer);
    }

    @Override public void close() {
        socket.close();
        worker.interrupt();
    }
}
