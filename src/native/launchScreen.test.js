import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

// Cold open, from the launch screen to the app's first frame. CI cannot launch
// the app, so this holds the pieces to each other:
//
//   launch screen (Splash, light and dark)  →  web view background before the
//   page paints (LaunchBackground)  →  the page's first frame (the inline
//   theme script in index.html and --bg in src/index.css)
//
// The middle step was Capacitor's systemBackground, white in light mode: the
// white flash between the dark launch screen and the app. Mirrors lastGLANCE's
// src/launchScreen.test.ts.

const root = resolve(__dirname, '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const ASSETS = 'ios/App/App/Assets.xcassets'

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')

async function cornerOf(path) {
  const { data } = await sharp(resolve(root, path)).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
  return hex([data[0], data[1], data[2]])
}

function launchBackground() {
  const json = JSON.parse(read(`${ASSETS}/LaunchBackground.colorset/Contents.json`))
  const toHex = (c) => hex(['red', 'green', 'blue'].map((k) => Number(c.components[k])))
  const any = json.colors.filter((c) => !c.appearances)
  const dark = json.colors.filter((c) => c.appearances?.some((a) => a.value === 'dark'))
  expect(any).toHaveLength(1)
  expect(dark).toHaveLength(1)
  return { light: toHex(any[0].color), dark: toHex(dark[0].color) }
}

// --bg in src/index.css: the dark default, and the [data-theme="light"] override.
function pageBackgrounds() {
  const css = read('src/index.css')
  const light = css.slice(css.indexOf('[data-theme="light"] {'))
  return {
    dark: css.match(/--bg:\s*(#[0-9A-Fa-f]{6});/)[1].toUpperCase(),
    light: light.match(/--bg:\s*(#[0-9A-Fa-f]{6});/)[1].toUpperCase(),
  }
}

describe('cold open: launch screen → web view → first frame', () => {
  it('paints the web view in the launch colour before the page loads', () => {
    const swift = read('ios/App/App/MainViewController.swift').replace(/\/\/.*$/gm, '')
    // First thing capacitorDidLoad does, so it happens before the page loads.
    expect(swift).toMatch(/override func capacitorDidLoad\(\) \{\s*paintLaunchBackground\(\)/)
    const paint = swift.slice(swift.indexOf('func paintLaunchBackground'))
    expect(paint).toContain('UIColor(named: "LaunchBackground")')
    for (const line of ['webView?.isOpaque = false', 'webView?.backgroundColor = launch', 'webView?.scrollView.backgroundColor = launch']) {
      expect(paint).toContain(line)
    }
  })

  it('LaunchBackground is the page background of each theme, and the dark one is the splash', async () => {
    const { light, dark } = launchBackground()
    const page = pageBackgrounds()
    expect(light).toBe(page.light)
    expect(dark).toBe(page.dark)
    expect(dark).toBe(await cornerOf('assets/splash-dark.png'))
  })

  it('the Splash images follow the appearance, each matching LaunchBackground', async () => {
    const { light, dark } = launchBackground()
    for (const n of [1, 2, 3]) {
      expect(await cornerOf(`${ASSETS}/Splash.imageset/Default@${n}x~universal~anyany.png`)).toBe(light)
      expect(await cornerOf(`${ASSETS}/Splash.imageset/Default@${n}x~universal~anyany-dark.png`)).toBe(dark)
    }
    // The asset generator's sources agree, so re-running it keeps both.
    expect(await cornerOf('assets/splash.png')).toBe(light)
    expect(await cornerOf('assets/splash-dark.png')).toBe(dark)
  })

  it('the first frame is in the saved theme: set in <head>, painted from --bg', () => {
    const html = read('index.html')
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toMatch(/document\.documentElement\.setAttribute\('data-theme', t\)/)
    expect(read('src/index.css')).toMatch(/html, body \{[^}]*background: var\(--bg\);/)
  })
})
