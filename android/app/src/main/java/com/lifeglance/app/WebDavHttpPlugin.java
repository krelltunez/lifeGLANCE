package com.lifeglance.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * OkHttp-backed HTTP for the WebDAV verbs (PROPFIND, MKCOL, …) that Android's
 * HttpURLConnection — the backend behind CapacitorHttp — rejects with
 * ProtocolException ("Invalid HTTP method"). OkHttp accepts arbitrary methods.
 *
 * Routed from src/sync/nativeHttp.js for non-core verbs on Android only; iOS's
 * URLSession accepts arbitrary verbs and needs no equivalent. See lastGLANCE
 * issue #233 and docs/android-webdav-audit.md.
 *
 * Contract (mirrors the CapacitorHttp response shape nativeRequest consumes):
 *   request({ method, url, headers, data }) -> { status, headers: {..}, data: string }
 */
@CapacitorPlugin(name = "WebDavHttp")
public class WebDavHttpPlugin extends Plugin {

    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build();

    @PluginMethod
    public void request(PluginCall call) {
        String method = call.getString("method");
        String url = call.getString("url");
        if (method == null || url == null) {
            call.reject("method and url are required");
            return;
        }
        String data = call.getString("data", "");

        Headers.Builder headerBuilder = new Headers.Builder();
        String contentType = "application/octet-stream";
        JSObject headers = call.getObject("headers");
        if (headers != null) {
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = headers.optString(key, null);
                if (value == null) continue;
                headerBuilder.add(key, value);
                if ("content-type".equalsIgnoreCase(key)) contentType = value;
            }
        }

        // OkHttp requires a (possibly empty) body for methods that expect one and
        // forbids one on GET/HEAD. PROPFIND carries an XML body; MKCOL has none.
        RequestBody requestBody = null;
        boolean bodyForbidden = "GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method);
        if (!bodyForbidden) {
            if (data != null && data.length() > 0) {
                requestBody = RequestBody.create(data, MediaType.parse(contentType));
            } else if (requiresBody(method)) {
                requestBody = RequestBody.create(new byte[0], null);
            }
        }

        Request request = new Request.Builder()
                .url(url)
                .method(method, requestBody)
                .headers(headerBuilder.build())
                .build();

        try (Response response = client.newCall(request).execute()) {
            JSObject responseHeaders = new JSObject();
            Headers rh = response.headers();
            for (int i = 0; i < rh.size(); i++) {
                responseHeaders.put(rh.name(i), rh.value(i));
            }
            ResponseBody rb = response.body();
            String responseText = rb != null ? rb.string() : "";

            JSObject ret = new JSObject();
            ret.put("status", response.code());
            ret.put("headers", responseHeaders);
            ret.put("data", responseText);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("WebDAV request failed: " + e.getMessage(), e);
        }
    }

    private boolean requiresBody(String method) {
        return "POST".equalsIgnoreCase(method)
                || "PUT".equalsIgnoreCase(method)
                || "PATCH".equalsIgnoreCase(method)
                || "PROPPATCH".equalsIgnoreCase(method);
    }
}
