import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { transform } from '../scripts/generate-pt-pt.mjs'

// pt-PT is generated, never hand-edited: every string must be exactly what
// scripts/generate-pt-pt.mjs derives from pt-BR. This is what makes the
// variant regenerable — when pt-BR changes, re-running the script adds the
// new keys and alters nothing else, and any reviewed fix has to land as a
// transform rule where it applies to future strings too. A hand-patched
// pt-PT string would be silently clobbered on the next regeneration; this
// test turns that mistake into a failure at the time it is made.
describe('pt-PT is exactly the generated transform of pt-BR', () => {
  const root = path.join(__dirname, 'locales')
  const files = fs.readdirSync(path.join(root, 'pt-BR')).filter((f) => f.endsWith('.json'))

  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k
      return v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, key) : [[key, v]]
    })

  it('covers all namespace files', () => {
    expect(fs.readdirSync(path.join(root, 'pt-PT')).filter((f) => f.endsWith('.json')).sort()).toEqual(
      files.sort()
    )
  })

  it.each(files)('%s matches a fresh regeneration', (file) => {
    const src = JSON.parse(fs.readFileSync(path.join(root, 'pt-BR', file), 'utf8'))
    const out = JSON.parse(fs.readFileSync(path.join(root, 'pt-PT', file), 'utf8'))
    const srcFlat = flatten(src)
    const outFlat = Object.fromEntries(flatten(out))
    for (const [key, value] of srcFlat) {
      const expected = typeof value === 'string' ? transform(value, `${file}:${key.split('.')[0]}`) : value
      expect(outFlat[key], `${file}:${key} drifted from the generator — edit the rule, not the file`).toBe(
        expected
      )
    }
    // and no keys exist in pt-PT that pt-BR does not have
    expect(Object.keys(outFlat).sort()).toEqual(srcFlat.map(([k]) => k).sort())
  })
})
