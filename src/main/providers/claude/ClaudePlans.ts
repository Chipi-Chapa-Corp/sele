import type { ProviderPlan, ProviderPlanItem } from '../../../shared/provider.ts'

type Task = ProviderPlanItem & { id: string }
type Call = { name: string; input: Record<string, unknown> }
export type ClaudePlanState = {
  tasks: Map<string, Task>
  calls: Map<string, Call>
  revision: number
}

export const createClaudePlanState = (): ClaudePlanState => ({
  tasks: new Map(),
  calls: new Map(),
  revision: 0
})

const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const string = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const status = (value: unknown): ProviderPlanItem['status'] | null =>
  value === 'pending' || value === 'in_progress' || value === 'completed' ? value : null

const task = (value: unknown): Task | null => {
  const item = record(value)
  const id = string(item?.id)
  const step = string(item?.subject)
  const state = status(item?.status)
  return id && step && state ? { id, step, status: state } : null
}

export const trackClaudePlanCall = (
  state: ClaudePlanState,
  id: string,
  name: unknown,
  input: unknown
): ClaudePlanState => {
  if (
    typeof name !== 'string' ||
    !['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite', 'TodoRead'].includes(name)
  )
    return state
  const calls = new Map(state.calls)
  calls.set(id, { name, input: record(input) ?? {} })
  return { ...state, calls }
}

const resultRecord = (value: unknown, text: string | null): Record<string, unknown> | null => {
  const structured = record(value)
  if (structured) return structured
  if (!text?.trim().startsWith('{')) return null
  try {
    return record(JSON.parse(text))
  } catch {
    // Most native results are human-readable text rather than JSON.
    return null
  }
}

/** Native task IDs come from successful results, never from guessed creation order. */
export const finishClaudePlanCall = (
  state: ClaudePlanState,
  id: string,
  value: unknown,
  text: string | null,
  failed: boolean
): { state: ClaudePlanState; plan?: ProviderPlan } => {
  const call = state.calls.get(id)
  if (!call) return { state }
  const calls = new Map(state.calls)
  calls.delete(id)
  const next = { ...state, calls }
  const output = resultRecord(value, text)
  if (failed || output?.success === false) return { state: next }

  let tasks = new Map(state.tasks)
  const { name, input } = call
  if (name === 'TodoWrite' || name === 'TodoRead') {
    const todos = name === 'TodoWrite' ? input.todos : output?.todos
    if (!Array.isArray(todos)) return { state: next }
    const items = todos.flatMap((value): ProviderPlanItem[] => {
      const item = record(value)
      const step = string(item?.content)
      const state = status(item?.status)
      return step && state ? [{ step, status: state }] : []
    })
    // An incomplete or malformed payload must not erase the last valid plan.
    if (items.length !== todos.length) return { state: next }
    const revision = state.revision + 1
    return { state: { ...next, tasks: new Map(), revision }, plan: { items, revision } }
  }

  if (name === 'TaskCreate') {
    const created = record(output?.task)
    const id = string(created?.id) ?? text?.match(/Task #(\S+) created successfully/)?.[1]
    const step = string(created?.subject) ?? string(input.subject)
    if (!id || !step) return { state: next }
    tasks.set(id, { id, step, status: 'pending' })
  } else if (name === 'TaskUpdate') {
    const id = string(input.taskId)
    if (!id) return { state: next }
    if (input.status === 'deleted') tasks.delete(id)
    else {
      const previous = tasks.get(id)
      const step = string(input.subject) ?? previous?.step
      const state = status(input.status) ?? previous?.status ?? 'pending'
      if (!step) return { state: next }
      tasks.set(id, { id, step, status: state })
    }
  } else if (name === 'TaskGet') {
    const header = text?.match(/^Task #(\S+): (.+)$/m)
    const item =
      task(output?.task) ??
      (header
        ? task({
            id: header[1],
            subject: header[2],
            status: text?.match(/^Status: (pending|in_progress|completed)$/m)?.[1]
          })
        : null)
    if (!item) return { state: next }
    tasks.set(item.id, item)
  } else if (name === 'TaskList') {
    const list = Array.isArray(output?.tasks)
      ? output.tasks
      : text?.trim() === 'No tasks found'
        ? []
        : text
            ?.trim()
            .split('\n')
            .map((line) => {
              const match = line.match(/^#(\S+) \[(pending|in_progress|completed)\] (.+)$/)
              return match ? { id: match[1], status: match[2], subject: match[3] } : null
            })
    if (!list) return { state: next }
    const items = list.map(task)
    if (items.some((item) => !item)) return { state: next }
    tasks = new Map(items.map((item) => [item!.id, item!]))
  }

  const revision = state.revision + 1
  return {
    state: { ...next, tasks, revision },
    plan: { items: [...tasks.values()].map(({ step, status }) => ({ step, status })), revision }
  }
}
