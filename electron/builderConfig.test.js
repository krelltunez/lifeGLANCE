// The package ships no node_modules (electron-builder.config.cjs, files): the
// renderer is one Vite bundle, and the main process must import nothing but
// Electron, Node and its own files. An import that broke that would work in
// dev, where node_modules is on disk, and fail only in the installed app.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const config = require('../electron-builder.config.cjs')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'))

const shipped = readdirSync(path.join(root, 'electron')).filter((f) => (f.endsWith('.js') && !f.endsWith('.test.js')) || f.endsWith('.cjs'))
const importsOf = (file) => {
  const source = readFileSync(path.join(root, 'electron', file), 'utf-8')
  return [
    ...[...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ...[...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ]
}

describe('what the desktop package carries', () => {
  it('starts at the main process file, as an ES module', () => {
    expect(pkg.main).toBe('electron/main.js')
    expect(pkg.type).toBe('module')
    expect(existsSync(path.join(root, pkg.main))).toBe(true)
  })

  it('imports only Electron, Node and its own files in the main process', () => {
    const outside = shipped.flatMap((file) => importsOf(file)
      .filter((spec) => spec !== 'electron' && !spec.startsWith('node:') && !spec.startsWith('./'))
      .map((spec) => `${file}: ${spec}`))
    expect(outside).toEqual([])
  })

  it('imports only files that ship', () => {
    const missing = shipped.flatMap((file) => importsOf(file)
      .filter((spec) => spec.startsWith('./'))
      .filter((spec) => !shipped.includes(spec.slice(2)))
      .map((spec) => `${file}: ${spec}`))
    expect(missing).toEqual([])
  })

  it('ships the bundle and the shell, and leaves out node_modules, tests and sourcemaps', () => {
    expect(config.files).toEqual(expect.arrayContaining(['dist/**/*', 'electron/*.js', 'electron/preload.cjs', '!electron/*.test.js', '!**/*.map', '!node_modules/**/*']))
    expect(config.npmRebuild).toBe(false)
  })

  it('keeps Electron and the build tools out of the runtime dependencies', () => {
    for (const name of ['electron', 'electron-builder', '@electron/notarize']) {
      expect(pkg.devDependencies[name], name).toBeTruthy()
      expect(pkg.dependencies[name], name).toBeUndefined()
    }
  })
})

describe('identity', () => {
  it('is com.lifeglance.app, the Android id, on the app:// origin main serves', () => {
    expect(config.appId).toBe('com.lifeglance.app')
    expect(config.productName).toBe('lifeGLANCE')
    expect(readFileSync(path.join(root, 'electron/main.js'), 'utf-8')).toContain("app.setAppUserModelId('com.lifeglance.app')")
  })

  it('names every architecture it builds for Linux, and puts it in the AppImage name', () => {
    // The default is only the build host's arch, and an x64 AppImage otherwise
    // loses its suffix.
    for (const target of config.linux.target) expect(target.arch).toEqual(['x64', 'arm64'])
    expect(config.appImage.artifactName).toContain('${arch}')
    expect(config.linux.maintainer).toMatch(/<.+@.+>/)
  })

  it('declares the shipped languages to macOS, in Apple\'s spelling', () => {
    const locales = readdirSync(path.join(root, 'src/locales'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    expect(config.mac.electronLanguages).toEqual(locales)
    const declared = config.mac.extendInfo.CFBundleLocalizations
    expect(declared).toContain('zh-Hans')
    expect(declared).toContain('zh-Hant')
    expect(declared).not.toContain('zh-CN')
    expect(new Set(declared).size).toBe(declared.length)
  })

  it('has the icons and entitlements it points at', () => {
    for (const file of [config.mac.icon, config.win.icon, config.linux.icon, config.mac.entitlements, config.mac.entitlementsInherit, config.afterPack, config.afterSign]) {
      expect(existsSync(path.join(root, file)), file).toBe(true)
    }
  })
})
