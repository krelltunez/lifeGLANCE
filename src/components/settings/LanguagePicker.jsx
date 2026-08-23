import React from 'react'
import { useTranslation } from 'react-i18next'
import { languages, resolveLanguage } from '../../locales'
import { nativeLanguageName } from '../../utils/languageName'

// Languages listed under their own names (see nativeLanguageName): someone who
// cannot read the current UI language has to be able to recognise theirs.
export default function LanguagePicker({ className, id, 'aria-label': ariaLabel }) {
  const { i18n } = useTranslation()
  // Same resolver the detector uses, so the option shown always matches the
  // language actually rendering. A select whose value matches no option
  // silently displays its first entry instead.
  const value = resolveLanguage(i18n.resolvedLanguage || i18n.language)

  return (
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
}
