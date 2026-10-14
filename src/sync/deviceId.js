// This device's stable id, shared by the GLANCEvault engine (its device id)
// and the Direct Access cycles (the writtenBy header that ranks relays
// between devices). Its own module so the folder tier can read it without
// importing dbSync.js, which imports the intents transport, which imports
// the folder tier: that was a cycle.

export const DEVICE_ID_KEY = 'lifeglance-db-sync-device-id'

export const ensureDeviceId = () => {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}
