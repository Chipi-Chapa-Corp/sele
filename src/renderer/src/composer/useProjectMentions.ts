import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { AppProject } from '../../../shared/app'
import { appApi } from '../appApi'
import { getProjectMentionResults, replaceProjectMention } from '../projectMention'
import { FileMention } from './mentionResults'

type ProjectMentionsDependencies = {
  message: string
  setMessage: Dispatch<SetStateAction<string>>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function useProjectMentions({
  message,
  setMessage,
  textareaRef
}: ProjectMentionsDependencies) {
  const [projectMention, setProjectMention] = useState<FileMention | null>(null)

  const [mentionProjects, setMentionProjects] = useState<AppProject[] | null>(null)

  const [mentionProjectsError, setMentionProjectsError] = useState(false)

  const [activeProjectMentionIndex, setActiveProjectMentionIndex] = useState(0)

  const projectMentionMenuOpen = Boolean(projectMention)

  const projectMentionResults = useMemo(
    () => getProjectMentionResults(mentionProjects ?? [], projectMention?.query ?? ''),
    [mentionProjects, projectMention?.query]
  )

  useEffect(() => {
    if (!projectMentionMenuOpen) return
    let cancelled = false
    setMentionProjects(null)
    setMentionProjectsError(false)
    void appApi.getProjects().then(
      (projects) => {
        if (!cancelled) setMentionProjects(projects)
      },
      (error: unknown) => {
        console.error('Unable to load projects for composer mentions.', error)
        if (!cancelled) setMentionProjectsError(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [projectMentionMenuOpen])

  const handleSelectProjectMention = (project: AppProject): void => {
    if (!projectMention) return
    const replacement = replaceProjectMention(message, projectMention, project)
    setMessage(replacement.message)
    setProjectMention(null)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(replacement.caret, replacement.caret)
    })
  }
  return {
    projectMention,
    setProjectMention,
    mentionProjects,
    mentionProjectsError,
    activeProjectMentionIndex,
    setActiveProjectMentionIndex,
    projectMentionMenuOpen,
    projectMentionResults,
    handleSelectProjectMention
  }
}
