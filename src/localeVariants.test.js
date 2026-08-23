import { describe, it, expect, beforeAll } from 'vitest'
import { languages, namespaces, loaders } from './locales.js'
import { EUROPEAN_ONLY, BRAZILIAN_ONLY } from './ptMarkers.js'

// The marker lists live in src/ptMarkers.js (shared with the native-string
// tests) — see that file for the calibration story and the ASCII-\b trap.

// Which standard each shipped Portuguese locale must hold to. A bare "pt" is
// treated as BRAZILIAN, because that is what this app's single locale was
// written in — note this is the OPPOSITE of dayGLANCE and lastGLANCE, whose
// pre-split "pt" was European. (Quick tell: this repo's pt has "configurações"
// and "compartilhar", not "definições" and "partilhar".)
function expectedStandard(tag) {
  if (tag === 'pt' || tag === 'pt-BR') return { name: 'Brazilian', forbidden: EUROPEAN_ONLY }
  if (tag === 'pt-PT') return { name: 'European', forbidden: BRAZILIAN_ONLY }
  return null
}

const portuguese = languages.filter((l) => l.split('-')[0] === 'pt')

describe('Portuguese variant purity', () => {
  // bundles[lng][ns] -> parsed JSON, loaded through the runtime loaders
  const bundles = {}
  beforeAll(async () => {
    await Promise.all(
      portuguese.map(async (lng) => {
        bundles[lng] = {}
        await Promise.all(
          namespaces.map(async (ns) => {
            bundles[lng][ns] = await loaders[lng][ns]()
          })
        )
      })
    )
  })

  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k
      return v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, key) : [[key, v]]
    })

  it('ships at least one Portuguese locale', () => {
    expect(portuguese.length).toBeGreaterThan(0)
  })

  it('knows the expected standard of every Portuguese locale', () => {
    for (const lng of portuguese) {
      expect(expectedStandard(lng), `add ${lng} to expectedStandard()`).not.toBeNull()
    }
  })

  // A marker that cannot match its own name is a guardrail that passes because
  // it never fires — the worst kind. This is how the ASCII-\b bug in /\becrã\b/
  // was found in dayGLANCE, after it had already let a stray "ecrã" through.
  it.each(Object.entries({ ...EUROPEAN_ONLY, ...BRAZILIAN_ONLY }))(
    'the %s pattern matches the word it is named for',
    (name, pattern) => {
      // Multi-word grammatical markers are named for the construction, not a
      // literal string, so they are exercised by the sample phrases instead.
      const constructions = {
        'está a + infinitivo': 'está a sincronizar',
        'precisa de + infinitivo': 'precisa de ser atualizado',
        'gerúndio progressivo': 'está sincronizando',
        'precisa + infinitivo': 'precisa ser atualizado',
      }
      expect(pattern.test(constructions[name] ?? name)).toBe(true)
    }
  )

  it.each(portuguese)('%s uses only its own standard, in all namespaces', (lng) => {
    const { name, forbidden } = expectedStandard(lng)
    const violations = []

    for (const ns of namespaces) {
      const strings = flatten(bundles[lng][ns]).filter(([, v]) => typeof v === 'string')
      for (const [key, value] of strings) {
        for (const [marker, pattern] of Object.entries(forbidden)) {
          const found = value.match(pattern)
          if (found)
            violations.push(`  ${ns}:${key}: "${found[0]}" — ${marker}\n      ${value.slice(0, 110)}`)
        }
      }
    }

    expect(
      violations,
      `${lng} is meant to be ${name} Portuguese but ${violations.length} string(s) use the other standard:\n${violations.join('\n')}`
    ).toEqual([])
  })
})
