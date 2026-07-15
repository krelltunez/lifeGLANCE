# Paywall / Billing Integration Guide — GLANCE family

This began as the extraction spec for lastGLANCE's paywall. `@glance-apps/billing`
is now published and lastGLANCE ships it end-to-end (validated on-device), so this
is the **reusable integration guide for the next adopter** — currently **lifeGLANCE**
(JavaScript), then iOS.

> **If you are integrating billing into lifeGLANCE: read
> [§4 Lessons from the lastGLANCE integration](#4-lessons-from-the-lastglance-integration-read-first)
> first.** Every item there is a real bug or real friction we hit and fixed. It
> will save you the same debugging.

---

## 1. Context and model

- The Play listing is **locked free** (once published to any track as free,
  Google permanently blocks free -> paid). Monetization is therefore **in-app via
  Play Billing** on the existing app entry: no new listing, no closed-test redo.
  lifeGLANCE's entry is in the same locked-free state.
- **Model:** annual subscription + lifetime one-time purchase, both granting the
  same entitlement. lastGLANCE prices: $4.99/yr, $19.99 lifetime. **Prices and
  trial length live in Play Console, never in code.**
- **Distribution split:** the **Play build is gated**; the **GitHub sideload APK
  and self-hosted web/PWA are ungated** by design. Gating is *structural* — only
  the Play build constructs a billing adapter; other channels pass `adapter: null`
  and are unlocked with nothing to strip.
- iOS later via the package's iOS adapter (not yet wired in any app).

## 2. The package: `@glance-apps/billing`

Headless entitlement engine + platform adapters. No UI — each app ships its own
gate UI in its own design system. Pin the **exact** version (family convention);
lastGLANCE is on `0.1.1`.

### Entry points actually used

```js
// Core (framework-agnostic)
import {
  BillingEngine,            // headless engine (use directly if not React)
  deriveReviewerCode,       // HMAC(secret, "YYYY-MM") -> 12-hex reviewer code
  sha256Hex,
  billingErrorMessage,      // code -> user string (generic fallback for unmapped)
  playManageSubscriptionUrl // (packageId, annualProductId) -> manage deep link
} from '@glance-apps/billing'

// React binding (lastGLANCE used this)
import { useBilling } from '@glance-apps/billing/react'

// Capacitor/Android adapter (pairs with the package's bundled android/ module)
import { createCapacitorAdapter } from '@glance-apps/billing/capacitor'
```

### Engine config (`useBilling(() => config)` or `new BillingEngine(config)`)

```js
{
  adapter,               // platform adapter, or null when ungated
  products,              // { yearly, lifetime } — SEE LESSON 1, this is load-bearing
  reviewerSecret,        // app-specific secret (SEE LESSON 2)
  storage,               // defaults to localStorage
  storageKeys,           // only if migrating legacy keys
  timings,               // defaults are good; do not tune blindly
  offlineGraceDays,      // optional offline-expiry grace (off by default)
}
```

### Hook result (`UseBillingResult`) — the fields the gate UI uses

`isUnlocked` (gate on THIS), `gated`, `isPro`, `entitlementSource`
(`'lifetime' | 'subscription' | 'channel' | 'reviewer' | 'none'`), `productId`,
`prices` (`{ yearly, lifetime }`, store-localized strings or null), `trialEligible`,
`trialDays` (number | null), `isLoading`, `billingEvent`, `subscribe(productId)`,
`restore()`, `refresh()`, `clearBillingEvent()`, `setReviewerUnlocked(code)`,
`billingErrorMessage(code)`.

### Native Android module (bundled in the package)

`node_modules/@glance-apps/billing/android` — a Gradle library, namespace
`com.glanceapps.billing`, plugin class `BillingBridgePlugin`, Play Billing client
version from `rootProject.ext.playBillingVersion` (defaults to `7.1.1`), depends on
`:capacitor-android`.

### Local storage keys the engine owns

`glance-billing.last-active`, `glance-billing.reviewer-unlock`,
`glance-billing.capacitor-status`. (Used in testing — see Lesson 8.)

## 3. Integration map (files to create/touch)

| Piece | lastGLANCE location (mirror in lifeGLANCE as `.js`/`.jsx`) |
|---|---|
| Billing config + hook | `src/billing/billing.js` — product ids, channel gating, adapter, `STORE_NAME`, `useSubscription()` |
| Reviewer secret module | `src/config/reviewerAccess.js` — committed secret + `deriveReviewerCode()` (Lesson 2) |
| Reviewer-code CLI | `scripts/reviewer-code.mjs` + `"reviewer-code"` npm script |
| Gate UI | `PaywallModal` in the app's design system: `mode='gate'` (hard, not dismissible) + `mode='status'` (settings surface) |
| Root wiring | `useSubscription()` at app root; render the hard gate last when `gated && !isUnlocked`; add a Subscription row to settings on gated builds |
| Android | `settings.gradle` include `:glance-apps-billing` -> `../node_modules/@glance-apps/billing/android`; `app/build.gradle` `implementation project(':glance-apps-billing')`; `variables.gradle` `playBillingVersion = '7.1.1'`; `MainActivity` `registerPlugin(BillingBridgePlugin.class)` + import `com.glanceapps.billing.BillingBridgePlugin` |
| Capacitor config | `android.webContentsDebuggingEnabled` gated on env (Lesson 7) |
| Build script | channel split + `--webview-debug` flag (Lesson 7) |

### billing.js shape (reference)

```js
import { Capacitor, registerPlugin } from '@capacitor/core'
import { playManageSubscriptionUrl } from '@glance-apps/billing'
import { createCapacitorAdapter } from '@glance-apps/billing/capacitor'
import { useBilling } from '@glance-apps/billing/react'
import { REVIEWER_SECRET } from '@/config/reviewerAccess'

export const PRODUCT_IDS = { yearly: 'lifeglance_pro_annual', lifetime: 'lifeglance_pro_lifetime' }

const CHANNEL = import.meta.env.VITE_BUILD_CHANNEL ?? 'web'
const isGatedChannel = CHANNEL === 'play' && Capacitor.getPlatform() === 'android'
const BillingBridge = registerPlugin('BillingBridge')
const adapter = isGatedChannel
  ? createCapacitorAdapter({ plugin: BillingBridge, products: PRODUCT_IDS })
  : null

export const MANAGE_SUBSCRIPTION_URL = playManageSubscriptionUrl('com.lifeglance.app', PRODUCT_IDS.yearly)
export const STORE_NAME = Capacitor.getPlatform() === 'ios' ? 'App Store' : 'Google Play'

export function useSubscription() {
  return useBilling(() => ({
    adapter,
    products: PRODUCT_IDS,   // LESSON 1 — also here, not only in the adapter
    reviewerSecret: REVIEWER_SECRET,
  }))
}
```

## 4. Lessons from the lastGLANCE integration (READ FIRST)

Each of these cost real debugging time. None is hypothetical.

### Lesson 1 — pass `products` to the ENGINE, not only the adapter (this is a bug magnet)

`entitlementSource` ('lifetime' vs 'subscription') is derived from
`EngineConfig.products`, which is **separate** from the `products` you pass to
`createCapacitorAdapter` (that copy is only used for querying). If you omit it from
the engine config, the package documents that **every active entitlement falls back
to `'subscription'`** — so a lifetime purchase shows "Annual subscription active"
and a **Manage subscription** button. Purchasing/unlocking still works; only the
classification is wrong. Pass `products: PRODUCT_IDS` in **both** places.
(lastGLANCE PR #221 — found only at the buy-lifetime test step.)

### Lesson 2 — reviewer bypass is a committed secret, not an env var

A hard-gated store build must give reviewers a way past the paywall (Play App-access
policy / Apple Guideline 2.1). Do **not** inject the secret via `VITE_REVIEWER_SECRET`.
Instead, one committed module holds the app's own secret and both the running app and
a CLI import from it, so they can never disagree and the secret is never typed on a
command line:

- `src/config/reviewerAccess.js` — `const _S = 'lg-r3v13w-' + '<random-hex>'`
  (split concat = light obfuscation, honor-system by design). Exports
  `REVIEWER_SECRET` and `deriveReviewerCode()` (no-arg, reads the current UTC month).
- `scripts/reviewer-code.mjs` + `npm run reviewer-code` — prints the current month's
  code; `npm run reviewer-code -- 2026-09` previews a future month.
- The engine gets `reviewerSecret: REVIEWER_SECRET`; the CLI derives from the same
  constant. **lifeGLANCE must use its OWN secret, distinct from lastGLANCE's and
  dayGLANCE's** (a shared secret would unlock all three). Pick it once and leave it —
  changing it after a build reaches review invalidates any code already in the notes.

Note: lastGLANCE is TS, so its `reviewerAccess.js` needed a colocated `.d.ts`.
**lifeGLANCE is JS — no `.d.ts` needed**, and no `import.meta`/type imports anywhere.

### Lesson 3 — the reviewer code rotates monthly; give reviewers more than one

Code = `HMAC(secret, "YYYY-MM")`, changes on the 1st. If review lands after month
rollover, last month's code fails at the hard gate -> rejection. In Play Console ->
App access, include **instructions + the current AND next month's code**:

> Full features require a purchase. To review without paying: on the paywall tap
> **"Reviewer access"**, enter the code, tap **Apply**.
> - This month: `<code>`  - Next month: `<code>`

### Lesson 4 — trial/price copy must be store-driven, with a fallback

No hardcoded prices **or** trial lengths (they live in the Play offer). Drive the
gate copy from `trialEligible` / `trialDays` / `prices`:

- trial + `trialDays` known -> "Start your {n}-day free trial", "{n}-day free trial,
  then {price}/yr", full renewal explainer.
- trial but store hasn't answered -> generic trial copy (no number), explainer hidden
  until price loads.
- no eligible trial -> non-trial headline ("Unlock <app>"), **no trial claims** (you
  cannot advertise a trial the store won't grant).

Handle plurals per locale. The trial only shows if a free-trial offer is actually
configured on the `annual` base plan.

### Lesson 5 — store name is platform-derived

For "Payment via {store}." and "Cancel anytime in your {store} subscription
settings.", use `Capacitor.getPlatform() === 'ios' ? 'App Store' : 'Google Play'`
(bare brand name, no article). Names the right store now and survives the iOS adapter
with no copy change.

### Lesson 6 — label the reviewer entry so users don't read it as a promo field

Not "Have a code?" (users try promo codes). Use **"Reviewer access"** with a helper:
**"For app-store reviewers only. Not a promo code."** and a "Reviewer code"
placeholder.

### Lesson 7 — add an opt-in WebView debugging flag for testing

Play Billing only works on the **Play-signed release build**, whose WebView is **not**
inspectable by default (Capacitor only enables debugging in `BuildConfig.DEBUG`).
Without inspection, clearing local-only state during testing (e.g. the reviewer-unlock
key) means wiping ALL app data. Add a default-off, explicit flag:

```ts
// capacitor.config
android: { webContentsDebuggingEnabled: process.env.CAP_WEBVIEW_DEBUG === '1' }
```
```sh
# build-android.sh: --webview-debug sets CAP_WEBVIEW_DEBUG=1 and prints a loud
# "internal testing only, do NOT promote to production" warning.
```

Then `chrome://inspect` -> Console -> `localStorage.removeItem('glance-billing.reviewer-unlock')`.
**Never promote a `--webview-debug` build to production** — a production app with an
inspectable WebView leaks sync credentials / passphrase material to anyone with a USB
cable. (Default off means a plain release build is safe.)

### Lesson 8 — data-safe entitlement reset during testing

Clearing these three keys via DevTools simulates a fresh install / reset **without**
wiping chores: `glance-billing.last-active`, `glance-billing.capacitor-status`,
`glance-billing.reviewer-unlock`. Caveat: **purchases are owned server-side by the
Google account** — DevTools cannot re-lock a real purchase; that reset is Play Console
(cancel/refund the test order).

### Lesson 9 — the production versionCode trap

Internal test builds use higher versionCodes (`--build N` -> base + N), and you can't
promote a `--webview-debug` build to production. So you build a **fresh production AAB**,
and it must have a versionCode **strictly higher than every internal upload** (Play
rejects otherwise, across all tracks). Build it with `--build N` (N higher than your
last internal) and **without** `--webview-debug`. Do not ship the base code if you
already uploaded higher test codes.

### Lesson 10 — post-cancel resubscribe error is benign

Re-buying the just-canceled subscription in test mode can throw a generic "Something
went wrong with the purchase" (transient Google state; the code is an unmapped
response like SERVICE_DISCONNECTED). A relaunch clears it. Not an app bug — real users
never hit this path.

### Lesson 11 — the engine already handles offline/anti-flash; don't reimplement

The engine provisionally unlocks a previously-entitled install at cold launch, holds a
determinate-inactive reading for a grace window (~12s) before re-locking, and ignores
indeterminate readings. Gate on `isUnlocked` and let it work. Verified on-device:
airplane-mode launch shows no paywall flash; a genuinely lapsed subscription re-locks
only after the store confirms inactive.

## 5. Build pipeline (channel split + debug flag)

`build-android.sh --release` builds web assets **twice**:

1. `VITE_BUILD_CHANNEL=github npm run build:android` -> `assembleRelease` -> sideload
   APK (**ungated**).
2. `VITE_BUILD_CHANNEL=play npm run build:android` -> `bundleRelease` -> Play AAB
   (**gated**).

`cap sync` runs each build and rewrites the native `capacitor.config.json` from
`capacitor.config.*`, so `CAP_WEBVIEW_DEBUG` (Lesson 7) is honored per build without a
clean. The reviewer secret is compiled in from `reviewerAccess.js` — **no env var to
set** for the reviewer bypass (that changed from the original plan).

## 6. Play Console sequence

1. Merchant/payments profile verified (required to create products).
2. Upload a build carrying `com.android.vending.BILLING` to **internal testing** first
   — products can only be created once such a build is on a track.
3. Create products with the **exact ids** in `PRODUCT_IDS`: subscription
   `<app>_pro_annual` (base plan `annual`, add the **7-day free trial** offer) +
   one-time INAPP `<app>_pro_lifetime`. **Activate** both. Expect propagation delay.
4. **License testers** (Setup -> License testing) buy without being charged.
5. Add the App-access reviewer notes (Lesson 3).
6. Build the production AAB (Lesson 9), upload, verify, submit/promote. Managed
   publishing on; coordinate with the GitHub ungated APK release.

## 7. On-device test matrix (the validation checklist)

Run these in order — entitlement state carries over, so order matters. lastGLANCE
passed all of these (the one bug found was Lesson 1, fixed before ship).

1. **Gate appears** on a fresh locked install; trial + real prices + badge render
   (validates gated build, active products, live trial offer, price query).
2. **Reviewer code** — valid unlocks; invalid shows "not valid". Reset to locked
   between this and purchases (DevTools clear per Lesson 7/8).
3. **Buy Annual** — Play sheet shows trial + price; completes; gate dismisses with no
   flash; settings reads "Annual subscription active".
4. **Airplane-mode launch** — entitled + offline cold launch opens straight in, no
   paywall flash (Lesson 11).
5. **Restore recovery** — clear the billing local keys (Lesson 8), cold launch;
   entitlement recovers from the store (auto or via Restore).
6. **Cancel flow** — cancel; access holds through the (test-accelerated) period; after
   expiry the app re-locks within ~12s.
7. **Buy Lifetime** (last — it is permanently owned) — completes; settings reads
   **"Lifetime unlock active"** with **no Manage-subscription button** (this is the
   Lesson 1 check).

## 8. lifeGLANCE-specific: confirm before starting

lifeGLANCE is JavaScript; the family stack is otherwise assumed identical
(Capacitor + React + Vite). **Confirm each of these in the lifeGLANCE repo** and adapt:

- **Framework:** if React, use `useBilling`. If not React, use the headless
  `BillingEngine` directly (`new BillingEngine(config)`, `engine.start()`,
  `engine.subscribe(render)`, `engine.getSnapshot()`).
- **Bundler / channel flag:** `import.meta.env.VITE_BUILD_CHANNEL` assumes Vite; adapt
  if different.
- **JS, not TS:** no type imports (`UseBillingResult`, `ProductIds`,
  `CapacitorBillingPlugin` are type-only), no `.d.ts`, no `tsc` step. `reviewerAccess`
  is plain `.js`.
- **App identity:** `com.lifeglance.app` (verify) for `playManageSubscriptionUrl`;
  product ids `lifeglance_pro_annual` / `lifeglance_pro_lifetime`.
- **Own reviewer secret** (Lesson 2), distinct from the other apps.
- **Capacitor version:** the android module targets `capacitor-android`, compileSdk 35,
  minSdk 23 — confirm compatibility.
- **Gate UI / locales:** build `PaywallModal` in lifeGLANCE's design system and add the
  billing copy to its locale files.
- Pin `@glance-apps/billing` to the exact latest version.

---

## Appendix — original decision record (2026-07)

The listing is locked free (free -> paid permanently blocked once published to any
track), so monetization is in-app via Play Billing on the existing entry, mirroring
dayGLANCE (annual + lifetime, same entitlement), extracted into a shared package
(`@glance-apps/billing`) following the `@glance-apps/sync` / `@glance-apps/intents`
pattern — pinned exact versions, headless core + thin per-app native adapter, Play
build gated and GitHub/web ungated. That extraction is done; §1-§8 above supersede the
original spec.
