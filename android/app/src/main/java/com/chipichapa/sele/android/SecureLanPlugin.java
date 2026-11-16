package com.chipichapa.sele.android;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.net.InetSocketAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLParameters;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.drafts.Draft_6455;
import org.java_websocket.handshake.ServerHandshake;

@CapacitorPlugin(name = "SecureLan")
public class SecureLanPlugin extends Plugin {
    private final Map<String, WebSocketClient> sockets = new ConcurrentHashMap<>();
    private final java.util.concurrent.ThreadPoolExecutor probes = new java.util.concurrent.ThreadPoolExecutor(
        2, 2, 0L, java.util.concurrent.TimeUnit.MILLISECONDS,
        new java.util.concurrent.ArrayBlockingQueue<>(4));

    @PluginMethod public void inspect(PluginCall call) {
        try {
            URI uri = PinnedTls.endpoint(call.getString("origin") + "/", "https", "/");
            probes.execute(() -> {
                AtomicReference<String> fingerprint = new AtomicReference<>();
                try (SSLSocket socket = (SSLSocket) PinnedTls.context(null, fingerprint::set).getSocketFactory().createSocket()) {
                    socket.setEnabledProtocols(PinnedTls.protocols(socket.getSupportedProtocols()));
                    socket.connect(new InetSocketAddress(PinnedTls.address(uri.getHost()), uri.getPort() == -1 ? 443 : uri.getPort()), 4000);
                    socket.setSoTimeout(4000);
                    try { socket.startHandshake(); }
                    catch (javax.net.ssl.SSLException expected) {
                        if (fingerprint.get() == null) throw expected;
                    }
                    JSObject result = new JSObject(); result.put("fingerprint", fingerprint.get()); call.resolve(result);
                } catch (Exception error) { call.reject("Cannot inspect the computer certificate. Check that desktop Sele is updated and reachable."); }
            });
        } catch (Exception error) { call.reject("Cannot inspect this Sele connection."); }
    }

    private void event(String id, String type, String data, int code) {
        JSObject result = new JSObject(); result.put("id", id); result.put("type", type);
        if (data != null) result.put("data", data);
        result.put("code", code);
        notifyListeners("socketEvent", result);
    }

    @PluginMethod public void open(PluginCall call) {
        try {
            String id = call.getString("id", "");
            if (!id.matches("[a-f0-9-]{36}") || sockets.size() >= 8 || sockets.containsKey(id))
                throw new IllegalArgumentException("Too many connections.");
            URI uri = PinnedTls.endpoint(call.getString("url"), "wss", "/sele/ws");
            String fingerprint = call.getString("fingerprint");
            javax.net.ssl.SSLContext context = PinnedTls.context(fingerprint, null);
            WebSocketClient client = new WebSocketClient(uri, new Draft_6455(java.util.Collections.emptyList(), 48 * 1024 * 1024),
                    java.util.Collections.singletonMap("Origin", "http://sele.localhost"), 4000) {
                @Override protected void onSetSSLParameters(SSLParameters parameters) {
                    if (sockets.get(id) != this) throw new IllegalStateException("Connection canceled.");
                    // The exact approved certificate verifies identity; LAN hostnames/IPs
                    // are discovery hints, not identities or CA-validated DNS names.
                    parameters.setEndpointIdentificationAlgorithm(null);
                    parameters.setProtocols(PinnedTls.protocols(context.getSupportedSSLParameters().getProtocols()));
                }
                @Override public void onOpen(ServerHandshake response) { event(id, "open", null, 0); }
                @Override public void onMessage(String message) { event(id, "message", message, 0); }
                @Override public void onClose(int code, String reason, boolean remote) {
                    sockets.remove(id, this);
                    try { if (getSocket() != null) getSocket().close(); } catch (java.io.IOException ignored) { }
                    event(id, "close", null, code);
                }
                @Override public void onError(Exception error) {
                    sockets.remove(id, this);
                    // Also release sockets canceled before the TLS handshake/write
                    // thread began; the library may already consider them closed.
                    try { if (getSocket() != null) getSocket().close(); } catch (java.io.IOException ignored) { }
                    boolean certificate = false;
                    for (Throwable cause = error; cause != null; cause = cause.getCause())
                        if (cause instanceof java.security.cert.CertificateException) { certificate = true; break; }
                    event(id, certificate ? "certificateError" : "error", null, certificate ? 4003 : 1006);
                }
            };
            client.setSocketFactory(context.getSocketFactory());
            client.setDnsResolver(endpoint -> PinnedTls.address(endpoint.getHost()));
            client.setConnectionLostTimeout(0); // The shared transport owns foreground probes and retries.
            client.setDaemon(true);
            sockets.put(id, client);
            client.connect();
            call.resolve();
        } catch (Exception error) { call.reject("Cannot open a verified encrypted connection to Sele."); }
    }

    @PluginMethod public void send(PluginCall call) {
        WebSocketClient client = sockets.get(call.getString("id", ""));
        String data = call.getString("data");
        if (client == null || !client.isOpen() || data == null || data.length() > 48 * 1024 * 1024) {
            call.reject("Sele is disconnected or the message is too large."); return;
        }
        try { client.send(data); call.resolve(); }
        catch (RuntimeException error) { call.reject("Unable to send to Sele."); }
    }

    @PluginMethod public void close(PluginCall call) {
        WebSocketClient client = sockets.remove(call.getString("id", ""));
        if (client != null) {
            try { if (client.getSocket() != null) client.getSocket().close(); } catch (java.io.IOException ignored) { }
            client.closeConnection(1000, "Connection closed");
        }
        call.resolve();
    }

    @Override protected void handleOnDestroy() {
        for (WebSocketClient client : sockets.values()) client.closeConnection(1000, "Activity closed");
        sockets.clear(); probes.shutdownNow();
    }
}
