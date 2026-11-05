import { Blocks, Package } from 'lucide-react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type DropdownOption } from '../components/Dropdown'
import { FileIcon as SymbolsFileIcon } from '../components/SymbolIcons'
import { composerMentionsEqual, getComposerMentionAtCaret } from '../composerMention'
import { getProjectDisplayName } from '../projectPresentation'
import { isTouchEditingActivation } from '../touchInput'
import {
  MentionMenuStyle,
  getFileMentionAtCaret,
  getMentionFileName,
  getMentionMenuStyle,
  getSkillMentionAtCaret,
  getSkillSummary,
  isComposerCacheCurrent
} from './mentionResults'
import { ProjectMentionIcon } from './ProjectMentionIcon'
import { useFileMentions } from './useFileMentions'
import { useProjectMentions } from './useProjectMentions'
import { useResourceMentions } from './useResourceMentions'

import type { MessageBoxProps } from '../components/MessageBox.types'
import type { useComposerDraftState } from './useComposerDraftState'

type ComposerMentionsDependencies = {
  options: Pick<
    MessageBoxProps,
    'container' | 'projectCwd' | 'providerId' | 'cwd' | 'providerResourcesRevision'
  >
  draft: Pick<
    ReturnType<typeof useComposerDraftState>,
    | 'message'
    | 'setMessage'
    | 'selectedAttachments'
    | 'setSelectedAttachments'
    | 'selectedSkills'
    | 'selectedApps'
    | 'setSelectedSkills'
    | 'setSelectedApps'
  >
  textareaRef: RefObject<HTMLTextAreaElement | null>
  editing: boolean
  setAttachmentSelectionError: Dispatch<SetStateAction<string | null>>
}

export function useComposerMentions({
  options,
  draft,
  textareaRef,
  editing,
  setAttachmentSelectionError
}: ComposerMentionsDependencies) {
  const {
    container = null,
    projectCwd,
    providerId,
    cwd = null,
    providerResourcesRevision = 0
  } = options
  const {
    message,
    setMessage,
    selectedAttachments,
    setSelectedAttachments,
    selectedSkills,
    selectedApps,
    setSelectedSkills,
    setSelectedApps
  } = draft

  const fileMentionListboxId = useId().replace(/:/g, '')

  const skillMentionListboxId = useId().replace(/:/g, '')

  const projectMentionListboxId = useId().replace(/:/g, '')

  const [mentionMenuStyle, setMentionMenuStyle] = useState<MentionMenuStyle | null>(null)

  const textareaWrapRef = useRef<HTMLDivElement>(null)

  const mentionMenuRef = useRef<HTMLDivElement>(null)

  const {
    projectMention,
    setProjectMention,
    mentionProjects,
    mentionProjectsError,
    activeProjectMentionIndex,
    setActiveProjectMentionIndex,
    projectMentionMenuOpen,
    projectMentionResults,
    handleSelectProjectMention
  } = useProjectMentions({ message, setMessage, textareaRef })

  const composerSourceKey = useMemo(() => JSON.stringify(container ?? null), [container])

  const {
    fileMention,
    setFileMention,
    projectFileCache,
    projectFilesErrorCwd,
    projectFilesError,
    activeFileMentionIndex,
    setActiveFileMentionIndex,
    fileMentionMenuOpen,
    fileMentionResults,
    handleSelectFileMention
  } = useFileMentions({
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
  })

  const {
    skillMention,
    setSkillMention,
    composerCache,
    composerLoadErrorScope,
    activeSkillMentionIndex,
    setActiveSkillMentionIndex,
    skillScope,
    skillMentionMenuOpen,
    composerResults,
    handleSelectComposerMention
  } = useResourceMentions({
    providerId,
    cwd,
    composerSourceKey,
    selectedSkills,
    selectedApps,
    providerResourcesRevision,
    container,
    message,
    setMessage,
    setSelectedSkills,
    setSelectedApps,
    textareaRef
  })

  const mentionDropdownOptions = useMemo<DropdownOption<string>[]>(
    () =>
      projectMentionMenuOpen
        ? projectMentionResults.map((project, index) => ({
            value: String(index),
            label: getProjectDisplayName(project),
            description: project.cwd,
            icon: <ProjectMentionIcon key={project.cwd} project={project} />
          }))
        : skillMentionMenuOpen
          ? composerResults.map((result, index) => {
              const skill = result.kind === 'skill' ? result.skill : null
              const app = result.kind === 'app' ? result.app : null

              return {
                value: String(index),
                label: skill?.displayName || skill?.name || app?.name || '',
                description: skill ? getSkillSummary(skill) : 'App',
                icon: skill ? <Package aria-hidden="true" /> : <Blocks aria-hidden="true" />
              }
            })
          : fileMentionMenuOpen
            ? fileMentionResults.map((file, index) => ({
                value: String(index),
                label: getMentionFileName(file.path),
                description: file.path,
                icon: <SymbolsFileIcon fileName={getMentionFileName(file.path)} autoAssign />
              }))
            : [],
    [
      composerResults,
      fileMentionMenuOpen,
      fileMentionResults,
      skillMentionMenuOpen,
      projectMentionMenuOpen,
      projectMentionResults
    ]
  )

  const mentionMenuOpen = projectMentionMenuOpen || skillMentionMenuOpen || fileMentionMenuOpen

  const activeMentionIndex = projectMentionMenuOpen
    ? activeProjectMentionIndex
    : skillMentionMenuOpen
      ? activeSkillMentionIndex
      : activeFileMentionIndex

  const mentionListboxId = projectMentionMenuOpen
    ? projectMentionListboxId
    : skillMentionMenuOpen
      ? skillMentionListboxId
      : fileMentionListboxId

  const setActiveMentionIndex = projectMentionMenuOpen
    ? setActiveProjectMentionIndex
    : skillMentionMenuOpen
      ? setActiveSkillMentionIndex
      : setActiveFileMentionIndex

  const updateMentionMenuPosition = useCallback((): void => {
    const anchorRect = textareaWrapRef.current?.getBoundingClientRect()

    if (
      !anchorRect ||
      anchorRect.bottom < 0 ||
      anchorRect.top > window.innerHeight ||
      anchorRect.width <= 0
    ) {
      setMentionMenuStyle(null)
      return
    }

    setMentionMenuStyle(getMentionMenuStyle(anchorRect))
  }, [])

  useLayoutEffect(() => {
    if (!mentionMenuOpen) return

    updateMentionMenuPosition()

    const handleScroll = (event: Event): void => {
      if (event.target instanceof Node && mentionMenuRef.current?.contains(event.target)) return

      updateMentionMenuPosition()
    }
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => updateMentionMenuPosition())

    if (textareaWrapRef.current) resizeObserver?.observe(textareaWrapRef.current)
    window.addEventListener('resize', updateMentionMenuPosition)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateMentionMenuPosition)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [mentionMenuOpen, updateMentionMenuPosition])

  const updateMessageMentions = (textarea: HTMLTextAreaElement): void => {
    const collapsed = textarea.selectionStart === textarea.selectionEnd
    const nextProjectMention = collapsed
      ? getComposerMentionAtCaret(textarea.value, textarea.selectionStart, '#')
      : null
    if (!composerMentionsEqual(nextProjectMention, projectMention)) {
      setProjectMention(nextProjectMention)
      setActiveProjectMentionIndex(0)
    }
    const nextFileMention = collapsed
      ? getFileMentionAtCaret(textarea.value, textarea.selectionStart)
      : null
    const nextSkillMention = collapsed
      ? getSkillMentionAtCaret(textarea.value, textarea.selectionStart)
      : null
    if (!composerMentionsEqual(nextFileMention, fileMention)) {
      setFileMention(nextFileMention)
      setActiveFileMentionIndex(0)
    }
    if (!composerMentionsEqual(nextSkillMention, skillMention)) {
      setSkillMention(nextSkillMention)
      setActiveSkillMentionIndex(0)
    }
  }

  const handleMessageSelect = (event: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    // Android can briefly report caret 0 while a suggestion is being tapped.
    // That platform selection must not unmount the option before pointer-up.
    if (!isTouchEditingActivation(event.currentTarget.ownerDocument))
      updateMessageMentions(event.currentTarget)
  }

  const handleSelectMentionDropdown = (value: string): void => {
    const index = Number(value)
    if (!Number.isInteger(index) || index < 0) return

    if (projectMentionMenuOpen) {
      const project = projectMentionResults[index]
      if (project) handleSelectProjectMention(project)
      return
    }
    if (skillMentionMenuOpen) {
      const result = composerResults[index]
      if (result) handleSelectComposerMention(result)
      return
    }

    const file = fileMentionResults[index]
    if (file) handleSelectFileMention(file)
  }

  const mentionDropdownEmptyContent = projectMentionMenuOpen ? (
    <div className="message-box__file-mention-status">
      {mentionProjectsError
        ? 'Unable to load projects'
        : mentionProjects === null
          ? 'Loading projects…'
          : 'No matching projects'}
    </div>
  ) : skillMentionMenuOpen ? (
    composerLoadErrorScope === skillScope ? (
      <div className="message-box__file-mention-status">Unable to load skills and apps</div>
    ) : !isComposerCacheCurrent(
        composerCache,
        providerId,
        cwd,
        composerSourceKey,
        providerResourcesRevision
      ) ? (
      <div className="message-box__file-mention-status">Loading skills and apps…</div>
    ) : (
      <div className="message-box__file-mention-status">No matching skills or apps</div>
    )
  ) : !projectCwd ? (
    <div className="message-box__file-mention-status">No project selected</div>
  ) : projectFilesErrorCwd === projectCwd ? (
    <div className="message-box__file-mention-status" role="alert">
      Could not list files in {projectCwd}: {projectFilesError}
    </div>
  ) : projectFileCache?.cwd !== projectCwd || projectFileCache.sourceKey !== composerSourceKey ? (
    <div className="message-box__file-mention-status">Searching files…</div>
  ) : (
    <div className="message-box__file-mention-status">No matching files</div>
  )
  return {
    mentionMenuStyle,
    textareaWrapRef,
    mentionMenuRef,
    setProjectMention,
    activeProjectMentionIndex,
    setActiveProjectMentionIndex,
    projectMentionMenuOpen,
    projectMentionResults,
    handleSelectProjectMention,
    composerSourceKey,
    setFileMention,
    activeFileMentionIndex,
    setActiveFileMentionIndex,
    fileMentionMenuOpen,
    fileMentionResults,
    handleSelectFileMention,
    setSkillMention,
    composerCache,
    activeSkillMentionIndex,
    setActiveSkillMentionIndex,
    skillMentionMenuOpen,
    composerResults,
    handleSelectComposerMention,
    mentionDropdownOptions,
    mentionMenuOpen,
    activeMentionIndex,
    mentionListboxId,
    setActiveMentionIndex,
    updateMessageMentions,
    handleMessageSelect,
    handleSelectMentionDropdown,
    mentionDropdownEmptyContent
  }
}
