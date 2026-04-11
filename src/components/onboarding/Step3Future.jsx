import React, { useState } from 'react'
import TypewriterText from '../ui/TypewriterText'
import { buildDateFromParts } from '../../utils/dates'

const PROMPT = "What's the one thing you're most looking forward to in the future?"

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

export default function Step3Future({ onSubmit, onSkip, pastMilestone }) {
  const [promptDone, setPromptDone] = useState(false)
  const [title, setTitle] = useState('')
  const [month, setMonth] = useState('1')
  const [year,  setYear]  = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  const thisYear = new Date().getFullYear()
  const canSubmit = title.trim() && year.length >= 4 && Number(year) >= thisYear

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit || busy) return
    setError('')

    const date = buildDateFromParts(month, year, 'month')
    if (date <= new Date()) {
      setError('This should be a future event.')
      return
    }

    setBusy(true)
    try {
      await onSubmit({ title: title.trim(), date, date_precision: 'month', category: 'personal' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onboarding-step">
      <div>
        <div className="progress-dots">
          <div className="progress-dot done" />
          <div className="progress-dot done" />
          <div className="progress-dot active" />
          <div className="progress-dot" />
        </div>
        <div className="onboarding-eyebrow" style={{ marginTop: '0.5rem' }}>
          step 3 of 4 — your future
        </div>
      </div>

      <div className="onboarding-prompt">
        <TypewriterText
          text={PROMPT}
          options={{ delay: 22, jitter: 18 }}
          onDone={() => setPromptDone(true)}
          hideCursorWhenDone
          playSound
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="onboarding-inputs"
        style={{
          opacity: promptDone ? 1 : 0,
          transform: promptDone ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.35s ease, transform 0.35s ease',
          pointerEvents: promptDone ? 'all' : 'none',
        }}
      >
        <div>
          <label className="field-label">event name</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. Trip to Japan"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoComplete="off"
            maxLength={80}
          />
        </div>

        <div className="field-row">
          <div style={{ flex: 2 }}>
            <label className="field-label">month</label>
            <select
              className="input"
              value={month}
              onChange={e => setMonth(e.target.value)}
              style={{ cursor: 'pointer' }}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">year</label>
            <input
              className="input"
              type="number"
              placeholder={thisYear + 1}
              value={year}
              onChange={e => setYear(e.target.value)}
              min={thisYear}
            />
          </div>
        </div>

        <div className="onboarding-helper">approximate is fine</div>

        {error && (
          <div style={{ fontSize: '0.78rem', color: '#E85D75' }}>{error}</div>
        )}

        <div className="onboarding-actions">
          <button type="submit" className="btn" disabled={!canSubmit || busy}>
            {busy ? 'placing…' : 'place it on my timeline →'}
          </button>
        </div>
      </form>

      <button className="skip-link" onClick={onSkip}>skip</button>
    </div>
  )
}
