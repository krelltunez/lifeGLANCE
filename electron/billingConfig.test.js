// The Mac App Store build sells the iOS app's products (Universal Purchase):
// one App Store record, one RevenueCat app, one entitlement. A value that
// drifted from the iOS sources would validate the Mac's receipt against the
// wrong RevenueCat app, or ask StoreKit for products that do not exist, and
// nothing before a real purchase on a real Mac would say so.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MAS_BILLING } from './billingConfig.js'

const root = path.resolve(import.meta.dirname, '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf-8')
const mainJs = read('electron/main.js')

describe('MAS billing uses the iOS app\'s store setup (Universal Purchase)', () => {
  it('the same product ids as the app', async () => {
    const js = read('src/billing/billing.js')
    expect(js).toContain(`yearly: '${MAS_BILLING.products.yearly}'`)
    expect(js).toContain(`lifetime: '${MAS_BILLING.products.lifetime}'`)
  })

  it('the iOS RevenueCat key and entitlement', () => {
    expect(MAS_BILLING.rcApiKey).toMatch(/^appl_/)
    expect(read('ios/App/App/AppDelegate.swift')).toContain(`configure(apiKey: "${MAS_BILLING.rcApiKey}")`)
    expect(read('ios/App/App/RevenueCatBilling.swift')).toContain(`static let entitlementId = "${MAS_BILLING.entitlementId}"`)
  })
})

describe('main registers billing', () => {
  it('on the Mac App Store build only', () => {
    const calls = [...mainJs.matchAll(/^.*registerElectronBilling\(.*$/gm)].map((m) => m[0].trim())
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/^if \(process\.mas\) registerElectronBilling\(/)
  })

  // This app's window does not last the process: closing it on macOS destroys
  // it, and the Dock opens another. Given a window, the package sends every
  // purchase and restore result to that one, so a purchase made after
  // reopening would complete in StoreKit and leave the paywall's spinner up.
  it('with the current window, not the first one', () => {
    expect(mainJs).toMatch(/registerElectronBilling\(\(\) => live\(mainWindow\), /)
    expect(mainJs).toContain("app.on('activate', () => showMainWindow())")
  })

  it('once, after the first window exists, and not per window', () => {
    const createWindowBody = mainJs.slice(mainJs.indexOf('function createWindow()'), mainJs.indexOf('function load(win)'))
    expect(createWindowBody).not.toContain('registerElectronBilling')
    const ready = mainJs.slice(mainJs.indexOf('app.whenReady()'))
    expect(ready.indexOf('createWindow()')).toBeGreaterThan(-1)
    expect(ready.indexOf('registerElectronBilling(')).toBeGreaterThan(ready.indexOf('createWindow()'))
  })
})
