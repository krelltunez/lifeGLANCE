// The lifeGLANCE desktop bridge: the one object the page sees, as
// `window.lifeGlanceDesktop` (docs/desktop-app.md, "The bridge"). Its groups
// mirror the app's existing plugin contracts. The page's side, and the list of
// methods, is src/native/desktop.js; bridgeContract.test.js holds this file,
// that one and the main process's IPC handlers to the same list.
//
// CommonJS, and it may require only `electron`: the window is sandboxed, so it
// decodes the info switch itself rather than importing electron/desktopInfo.js.
// Keep each group a flat object literal of `name: (...) => ...` entries; the
// contract test reads them from the source.

const { contextBridge, ipcRenderer } = require('electron')

const DESKTOP_INFO_ARG = '--lifeglance-desktop-info='

function readInfo() {
  const arg = process.argv.find((a) => a.startsWith(DESKTOP_INFO_ARG))
  try {
    const parsed = JSON.parse(decodeURIComponent((arg ?? '').slice(DESKTOP_INFO_ARG.length)))
    if (typeof parsed?.version === 'string' && typeof parsed?.isMAS === 'boolean' && typeof parsed?.secureStorage === 'boolean') {
      return { version: parsed.version, isMAS: parsed.isMAS, secureStorage: parsed.secureStorage }
    }
  } catch { /* absent or malformed: fall through */ }
  return { version: '', isMAS: false, secureStorage: false }
}

const info = readInfo()

// A main-to-page event as a listener the page can remove: returns the
// unsubscribe function. The IPC event object never reaches the page.
function subscribe(channel, listener) {
  const handler = (_event, payload) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

contextBridge.exposeInMainWorld('lifeGlanceDesktop', {
  info: {
    platform: process.platform,
    version: info.version,
    isMAS: info.isMAS,
    secureStorage: info.secureStorage,
  },
  shell: {
    setTheme: (dark) => ipcRenderer.send('shell:set-theme', dark),
    setMenuLabels: (labels) => ipcRenderer.send('shell:set-menu-labels', labels),
    log: (message) => ipcRenderer.send('shell:log', message),
    latestRelease: () => ipcRenderer.invoke('shell:latest-release'),
    onWake: (listener) => subscribe('shell:wake', listener),
    onFullscreen: (listener) => subscribe('shell:fullscreen', listener),
  },
  http: {
    request: (method, url, headers, body, options) => ipcRenderer.invoke('http:request', method, url, headers, body, options),
    inspect: (url) => ipcRenderer.invoke('http:inspect', url),
    grant: (url, labels) => ipcRenderer.invoke('http:grant', url, labels),
    grants: () => ipcRenderer.invoke('http:grants'),
    revoke: (origin) => ipcRenderer.invoke('http:revoke', origin),
  },
  vaultSse: {
    start: (options) => ipcRenderer.invoke('vault-sse:start', options),
    stop: () => ipcRenderer.invoke('vault-sse:stop'),
    onMessage: (listener) => subscribe('vault-sse:message', listener),
  },
  secureStore: {
    get: (options) => ipcRenderer.invoke('secure-store:get', options.key),
    set: (options) => ipcRenderer.invoke('secure-store:set', options.key, options.value),
    delete: (options) => ipcRenderer.invoke('secure-store:delete', options.key),
  },
  directAccess: {
    status: () => ipcRenderer.invoke('direct-access:status'),
    pickFolder: () => ipcRenderer.invoke('direct-access:pick-folder'),
    disconnect: () => ipcRenderer.invoke('direct-access:disconnect'),
    read: () => ipcRenderer.invoke('direct-access:read'),
    write: (options) => ipcRenderer.invoke('direct-access:write', options),
    deleteFile: () => ipcRenderer.invoke('direct-access:delete'),
    listFiles: (options) => ipcRenderer.invoke('direct-access:list-files', options),
    readFile: (options) => ipcRenderer.invoke('direct-access:read-file', options),
    writeFile: (options) => ipcRenderer.invoke('direct-access:write-file', options),
    deleteFileAt: (options) => ipcRenderer.invoke('direct-access:delete-file', options),
    makeDir: (options) => ipcRenderer.invoke('direct-access:make-dir', options),
    onChanged: (listener) => subscribe('direct-access:changed', listener),
  },
  icloud: {
    available: () => ipcRenderer.invoke('icloud:available'),
    readFile: (options) => ipcRenderer.invoke('icloud:read-file', options),
    writeFile: (options) => ipcRenderer.invoke('icloud:write-file', options),
    listFiles: (options) => ipcRenderer.invoke('icloud:list-files', options),
    deleteFile: (options) => ipcRenderer.invoke('icloud:delete-file', options),
    makeDir: (options) => ipcRenderer.invoke('icloud:make-dir', options),
    onChanged: (listener) => subscribe('icloud:changed', listener),
  },
})
