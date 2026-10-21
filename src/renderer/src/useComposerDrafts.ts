import { type SetStateAction, useCallback, useLayoutEffect, useState } from 'react'
import { createAfterPaintWriter } from './afterPaintWriter'
import {
  type ComposerDraftState,
  readStoredComposerDrafts,
  writeStoredComposerDrafts
} from './composerDraftStorage'

const resolveAction = <T>(current: T, action: SetStateAction<T>): T =>
  typeof action === 'function' ? (action as (value: T) => T)(current) : action

export const useComposerDrafts = (editing: boolean) => {
  const [state, setState] = useState(readStoredComposerDrafts)
  const [writer] = useState(() => createAfterPaintWriter(writeStoredComposerDrafts))
  const setComposerDrafts = useCallback(
    (action: SetStateAction<ComposerDraftState['composerDrafts']>) => {
      setState((current) => {
        const composerDrafts = resolveAction(current.composerDrafts, action)
        return composerDrafts === current.composerDrafts ? current : { ...current, composerDrafts }
      })
    },
    []
  )
  const setPromptDraftsByProject = useCallback(
    (action: SetStateAction<ComposerDraftState['promptDraftsByProject']>) => {
      setState((current) => {
        const promptDraftsByProject = resolveAction(current.promptDraftsByProject, action)
        return promptDraftsByProject === current.promptDraftsByProject
          ? current
          : { ...current, promptDraftsByProject }
      })
    },
    []
  )

  useLayoutEffect(() => {
    // Message editing temporarily replaces the composer. Keep the original unsent draft on disk.
    if (!editing) writer.schedule(state)
  }, [editing, state, writer])
  useLayoutEffect(() => () => writer.flush(), [writer])

  return { ...state, setComposerDrafts, setPromptDraftsByProject }
}
