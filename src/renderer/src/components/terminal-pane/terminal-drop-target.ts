import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { readLastTerminalInputAt } from '@/lib/terminal-input-activity-coalescing'
import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { PtyTransport } from './pty-transport'

export type CapturedTerminalDropTarget = {
  paneId: number
  leafId: string
  ptyId: string | null
  transport: PtyTransport
  tabId?: string
  inputStampAtDrop?: number
}

function readPaneInputStamp(tabId: string | undefined, leafId: string): number | undefined {
  if (tabId === undefined) {
    return undefined
  }
  try {
    const state = useAppStore.getState()
    return readLastTerminalInputAt(state.lastTerminalInputAtByPaneKey, makePaneKey(tabId, leafId))
  } catch {
    // Legacy/malformed layouts have no pane key, so they never report typed-since-drop.
    return undefined
  }
}

export function captureTerminalDropTarget(
  pane: { id: number; leafId: string },
  transport: PtyTransport,
  tabId: string
): CapturedTerminalDropTarget {
  return {
    paneId: pane.id,
    leafId: pane.leafId,
    ptyId: transport.getPtyId(),
    transport,
    tabId,
    inputStampAtDrop: readPaneInputStamp(tabId, pane.leafId)
  }
}

/** True when input reached the drop's pane after capture, e.g. typing during an upload. */
export function hasTerminalInputSinceDropCapture(target: CapturedTerminalDropTarget): boolean {
  return readPaneInputStamp(target.tabId, target.leafId) !== target.inputStampAtDrop
}

export function getCurrentTerminalDropTransport(
  manager: PaneManager,
  paneTransports: Map<number, PtyTransport>,
  target: CapturedTerminalDropTarget
): PtyTransport | null {
  const liveTransport = paneTransports.get(target.paneId)
  if (
    liveTransport !== target.transport ||
    !liveTransport.isConnected() ||
    liveTransport.getPtyId() !== target.ptyId
  ) {
    return null
  }
  const activePane = manager.getActivePane()
  const paneStillMounted =
    manager.getPanes().some((pane) => pane.id === target.paneId && pane.leafId === target.leafId) ||
    (activePane?.id === target.paneId && activePane.leafId === target.leafId)
  return paneStillMounted ? liveTransport : null
}
