package com.lifeglance.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.lifeglance.app.widget.WidgetData;
import com.lifeglance.app.widget.WidgetRefreshWorker;

/**
 * Bridge between the web app (IndexedDB, unreachable from the widget process) and
 * the native home-screen widgets. The web layer pushes a render-ready snapshot which
 * is persisted to SharedPreferences and read by the widgets.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @Override
    public void load() {
        // Make sure the daily midnight refresh is scheduled whenever the app runs.
        WidgetRefreshWorker.Companion.schedule(getContext());
    }

    // Persists the snapshot JSON and refreshes any placed widgets immediately.
    @PluginMethod
    public void updateSnapshot(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("Missing 'json'");
            return;
        }
        Context ctx = getContext();
        ctx.getSharedPreferences(WidgetData.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(WidgetData.KEY_SNAPSHOT, json)
            .apply();
        WidgetData.refreshAll(ctx);
        call.resolve();
    }

    // Returns and clears a pending deep-link target left by a widget tap.
    @PluginMethod
    public void consumeLaunchTarget(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(WidgetData.PREFS, Context.MODE_PRIVATE);
        String target = prefs.getString(WidgetData.KEY_PENDING_TARGET, null);
        String action = prefs.getString(WidgetData.KEY_PENDING_ACTION, null);
        if (target != null || action != null) {
            prefs.edit()
                .remove(WidgetData.KEY_PENDING_TARGET)
                .remove(WidgetData.KEY_PENDING_ACTION)
                .apply();
        }
        JSObject ret = new JSObject();
        ret.put("milestoneId", target); // null when nothing is pending
        ret.put("action", action);
        call.resolve(ret);
    }
}
