// The application menu (docs/desktop-app.md, "The window"). Electron's default
// menu carries Help links to electronjs.org and a developer-tools item that
// does nothing in a packaged build, so the app sets its own: the standard
// items, and one Help item that opens the app's site.
//
// It speaks the app's language: the page pushes the `menu` block of its
// desktop strings (src/locales/<lng>/desktop.json, src/native/desktop.js), on
// every platform, since Electron's own role labels are English everywhere.
// Until a complete set arrives the menu is in English. After lastGLANCE's
// electron/applicationMenu.ts.
//
// A pure template, tested without Electron.

export const HELP_URL = 'https://www.glance-apps.com/apps/lifeglance'

/** English, and the list of keys: held equal to en/desktop.json by a test. */
export const DEFAULT_MENU_LABELS = Object.freeze({
  file: 'File',
  edit: 'Edit',
  view: 'View',
  window: 'Window',
  quit: 'Quit',
  close: 'Close',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  delete: 'Delete',
  selectAll: 'Select All',
  reload: 'Reload',
  forceReload: 'Force Reload',
  toggleDevTools: 'Toggle Developer Tools',
  resetZoom: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  toggleFullScreen: 'Toggle Full Screen',
  minimize: 'Minimize',
  zoom: 'Zoom',
  about: 'About lifeGLANCE',
  services: 'Services',
  hide: 'Hide lifeGLANCE',
  hideOthers: 'Hide Others',
  showAll: 'Show All',
  front: 'Bring All to Front',
  help: 'lifeGLANCE Help',
})

export const APPLICATION_MENU_LABEL_KEYS = Object.freeze(Object.keys(DEFAULT_MENU_LABELS))

const MAX_LABEL_LENGTH = 80

/** A complete set of short, non-empty strings; anything else leaves the menu as it is. */
export function isApplicationMenuLabels(value) {
  if (!value || typeof value !== 'object') return false
  return APPLICATION_MENU_LABEL_KEYS.every((key) => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= MAX_LABEL_LENGTH)
}

/**
 * @param {object} options
 * @param {string} options.platform  process.platform
 * @param {boolean} options.devTools  false in packaged builds, where DevTools are off
 * @param {(url: string) => void} options.openExternal
 * @param {Record<string, string>} [options.labels]  a complete set (isApplicationMenuLabels), else English
 * @param {string} [options.appName]
 * @returns {import('electron').MenuItemConstructorOptions[]}
 */
export function buildApplicationMenuTemplate({ platform, devTools, openExternal, labels, appName = 'lifeGLANCE' }) {
  const isMac = platform === 'darwin'
  const t = isApplicationMenuLabels(labels) ? labels : DEFAULT_MENU_LABELS
  return [
    // macOS: the app menu (About, Hide, Quit). Elsewhere Quit lives under File.
    ...(isMac ? [{
      label: appName,
      submenu: [
        { label: t.about, role: 'about' },
        { type: 'separator' },
        { label: t.services, role: 'services' },
        { type: 'separator' },
        { label: t.hide, role: 'hide' },
        { label: t.hideOthers, role: 'hideOthers' },
        { label: t.showAll, role: 'unhide' },
        { type: 'separator' },
        { label: t.quit, role: 'quit' },
      ],
    }] : []),
    {
      label: t.file,
      submenu: [isMac ? { label: t.close, role: 'close' } : { label: t.quit, role: 'quit' }],
    },
    {
      label: t.edit,
      submenu: [
        { label: t.undo, role: 'undo' },
        { label: t.redo, role: 'redo' },
        { type: 'separator' },
        { label: t.cut, role: 'cut' },
        { label: t.copy, role: 'copy' },
        { label: t.paste, role: 'paste' },
        { label: t.delete, role: 'delete' },
        { type: 'separator' },
        { label: t.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: t.view,
      submenu: [
        { label: t.reload, role: 'reload' },
        { label: t.forceReload, role: 'forceReload' },
        ...(devTools ? [{ label: t.toggleDevTools, role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { label: t.resetZoom, role: 'resetZoom' },
        { label: t.zoomIn, role: 'zoomIn' },
        { label: t.zoomOut, role: 'zoomOut' },
        { type: 'separator' },
        { label: t.toggleFullScreen, role: 'togglefullscreen' },
      ],
    },
    {
      label: t.window,
      // The role makes this the Window menu macOS adds its window list to.
      role: 'window',
      submenu: [
        { label: t.minimize, role: 'minimize' },
        { label: t.zoom, role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { label: t.front, role: 'front' }] : [{ label: t.close, role: 'close' }]),
      ],
    },
    {
      label: t.help,
      role: 'help',
      submenu: [{ label: t.help, click: () => openExternal(HELP_URL) }],
    },
  ]
}
