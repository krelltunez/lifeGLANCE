import { useCallback, useEffect, useState } from 'react'
import { desktopBridge } from '../native/desktop.js'

/**
 * The origins the desktop app may reach on a private network, from its main
 * process (sync/privateAddress.js). Empty, and inert, off the desktop.
 *
 * @returns {{ grants: { origin: string, grantedAt: string, addresses: string[] }[], refresh: () => Promise<void>, revoke: (origin: string) => Promise<void> }}
 */
export function usePrivateAddressGrants() {
  const http = desktopBridge()?.http ?? null
  const [grants, setGrants] = useState([])

  const refresh = useCallback(async () => {
    if (!http) return
    try {
      const list = await http.grants()
      setGrants(Array.isArray(list) ? list : [])
    } catch {
      // The list is informational; the next refresh shows the truth.
    }
  }, [http])

  const revoke = useCallback(async (origin) => {
    if (!http) return
    try { await http.revoke(origin) } finally { await refresh() }
  }, [http, refresh])

  useEffect(() => {
    if (!http) return
    let live = true
    http.grants().then((list) => { if (live) setGrants(Array.isArray(list) ? list : []) }).catch(() => {})
    return () => { live = false }
  }, [http])

  return { grants, refresh, revoke }
}
