type MountJob = { priority: number; queuedAt: number; run: (complete: () => void) => void }
const maxPriorityWaitMs = 250

// Each turn's Markdown and DOM work gets its own paint opportunity. Waiting for
// completion also prevents React from combining all queued turns into one commit.
export const createChatMountQueue = (
  afterPaint: (run: () => void) => () => void,
  now: () => number = () => performance.now()
) => {
  const jobs = new Set<MountJob>()
  let active: MountJob | null = null
  let cancelFrame: (() => void) | null = null
  const schedule = (): void => {
    if (active || cancelFrame || !jobs.size) return
    cancelFrame = afterPaint(() => {
      cancelFrame = null
      // Newest history gets priority initially, but a stream can keep adding
      // higher-priority Markdown leaves forever. Once a job has waited, drain
      // in arrival order so older turns and other conversations cannot starve.
      const oldest = jobs.values().next().value
      let next = oldest
      if (oldest && now() - oldest.queuedAt < maxPriorityWaitMs) {
        for (const job of jobs) if (next && job.priority > next.priority) next = job
      }
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
    const job = { run, priority, queuedAt: now() }
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
