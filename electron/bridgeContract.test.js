// The desktop bridge's three spellings, held to one list (docs/desktop-app.md,
// "The bridge"):
//
//  - src/native/desktop.js: DESKTOP_BRIDGE_METHODS, what the page may call;
//  - electron/preload.cjs: what contextBridge actually exposes;
//  - electron/main.js: the ipcMain handlers behind it.
//
// A source-text test, as icloudIosParity.test.js is for the iOS plugin: the
// preload is sandboxed and cannot be imported here, and this is the seam a
// method added on one side only would slip through.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DESKTOP_BRIDGE_METHODS, DESKTOP_INFO_FIELDS } from '../src/native/desktop.js'
import { DESKTOP_INFO_ARG } from './desktopInfo.js'

const root = path.resolve(import.meta.dirname, '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf-8')

const preload = read('electron/preload.cjs')
const mainJs = read('electron/main.js')
const mainProcess = readdirSync(path.join(root, 'electron'))
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
  .map((f) => read(`electron/${f}`))
  .join('\n')

/** The exposed object literal's groups: { group: { key: isFunction } }. */
function preloadGroups() {
  const start = preload.indexOf("exposeInMainWorld('lifeGlanceDesktop', {")
  expect(start, 'preload exposes lifeGlanceDesktop').toBeGreaterThan(-1)
  const groups = {}
  let current = null
  for (const line of preload.slice(start).split('\n').slice(1)) {
    const group = /^ {2}(\w+): \{$/.exec(line)
    if (group) { current = group[1]; groups[current] = {}; continue }
    if (/^\}\)/.test(line)) break
    const entry = /^ {4}(\w+): (.*)$/.exec(line)
    if (entry && current) groups[current][entry[1]] = /^\(.*\) =>/.test(entry[2])
  }
  return groups
}

describe('desktop bridge contract', () => {
  const groups = preloadGroups()

  it('exposes exactly the methods DESKTOP_BRIDGE_METHODS lists', () => {
    const exposed = Object.entries(groups).flatMap(([g, keys]) =>
      Object.entries(keys).filter(([, fn]) => fn).map(([k]) => `${g}.${k}`))
    expect(exposed.sort()).toEqual([...DESKTOP_BRIDGE_METHODS].sort())
  })

  it('exposes info as plain facts, and nothing else that is not a function', () => {
    const facts = Object.entries(groups).flatMap(([g, keys]) =>
      Object.entries(keys).filter(([, fn]) => !fn).map(([k]) => `${g}.${k}`))
    expect(facts.sort()).toEqual(DESKTOP_INFO_FIELDS.map((f) => `info.${f}`).sort())
  })

  it('spells the info switch the same in the preload and desktopInfo.js', () => {
    expect(preload).toContain(`const DESKTOP_INFO_ARG = '${DESKTOP_INFO_ARG}'`)
  })

  it('handles in main every channel the preload sends or invokes', () => {
    const sent = new Set([...preload.matchAll(/ipcRenderer\.(?:send|invoke)\('([^']+)'/g)].map((m) => m[1]))
    const handled = new Set([
      ...[...mainProcess.matchAll(/ipcMain\.(?:on|handle)\('([^']+)'/g)].map((m) => m[1]),
      // A module that registers through a helper names the channel as its first argument (directAccess.js).
      ...[...mainProcess.matchAll(/\bhandle\('([a-z-]+:[a-z-]+)'/g)].map((m) => m[1]),
    ])
    expect(sent.size).toBeGreaterThan(0)
    expect([...sent].sort()).toEqual([...handled].sort())
  })

  it('listens in the preload only to events main sends', () => {
    const listened = new Set([...preload.matchAll(/subscribe\('([^']+)'/g)].map((m) => m[1]))
    const sentByMain = new Set([...mainProcess.matchAll(/webContents\.send\('([^']+)'/g)].map((m) => m[1]))
    expect(listened.size).toBeGreaterThan(0)
    expect([...listened].sort()).toEqual([...sentByMain].sort())
  })

  it('answers every call only to the main window', () => {
    // Each handler's first act is the sender check; a handler without one
    // would answer any frame that reached the channel.
    const starts = [...mainJs.matchAll(/ipcMain\.(?:on|handle)\('([^']+)', (?:async )?\(event/g)]
    expect(starts.map((m) => m[1]).sort()).toEqual([...mainJs.matchAll(/ipcMain\.(?:on|handle)\('([^']+)'/g)].map((m) => m[1]).sort())
    const unchecked = starts
      .filter((m) => !mainJs.slice(m.index).split('\n').slice(0, 2).join('\n').includes('isMainWindowSender(event.sender)'))
      .map((m) => m[1])
    expect(unchecked).toEqual([])
    // The folder handlers register through one helper, which makes the check for all of them.
    const directAccess = read('electron/directAccess.js')
    expect(directAccess).toMatch(/deps\.ipcMain\.handle\(channel, \(event, \.\.\.args\) => \{\n\s+if \(!deps\.isMainWindowSender\(event\.sender\)\) return fallback/)
    expect([...directAccess.matchAll(/ipcMain\.(?:on|handle)\(/g)]).toHaveLength(1)
  })

  it('loads the preload main.js names, in a sandboxed, isolated window', () => {
    expect(mainJs).toContain("preload: path.join(import.meta.dirname, 'preload.cjs')")
    expect(mainJs).toContain('contextIsolation: true')
    expect(mainJs).toContain('nodeIntegration: false')
    expect(mainJs).toContain('sandbox: true')
    // The sandboxed preload may load nothing but electron.
    const required = [...preload.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
    expect(required).toEqual(['electron'])
  })

  it('offers the page the folder calls its Direct Access adapter makes', () => {
    const adapter = read('src/native/directAccess.js')
    const body = adapter.slice(adapter.indexOf('export function desktopDirectAccessPlugin'))
    const called = [...new Set([...body.slice(0, body.indexOf('\n}\n')).matchAll(/desktop\.(\w+)\(/g)].map((m) => m[1]))]
    expect([...called, 'onChanged'].sort()).toEqual(Object.keys(groups.directAccess).sort())
  })

  it('offers the page the iOS plugin\'s iCloud calls, by the same names', () => {
    // src/native/icloud.js adapts this group to the plugin one for one.
    const adapter = read('src/native/icloud.js')
    const called = [...new Set([...adapter.matchAll(/desktop\.(\w+)\(/g)].map((m) => m[1]))].sort()
    expect(called).toEqual(Object.keys(groups.icloud).sort())
  })
})
