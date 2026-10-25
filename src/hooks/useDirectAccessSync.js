import { directAccessTransport } from '../sync/directAccess.js'
import { useSnapshotFileSync } from './useSnapshotFileSync.js'

// Direct Access sync (docs/direct-access.md): the shared snapshot-file hook
// (useSnapshotFileSync.js) over the folder transport. Picking the folder is
// the decision, so this transport never asks the first-run question.

export { SKIPPED_RETRY_MS } from './useSnapshotFileSync.js'

/**
 * @param {object} [args] as useSnapshotFileSync, with the folder transport by default
 * @returns {{ runSync: () => Promise<string | null>, lastError: string | null }}
 */
export function useDirectAccessSync({ transport = directAccessTransport, ...rest } = {}) {
  const { runSync, lastError } = useSnapshotFileSync({ transport, ...rest })
  return { runSync, lastError }
}
