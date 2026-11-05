package com.chipichapa.sele.android;

import static org.junit.Assert.assertTrue;
import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
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
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NsdManager manager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        String identity = "f1a00000-1234-1234-1234-123456789012";
        NsdServiceInfo service = new NsdServiceInfo();
        service.setServiceName("Sele on emulator discovery fixture");
        service.setServiceType("_sele._tcp.");
        service.setPort(12345);
        service.setAttribute("id", identity);
        service.setAttribute("name", "My Sele computer");
        CountDownLatch registered = new CountDownLatch(1);
        AtomicReference<String> registrationError = new AtomicReference<>("");
        NsdManager.RegistrationListener registration = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo info) { registered.countDown(); }
            @Override public void onRegistrationFailed(NsdServiceInfo info, int code) { registrationError.set("Registration failed: " + code); registered.countDown(); }
            @Override public void onServiceUnregistered(NsdServiceInfo info) {}
            @Override public void onUnregistrationFailed(NsdServiceInfo info, int code) { android.util.Log.w("SeleTest", "Unregister failed: " + code); }
        };
        manager.registerService(service, NsdManager.PROTOCOL_DNS_SD, registration);
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            assertTrue("Fixture registered", registered.await(20, TimeUnit.SECONDS));
            assertTrue(registrationError.get(), registrationError.get().isEmpty());
            long deadline = System.currentTimeMillis() + 30000;
            boolean started = false;
            String result = "";
            while (System.currentTimeMillis() < deadline) {
                if (!started && evaluate(activity, "typeof window.Capacitor?.nativePromise === 'function'").equals("true")) {
                    evaluate(activity, "Capacitor.nativePromise('LocalNetwork','startDiscovery',{}).catch(error=>window.__nsdError=String(error)); true");
                    started = true;
                }
                if (started) {
                    evaluate(activity, "Capacitor.nativePromise('LocalNetwork','getServices',{}).then(value=>window.__nsdResult=JSON.stringify(value)).catch(error=>window.__nsdError=String(error)); true");
                    result = evaluate(activity, "window.__nsdResult || window.__nsdError || ''");
                    if (result.contains(identity) && result.contains(":12345")) break;
                }
                Thread.sleep(200);
            }
            assertTrue("Native plugin discovered and resolved the fixture: " + result, result.contains(identity) && result.contains(":12345"));
            assertTrue("Discovery displays the advertised friendly computer name", result.contains("My Sele computer"));
            evaluate(activity, "Capacitor.nativePromise('LocalNetwork','stopDiscovery',{}); true");
        } finally { manager.unregisterService(registration); }
    }
}
