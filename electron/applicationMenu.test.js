import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { APPLICATION_MENU_LABEL_KEYS, buildApplicationMenuTemplate, DEFAULT_MENU_LABELS, HELP_URL, isApplicationMenuLabels } from './applicationMenu.js'
import { isAllowedExternalUrl } from './externalLinks.js'

const build = (over = {}) => buildApplicationMenuTemplate({ platform: 'linux', devTools: false, openExternal: () => {}, ...over })
const top = (template) => template.map((item) => item.label)
const menu = (template, label) => template.find((item) => item.label === label)
const roles = (template, label) => menu(template, label).submenu.map((item) => item.role ?? item.type ?? 'click')
const allLabels = (template) => template.flatMap((item) => [item.label, ...(item.submenu ?? []).map((sub) => sub.label)]).filter(Boolean)

const localesDir = path.resolve(import.meta.dirname, '../src/locales')
const menuOf = (lng) => JSON.parse(fs.readFileSync(path.join(localesDir, lng, 'desktop.json'), 'utf-8')).menu

describe('buildApplicationMenuTemplate', () => {
  it('has the app menu on macOS only, where Quit lives', () => {
    expect(top(build({ platform: 'darwin' }))).toEqual(['lifeGLANCE', 'File', 'Edit', 'View', 'Window', 'lifeGLANCE Help'])
    expect(roles(build({ platform: 'darwin' }), 'lifeGLANCE')).toEqual(['about', 'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit'])
    for (const platform of ['win32', 'linux']) {
      expect(top(build({ platform }))).toEqual(['File', 'Edit', 'View', 'Window', 'lifeGLANCE Help'])
    }
  })

  it('puts Quit under File where there is no app menu', () => {
    expect(roles(build({ platform: 'win32' }), 'File')).toEqual(['quit'])
    expect(roles(build({ platform: 'linux' }), 'File')).toEqual(['quit'])
    expect(roles(build({ platform: 'darwin' }), 'File')).toEqual(['close'])
  })

  it('offers developer tools only where they exist', () => {
    expect(roles(build({ devTools: true }), 'View')).toContain('toggleDevTools')
    expect(roles(build({ devTools: false }), 'View')).not.toContain('toggleDevTools')
  })

  it('keeps the standard editing, zoom and window items', () => {
    expect(roles(build(), 'Edit')).toEqual(['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'delete', 'separator', 'selectAll'])
    expect(roles(build(), 'View')).toEqual(['reload', 'forceReload', 'separator', 'resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen'])
    expect(roles(build(), 'Window')).toEqual(['minimize', 'zoom', 'close'])
    expect(roles(build({ platform: 'darwin' }), 'Window')).toEqual(['minimize', 'zoom', 'separator', 'front'])
  })

  it('has one Help item, which opens the app’s site in the browser', () => {
    const openExternal = vi.fn()
    const help = menu(build({ openExternal }), 'lifeGLANCE Help')
    expect(help.submenu).toHaveLength(1)
    help.submenu[0].click()
    expect(openExternal).toHaveBeenCalledWith(HELP_URL)
    expect(isAllowedExternalUrl(HELP_URL)).toBe(true)
  })

  it('speaks the language it is given, on every platform', () => {
    const de = menuOf('de')
    for (const platform of ['darwin', 'win32', 'linux']) {
      const template = build({ platform, labels: de, devTools: true })
      expect(top(template)).toContain('Bearbeiten')
      expect(menu(template, 'Bearbeiten').submenu.map((item) => item.label).filter(Boolean)).toEqual(['Rückgängig', 'Wiederholen', 'Ausschneiden', 'Kopieren', 'Einfügen', 'Löschen', 'Alles auswählen'])
      // Nothing is left in English.
      const english = new Set(Object.values(DEFAULT_MENU_LABELS))
      expect(allLabels(template).filter((label) => english.has(label) && !Object.values(de).includes(label))).toEqual([])
    }
  })

  it('stays in English until a complete set of labels arrives', () => {
    const partial = { ...menuOf('de') }
    delete partial.zoomIn
    expect(top(build({ labels: partial }))).toEqual(['File', 'Edit', 'View', 'Window', 'lifeGLANCE Help'])
    expect(top(build({ labels: 'Datei' }))).toEqual(['File', 'Edit', 'View', 'Window', 'lifeGLANCE Help'])
  })
})

describe('isApplicationMenuLabels', () => {
  it('wants every key as a short, non-empty string', () => {
    expect(isApplicationMenuLabels(DEFAULT_MENU_LABELS)).toBe(true)
    expect(isApplicationMenuLabels({ ...DEFAULT_MENU_LABELS, extra: 'ignored' })).toBe(true)
    expect(isApplicationMenuLabels({ ...DEFAULT_MENU_LABELS, copy: '' })).toBe(false)
    expect(isApplicationMenuLabels({ ...DEFAULT_MENU_LABELS, copy: 7 })).toBe(false)
    expect(isApplicationMenuLabels({ ...DEFAULT_MENU_LABELS, copy: 'x'.repeat(81) })).toBe(false)
    expect(isApplicationMenuLabels(null)).toBe(false)
    expect(isApplicationMenuLabels([])).toBe(false)
  })
})

describe('the menu strings', () => {
  it('are English in the shell exactly as en/desktop.json has them', () => {
    expect(menuOf('en')).toEqual(DEFAULT_MENU_LABELS)
  })

  it('are complete in every language, so the menu is never half translated', () => {
    for (const lng of fs.readdirSync(localesDir)) {
      const labels = menuOf(lng)
      expect(Object.keys(labels).sort(), lng).toEqual([...APPLICATION_MENU_LABEL_KEYS].sort())
      expect(isApplicationMenuLabels(labels), lng).toBe(true)
    }
  })
})
