import { afterEach, describe, expect, it, vi } from 'vitest'

// Which builds are gated, and how the gate reads, per channel
// (docs/desktop-app.md, "Billing"). Each row loads billing.js afresh under its
// platform, build channel and desktop bridge. After lastGLANCE's
// src/billing/billingChannels.test.ts.

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.doUnmock('@capacitor/core')
})

const desktopBilling = () => ({
  subscriptionStatus: vi.fn(async () => ({ active: false, productId: null, indeterminate: true })),
  subscriptionPurchase: vi.fn(async () => {}),
  subscriptionRestore: vi.fn(async () => {}),
  subscriptionPrices: vi.fn(async () => null),
  onSubscriptionEvent: vi.fn(() => () => {}),
  onSubscriptionPricesReady: vi.fn(() => () => {}),
})

async function load(platform, channel, desktop) {
  const plugin = { initialize: vi.fn(async () => ({})), getStatus: vi.fn(async () => ({})), addListener: vi.fn(async () => ({ remove() {} })) }
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { getPlatform: () => platform, isNativePlatform: () => platform !== 'web', isPluginAvailable: () => false },
    registerPlugin: () => plugin,
  }))
  if (channel) vi.stubEnv('VITE_BUILD_CHANNEL', channel)
  const billing = desktop ? desktopBilling() : null
  vi.stubGlobal('window', desktop
    ? { lifeGlanceDesktop: { info: { platform: desktop.platform, version: '5.1.0', isMAS: desktop.isMAS, secureStorage: true }, shell: { setTheme() {} }, billing } }
    : {})
  return { module: await import('./billing'), billing, plugin }
}

describe('billing channels', () => {
  it.each([
    // [row, platform, channel, desktop, gated, store]
    ['web and PWA', 'web', undefined, null, false, 'Google Play'],
    ['Android, GitHub sideload', 'android', 'github', null, false, 'Google Play'],
    ['Android, Play', 'android', 'play', null, true, 'Google Play'],
    ['iOS', 'ios', undefined, null, true, 'App Store'],
    ['desktop, Mac App Store', 'web', undefined, { platform: 'darwin', isMAS: true }, true, 'App Store'],
    ['desktop, Mac Developer ID', 'web', undefined, { platform: 'darwin', isMAS: false }, false, 'Google Play'],
    ['desktop, Windows', 'web', undefined, { platform: 'win32', isMAS: false }, false, 'Google Play'],
    ['desktop, Linux', 'web', undefined, { platform: 'linux', isMAS: false }, false, 'Google Play'],
  ])('%s', async (_row, platform, channel, desktop, gated, store) => {
    const { module: b } = await load(platform, channel, desktop)
    expect(b.BILLING_GATED).toBe(gated)
    // An ungated build never shows the store's name; the value is only checked where it is read.
    if (gated) expect(b.STORE_NAME).toBe(store)
  })

  it('a stray Play channel does not gate a desktop build (Capacitor reads web there)', async () => {
    // build.sh's last Android pass can leave VITE_BUILD_CHANNEL=play in the
    // environment a desktop renderer is then built in.
    for (const desktop of [{ platform: 'darwin', isMAS: false }, { platform: 'win32', isMAS: false }, { platform: 'linux', isMAS: false }]) {
      const { module: b } = await load('web', 'play', desktop)
      expect(b.BILLING_GATED, desktop.platform).toBe(false)
      vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('@capacitor/core')
    }
  })

  it('only the Mac App Store paywall leaves the widgets out of what a purchase unlocks', async () => {
    // The Mac app has no home-screen widgets; the phones' paywalls keep the line.
    const rows = [
      ['web', undefined, null, true],
      ['android', 'play', null, true],
      ['ios', undefined, null, true],
      ['web', undefined, { platform: 'darwin', isMAS: true }, false],
      ['web', undefined, { platform: 'darwin', isMAS: false }, true],
    ]
    for (const [platform, channel, desktop, widgets] of rows) {
      const { module: b } = await load(platform, channel, desktop)
      expect(b.HAS_HOME_SCREEN_WIDGETS, `${platform} ${JSON.stringify(desktop)}`).toBe(widgets)
      vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('@capacitor/core')
    }
  })

  it('the Mac App Store app manages its subscription in the App Store', async () => {
    const { module: b } = await load('web', undefined, { platform: 'darwin', isMAS: true })
    expect(b.MANAGE_SUBSCRIPTION_URL).toContain('apps.apple.com')
    // main opens only http, https and mailto outside the app (externalLinks.js).
    expect(new URL(b.MANAGE_SUBSCRIPTION_URL).protocol).toBe('https:')
  })

  it('Android keeps Play\'s subscription page, and iOS Apple\'s', async () => {
    expect((await load('android', 'play', null)).module.MANAGE_SUBSCRIPTION_URL).toContain('play.google.com')
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('@capacitor/core')
    expect((await load('ios', undefined, null)).module.MANAGE_SUBSCRIPTION_URL).toContain('apps.apple.com')
  })
})
