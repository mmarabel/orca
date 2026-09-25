// Why: every host-list write is a read-modify-write over one AsyncStorage key, so they run one at
// a time here — two concurrent writers reading the same base would silently drop one's update.
let hostListMutation: Promise<void> = Promise.resolve()

/** Settles once every mutation queued so far has finished. */
export const settled = (): Promise<void> => hostListMutation

export function enqueue(operation: () => Promise<void>): Promise<void> {
  const mutation = hostListMutation.then(operation)
  hostListMutation = mutation.catch(() => {})
  return mutation
}

/** Queues work whose result no caller awaits, so a slow or failing operation cannot stall them. */
export function chain(operation: () => Promise<void>): void {
  hostListMutation = hostListMutation.then(operation).catch(() => {})
}

/** Test-only: drain the module mutation chain between cases. */
export function resetForTests(): void {
  hostListMutation = Promise.resolve()
}
