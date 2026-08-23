import React from 'react'
import { useTranslation } from 'react-i18next'
import { languages, resolveLanguage } from '../../locales'
import { nativeLanguageName } from '../../utils/languageName'

// Languages listed under their own names (see nativeLanguageName): someone who
// cannot read the current UI language has to be able to recognise theirs.
//
// `inline` shrink-wraps the control to the current name. A select's intrinsic
// width is that of its WIDEST option ("Português (Portugal)"), which strands
// half a line of empty space after a short name like "english" when the
// control sits inline with other text. The inline variant renders the name as
// a plain span and stacks the real select on top at opacity 0, so the native
// dropdown still opens from the same spot and keyboard/AT behaviour is the
// select's own.
export default function LanguagePicker({ className, id, 'aria-label': ariaLabel, inline = false }) {
  const { i18n } = useTranslation()
  // Same resolver the detector uses, so the option shown always matches the
  // language actually rendering. A select whose value matches no option
  // silently displays its first entry instead.
  const value = resolveLanguage(i18n.resolvedLanguage || i18n.language)

  const select = (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      className={className}
    >
      {languages.map((lng) => (
        <option key={lng} value={lng}>
          {nativeLanguageName(lng)}
        </option>
      ))}
    </select>
  )

  if (!inline) return select

  return (
    <span className="language-picker-inline">
      <span aria-hidden="true">{nativeLanguageName(value)}</span>
      {select}
    </span>
  )
}
