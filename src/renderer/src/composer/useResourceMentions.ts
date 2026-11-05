import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderApp, ProviderSkill } from '../../../shared/provider'
import { providerApi } from '../providerApi'
import { maxSelectedAppCount, maxSelectedSkillCount } from './composerLimits'
import {
  ComposerCache,
  ComposerResult,
  SkillMention,
  getComposerResults,
  isComposerCacheCurrent
} from './mentionResults'

type ResourceMentionsDependencies = {
  providerId: 'codex' | 'claude' | 'copilot' | 'opencode-v2'
  cwd: string | null
  composerSourceKey: string
  selectedSkills: ProviderSkill[]
  selectedApps: ProviderApp[]
  providerResourcesRevision: number
  container: AppContainerTarget | null
  message: string
  setMessage: Dispatch<SetStateAction<string>>
  setSelectedSkills: Dispatch<SetStateAction<ProviderSkill[]>>
  setSelectedApps: Dispatch<SetStateAction<ProviderApp[]>>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function useResourceMentions({
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
}: ResourceMentionsDependencies) {
  const [skillMention, setSkillMention] = useState<SkillMention | null>(null)

  const [composerCache, setComposerCache] = useState<ComposerCache | null>(null)

  const [composerLoadErrorScope, setComposerLoadErrorScope] = useState<string | null>(null)

  const [activeSkillMentionIndex, setActiveSkillMentionIndex] = useState(0)

  const skillScope = `${providerId}\0${cwd ?? ''}\0${composerSourceKey}`

  const skillMentionMenuOpen = Boolean(
    skillMention &&
      (selectedSkills.length < maxSelectedSkillCount || selectedApps.length < maxSelectedAppCount)
  )

  const composerResults = useMemo(
    () =>
      getComposerResults(
        isComposerCacheCurrent(
          composerCache,
          providerId,
          cwd,
          composerSourceKey,
          providerResourcesRevision
        )
          ? composerCache.skills
          : [],
        isComposerCacheCurrent(
          composerCache,
          providerId,
          cwd,
          composerSourceKey,
          providerResourcesRevision
        )
          ? composerCache.apps
          : [],
        skillMention?.query ?? ''
      ).filter((result) =>
        result.kind === 'skill'
          ? selectedSkills.length < maxSelectedSkillCount &&
            !selectedSkills.some((selectedSkill) => selectedSkill.path === result.skill.path)
          : selectedApps.length < maxSelectedAppCount &&
            !selectedApps.some((selectedApp) => selectedApp.id === result.app.id)
      ),
    [
      composerCache,
      composerSourceKey,
      cwd,
      providerId,
      providerResourcesRevision,
      selectedApps,
      selectedSkills,
      skillMention?.query
    ]
  )

  useEffect(() => {
    if (
      !skillMentionMenuOpen ||
      isComposerCacheCurrent(
        composerCache,
        providerId,
        cwd,
        composerSourceKey,
        providerResourcesRevision
      )
    ) {
      return
    }

    let active = true

    void Promise.allSettled([
      providerApi.getSkills(providerId, cwd, { container }),
      providerApi.getApps(providerId, { container })
    ]).then(([skillsResult, appsResult]) => {
      if (skillsResult.status === 'rejected') {
        console.error('Unable to load composer skills.', skillsResult.reason)
      }
      if (appsResult.status === 'rejected') {
        console.error('Unable to load composer apps.', appsResult.reason)
      }
      if (!active) return

      if (skillsResult.status === 'rejected' && appsResult.status === 'rejected') {
        setComposerLoadErrorScope(skillScope)
        return
      }

      setComposerCache({
        cwd,
        providerId,
        providerResourcesRevision,
        sourceKey: composerSourceKey,
        skills:
          skillsResult.status === 'fulfilled'
            ? skillsResult.value.filter((skill) => skill.enabled)
            : [],
        apps:
          appsResult.status === 'fulfilled'
            ? appsResult.value.filter((app) => app.enabled && app.callable)
            : []
      })
      setComposerLoadErrorScope(null)
    })

    return () => {
      active = false
    }
  }, [
    composerCache,
    composerSourceKey,
    container,
    cwd,
    providerId,
    providerResourcesRevision,
    skillMentionMenuOpen,
    skillScope
  ])

  const handleSelectComposerMention = (result: ComposerResult): void => {
    if (!skillMention) return

    const prefix = message.slice(0, skillMention.start)
    const suffix = message.slice(skillMention.end)
    const removeLeadingSuffixSpace =
      suffix.startsWith(' ') && (prefix.length === 0 || prefix.endsWith(' '))
    const nextSuffix = removeLeadingSuffixSpace ? suffix.slice(1) : suffix
    const nextMessage = prefix + nextSuffix
    const nextCaret = prefix.length

    setMessage(nextMessage)
    setSkillMention(null)
    if (result.kind === 'skill') {
      setSelectedSkills((skills) =>
        skills.some((selectedSkill) => selectedSkill.path === result.skill.path)
          ? skills
          : [...skills, result.skill].slice(0, maxSelectedSkillCount)
      )
    } else {
      setSelectedApps((apps) =>
        apps.some((selectedApp) => selectedApp.id === result.app.id)
          ? apps
          : [...apps, result.app].slice(0, maxSelectedAppCount)
      )
    }

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }
  return {
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
  }
}
