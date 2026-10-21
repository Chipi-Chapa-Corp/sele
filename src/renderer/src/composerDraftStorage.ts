import type { AppSelectedAttachment } from '../../shared/app'
import type { ProviderApp, ProviderSkill } from '../../shared/provider'
import type { ComposerDraft, PromptDraft } from './composerDraft'
import { preferences } from './preferences.ts'

export const composerDraftsStorageKey = 'sele:composer-drafts:v1'

export type ComposerDraftState = {
  composerDrafts: ReadonlyMap<string, ComposerDraft>
  promptDraftsByProject: ReadonlyMap<string, readonly PromptDraft[]>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isAttachment = (value: unknown): value is AppSelectedAttachment =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  typeof value.path === 'string' &&
  (value.kind === 'file' || (value.kind === 'image' && typeof value.dataUrl === 'string'))

const isSkill = (value: unknown): value is ProviderSkill =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  typeof value.path === 'string' &&
  typeof value.description === 'string' &&
  (value.shortDescription === null || typeof value.shortDescription === 'string') &&
  (value.displayName === null || typeof value.displayName === 'string') &&
  ['user', 'repo', 'system', 'admin'].includes(String(value.scope)) &&
  typeof value.enabled === 'boolean'

const isApp = (value: unknown): value is ProviderApp =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.description === 'string' &&
  typeof value.enabled === 'boolean' &&
  typeof value.callable === 'boolean' &&
  Array.isArray(value.skillNames) &&
  value.skillNames.every((name) => typeof name === 'string')

const isPromptDraft = (value: unknown): value is PromptDraft =>
  isRecord(value) && typeof value.id === 'string' && typeof value.prompt === 'string'

export const parseStoredComposerDrafts = (value: string | null): ComposerDraftState => {
  const state: ComposerDraftState = {
    composerDrafts: new Map(),
    promptDraftsByProject: new Map()
  }
  if (!value) return state

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    console.error('Unable to parse stored composer drafts.', error)
    return state
  }
  if (!isRecord(parsed)) return state

  const composerDrafts = new Map<string, ComposerDraft>()
  if (Array.isArray(parsed.composerDrafts)) {
    for (const entry of parsed.composerDrafts) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !isRecord(entry[1])) continue
      const [key, draft] = entry
      if (typeof draft.message !== 'string') continue
      const attachments = Array.isArray(draft.attachments)
        ? draft.attachments.filter(isAttachment)
        : []
      const skills = Array.isArray(draft.skills) ? draft.skills.filter(isSkill) : []
      const apps = Array.isArray(draft.apps) ? draft.apps.filter(isApp) : []
      if (draft.message || attachments.length || skills.length || apps.length) {
        composerDrafts.set(key, { message: draft.message, attachments, skills, apps })
      }
    }
  }
  const promptDraftsByProject = new Map<string, readonly PromptDraft[]>()
  if (Array.isArray(parsed.promptDraftsByProject)) {
    for (const entry of parsed.promptDraftsByProject) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1]))
        continue
      const drafts = entry[1].filter(isPromptDraft)
      if (drafts.length) promptDraftsByProject.set(entry[0], drafts)
    }
  }
  return { composerDrafts, promptDraftsByProject }
}

export const readStoredComposerDrafts = (): ComposerDraftState =>
  parseStoredComposerDrafts(preferences.getItem(composerDraftsStorageKey))

export const writeStoredComposerDrafts = (state: ComposerDraftState): void => {
  if (state.composerDrafts.size === 0 && state.promptDraftsByProject.size === 0) {
    preferences.removeItem(composerDraftsStorageKey)
    return
  }
  // Store both maps together so stashing/restoring a prompt cannot save only half the move.
  preferences.setItem(
    composerDraftsStorageKey,
    JSON.stringify({
      composerDrafts: [...state.composerDrafts],
      promptDraftsByProject: [...state.promptDraftsByProject]
    })
  )
}
