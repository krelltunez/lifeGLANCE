import { useEffect, useRef, useCallback } from 'react'
import { pollEvents, isIntegrationEnabled } from '../lib/intentsTransport.js'
import { ACTIONS, SOURCE_APPS } from '@glance-apps/intents'

// Polls the WebDAV events directory while the component is mounted (foreground).
// Calls the appropriate handler for each inbound event:
//   onInboundCreate(payload)  — dayGLANCE pushed a new Goal → create milestone
//   onInboundNotify(payload)  — state change on a lG-originated task in dayGLANCE
//   onActivityEntry(entry)    — optional; receives { type, filename, payload } for the activity log
//
// Polling runs immediately on mount, then every `intervalMin` minutes (default 2).
export function useIntentPoller({
  onInboundCreate,
  onInboundNotify,
  onActivityEntry,
  intervalMin = 2,
}) {
  // Keep handler refs stable so the interval closure always sees the latest props.
  const createRef  = useRef(onInboundCreate)
  const notifyRef  = useRef(onInboundNotify)
  const activityRef = useRef(onActivityEntry)
  useEffect(() => { createRef.current  = onInboundCreate  }, [onInboundCreate])
  useEffect(() => { notifyRef.current  = onInboundNotify  }, [onInboundNotify])
  useEffect(() => { activityRef.current = onActivityEntry }, [onActivityEntry])

  const runPoll = useCallback(async () => {
    if (!isIntegrationEnabled()) return

    await pollEvents(async (envelope) => {
      const { action, payload, event_id, emitted_by } = envelope
      activityRef.current?.({ type: 'received', event_id, action, emitted_by, payload })

      if (action === ACTIONS.CREATE && emitted_by === SOURCE_APPS.DAYGLANCE) {
        await createRef.current?.(payload)
      } else if (action === ACTIONS.NOTIFY && payload.source_app === SOURCE_APPS.LIFEGLANCE) {
        await notifyRef.current?.(payload)
      }
    })
  }, [])

  useEffect(() => {
    runPoll()
    const ms = Math.max(1, intervalMin) * 60 * 1000
    const id = setInterval(runPoll, ms)
    return () => clearInterval(id)
  }, [runPoll, intervalMin])
}
