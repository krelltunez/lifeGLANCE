// The application menu (docs/desktop-app.md, "The window"). Electron's default
// menu carries Help links to electronjs.org and a developer-tools item that
// does nothing in a packaged build, so the app sets its own: the standard
// roles, and one Help item that opens the app's site.
//
// A pure template, tested without Electron. Labels are the roles' own
// (English on Windows and Linux; macOS words several of them itself).
// Translating them is on the list in the doc.

export const HELP_URL = 'https://www.glance-apps.com/lifeglance'

/**
 * @param {object} options
 * @param {string} options.platform  process.platform
 * @param {boolean} options.devTools  false in packaged builds, where DevTools are off
 * @param {(url: string) => void} options.openExternal
 * @param {string} [options.appName]
 * @returns {import('electron').MenuItemConstructorOptions[]}
 */
export function buildApplicationMenuTemplate({ platform, devTools, openExternal, appName = 'lifeGLANCE' }) {
  const isMac = platform === 'darwin'
  return [
    // macOS: the app menu (About, Hide, Quit). Elsewhere Quit lives under File.
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      role: 'fileMenu',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      role: 'viewMenu',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(devTools ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: `${appName} Help`, click: () => openExternal(HELP_URL) }],
    },
  ]
}
