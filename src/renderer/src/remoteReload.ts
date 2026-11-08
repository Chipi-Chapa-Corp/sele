/** Reconnecting replaces subscriptions by reloading the remote client. A native
 * picker must finish and its returned attachments must reach durable drafts first. */
export function createRemoteReload({
  settle,
  persist,
  reload,
  onError
}: {
  settle: () => Promise<void>
  persist: () => Promise<void>
  reload: () => void
  onError: (error: unknown) => void
}) {
  let holds = 0
  let requested = false
  let running = false
  let generation = 0

  const drain = async (): Promise<void> => {
    if (!requested || holds || running) return
    running = true
    const currentGeneration = generation
    try {
      // Resolving a picker/upload promise queues React's draft update. Give its
      // layout effects time to schedule the draft writer before flushing it.
      await settle()
      if (holds || generation !== currentGeneration) return
      await persist()
      if (holds || generation !== currentGeneration) return
      requested = false
      reload()
    } catch (error) {
      requested = false
      onError(error)
    } finally {
      running = false
      if (requested && !holds) void drain()
    }
  }

  return {
    request(): void {
      requested = true
      void drain()
    },
    hold(): () => void {
      generation++
      holds++
      let released = false
      return () => {
        if (released) return
        released = true
        holds--
        void drain()
      }
    }
  }
}
