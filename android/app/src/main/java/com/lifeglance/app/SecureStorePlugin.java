package com.lifeglance.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// Keystore-backed secret storage for sync/vault/intents credentials. Values
// are AES-GCM ciphertext in a private SharedPreferences file; the AES key
// lives in the Android Keystore (non-exportable, hardware-backed where the
// device supports it), so the ciphertext is useless off-device. That failure
// mode is deliberate: prefs restored or transferred to another device won't
// decrypt, get() reports the entry as absent, and the app asks the user to
// re-enter credentials rather than failing cryptically.
//
// Ported from lastGLANCE's SecureStorePlugin.java (issue #210 there); keep
// the two in sync when fixing bugs in either.
//
// Registered in MainActivity; consumed by src/native/secureStore.js, which
// leaves callers on their existing storage where the plugin is absent.
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {

    private static final String PREFS = "lifeglance_secure_store";
    private static final String KEY_ALIAS = "lifeglance_secure_store";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    // GCM with the Keystore-generated IV, 128-bit tag. Stored value format is
    // "v1:" + base64(iv) + ":" + base64(ciphertext).
    private static final int GCM_TAG_BITS = 128;
    private static final String FORMAT_PREFIX = "v1:";

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("missing key");
            return;
        }
        String stored = prefs().getString(key, null);
        JSObject ret = new JSObject();
        if (stored == null) {
            ret.put("value", (String) null);
            call.resolve(ret);
            return;
        }
        String plain = decrypt(stored);
        if (plain == null) {
            // Undecryptable (restored ciphertext, invalidated key). The Keystore
            // key is non-exportable, so this can never recover — drop the entry
            // so the caller sees a clean "absent" and a later set() starts fresh.
            prefs().edit().remove(key).apply();
        }
        ret.put("value", plain);
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || key.isEmpty() || value == null) {
            call.reject("missing key or value");
            return;
        }
        String stored = encrypt(value);
        if (stored == null) {
            // One retry with a fresh key covers the rare corrupted-alias state
            // (e.g. a partially restored Keystore). Existing entries were already
            // undecryptable in that state, so rotating the key loses nothing.
            deleteKeyQuietly();
            stored = encrypt(value);
        }
        if (stored == null) {
            call.reject("encrypt failed");
            return;
        }
        prefs().edit().putString(key, stored).apply();
        call.resolve();
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("missing key");
            return;
        }
        prefs().edit().remove(key).apply();
        call.resolve();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── Keystore-backed AES-GCM ───────────────────────────────────────────────

    private String encrypt(String plaintext) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            // The Keystore must generate the IV: keys are created with
            // randomized encryption required (the secure default), and passing
            // a caller-provided IV at encrypt time throws
            // InvalidAlgorithmParameterException ("Caller-provided IV not
            // permitted") — which made every set() fail and presented as wiped
            // sync settings in lastGLANCE's 2.1.0 release candidate.
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] iv = cipher.getIV();
            byte[] ct = cipher.doFinal(plaintext.getBytes("UTF-8"));
            return FORMAT_PREFIX
                + Base64.encodeToString(iv, Base64.NO_WRAP)
                + ":"
                + Base64.encodeToString(ct, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    private String decrypt(String stored) {
        try {
            if (!stored.startsWith(FORMAT_PREFIX)) return null;
            String[] parts = stored.substring(FORMAT_PREFIX.length()).split(":", 2);
            if (parts.length != 2) return null;
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ct = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new String(cipher.doFinal(ct), "UTF-8");
        } catch (Exception e) {
            // Bad tag / invalidated or missing key / malformed entry — all map to
            // "absent" (see get()).
            return null;
        }
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // No user-auth binding: these credentials are read at boot for
            // background-capable sync, before any biometric prompt could show.
            .build());
        return kg.generateKey();
    }

    private void deleteKeyQuietly() {
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            ks.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
        }
    }
}
