import { OrcaRuntimeWithRecordPtyWorktree } from './orca-runtime-record-pty-worktree'
import type { RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'
import { restoredTerminalTailSeedAllowed } from './terminal-tail-restore-seed'

export class OrcaRuntimeWithSeedAdoptedPtyRestoreTitle extends OrcaRuntimeWithRecordPtyWorktree {
  // Keyed by record so a pruned record drops its attempt; the value names the PTY incarnation tried.
  private readonly adoptedPtyTitleSeedAttempts = new WeakMap<RuntimePtyWorktreeRecord, string>()

  /**
   * Seeds the last title of a live session adopted from the controller inventory.
   *
   * Why: a headless runtime restart adopts surviving daemon sessions without a spawn, so the
   * restore title the spawn paths seed never arrives and idle agents read as unknown.
   * Why title only: adoption does not attach the session, so no live bytes follow a seed. A
   * seeded tail would freeze preview/read/tui-idle evidence that the provider fallbacks keep fresh.
   */
  protected seedAdoptedPtyRestoreTitle(pty: RuntimePtyWorktreeRecord): void {
    // Why local only: SSH relay providers serve no buffer snapshot, so asking is pure overhead.
    if (!this.ptyController?.serializeProviderBuffer || pty.connectionId !== null) {
      return
    }
    const ptyId = pty.ptyId
    const attempt = this.adoptedPtyTitleSeedAttempt(pty)
    if (this.adoptedPtyTitleSeedAttempts.get(pty) === attempt) {
      return
    }
    // Why: live bytes, a tracked title, or a spawn-path seed already gave this record its state.
    if (
      !restoredTerminalTailSeedAllowed(pty) ||
      this.getTrackedRawTitleForPty(ptyId) !== null ||
      (this.leavesByPtyId.get(ptyId) ?? []).some((leaf) => !restoredTerminalTailSeedAllowed(leaf))
    ) {
      return
    }
    this.adoptedPtyTitleSeedAttempts.set(pty, attempt)
    // Why fire-and-forget: the inventory listing is a hot path and must not wait on a snapshot.
    void this.applyAdoptedPtyRestoreTitle(pty, attempt).catch(() => {})
  }

  private adoptedPtyTitleSeedAttempt(pty: RuntimePtyWorktreeRecord): string {
    return `${this.getPtyLifecycleGeneration(pty.ptyId)}:${pty.incarnationId ?? ''}`
  }

  private async applyAdoptedPtyRestoreTitle(
    pty: RuntimePtyWorktreeRecord,
    attempt: string
  ): Promise<void> {
    const ptyId = pty.ptyId
    // Why direct, not the shared acquisition: that one is keyed by lifecycle generation, so a
    // replacement incarnation adopted mid-flight would join the predecessor's frame.
    // Why zero rows: only the title is used, so skip serializing scrollback.
    const snapshot = await this.ptyController?.serializeProviderBuffer?.(ptyId, {
      scrollbackRows: 0
    })
    // Why: a snapshot is only valid for the record and incarnation that asked.
    if (
      !snapshot?.lastTitle ||
      this.ptysById.get(ptyId) !== pty ||
      !pty.connected ||
      this.adoptedPtyTitleSeedAttempt(pty) !== attempt
    ) {
      return
    }
    // The seed already lets a title observed live while this was in flight win.
    this.seedTerminalRestoreTail(ptyId, { lastTitle: snapshot.lastTitle })
  }
}
