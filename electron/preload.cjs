// The lifeGLANCE desktop bridge: the one object the page sees, as
// `window.lifeGlanceDesktop` (docs/desktop-app.md, "The bridge"). The page's
// side, and the list of methods, is src/native/desktop.js;
// bridgeContract.test.js holds this file, that one and main.js's IPC handlers
// to the same list.
//
// CommonJS, and it may require only `electron`: the window is sandboxed. Keep
// each group a flat object literal of `name: (...) => ...` entries; the
// contract test reads them from the source.

const { contextBridge, ipcRenderer } = require('electron')

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
  },
  shell: {
    setTheme: (dark) => ipcRenderer.send('shell:set-theme', dark),
    log: (message) => ipcRenderer.send('shell:log', message),
    onWake: (listener) => subscribe('shell:wake', listener),
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
