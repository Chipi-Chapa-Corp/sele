import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AppContainerTarget,
  AppFileTreeFile,
  AppSelectedAttachment
} from '../../../shared/app'
import { appApi } from '../appApi'
import type { ComposerMention } from '../composerMention'
import { maxSelectedAttachmentCount } from './composerLimits'
import {
  ProjectFileCache,
  applyMentionReplacement,
  getFileMentionResults,
  getMentionAttachmentPath,
  getMentionFileName,
  removeComposerMention
} from './mentionResults'

type FileMentionsDependencies = {
  editing: boolean
  selectedAttachments: AppSelectedAttachment[]
  projectCwd: string | null | undefined
  composerSourceKey: string
  container: AppContainerTarget | null
  setAttachmentSelectionError: Dispatch<SetStateAction<string | null>>
  message: string
  setMessage: Dispatch<SetStateAction<string>>
  setSelectedAttachments: Dispatch<SetStateAction<AppSelectedAttachment[]>>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function useFileMentions({
  editing,
  selectedAttachments,
  projectCwd,
  composerSourceKey,
  container,
  setAttachmentSelectionError,
  message,
  setMessage,
  setSelectedAttachments,
  textareaRef
}: FileMentionsDependencies) {
  const [fileMention, setFileMention] = useState<ComposerMention | null>(null)

  const [projectFileCache, setProjectFileCache] = useState<ProjectFileCache | null>(null)

  const [projectFilesErrorCwd, setProjectFilesErrorCwd] = useState<string | null>(null)

  const [projectFilesError, setProjectFilesError] = useState<string | null>(null)

  const [activeFileMentionIndex, setActiveFileMentionIndex] = useState(0)

  const fileMentionMenuOpen = Boolean(
    fileMention && !editing && selectedAttachments.length < maxSelectedAttachmentCount
  )

  const currentFileCache =
    projectCwd &&
    projectFileCache?.cwd === projectCwd &&
    projectFileCache.sourceKey === composerSourceKey
      ? projectFileCache
      : null

  const fileMentionResults = useMemo(
    () => getFileMentionResults(currentFileCache?.files ?? [], fileMention?.query ?? ''),
    [currentFileCache, fileMention?.query]
  )

  useEffect(() => {
    if (!fileMentionMenuOpen || !projectCwd || currentFileCache) return

    let active = true

    void appApi
      .getFileTree({ container, cwd: projectCwd })
      .then((result) => {
        if (!active) return
        setProjectFileCache({
          cwd: projectCwd,
          files: result.files,
          repositoryRoot: result.repositoryRoot,
          sourceKey: composerSourceKey
        })
        setProjectFilesErrorCwd(null)
      })
      .catch((error: unknown) => {
        console.error('Unable to load files for composer mentions.', error)
        if (!active) return
        setProjectFilesErrorCwd(projectCwd)
        setProjectFilesError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      active = false
    }
  }, [composerSourceKey, container, currentFileCache, fileMentionMenuOpen, projectCwd])

  const handleSelectFileMention = (file: AppFileTreeFile): void => {
    if (!fileMention || !currentFileCache) return

    const attachmentPath = getMentionAttachmentPath(currentFileCache.repositoryRoot, file.path)
    const attachmentAlreadySelected = selectedAttachments.some(
      (attachment) => attachment.path === attachmentPath
    )
    if (!attachmentAlreadySelected && selectedAttachments.length >= maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Attach up to ${maxSelectedAttachmentCount} files per message.`)
      setFileMention(null)
      return
    }

    applyMentionReplacement(removeComposerMention(message, fileMention), setMessage, textareaRef)
    setFileMention(null)
    setAttachmentSelectionError(null)
    if (!attachmentAlreadySelected) {
      setSelectedAttachments((currentAttachments) => [
        ...currentAttachments,
        {
          kind: 'file',
          name: getMentionFileName(file.path),
          path: attachmentPath
        }
      ])
    }
  }
  return {
    fileMention,
    setFileMention,
    currentFileCache,
    projectFilesErrorCwd,
    projectFilesError,
    activeFileMentionIndex,
    setActiveFileMentionIndex,
    fileMentionMenuOpen,
    fileMentionResults,
    handleSelectFileMention
  }
}
