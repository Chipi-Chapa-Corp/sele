package com.chipichapa.sele.android;

import java.net.InetAddress;
import java.net.URI;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** Trust belongs to an approved computer certificate, never its changing LAN IP. */
final class PinnedTls {
    static String[] protocols(String[] supported) {
        for (String protocol : supported) if ("TLSv1.3".equals(protocol)) return new String[]{"TLSv1.3", "TLSv1.2"};
        return new String[]{"TLSv1.2"};
    }
    static String fingerprint(X509Certificate certificate) throws CertificateException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
            StringBuilder result = new StringBuilder();
            for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
            return result.toString();
        } catch (java.security.GeneralSecurityException error) { throw new CertificateException(error); }
    }

    static URI endpoint(String value, String scheme, String path) {
        URI uri = URI.create(value == null ? "" : value);
        if (!scheme.equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null ||
            uri.getRawQuery() != null || uri.getRawFragment() != null ||
            !path.equals(uri.getPath()) || uri.getPort() == 0 || uri.getPort() > 65535)
            throw new IllegalArgumentException("Use an encrypted Sele connection on your local network.");
        return uri;
    }

    static InetAddress address(String host) throws java.net.UnknownHostException {
        InetAddress[] addresses = InetAddress.getAllByName(host);
        for (InetAddress address : addresses) {
            byte[] bytes = address.getAddress();
            boolean uniqueLocal = bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc;
            if (!(address.isLoopbackAddress() || address.isSiteLocalAddress() || address.isLinkLocalAddress() || uniqueLocal))
                throw new java.net.UnknownHostException("Sele requires a local network address.");
        }
        if (addresses.length == 0) throw new java.net.UnknownHostException(host);
        return addresses[0];
    }

    static X509TrustManager trust(String expected, java.util.function.Consumer<String> inspected) {
        if (inspected == null && (expected == null || !expected.matches("[a-f0-9]{64}")))
            throw new IllegalArgumentException("Pair this computer again to verify its certificate.");
        return new X509TrustManager() {
            @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            @Override public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                throw new CertificateException("Client certificates are not accepted.");
            }
            @Override public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                if (chain == null || chain.length == 0) throw new CertificateException("Missing computer certificate.");
                chain[0].checkValidity();
                String actual = fingerprint(chain[0]);
                if (inspected != null) {
                    inspected.accept(actual);
                    // Inspection never trusts the connection or sends application data.
                    throw new CertificateException("Certificate inspected; approval is required.");
                }
                if (!MessageDigest.isEqual(actual.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                        expected.getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
                    throw new CertificateException("The computer certificate changed. Pair it again and compare the security code.");
            }
        };
    }

    static SSLContext context(String expected, java.util.function.Consumer<String> inspected) throws java.security.GeneralSecurityException {
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[]{trust(expected, inspected)}, null);
        return context;
    }
}
