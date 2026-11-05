import MarkdownWorker from './chatMarkdown.worker?worker'
import type { MarkdownPlanNode } from './markdownPlan'
import type { ProviderMessage } from '../../shared/provider'
import type { RecentChatReference } from './chatRecents'

type MarkdownRequest = {
  content: string
  interactiveFileLinks: boolean
  footnotePrefix: string
  baseUrl?: string
}
type Request =
  | (MarkdownRequest & { kind: 'markdown' })
  | { kind: 'references'; items: ProviderMessage[]; messageLimit: number }
type Job = {
  input: Request
  resolve: (result: unknown) => void
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
        else job?.resolve(job.input.kind === 'references' ? data.references : data.plan)
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
const requestJob = <Result>(input: Request) => {
  const id = ++sequence
  const result = new Promise<Result>((resolve, reject) => {
    jobs.set(id, { input, resolve: (value) => resolve(value as Result), reject })
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

export const requestMarkdownPlan = (input: MarkdownRequest) =>
  requestJob<MarkdownPlanNode[]>({ ...input, kind: 'markdown' })

export const requestChatReferences = (items: ProviderMessage[], messageLimit: number) =>
  requestJob<RecentChatReference[]>({ kind: 'references', items, messageLimit })
