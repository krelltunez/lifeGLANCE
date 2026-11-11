// How a Life is shown: its name (Me is always the translated "Me", with its
// nickname if it has one), its colour, and how a device that blocks the Lives
// gate is described.

import { ME_LIFE_ID } from '../../data/lifeMembership'

/** Display name. Me's official label is "Me" in the user's language. */
export function lifeName(life, t) {
  if (!life) return ''
  if (life.id === ME_LIFE_ID) return life.nickname ? `${t('me')} (${life.nickname})` : t('me')
  return life.name
}

/** The Life's accent colour; Me without a colour keeps the app's amber. */
export const lifeColor = (life) => life?.color || 'var(--amber)'

const PLATFORM_KEYS = { ios: 'platformIos', android: 'platformAndroid', web: 'platformWeb' }

/** One line for a device that keeps Lives off (lifeGate.js blockingWriters). */
export function blockingDeviceLabel(writer, t) {
  if (writer.legacy) return t('gateLegacyDevice')
  const platform = t(PLATFORM_KEYS[writer.platform] ?? 'platformUnknown')
  return writer.app ? t('gateDevice', { platform, app: writer.app }) : platform
}
