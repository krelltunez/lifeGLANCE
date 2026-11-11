import React, { useState } from 'react'
import { dateFieldOrder, monthNames } from '../../utils/dates'

// Number of days in a given 1-based month, defaulting to 31 until a month is
// picked so the day list is never empty.
function daysInMonth(year, month) {
  if (!month) return 31
  return new Date(Number(year) || 2000, Number(month), 0).getDate()
}

// Birthday entry as three Year / Month / Day dropdowns instead of a native
// <input type="date">. On phones the native picker opens a calendar that forces
// tapping back through a month per step to reach a birth year decades ago
// (issue #243); dropdowns make it a few taps. The stored value keeps the exact
// same YYYY-MM-DD string the date input produced, so age math and sync are
// unchanged. Fields are ordered per locale (dateFieldOrder).
export default function BirthdayPicker({ value, onChange, language, tc }) {
  const months = monthNames(language, 'long')

  const parse = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '')
    return m ? { y: m[1], mo: String(Number(m[2])), d: String(Number(m[3])) } : { y: '', mo: '', d: '' }
  }
  const [parts, setParts] = useState(() => parse(value))

  // Re-sync if the birthday changes elsewhere (e.g. restored from a backup or a
  // GLANCEvault sync) while this modal is open. Adjusting state during render off
  // the previous prop is React's recommended alternative to a syncing effect.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setParts(parse(value))
  }

  const nowYear = new Date().getFullYear()
  const years = Array.from({ length: nowYear - 1900 + 1 }, (_, i) => String(nowYear - i))
  const days = Array.from({ length: daysInMonth(parts.y, parts.mo) }, (_, i) => String(i + 1))

  function update(next) {
    // Keep the day valid for the chosen month/year (e.g. Feb 31 -> Feb 28/29).
    const max = daysInMonth(next.y, next.mo)
    if (next.d && Number(next.d) > max) next.d = String(max)
    setParts(next)
    // Only emit a complete date; an incomplete selection clears the birthday.
    onChange(next.y && next.mo && next.d
      ? `${next.y}-${next.mo.padStart(2, '0')}-${next.d.padStart(2, '0')}`
      : '')
  }

  const fields = {
    year: (
      <select key="year" className="settings-birthday-input" value={parts.y}
        onChange={e => update({ ...parts, y: e.target.value })} aria-label={tc('year')}>
        <option value="">{tc('year')}</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    ),
    month: (
      <select key="month" className="settings-birthday-input" value={parts.mo}
        onChange={e => update({ ...parts, mo: e.target.value })} aria-label={tc('month')}>
        <option value="">{tc('month')}</option>
        {months.map((m, i) => <option key={i + 1} value={String(i + 1)}>{m}</option>)}
      </select>
    ),
    day: (
      <select key="day" className="settings-birthday-input" value={parts.d}
        onChange={e => update({ ...parts, d: e.target.value })} aria-label={tc('day')}>
        <option value="">{tc('day')}</option>
        {days.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    ),
  }

  return (
    <div className="settings-birthday-fields">
      {dateFieldOrder(language).map(f => fields[f])}
    </div>
  )
}
