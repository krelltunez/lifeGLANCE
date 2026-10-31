import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The iOS shell is not compiled in CI, so this holds BillingBridgePlugin.swift
// to the CapacitorBillingPlugin contract src/billing/billing.js drives, and to
// the registration and Xcode project that make the plugin exist at all. An
// unregistered plugin still compiles (MainViewController.swift says how
// Spotlight shipped dead that way); here the failure mode is an iOS app whose
// adapter talks to nothing, so the gate below fails closed with no store.
// Ported from lastGLANCE's src/billing/billingIosParity.test.ts.

const root = resolve(__dirname, '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const swift = read('ios/App/App/BillingBridgePlugin.swift')
const core = read('ios/App/App/RevenueCatBilling.swift')
const js = read('src/billing/billing.js')

// The methods createCapacitorAdapter calls (CapacitorBillingPlugin in
// @glance-apps/billing/capacitor), minus the Play-only consumeTestPurchase.
const CONTRACT = ['initialize', 'getStatus', 'refresh', 'purchase', 'getProductPrices', 'getTrialEligibility']

describe('iOS BillingBridge plugin parity', () => {
  it('is registered and compiled into the app target', () => {
    expect(read('ios/App/App/MainViewController.swift')).toContain('registerPluginInstance(BillingBridgePlugin())')
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj')
    for (const file of ['BillingBridgePlugin', 'RevenueCatBilling']) {
      expect(pbx).toMatch(new RegExp(`${file}\\.swift in Sources \\*/ = \\{isa = PBXBuildFile`))
      expect(pbx).toMatch(new RegExp(`${file}\\.swift \\*/ = \\{isa = PBXFileReference`))
      expect((pbx.match(new RegExp(`${file}\\.swift in Sources \\*/,`, 'g')) ?? []).length).toBe(1)
    }
    expect(pbx).toMatch(/RevenueCat in Frameworks \*\/ = \{isa = PBXBuildFile/)
  })

  it('answers to the name billing.js registers', () => {
    const registered = js.match(/registerPlugin\('(\w+)'\)/)?.[1]
    expect(registered).toBe('BillingBridge')
    expect(swift).toContain(`public let jsName = "${registered}"`)
  })

  it('declares and implements exactly the contract methods', () => {
    const block = swift.slice(swift.indexOf('pluginMethods'), swift.indexOf('].map'))
    const declared = [...block.matchAll(/"(\w+)"/g)].map((m) => m[1])
    expect([...declared].sort()).toEqual([...CONTRACT].sort())
    for (const m of CONTRACT) {
      expect(swift).toMatch(new RegExp(`@objc func ${m}\\(_ call: CAPPluginCall\\)`))
    }
  })

  it('emits terminal outcomes on the event the adapter subscribes to', () => {
    expect(swift).toContain('notifyListeners("billingEvent"')
  })

  it('keeps the real-status override out of Release builds', () => {
    // The override lives only between `#if DEBUG` and `#else` in getStatus.
    const debug = swift.slice(swift.indexOf('#if DEBUG'), swift.indexOf('#else'))
    const release = swift.slice(swift.indexOf('#else'), swift.indexOf('#endif'))
    expect(debug).toContain('UserDefaults.standard.bool(forKey: "GlanceBillingRealStatus")')
    expect(release).not.toContain('GlanceBillingRealStatus')
    expect(swift.match(/GlanceBillingRealStatus"/g)?.length).toBe(1)
  })

  it('never reports a trial for a product with no introductory offer', () => {
    // The paywall shows generic trial copy to an eligible user whose trial
    // length is unknown, so eligibility must not stay at its default true.
    expect(core).toMatch(/case \.ineligible, \.noIntroOfferExists:\s*\n(\s*\/\/.*\n)*\s*UserDefaults\.standard\.set\(false/)
  })
})

// billing.js reads the platform and channel at module load, so each case
// imports a fresh copy under a mocked Capacitor.
const createCapacitorAdapter = vi.fn(() => ({}))
let platform = 'web'

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platform },
  // Like Capacitor's real plugin proxy: every property is a function.
  registerPlugin: () => new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : vi.fn(async () => ({}))) }),
}))
vi.mock('@glance-apps/billing/capacitor', () => ({ createCapacitorAdapter }))
// For rendering the real PaywallModal: each string renders as its key, with
// the interpolated count or store appended so the test can see them.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts?.count != null ? `${key}:${opts.count}` : opts?.store ? `${key}[${opts.store}]` : key),
  }),
}))

async function load(p, channel) {
  platform = p
  if (channel) vi.stubEnv('VITE_BUILD_CHANNEL', channel)
  vi.resetModules()
  return import('./billing')
}

describe('billing gate by platform and channel', () => {
  beforeEach(() => createCapacitorAdapter.mockClear())
  afterEach(() => vi.unstubAllEnvs())

  it('gates the iOS app whatever the channel, since every iOS build is a store build', async () => {
    for (const channel of [undefined, 'web', 'github', 'play']) {
      createCapacitorAdapter.mockClear()
      await load('ios', channel)
      expect(createCapacitorAdapter).toHaveBeenCalledTimes(1)
    }
  })

  it('never gates web, PWA or self-hosted builds', async () => {
    for (const channel of [undefined, 'web', 'play']) {
      createCapacitorAdapter.mockClear()
      await load('web', channel)
      expect(createCapacitorAdapter).not.toHaveBeenCalled()
    }
  })

  it('gates Android only on the Play channel', async () => {
    await load('android', 'github')
    expect(createCapacitorAdapter).not.toHaveBeenCalled()
    await load('android', 'play')
    expect(createCapacitorAdapter).toHaveBeenCalledTimes(1)
  })

  it('hands the iOS adapter only the methods the native plugin implements', async () => {
    await load('ios')
    const [[{ plugin, products }]] = createCapacitorAdapter.mock.calls
    expect(Object.keys(plugin).sort()).toEqual([...CONTRACT, 'addListener'].sort())
    expect(typeof plugin.consumeTestPurchase).toBe('undefined')
    expect(products).toEqual({ yearly: 'lifeglance_pro_annual', lifetime: 'lifeglance_pro_lifetime' })
  })

  it('points Manage subscription and the paywall copy at the right store', async () => {
    const ios = await load('ios')
    expect(ios.MANAGE_SUBSCRIPTION_URL).toBe('https://apps.apple.com/account/subscriptions')
    expect(ios.STORE_NAME).toBe('App Store')
    const android = await load('android', 'play')
    expect(android.MANAGE_SUBSCRIPTION_URL).toContain('play.google.com/store/account/subscriptions')
    expect(android.STORE_NAME).toBe('Google Play')
  })

  it('carries no hardcoded trial length', async () => {
    expect('TRIAL_FALLBACK_DAYS' in (await load('ios'))).toBe(false)
  })
})

describe('the paywall gate as rendered', () => {
  // Rendered from the real component under the platform's billing module.
  async function renderGate(p, overrides = {}, channel, props = {}) {
    await load(p, channel)
    const [{ createElement }, { renderToStaticMarkup }, { default: PaywallModal }] = await Promise.all([
      import('react'),
      import('react-dom/server'),
      import('../components/billing/PaywallModal'),
    ])
    const billing = {
      isPro: false,
      entitlementSource: 'none',
      prices: { yearly: '$4.99', lifetime: '$19.99' },
      trialEligible: true,
      trialDays: 7,
      billingEvent: null,
      subscribe: () => {},
      restore: () => {},
      clearBillingEvent: () => {},
      setReviewerUnlocked: async () => false,
      ...overrides,
    }
    return renderToStaticMarkup(createElement(PaywallModal, { mode: 'gate', billing, ...props }))
  }

  afterEach(() => vi.unstubAllEnvs())

  it('has no close control on either platform, even when handed onClose (the gate is not dismissible)', async () => {
    for (const [p, channel] of [['ios'], ['android', 'play']]) {
      for (const props of [{}, { onClose: () => {} }]) {
        const html = await renderGate(p, {}, channel, props)
        expect(html).not.toContain('sheet-close')
        expect(html).not.toContain('✕')
      }
    }
  })

  it('keeps Reviewer access and Restore on both platforms', async () => {
    for (const [p, channel] of [['ios'], ['android', 'play']]) {
      const html = await renderGate(p, {}, channel)
      expect(html).toContain('reviewerToggle')
      expect(html).toContain('>restore<')
    }
  })

  it('names the App Store, never Google Play, on iOS', async () => {
    const html = await renderGate('ios')
    expect(html).toContain('paymentNote[App Store]')
    expect(html).not.toContain('Google Play')
  })

  it('leads with the store-reported trial length when there is one', async () => {
    const html = await renderGate('ios', { trialDays: 7 })
    expect(html).toContain('trialHeadline:7')
    expect(html).toContain('trialSubline:7')
  })

  it('falls back to generic trial copy, with no number, when the store reports none', async () => {
    const html = await renderGate('ios', { trialDays: null })
    expect(html).toContain('trialHeadlineGeneric')
    expect(html).toContain('trialSublineGeneric')
    expect(html).not.toMatch(/trial(Headline|Subline):/)
  })

  it('makes no trial claim to an ineligible user', async () => {
    const html = await renderGate('ios', { trialEligible: false, trialDays: null })
    expect(html).toContain('>headline<')
    expect(html).not.toContain('trialHeadline')
    expect(html).not.toContain('trialSubline')
  })
})
