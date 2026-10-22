import MarkdownWorker from './chatMarkdown.worker?worker'
import type { MarkdownPlanNode } from './markdownPlan'

type Request = { content: string; interactiveFileLinks: boolean; footnotePrefix: string }
type Job = {
  input: Request
  resolve: (plan: MarkdownPlanNode[]) => void
  reject: (error: Error) => void
}
const jobs = new Map<number, Job>()
let worker: Worker | null = null
let active: number | null = null
let sequence = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null

const fail = (error: Error): void => {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  worker?.terminate()
  worker = null
  active = null
  for (const job of jobs.values()) job.reject(error)
  jobs.clear()
}

const drain = (): void => {
  if (active !== null || !jobs.size) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  try {
    if (!worker) {
      worker = new MarkdownWorker()
      worker.onmessage = ({ data }) => {
        if (data.id !== active) return
        const job = jobs.get(data.id)
        jobs.delete(data.id)
        active = null
        if (data.error) job?.reject(new Error(data.error))
        else job?.resolve(data.plan)
        drain()
        if (active === null && !jobs.size)
          idleTimer = setTimeout(() => {
            worker?.terminate()
            worker = null
            idleTimer = null
          }, 30_000)
      }
      worker.onerror = (event) => fail(new Error(event.message || 'Markdown worker failed'))
      worker.onmessageerror = () => fail(new Error('Unable to receive rendered Markdown'))
    }
    const [id, job] = jobs.entries().next().value!
    active = id
    worker.postMessage({ id, ...job.input })
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)))
  }
}

/** One worker, one active render, and at most one queued revision per mounted message. */
export const requestMarkdownPlan = (input: Request) => {
  const id = ++sequence
  const result = new Promise<MarkdownPlanNode[]>((resolve, reject) => {
    jobs.set(id, { input, resolve, reject })
    drain()
  })
  return {
    result,
    cancel: () => {
      jobs.delete(id)
      // Let an active revision finish. Restarting its worker on each stream chunk can starve
      // slow renders forever; its result is discarded and only the latest queued input runs.
    }
  }
}
