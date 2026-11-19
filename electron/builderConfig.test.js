// The package ships no node_modules (electron-builder.config.cjs, files): the
// renderer is one Vite bundle, and the main process must import nothing but
// Electron, Node and its own files. An import that broke that would work in
// dev, where node_modules is on disk, and fail only in the installed app.
//
// The one exception is @glance-apps/billing's main-process half (the Mac App
// Store build's purchases), which ships as those two paths and is held to the
// same rule itself.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
// The config reads its environment when loaded, so a variant is a fresh load.
function loadConfig() {
  delete require.cache[require.resolve('../electron-builder.config.cjs')]
  return require('../electron-builder.config.cjs')
}
const config = loadConfig()
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'))

const shipped = readdirSync(path.join(root, 'electron')).filter((f) => (f.endsWith('.js') && !f.endsWith('.test.js')) || f.endsWith('.cjs'))
const BILLING_MAIN = '@glance-apps/billing/electron-main'
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

  it('imports only Electron, Node, its own files and the billing package\'s main half in the main process', () => {
    const outside = shipped.flatMap((file) => importsOf(file)
      .filter((spec) => spec !== 'electron' && !spec.startsWith('node:') && !spec.startsWith('./'))
      .map((spec) => `${file}: ${spec}`))
    expect(outside).toEqual([`main.js: ${BILLING_MAIN}`])
  })

  it('ships the billing package\'s main half, which imports only Electron and Node itself', () => {
    // What `@glance-apps/billing/electron-main` resolves to is what must ship:
    // the package.json that maps it, and the folder it maps to.
    const billingPkg = JSON.parse(readFileSync(path.join(root, 'node_modules/@glance-apps/billing/package.json'), 'utf-8'))
    expect(billingPkg.exports['./electron-main'].default).toBe('./dist/electron-main/index.js')
    expect(config.files.filter((f) => f.startsWith('node_modules/'))).toEqual([
      'node_modules/@glance-apps/billing/package.json',
      'node_modules/@glance-apps/billing/dist/electron-main/**/*',
    ])
    // An exclusion after an inclusion would take it back out.
    expect(config.files.indexOf('!node_modules/**/*')).toBeLessThan(config.files.indexOf('node_modules/@glance-apps/billing/package.json'))
    const dir = path.join(root, 'node_modules/@glance-apps/billing/dist/electron-main')
    const sources = readdirSync(dir).filter((f) => f.endsWith('.js'))
    expect(sources).toContain('index.js')
    const imports = sources.flatMap((f) => [...readFileSync(path.join(dir, f), 'utf-8').matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]))
    expect(imports.length).toBeGreaterThan(0)
    expect(imports.filter((spec) => spec !== 'electron' && !spec.startsWith('node:'))).toEqual([])
  })

  it('takes a billing package that sends its results to the current window', () => {
    // main.js gives it a getter (billingConfig.test.js), which 0.2.3 is the
    // first version to accept: an older one would call isDestroyed() on the
    // function and throw on every purchase and restore result.
    expect(pkg.dependencies['@glance-apps/billing']).toBe('0.2.3')
    const billingPkg = JSON.parse(readFileSync(path.join(root, 'node_modules/@glance-apps/billing/package.json'), 'utf-8'))
    expect(billingPkg.version).toBe('0.2.3')
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
    for (const file of [config.mac.icon, config.win.icon, config.linux.icon, config.mac.entitlements, config.mac.entitlementsInherit, config.mas.entitlements, config.mas.entitlementsInherit, config.afterPack, config.afterSign]) {
      expect(existsSync(path.join(root, file)), file).toBe(true)
    }
  })

  it('validates against electron-builder\'s own schema, as a direct build and as a MAS one', () => {
    const Ajv = require('ajv')
    const check = new Ajv({ allErrors: true, strict: false }).compile(require('app-builder-lib/scheme.json'))
    const detail = () => (check.errors ?? []).map((e) => `${e.instancePath ?? e.dataPath} ${e.message}`).join('\n')
    expect(check(config), detail()).toBe(true)
    process.env.LIFEGLANCE_APP_ID = 'com.lifeglance'
    try {
      expect(check(loadConfig()), detail()).toBe(true)
    } finally {
      delete process.env.LIFEGLANCE_APP_ID
    }
  })
})

describe('the Mac App Store build', () => {
  const plistStrings = (source, key) => {
    const at = source.indexOf(`<key>${key}</key>`)
    if (at === -1) return null
    const rest = source.slice(at)
    return [...rest.slice(0, rest.indexOf('</array>')).matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1])
  }
  const plistKeys = (source) => [...source.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])
  const masEntitlements = readFileSync(path.join(root, 'electron/entitlements.mas.plist'), 'utf-8')

  it('a direct build is not one: ad-hoc or Developer ID, and no build number of its own', () => {
    expect(config.mac.identity).toBeNull()
    expect(config.buildVersion).toBeUndefined()
  })

  it('takes the iOS bundle id, a rising build number, and a keychain identity', () => {
    process.env.LIFEGLANCE_APP_ID = 'com.lifeglance'
    try {
      const mas = loadConfig()
      // The iOS app's id, which is what makes the purchases Universal.
      expect(mas.appId).toBe('com.lifeglance')
      expect(readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf-8')).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${mas.appId};`)
      // Not null: null is "do not sign", which a MAS build must never inherit.
      expect(mas.mac.identity).toBeUndefined()
      expect(mas.buildVersion).toMatch(/^\d{8}\.\d{4}$/)
      expect(mas.mas.type).toBe('distribution')
      expect(mas.mas.hardenedRuntime).toBe(false)
      expect(mas.mas.provisioningProfile).toBe('electron/lifeglance.mas.provisionprofile')
    } finally {
      delete process.env.LIFEGLANCE_APP_ID
    }
  })

  it('takes its build number and its profile from the environment when given', () => {
    Object.assign(process.env, { LIFEGLANCE_APP_ID: 'com.lifeglance', BUILD_NUMBER: '42', MAC_PROVISIONING_PROFILE: '/tmp/x.provisionprofile' })
    try {
      const mas = loadConfig()
      expect(mas.buildVersion).toBe('42')
      expect(mas.mas.provisioningProfile).toBe('/tmp/x.provisionprofile')
    } finally {
      for (const name of ['LIFEGLANCE_APP_ID', 'BUILD_NUMBER', 'MAC_PROVISIONING_PROFILE']) delete process.env[name]
    }
  })

  it('is built by a script that sets what the config keys on', () => {
    const script = pkg.scripts['build:electron:mas']
    expect(script).toContain('LIFEGLANCE_APP_ID=com.lifeglance electron-builder')
    expect(script).toContain('--mac mas --universal')
    expect(script).toContain('--publish never')
    // No other script may produce a build under the iOS bundle id.
    const others = Object.entries(pkg.scripts).filter(([name, body]) => name !== 'build:electron:mas' && body.includes('LIFEGLANCE_APP_ID'))
    expect(others).toEqual([])
  })

  it('keeps the provisioning profile out of the repository', () => {
    expect(readFileSync(path.join(root, '.gitignore'), 'utf-8')).toContain('electron/*.provisionprofile')
  })

  it('is sandboxed, with the iOS app\'s iCloud containers and nothing it does not use', () => {
    expect(plistKeys(masEntitlements).sort()).toEqual([
      'com.apple.developer.icloud-container-identifiers',
      'com.apple.developer.icloud-services',
      'com.apple.security.app-sandbox',
      'com.apple.security.cs.allow-jit',
      'com.apple.security.files.bookmarks.app-scope',
      'com.apple.security.files.user-selected.read-write',
      'com.apple.security.network.client',
    ])
    const ios = readFileSync(path.join(root, 'ios/App/App/App.entitlements'), 'utf-8')
    for (const key of ['com.apple.developer.icloud-container-identifiers', 'com.apple.developer.icloud-services']) {
      expect(plistStrings(masEntitlements, key), key).toEqual(plistStrings(ios, key))
    }
    expect(plistStrings(masEntitlements, 'com.apple.developer.icloud-container-identifiers')).toEqual(['iCloud.com.lifeglance', 'iCloud.com.dayglance'])
  })

  it('gives the Electron helpers the sandbox and inheritance, and nothing else', () => {
    const inherit = readFileSync(path.join(root, 'electron/entitlements.mas.inherit.plist'), 'utf-8')
    expect(plistKeys(inherit).sort()).toEqual(['com.apple.security.app-sandbox', 'com.apple.security.inherit'])
  })

  it('is skipped by the Developer ID hooks: no ad-hoc signature over the store\'s, no notarization', () => {
    expect(readFileSync(path.join(root, 'scripts/codesign-ad-hoc.cjs'), 'utf-8')).toContain("electronPlatformName === 'mas'")
    expect(readFileSync(path.join(root, 'scripts/notarize.cjs'), 'utf-8')).toContain("electronPlatformName === 'mas'")
  })
})
