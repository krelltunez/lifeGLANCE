import { describe, expect, it, vi } from 'vitest'
import { buildApplicationMenuTemplate, HELP_URL } from './applicationMenu.js'
import { isAllowedExternalUrl } from './externalLinks.js'

const build = (over = {}) => buildApplicationMenuTemplate({ platform: 'linux', devTools: false, openExternal: () => {}, ...over })
const roles = (template) => template.map((item) => item.role)
const submenuRoles = (template, role) => template.find((item) => item.role === role).submenu.map((item) => item.role ?? item.type ?? item.label)

describe('buildApplicationMenuTemplate', () => {
  it('has the app menu on macOS only, where Quit lives', () => {
    expect(roles(build({ platform: 'darwin' }))).toEqual(['appMenu', 'fileMenu', 'editMenu', 'viewMenu', 'windowMenu', 'help'])
    for (const platform of ['win32', 'linux']) {
      expect(roles(build({ platform }))).toEqual(['fileMenu', 'editMenu', 'viewMenu', 'windowMenu', 'help'])
    }
  })

  it('puts Quit under File where there is no app menu', () => {
    expect(submenuRoles(build({ platform: 'win32' }), 'fileMenu')).toEqual(['quit'])
    expect(submenuRoles(build({ platform: 'linux' }), 'fileMenu')).toEqual(['quit'])
    expect(submenuRoles(build({ platform: 'darwin' }), 'fileMenu')).toEqual(['close'])
  })

  it('offers developer tools only where they exist', () => {
    expect(submenuRoles(build({ devTools: true }), 'viewMenu')).toContain('toggleDevTools')
    expect(submenuRoles(build({ devTools: false }), 'viewMenu')).not.toContain('toggleDevTools')
  })

  it('keeps reload, zoom and fullscreen in View', () => {
    expect(submenuRoles(build(), 'viewMenu')).toEqual(['reload', 'forceReload', 'separator', 'resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen'])
  })

  it('has one Help item, which opens the app’s site in the browser', () => {
    const openExternal = vi.fn()
    const help = build({ openExternal }).find((item) => item.role === 'help')
    expect(help.submenu.map((item) => item.label)).toEqual(['lifeGLANCE Help'])
    help.submenu[0].click()
    expect(openExternal).toHaveBeenCalledWith(HELP_URL)
    expect(isAllowedExternalUrl(HELP_URL)).toBe(true)
  })
})
