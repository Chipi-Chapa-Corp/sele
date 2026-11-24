package com.chipichapa.sele.android;

import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.lang.reflect.Field;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Tests Android NSD itself inside the emulator's network. Host multicast does
 * not cross the emulator NAT, so desktop advertisements are checked separately. */
@RunWith(AndroidJUnit4.class)
public class LocalDiscoveryTest {
    private String evaluate(ActivityScenario<MainActivity> activity, String script) throws Exception {
        CountDownLatch returned = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>("");
        activity.onActivity(instance -> instance.getBridge().getWebView().evaluateJavascript(script, result -> {
            value.set(result);
            returned.countDown();
        }));
        assertTrue("WebView evaluation completed", returned.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    @Test public void storageRespondsAfterRepeatedWebViewReloads() throws Exception {
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            for (int reload = 0; reload < 12; reload++) {
                evaluate(activity, "window.__previousReloadDocument=true;true");
                activity.onActivity(instance -> instance.getBridge().getWebView().reload());
                long deadline = System.currentTimeMillis() + 15000;
                boolean requested = false;
                boolean returned = false;
                while (System.currentTimeMillis() < deadline) {
                    if (!requested && evaluate(activity, "!window.__previousReloadDocument && typeof window.Capacitor?.nativePromise === 'function'").equals("true")) {
                        evaluate(activity, "window.__storageReloadReturned=false; Capacitor.nativePromise('LocalNetwork','readStorage',{}).then(value=>window.__storageReloadReturned=Boolean(value.values));true");
                        requested = true;
                    }
                    if (requested && evaluate(activity, "window.__storageReloadReturned===true").equals("true")) {
                        returned = true;
                        break;
                    }
                    Thread.sleep(100);
                }
                assertTrue("Native storage returned after reload " + reload, returned);
            }
        }
    }

    @Test public void discoversNativeSeleServiceAndItsStableIdentity() throws Exception {
        checkDiscovery(false);
    }

    @Test public void retriesAddressLookupAfterAServiceAppears() throws Exception {
        checkDiscovery(true);
    }

    @Test public void discoversAComputerThatOnlyAnswersBroadcast() throws Exception {
        String identity = UUID.randomUUID().toString();
        try (DatagramSocket fixture = new DatagramSocket(4589);
             ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            fixture.setSoTimeout(12000);
            DatagramPacket query = new DatagramPacket(new byte[513], 513);
            fixture.receive(query);
            assertTrue("Received a Sele broadcast query", query.getLength() == 512);
            String text = new String(query.getData(), query.getOffset(), query.getLength(), StandardCharsets.US_ASCII);
            assertTrue(text.startsWith("SELE-DISCOVER-1 "));
            String nonce = text.substring(16, 48);
            byte[] response = ("{\"nonce\":\"" + nonce + "\",\"id\":\"" + identity
                + "\",\"name\":\"Broadcast fixture\",\"port\":12345}").getBytes(StandardCharsets.UTF_8);
            fixture.send(new DatagramPacket(response, response.length, query.getAddress(), query.getPort()));
            long deadline = System.currentTimeMillis() + 5000;
            while (System.currentTimeMillis() < deadline) {
                evaluate(activity, "Capacitor.nativePromise('LocalNetwork','getServices',{}).then(value=>window.__broadcastResult=JSON.stringify(value)); true");
                String result = evaluate(activity, "window.__broadcastResult || ''");
                if (result.contains(identity) && result.contains(":12345")) return;
                Thread.sleep(100);
            }
            throw new AssertionError("Broadcast response was not visible to the device picker");
        }
    }

    private void checkDiscovery(boolean announceBeforeRegistration) throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NsdManager manager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        String identity = UUID.randomUUID().toString();
        NsdServiceInfo service = new NsdServiceInfo();
        service.setServiceName("Sele fixture " + identity);
        service.setServiceType("_sele._tcp.");
        service.setPort(12345);
        service.setAttribute("id", identity);
        service.setAttribute("name", "My Sele computer");
        service.setAttribute("tls", "1");
        CountDownLatch registered = new CountDownLatch(1);
        AtomicReference<String> registrationError = new AtomicReference<>("");
        NsdManager.RegistrationListener registration = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo info) { registered.countDown(); }
            @Override public void onRegistrationFailed(NsdServiceInfo info, int code) { registrationError.set("Registration failed: " + code); registered.countDown(); }
            @Override public void onServiceUnregistered(NsdServiceInfo info) {}
            @Override public void onUnregistrationFailed(NsdServiceInfo info, int code) { android.util.Log.w("SeleTest", "Unregister failed: " + code); }
        };
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            NsdManager.DiscoveryListener initialScan = null;
            if (announceBeforeRegistration) {
                long deadline = System.currentTimeMillis() + 10000;
                while (System.currentTimeMillis() < deadline && initialScan == null) {
                    initialScan = currentScan(activity);
                    if (initialScan == null) Thread.sleep(100);
                }
                assertTrue("Scan is running", initialScan != null);
                // Simulate the PTR announcement arriving before the address can be resolved.
                NsdServiceInfo announcement = new NsdServiceInfo();
                announcement.setServiceType(service.getServiceType());
                announcement.setServiceName(service.getServiceName());
                initialScan.onServiceFound(announcement);
                Thread.sleep(5500); // Let the first address lookup expire before the fixture answers.
            }
            manager.registerService(service, NsdManager.PROTOCOL_DNS_SD, registration);
            try {
                assertTrue("Fixture registered", registered.await(20, TimeUnit.SECONDS));
                assertTrue(registrationError.get(), registrationError.get().isEmpty());
                long deadline = System.currentTimeMillis() + 30000;
                String result = "";
                while (System.currentTimeMillis() < deadline) {
                    evaluate(activity, "Capacitor.nativePromise('LocalNetwork','getServices',{}).then(value=>window.__nsdResult=JSON.stringify(value)).catch(error=>window.__nsdError=String(error)); true");
                    result = evaluate(activity, "window.__nsdResult || window.__nsdError || ''");
                    if (result.contains(identity) && result.contains(":12345")) break;
                    Thread.sleep(200);
                }
                assertTrue("Native plugin discovered and resolved the fixture: " + result, result.contains(identity) && result.contains(":12345"));
                assertTrue("Discovery displays the advertised friendly computer name", result.contains("My Sele computer"));
                if (announceBeforeRegistration) assertSame("Lookup recovered within the original scan", initialScan, currentScan(activity));
            } finally {
                manager.unregisterService(registration);
            }
        }
    }

    private NsdManager.DiscoveryListener currentScan(ActivityScenario<MainActivity> activity) throws Exception {
        Field discovery = LocalNetworkPlugin.class.getDeclaredField("discovery");
        discovery.setAccessible(true);
        AtomicReference<NsdManager.DiscoveryListener> scan = new AtomicReference<>();
        activity.onActivity(instance -> {
            try {
                scan.set((NsdManager.DiscoveryListener) discovery.get(instance.getBridge().getPlugin("LocalNetwork").getInstance()));
            } catch (IllegalAccessException error) {
                throw new AssertionError(error);
            }
        });
        return scan.get();
    }
}
