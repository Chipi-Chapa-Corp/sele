import { startTransition, useEffect, useMemo } from 'react'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderChatItem } from '../../../shared/provider'
import { appApi } from '../appApi'
import {
  getChatChangedFiles,
  getLastTurnChangedFiles,
  getCommitPatches,
  getPatchFilterSignature,
  isPatchChangeSource,
  type ChangeSource,
  type PatchFilterScope
} from '../changeTree'
import { getErrorMessage } from './chatControllerUtils'
import type { WorkspaceSelectionDependencies } from './selectionDependencies'

type Dependencies = Pick<
  WorkspaceSelectionDependencies,
  | 'setUncommittedPatchFilter'
  | 'setUncommittedPatchFilterState'
  | 'setUncommittedPatchFilterError'
  | 'setGitChangeLoadErrorDismissed'
> & {
  changeSource: ChangeSource
  changesContainer: AppContainerTarget | null
  changesContainerKey: string
  changesCwd: string | null
  items: readonly ProviderChatItem[] | undefined
  gitChangeLoadRequest: number
}

export function useUncommittedPatchFilter({
  changeSource,
  changesContainer,
  changesContainerKey,
  changesCwd,
  items,
  gitChangeLoadRequest,
  setUncommittedPatchFilter,
  setUncommittedPatchFilterState,
  setUncommittedPatchFilterError,
  setGitChangeLoadErrorDismissed
}: Dependencies): void {
  const patchItems = changesCwd && isPatchChangeSource(changeSource) ? items : undefined
  const patches = useMemo(
    () =>
      patchItems
        ? getCommitPatches(
            changeSource === 'chat'
              ? getChatChangedFiles(patchItems)
              : getLastTurnChangedFiles(patchItems)
          )
        : [],
    [patchItems, changeSource]
  )
  const signature = getPatchFilterSignature(patches)
  // The scope signature identifies patch contents. Text-only updates must not
  // reset state or repeat an IPC request, even while a transition is pending.
  // biome-ignore lint/correctness/useExhaustiveDependencies: patches are keyed by their signature.
  useEffect(() => {
    let active = true

    if (!changesCwd || !isPatchChangeSource(changeSource)) {
      startTransition(() => {
        if (!active) return
        setGitChangeLoadErrorDismissed(false)
        setUncommittedPatchFilterError(null)
        setUncommittedPatchFilterState('ready')
      })

      return () => {
        active = false
      }
    }

    const scope: PatchFilterScope = {
      containerKey: changesContainerKey,
      cwd: changesCwd,
      source: changeSource,
      signature
    }

    if (patches.length === 0) {
      startTransition(() => {
        if (!active) return

        setUncommittedPatchFilter({ scope, patches: [] })
        setGitChangeLoadErrorDismissed(false)
        setUncommittedPatchFilterError(null)
        setUncommittedPatchFilterState('ready')
      })

      return () => {
        active = false
      }
    }

    startTransition(() => {
      if (!active) return
      setGitChangeLoadErrorDismissed(false)
      setUncommittedPatchFilterError(null)
      setUncommittedPatchFilterState('loading')
    })

    appApi
      .getUncommittedGitPatchChanges({ container: changesContainer, cwd: changesCwd, patches })
      .then((result) => {
        if (!active) return

        startTransition(() => {
          setUncommittedPatchFilter({ scope, patches: result.patches })
          setGitChangeLoadErrorDismissed(false)
          setUncommittedPatchFilterError(null)
          setUncommittedPatchFilterState('ready')
        })
      })
      .catch((error) => {
        console.error('[caught:useWorkspaceSelection:useWorkspaceSelection]', error)

        if (!active) return

        setGitChangeLoadErrorDismissed(false)
        setUncommittedPatchFilterError({
          scope,
          cwd: changesCwd,
          error: getErrorMessage(error, 'Unable to filter Git changes.'),
          operation: 'Filter Git changes'
        })
        setUncommittedPatchFilterState('error')
      })

    return () => {
      active = false
    }
  }, [
    changeSource,
    changesContainer,
    changesContainerKey,
    changesCwd,
    signature,
    gitChangeLoadRequest
  ])
}
