import { useCallback, useRef } from 'react'

// The workspace controller rebuilds every panel's props on each render, with new
// handler functions and wrapper objects. This keeps a panel's props object, and
// therefore its memo(), unchanged unless something it shows actually changed.
//
// - Event handlers become stable wrappers that call the latest handler. They must
//   not be called during rendering: a skipped render would keep using the result.
// - Functions called while rendering (`render*`, `get*` and `renderFunctions`)
//   are kept as is. Those must come from useCallback/useMemo or module scope,
//   otherwise the panel rerenders every time, which is still correct.
// - Arrays with the same elements and the listed nested plain objects are
//   compared one level deeper.

type StableOptions = {
  renderFunctions?: readonly string[]
  nested?: readonly string[]
}

type StableState = {
  previous: Record<string, unknown> | null
  handlers: Map<string, { latest: (...args: unknown[]) => unknown; stable: unknown }>
  nested: Map<string, StableState>
}

const createState = (): StableState => ({ previous: null, handlers: new Map(), nested: new Map() })

const isRenderFunction = (key: string, options: StableOptions): boolean =>
  key.startsWith('render') ||
  key.startsWith('get') ||
  Boolean(options.renderFunctions?.includes(key))

const areArraysShallowEqual = (first: readonly unknown[], second: readonly unknown[]): boolean =>
  first.length === second.length && first.every((value, index) => Object.is(value, second[index]))

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

export const stabilizeProps = <Props extends object>(
  state: StableState,
  props: Props,
  options: StableOptions = {}
): Props => {
  const previous = state.previous
  const next: Record<string, unknown> = {}
  let changed = !previous || Object.keys(previous).length !== Object.keys(props).length

  for (const [key, value] of Object.entries(props)) {
    let stableValue = value
    if (typeof value === 'function' && !isRenderFunction(key, options)) {
      let handler = state.handlers.get(key)
      if (!handler) {
        const entry = {
          latest: value as (...args: unknown[]) => unknown,
          stable: undefined as unknown
        }
        entry.stable = (...args: unknown[]) => entry.latest(...args)
        state.handlers.set(key, entry)
        handler = entry
      }
      handler.latest = value as (...args: unknown[]) => unknown
      stableValue = handler.stable
    } else if (options.nested?.includes(key) && isPlainObject(value)) {
      let nestedState = state.nested.get(key)
      if (!nestedState) {
        nestedState = createState()
        state.nested.set(key, nestedState)
      }
      stableValue = stabilizeProps(nestedState, value, options)
    } else if (
      previous &&
      Array.isArray(value) &&
      Array.isArray(previous[key]) &&
      areArraysShallowEqual(value, previous[key] as unknown[])
    ) {
      stableValue = previous[key]
    }

    next[key] = stableValue
    if (!changed && (!previous || !(key in previous) || !Object.is(previous[key], stableValue))) {
      changed = true
    }
  }

  if (!changed && previous) return previous as Props
  state.previous = next
  return next as Props
}

export const useStableProps = <Props extends object>(
  props: Props,
  options?: StableOptions
): Props => {
  const state = useRef<StableState | null>(null)
  state.current ??= createState()
  return stabilizeProps(state.current, props, options)
}

/**
 * A stable function that calls the latest `handler`. For event handlers used by
 * memoized render functions; never call it while rendering.
 */
export const useLatestHandler = <Args extends unknown[], Result>(
  handler: (...args: Args) => Result
): ((...args: Args) => Result) => {
  const latest = useRef(handler)
  latest.current = handler
  return useCallback((...args: Args) => latest.current(...args), [])
}

/** Returns the previous object while every property is identical. */
export const useShallowStable = <Value extends object>(value: Value): Value => {
  const previous = useRef<Value | null>(null)
  const current = previous.current
  if (
    current &&
    Object.keys(current).length === Object.keys(value).length &&
    Object.entries(value).every(([key, item]) =>
      Object.is((current as Record<string, unknown>)[key], item)
    )
  ) {
    return current
  }
  previous.current = value
  return value
}
