import { type SetStateAction, useCallback, useLayoutEffect, useState } from 'react'
import { createAfterPaintWriter } from './afterPaintWriter'
import {
  type ComposerDraftState,
  readStoredComposerDrafts,
  subscribeComposerDrafts,
  writeStoredComposerDrafts
} from './composerDraftStorage'

const resolveAction = <T>(current: T, action: SetStateAction<T>): T =>
  typeof action === 'function' ? (action as (value: T) => T)(current) : action

export const useComposerDrafts = (editing: boolean) => {
  const [state, setState] = useState(readStoredComposerDrafts)
  const [writer] = useState(() => createAfterPaintWriter(writeStoredComposerDrafts))
  useLayoutEffect(() => subscribeComposerDrafts(setState), [])
  const setComposerDrafts = useCallback(
    (action: SetStateAction<ComposerDraftState['composerDrafts']>) => {
      setState((current) => {
        const composerDrafts = resolveAction(current.composerDrafts, action)
        return composerDrafts === current.composerDrafts ? current : { ...current, composerDrafts }
      })
    },
    []
  )
  const setPromptDraftsByScope = useCallback(
    (action: SetStateAction<ComposerDraftState['promptDraftsByScope']>) => {
      setState((current) => {
        const promptDraftsByScope = resolveAction(current.promptDraftsByScope, action)
        return promptDraftsByScope === current.promptDraftsByScope
          ? current
          : { ...current, promptDraftsByScope }
      })
    },
    []
  )

  useLayoutEffect(() => {
    // Message editing temporarily replaces the composer. Keep the original unsent draft on disk.
    if (!editing) writer.schedule(state)
  }, [editing, state, writer])
  useLayoutEffect(() => () => writer.flush(), [writer])

  return { ...state, setComposerDrafts, setPromptDraftsByScope }
}
