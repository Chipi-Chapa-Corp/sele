package com.chipichapa.sele.android;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @SuppressWarnings("deprecation")
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalNetworkPlugin.class);
        registerPlugin(MobileBrowserPlugin.class);
        super.onCreate(savedInstanceState);
        android.content.SharedPreferences bars = getSharedPreferences("sele-system-bars", MODE_PRIVATE);
        int color = bars.getInt("color", android.graphics.Color.rgb(245,245,243));
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        getWindow().getDecorView().setBackgroundColor(color);
        if (bridge != null) {
            android.webkit.WebView view = bridge.getWebView();
            view.setBackgroundColor(color);
            if (view.getParent() instanceof android.view.View)
                ((android.view.View) view.getParent()).setBackgroundColor(color);
            androidx.core.view.WindowInsetsControllerCompat icons = androidx.core.view.WindowCompat.getInsetsController(getWindow(), view);
            boolean dark = bars.getBoolean("dark", false);
            icons.setAppearanceLightStatusBars(!dark);
            icons.setAppearanceLightNavigationBars(!dark);
        }
    }

    @Override public void onResume() {
        super.onResume();
        // Capacitor reapplies its default DecorView background on resume.
        // Restore our palette in this same frame, including after browser/file activities.
        if (bridge != null && bridge.getPlugin("LocalNetwork") != null)
            ((LocalNetworkPlugin) bridge.getPlugin("LocalNetwork").getInstance()).restoreSystemBars();
    }

    @Override public void onConfigurationChanged(android.content.res.Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (bridge != null && bridge.getPlugin("LocalNetwork") != null)
            ((LocalNetworkPlugin) bridge.getPlugin("LocalNetwork").getInstance()).restoreSystemBars();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        if (bridge != null && bridge.getPlugin("MobileBrowser") != null &&
            ((MobileBrowserPlugin) bridge.getPlugin("MobileBrowser").getInstance()).fileResult(requestCode, resultCode, data)) return;
        super.onActivityResult(requestCode, resultCode, data);
    }
}
