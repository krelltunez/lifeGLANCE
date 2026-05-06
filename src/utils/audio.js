/**
 * Minimal Web Audio synthesis for lifeGLANCE.
 * AudioContext is created lazily on the first user gesture (call init()).
 * All play functions are no-ops when muted or before init().
 */

let ctx           = null
let ambientNodes  = []
let ambientActive = false
let melodyTimer   = null
let _muted        = localStorage.getItem('lifeglance-sound') === 'off'

// ── Context ───────────────────────────────────────────────────────────────────

/** Call from a user-gesture handler (click/keydown) to unlock the AudioContext. */
export function init() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)()
    } catch { /* browser doesn't support Web Audio */ }
  } else if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
}

function getCtx() {
  if (!ctx || ctx.state === 'closed') return null
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// ── Mute ─────────────────────────────────────────────────────────────────────

export function isMuted()     { return _muted }
export function setMuted(val) {
  _muted = !!val
  localStorage.setItem('lifeglance-sound', _muted ? 'off' : 'on')
  if (_muted) _fadeOutAmbient()
}
export function toggleMuted() { setMuted(!_muted); return _muted }

// ── Primitive: single sine tone with envelope ─────────────────────────────────

function tone(freq, duration, peak = 0.09, type = 'sine', delaySec = 0) {
  if (_muted) return
  const c = getCtx()
  if (!c) return
  const osc  = c.createOscillator()
  const gain = c.createGain()
  osc.connect(gain)
  gain.connect(c.destination)
  osc.type = type
  osc.frequency.value = freq
  const t0 = c.currentTime + delaySec
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

// ── Typewriter key click ──────────────────────────────────────────────────────
// A short frequency-swept sine: starts at ~1500–2000 Hz and drops to ~20%
// of that over 11 ms — mimics the physics of a key strike (high-frequency
// contact transient that immediately settles). No noise = no fart.

export function playKeyClick() {
  if (_muted) return
  const c = getCtx()
  if (!c) return
  const t0        = c.currentTime
  const startFreq = 1500 + Math.random() * 500   // slight per-key variation
  const osc  = c.createOscillator()
  const gain = c.createGain()
  osc.connect(gain)
  gain.connect(c.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(startFreq, t0)
  osc.frequency.exponentialRampToValueAtTime(startFreq * 0.2, t0 + 0.011)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(0.08, t0 + 0.001)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.014)
  osc.start(t0)
  osc.stop(t0 + 0.02)
}

// ── Piano note (used by melody + chime) ──────────────────────────────────────
// Fundamental sine + 2nd harmonic at 28 % for body. Fast attack, long decay.

function playPianoNote(freq, vel = 0.07, decaySec = 1.8) {
  if (_muted) return
  const c = getCtx()
  if (!c) return
  const t0 = c.currentTime
  ;[[1, vel], [2, vel * 0.28]].forEach(([mult, peak]) => {
    const osc  = c.createOscillator()
    const gain = c.createGain()
    osc.connect(gain)
    gain.connect(c.destination)
    osc.type = 'sine'
    osc.frequency.value = freq * mult
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decaySec)
    osc.start(t0)
    osc.stop(t0 + decaySec + 0.05)
  })
}

// ── Milestone save chime ──────────────────────────────────────────────────────
// C major triad arpeggio played as piano notes: C5 → E5 → G5

export function playChime() {
  playPianoNote(523.25, 0.10, 1.1)
  setTimeout(() => playPianoNote(659.25, 0.07, 0.95), 70)
  setTimeout(() => playPianoNote(783.99, 0.05, 0.80), 140)
}

// ── Edit save ─────────────────────────────────────────────────────────────────

export function playEditSave() {
  playPianoNote(523.25, 0.07, 0.7)
}

// ── Navigation tick ───────────────────────────────────────────────────────────
// Lower pitch = past (going back); higher = future (going forward).

export function playNavTick(goingForward = false) {
  tone(goingForward ? 587.33 : 369.99, 0.13, 0.045, 'sine', 0)
}

// ── Onboarding ambient ────────────────────────────────────────────────────────
// Drone: A2 (110 Hz) + detuned copy + E3 fifth, each with a slow LFO tremolo.
// Melody: random pentatonic piano notes every 1.5–5 s, starting 2.2 s in.

// A minor pentatonic, 4th–5th octave
const PENTATONIC = [
  261.63,  // C4
  293.66,  // D4
  329.63,  // E4
  392.00,  // G4
  440.00,  // A4
  523.25,  // C5
  587.33,  // D5
  659.25,  // E5
  783.99,  // G5
  880.00,  // A5
]

function scheduleMelody() {
  if (!ambientActive || _muted) return
  const freq = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)]
  const vel  = 0.035 + Math.random() * 0.025   // dynamic variation
  playPianoNote(freq, vel, 1.6)
  melodyTimer = setTimeout(scheduleMelody, 1500 + Math.random() * 3500)
}

export function startAmbient() {
  if (_muted || ambientActive) return
  const c = getCtx()
  if (!c) return
  ambientActive = true

  const voices = [
    { freq: 110.0,  peakGain: 0.035, lfoFreq: 0.17 },
    { freq: 110.4,  peakGain: 0.025, lfoFreq: 0.23 },
    { freq: 164.81, peakGain: 0.018, lfoFreq: 0.13 },
  ]

  voices.forEach(({ freq, peakGain, lfoFreq }) => {
    const osc    = c.createOscillator()
    const gainNd = c.createGain()
    const lfo    = c.createOscillator()
    const lfoGn  = c.createGain()

    osc.type = 'sine'
    osc.frequency.value = freq
    lfo.type = 'sine'
    lfo.frequency.value = lfoFreq
    lfoGn.gain.value = peakGain * 0.3   // LFO depth = 30 % of base gain

    lfo.connect(lfoGn)
    lfoGn.connect(gainNd.gain)
    osc.connect(gainNd)
    gainNd.connect(c.destination)

    gainNd.gain.setValueAtTime(0, c.currentTime)
    gainNd.gain.linearRampToValueAtTime(peakGain, c.currentTime + 2.5)

    osc.start()
    lfo.start()

    ambientNodes.push({ osc, gainNd, lfo })
  })

  // Start melody once the drone has faded in
  melodyTimer = setTimeout(scheduleMelody, 2200)
}

function _fadeOutAmbient() {
  ambientActive = false
  clearTimeout(melodyTimer)
  melodyTimer = null

  const c     = ctx
  const nodes = ambientNodes
  ambientNodes = []

  nodes.forEach(({ osc, gainNd, lfo }) => {
    if (c && c.state !== 'closed') {
      gainNd.gain.cancelScheduledValues(c.currentTime)
      gainNd.gain.setValueAtTime(gainNd.gain.value, c.currentTime)
      gainNd.gain.linearRampToValueAtTime(0, c.currentTime + 1.2)
    }
    try { osc.stop(c ? c.currentTime + 1.3 : 0) } catch {}
    try { lfo.stop(c ? c.currentTime + 1.3 : 0) } catch {}
  })
}

export function stopAmbient() { _fadeOutAmbient() }

// ── Chapter drill-in / drill-out ──────────────────────────────────────────────
// Drill-in: ascending frequency sweep (180 → 520 Hz) + arrival piano note.
// Drill-out: descending sweep (520 → 180 Hz) + lower landing note.

export function playDrillIn() {
  if (_muted) return
  const c = getCtx()
  if (!c) return
  const t0 = c.currentTime
  const osc  = c.createOscillator()
  const gain = c.createGain()
  osc.connect(gain)
  gain.connect(c.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(180, t0)
  osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.26)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(0.11, t0 + 0.04)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32)
  osc.start(t0)
  osc.stop(t0 + 0.35)
  // Landing note
  setTimeout(() => playPianoNote(523.25, 0.06, 0.7), 220)
}

export function playDrillOut() {
  if (_muted) return
  const c = getCtx()
  if (!c) return
  const t0 = c.currentTime
  const osc  = c.createOscillator()
  const gain = c.createGain()
  osc.connect(gain)
  gain.connect(c.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(520, t0)
  osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.26)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(0.11, t0 + 0.04)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32)
  osc.start(t0)
  osc.stop(t0 + 0.35)
  // Landing note
  setTimeout(() => playPianoNote(261.63, 0.06, 0.7), 220)
}
