package com.chipichapa.sele.android;

import static org.junit.Assert.*;
import org.junit.Test;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.concurrent.atomic.AtomicReference;

public class PinnedTlsTest {
    private X509Certificate certificate(String name) throws Exception {
        try (java.io.InputStream stream = getClass().getResourceAsStream("/" + name)) {
            return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(stream);
        }
    }

    @Test public void exactPinAcceptsOnlyTheApprovedComputer() throws Exception {
        X509Certificate cert = certificate("computer.pem");
        String pin = PinnedTls.fingerprint(cert);
        assertEquals(64, pin.length());
        PinnedTls.trust(pin, null).checkServerTrusted(new X509Certificate[]{cert}, "EC");
        assertThrows(CertificateException.class, () -> PinnedTls.trust("0".repeat(64), null)
            .checkServerTrusted(new X509Certificate[]{cert}, "EC"));
        assertThrows(IllegalArgumentException.class, () -> PinnedTls.trust(null, null));
        assertThrows(CertificateException.class, () -> PinnedTls.trust(pin, null)
            .checkServerTrusted(new X509Certificate[0], "EC"));
        assertThrows(CertificateException.class, () -> PinnedTls.trust(pin, null)
            .checkClientTrusted(new X509Certificate[]{cert}, "EC"));
    }

    @Test public void inspectionCapturesPublicIdentityButNeverTrustsIt() throws Exception {
        X509Certificate cert = certificate("computer.pem");
        AtomicReference<String> inspected = new AtomicReference<>();
        assertThrows(CertificateException.class, () -> PinnedTls.trust(null, inspected::set)
            .checkServerTrusted(new X509Certificate[]{cert}, "EC"));
        assertEquals(PinnedTls.fingerprint(cert), inspected.get());
    }

    @Test public void expiredPinnedCertificatesAndPlaintextTargetsAreRejected() throws Exception {
        X509Certificate cert = certificate("expired-computer.pem");
        assertThrows(CertificateException.class, () -> PinnedTls.trust(PinnedTls.fingerprint(cert), null)
            .checkServerTrusted(new X509Certificate[]{cert}, "EC"));
        for (String url : new String[]{"ws://127.0.0.1/sele/ws", "wss://user@127.0.0.1/sele/ws",
                "wss://127.0.0.1/sele/ws?redirect=x", "wss://127.0.0.1/sele/ws#x", "wss://127.0.0.1/other"})
            assertThrows(IllegalArgumentException.class, () -> PinnedTls.endpoint(url, "wss", "/sele/ws"));
        assertEquals("127.0.0.1", PinnedTls.address("127.0.0.1").getHostAddress());
        assertThrows(java.net.UnknownHostException.class, () -> PinnedTls.address("8.8.8.8"));
        assertArrayEquals(new String[]{"TLSv1.2"}, PinnedTls.protocols(new String[]{"TLSv1.2"}));
    }
}
