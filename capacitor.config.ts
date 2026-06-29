import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lifeglance',
  appName: 'lifeGLANCE',
  webDir: 'dist',
  plugins: {
    // Route fetch/XHR through the native HTTP stack so cross-origin GLANCEvault
    // sync works inside the native WebView without a CORS proxy. This makes the
    // package's INTERNAL vault client (inside createDbSyncEngine, which we do not
    // inject a fetchImpl into) native-safe. The WebDAV and intents transports
    // already use the explicit CapacitorHttp path (electronProxyFetch /
    // nativeWebdavResponse), so this patch is additive for them; on web the patch
    // is inactive and global fetch is used unchanged.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
