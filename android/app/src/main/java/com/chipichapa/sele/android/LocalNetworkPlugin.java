package com.chipichapa.sele.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.app.Activity;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.UUID;

@CapacitorPlugin(name = "LocalNetwork")
public class LocalNetworkPlugin extends Plugin {
    private android.animation.ValueAnimator barAnimation;
    private int barColor = android.graphics.Color.rgb(245, 245, 243);
    private boolean barsDimmed;
    private boolean imeVisible;
    private long imeHiddenAt;

    @Override public void load() {
        getActivity().runOnUiThread(() -> getActivity().getWindow().getDecorView().getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            androidx.core.view.WindowInsetsCompat insets = androidx.core.view.ViewCompat.getRootWindowInsets(bridge.getWebView());
            boolean visible = insets != null && insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime());
            if (imeVisible && !visible) imeHiddenAt = android.os.SystemClock.elapsedRealtime();
            imeVisible = visible;
        }));
    }

    @PluginMethod public void consumeKeyboardBack(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            androidx.core.view.WindowInsetsCompat insets = androidx.core.view.ViewCompat.getRootWindowInsets(bridge.getWebView());
            boolean visible = insets != null && insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime());
            boolean wasVisible = imeVisible;
            if (wasVisible && !visible) { imeVisible = false; imeHiddenAt = android.os.SystemClock.elapsedRealtime(); }
            boolean consumed = visible || wasVisible || android.os.SystemClock.elapsedRealtime() - imeHiddenAt < 350;
            if (visible) androidx.core.view.WindowCompat.getInsetsController(getActivity().getWindow(), bridge.getWebView()).hide(androidx.core.view.WindowInsetsCompat.Type.ime());
            JSObject result = new JSObject(); result.put("consumed", consumed); call.resolve(result);
        });
    }

    void restoreSystemBars() {
        SharedPreferences saved = getContext().getSharedPreferences("sele-system-bars", Context.MODE_PRIVATE);
        int base = saved.getInt("color", android.graphics.Color.rgb(245,245,243));
        int target = barsDimmed ? androidx.core.graphics.ColorUtils.blendARGB(base, android.graphics.Color.rgb(22,18,12), .4f) : base;
        if (barAnimation != null) barAnimation.cancel();
        paintSystemBars(target);
        boolean dark = saved.getBoolean("dark", false);
        androidx.core.view.WindowInsetsControllerCompat icons = androidx.core.view.WindowCompat.getInsetsController(getActivity().getWindow(), bridge.getWebView());
        icons.setAppearanceLightStatusBars(!dark);
        icons.setAppearanceLightNavigationBars(!dark);
    }

    @SuppressWarnings("deprecation")
    private void paintSystemBars(int color) {
        barColor = color;
        android.view.Window window = getActivity().getWindow();
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
        window.getDecorView().setBackgroundColor(color);
        bridge.getWebView().setBackgroundColor(color);
        if (bridge.getWebView().getParent() instanceof android.view.View)
            ((android.view.View) bridge.getWebView().getParent()).setBackgroundColor(color);
    }

    @PluginMethod
    public void setSystemBars(PluginCall call) {
        String value = call.getString("color", "");
        if (!value.matches("#[0-9a-fA-F]{6}")) { call.reject("Invalid shell color."); return; }
        int base = android.graphics.Color.parseColor(value);
        boolean dark = call.getBoolean("dark", false);
        boolean dimmed = call.getBoolean("dimmed", false);
        // Same rgba(22, 18, 12, .4) scrim as the drawer's web backdrop.
        int target = dimmed ? androidx.core.graphics.ColorUtils.blendARGB(base, android.graphics.Color.rgb(22,18,12), .4f) : base;
        getActivity().runOnUiThread(() -> {
            androidx.core.view.WindowInsetsControllerCompat icons = androidx.core.view.WindowCompat.getInsetsController(getActivity().getWindow(), bridge.getWebView());
            icons.setAppearanceLightStatusBars(!dark);
            icons.setAppearanceLightNavigationBars(!dark);
            if (barAnimation != null) barAnimation.cancel();
            if (barsDimmed != dimmed) {
                barAnimation = android.animation.ValueAnimator.ofArgb(barColor, target);
                barAnimation.setDuration(180);
                barAnimation.setInterpolator(new android.view.animation.PathInterpolator(.25f,.1f,.25f,1f));
                barAnimation.addUpdateListener(animation -> paintSystemBars((Integer) animation.getAnimatedValue()));
                barAnimation.start();
            } else paintSystemBars(target);
            barsDimmed = dimmed;
            getContext().getSharedPreferences("sele-system-bars", Context.MODE_PRIVATE).edit().putInt("color", base).putBoolean("dark", dark).apply();
            call.resolve();
        });
    }

    @PluginMethod
    public void showKeyboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            android.webkit.WebView view = bridge.getWebView();
            view.requestFocus();
            view.post(() -> {
                android.view.inputmethod.InputMethodManager manager = (android.view.inputmethod.InputMethodManager)
                    getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
                manager.showSoftInput(view, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
                call.resolve();
            });
        });
    }
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || name.length() > 255 || data == null || data.length() > 90 * 1024 * 1024) {
            call.reject("Invalid file download."); return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("type", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "fileSaved");
    }

    @ActivityCallback
    private void fileSaved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject canceled = new JSObject(); canceled.put("path", null); call.resolve(canceled); return;
        }
        android.net.Uri uri = result.getData().getData();
        bridge.execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new java.io.IOException("The selected file is unavailable.");
                output.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
                JSObject saved = new JSObject(); saved.put("path", uri.toString());
                getActivity().runOnUiThread(() -> call.resolve(saved));
            } catch (Exception error) {
                getActivity().runOnUiThread(() -> call.reject("Unable to save this file. Choose another location.", error));
            }
        });
    }
    @PluginMethod
    public void readStorage(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences("sele-storage", Context.MODE_PRIVATE);
        JSObject values = new JSObject();
        for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
            if (entry.getValue() instanceof String) values.put(entry.getKey(), entry.getValue());
        }
        JSObject result = new JSObject();
        result.put("values", values);
        // Capacitor updates its WebMessage reply proxy after dispatching the
        // plugin call. Resolve on the UI queue so the first call after reload
        // cannot reply through the previous document's proxy.
        getActivity().runOnUiThread(() -> call.resolve(result));
    }

    @PluginMethod
    public void writeStorage(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.length() > 4096) { call.reject("Invalid storage key."); return; }
        String value = call.getString("value");
        SharedPreferences.Editor editor = getContext().getSharedPreferences("sele-storage", Context.MODE_PRIVATE).edit();
        if (value == null) editor.remove(key); else editor.putString(key, value);
        boolean committed = editor.commit();
        getActivity().runOnUiThread(() -> {
            if (committed) call.resolve(); else call.reject("Unable to save Sele data on this device.");
        });
    }
    private NsdManager manager;
    private NsdManager.DiscoveryListener discovery;
    private final Map<String, JSObject> services = new HashMap<>();
    private final ArrayDeque<NsdServiceInfo> resolveQueue = new ArrayDeque<>();
    private final HashSet<String> present = new HashSet<>();
    private boolean resolving;
    private int generation;
    private String discoveryError;

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences("sele-device", Context.MODE_PRIVATE);
        String id = preferences.getString("id", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            preferences.edit().putString("id", id).apply();
        }
        JSObject info = new JSObject();
        info.put("id", id);
        info.put("name", Build.MODEL);
        getActivity().runOnUiThread(() -> call.resolve(info));
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (discovery != null) { call.resolve(); return; }
            manager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
            discoveryError = null;
            final int run = ++generation;
            discovery = new NsdManager.DiscoveryListener() {
                @Override public void onDiscoveryStarted(String type) {}
                @Override public void onDiscoveryStopped(String type) {}
                @Override public void onStartDiscoveryFailed(String type, int code) {
                    getActivity().runOnUiThread(() -> {
                        if (run == generation) {
                            discoveryError = "Nearby discovery could not start. Check Wi-Fi and try again.";
                            stop();
                        }
                    });
                }
                @Override public void onStopDiscoveryFailed(String type, int code) {
                    android.util.Log.w("SeleDiscovery", "Stop failed: " + code);
                }
                @Override public void onServiceFound(NsdServiceInfo service) {
                    getActivity().runOnUiThread(() -> {
                        if (run != generation || !service.getServiceType().startsWith("_sele._tcp")) return;
                        present.add(service.getServiceName());
                        resolveQueue.add(service);
                        resolveNext(run);
                    });
                }
                @Override public void onServiceLost(NsdServiceInfo service) {
                    getActivity().runOnUiThread(() -> {
                        if (run != generation) return;
                        present.remove(service.getServiceName());
                        services.remove(service.getServiceName());
                    });
                }
            };
            try {
                manager.discoverServices("_sele._tcp.", NsdManager.PROTOCOL_DNS_SD, discovery);
                call.resolve();
            } catch (RuntimeException error) {
                discovery = null;
                call.reject("Unable to discover nearby Sele computers.", error);
            }
        });
    }

    @SuppressWarnings("deprecation")
    private void resolveNext(int run) {
        if (resolving || run != generation || resolveQueue.isEmpty()) return;
        NsdServiceInfo service = resolveQueue.remove();
        resolving = true;
        try {
            manager.resolveService(service, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo value, int code) {
                    getActivity().runOnUiThread(() -> {
                        if (run != generation) return;
                        android.util.Log.w("SeleDiscovery", "Resolve failed: " + code);
                        resolving = false;
                        resolveNext(run);
                    });
                }
                @Override public void onServiceResolved(NsdServiceInfo value) {
                    getActivity().runOnUiThread(() -> {
                        if (run != generation) return;
                        InetAddress address = value.getHost();
                        if (Build.VERSION.SDK_INT >= 34) {
                            for (InetAddress candidate : value.getHostAddresses()) {
                                if (candidate instanceof Inet4Address) { address = candidate; break; }
                            }
                        }
                        if (address != null && present.contains(value.getServiceName())) {
                            String host = address.getHostAddress();
                            if (host.contains(":")) host = "[" + host + "]";
                            JSObject result = new JSObject();
                            byte[] identity = value.getAttributes().get("id");
                            result.put("id", identity == null ? value.getServiceName() : new String(identity, StandardCharsets.UTF_8));
                            byte[] advertisedName = value.getAttributes().get("name");
                            String displayName = advertisedName == null ? "" : new String(advertisedName, StandardCharsets.UTF_8).trim();
                            result.put("name", displayName.isEmpty() || displayName.length() > 80
                                ? value.getServiceName().replaceFirst("^Sele on ", "") : displayName);
                            result.put("origin", "http://" + host + ":" + value.getPort());
                            services.put(value.getServiceName(), result);
                        }
                        resolving = false;
                        resolveNext(run);
                    });
                }
            });
        } catch (RuntimeException error) {
            android.util.Log.w("SeleDiscovery", "Resolve failed", error);
            resolving = false;
            resolveNext(run);
        }
    }

    @PluginMethod
    public void getServices(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            JSArray list = new JSArray();
            for (JSObject service : services.values()) list.put(service);
            result.put("services", list);
            result.put("error", discoveryError);
            call.resolve(result);
        });
    }

    private void stop() {
        generation++;
        if (discovery != null && manager != null) {
            try { manager.stopServiceDiscovery(discovery); }
            catch (IllegalArgumentException error) { android.util.Log.w("SeleDiscovery", "Already stopped", error); }
        }
        discovery = null;
        resolving = false;
        services.clear();
        present.clear();
        resolveQueue.clear();
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        getActivity().runOnUiThread(() -> { stop(); call.resolve(); });
    }

    @Override protected void handleOnDestroy() { stop(); }
}
