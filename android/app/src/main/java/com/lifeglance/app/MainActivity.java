package com.lifeglance.app;

import android.content.Intent;
import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.lifeglance.app.widget.WidgetData;

public class MainActivity extends BridgeActivity {

    // Extra carrying the milestone id a widget tap wants the app to focus.
    public static final String EXTRA_WIDGET_MILESTONE_ID = "widget_milestone_id";
    // Extra carrying a widget action (e.g. "new" from the quick-add widget).
    public static final String EXTRA_WIDGET_ACTION = "widget_action";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
        handleWidgetIntent(getIntent());
        enableImmersiveMode();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleWidgetIntent(intent);
    }

    // Stash a widget tap's milestone id where the web layer can read it via
    // WidgetBridge.consumeLaunchTarget() once the WebView resumes.
    private void handleWidgetIntent(Intent intent) {
        if (intent == null) return;
        String milestoneId = intent.getStringExtra(EXTRA_WIDGET_MILESTONE_ID);
        String action      = intent.getStringExtra(EXTRA_WIDGET_ACTION);
        if (milestoneId == null && action == null) return;
        var editor = getSharedPreferences(WidgetData.PREFS, MODE_PRIVATE).edit();
        if (milestoneId != null) editor.putString(WidgetData.KEY_PENDING_TARGET, milestoneId);
        if (action != null)      editor.putString(WidgetData.KEY_PENDING_ACTION, action);
        editor.apply();
        intent.removeExtra(EXTRA_WIDGET_MILESTONE_ID);
        intent.removeExtra(EXTRA_WIDGET_ACTION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // System bars reappear after interaction / regaining focus; re-hide them.
        if (hasFocus) enableImmersiveMode();
    }

    // Hide the status and navigation bars for a fullscreen timeline; they slide
    // back in temporarily on an edge swipe, then auto-hide again.
    private void enableImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
