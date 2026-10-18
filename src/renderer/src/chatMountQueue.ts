type MountJob = { priority: number; run: (complete: () => void) => void }

// Each turn's Markdown and DOM work gets its own paint opportunity. Waiting for
// completion also prevents React from combining all queued turns into one commit.
export const createChatMountQueue = (afterPaint: (run: () => void) => () => void) => {
  const jobs = new Set<MountJob>()
  let active: MountJob | null = null
  let cancelFrame: (() => void) | null = null
  const schedule = (): void => {
    if (active || cancelFrame || !jobs.size) return
    cancelFrame = afterPaint(() => {
      cancelFrame = null
      const next = [...jobs].sort((a, b) => b.priority - a.priority)[0]
      if (!next) return
      jobs.delete(next)
      active = next
      next.run(() => {
        if (active !== next) return
        active = null
        schedule()
      })
    })
  }
  return (run: MountJob['run'], priority: number): (() => void) => {
    const job = { run, priority }
    jobs.add(job)
    schedule()
    return () => {
      jobs.delete(job)
      if (active === job) active = null
      if (!jobs.size && cancelFrame) {
        cancelFrame()
        cancelFrame = null
      }
      schedule()
    }
  }
}

export const scheduleChatTurnMount = createChatMountQueue((run) => {
  let timer: number | null = null
  const frame = window.requestAnimationFrame(() => {
    timer = window.setTimeout(run, 0)
  })
  return () => {
    window.cancelAnimationFrame(frame)
    if (timer !== null) window.clearTimeout(timer)
  }
})
