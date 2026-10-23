import type { AppSelectedAttachment } from '../../shared/app'
import type { ProviderApp, ProviderSkill } from '../../shared/provider'
import type { ComposerDraft, PromptDraft } from './composerDraft'
import { preferences } from './preferences.ts'
import { flushAfterPaintWriters } from './afterPaintWriter.ts'

export const composerDraftsStorageKey = 'sele:composer-drafts:v1'
const imageStoragePrefix = 'sele:composer-image:v1:'
const storedImageKeys = new WeakMap<AppSelectedAttachment, string>()
const isImageKey = (key: unknown): key is string =>
  typeof key === 'string' && key.startsWith(imageStoragePrefix)

export type ComposerDraftState = {
  composerDrafts: ReadonlyMap<string, ComposerDraft>
  promptDraftsByScope: ReadonlyMap<string, readonly PromptDraft[]>
}

const listeners = new Set<(state: ComposerDraftState) => void>()

export const subscribeComposerDrafts = (listener: (state: ComposerDraftState) => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const updateStoredComposerDrafts = (
  update: (state: ComposerDraftState) => ComposerDraftState
): void => {
  // Capture the latest committed input before lifecycle actions change its scope.
  // Flush first so an old pending write cannot resurrect a completed chat's drafts.
  flushAfterPaintWriters()
  const current = readStoredComposerDrafts()
  const next = update(current)
  if (next === current) return
  writeStoredComposerDrafts(next)
  for (const listener of listeners) listener(next)
}

export const moveComposerDraftScope = (
  state: ComposerDraftState,
  from: string,
  to: string
): ComposerDraftState => {
  const prompts = state.promptDraftsByScope.get(from) ?? []
  const moving = to.startsWith('new-chat:')
    ? prompts
    : prompts.filter((draft) => !draft.newChatsOnly)
  if (from === to || (!state.composerDrafts.has(from) && moving.length === 0)) {
    return state
  }
  const composerDrafts = new Map(state.composerDrafts)
  const promptDraftsByScope = new Map(state.promptDraftsByScope)
  const source = composerDrafts.get(from)
  if (source) {
    const target = composerDrafts.get(to)
    composerDrafts.set(
      to,
      target
        ? {
            message: [target.message, source.message].filter(Boolean).join('\n\n'),
            attachments: [...target.attachments, ...source.attachments],
            skills: [...target.skills, ...source.skills],
            apps: [...target.apps, ...source.apps]
          }
        : source
    )
    composerDrafts.delete(from)
  }
  if (prompts.length) {
    const retained = to.startsWith('new-chat:') ? [] : prompts.filter((draft) => draft.newChatsOnly)
    if (moving.length) {
      promptDraftsByScope.set(to, [...(promptDraftsByScope.get(to) ?? []), ...moving])
    }
    if (retained.length) promptDraftsByScope.set(from, retained)
    else promptDraftsByScope.delete(from)
  }
  return { composerDrafts, promptDraftsByScope }
}

export const releaseComposerDraftScope = (
  state: ComposerDraftState,
  from: string,
  newChatScope: string
): ComposerDraftState => {
  const prompts = state.promptDraftsByScope.get(from)
  const moved = moveComposerDraftScope(state, from, newChatScope)
  if (!prompts?.length || from === newChatScope) return moved
  const promptDraftsByScope = new Map(moved.promptDraftsByScope)
  promptDraftsByScope.set(newChatScope, [
    ...(state.promptDraftsByScope.get(newChatScope) ?? []),
    ...prompts.map((draft) => ({ ...draft, newChatsOnly: true }))
  ])
  return { ...moved, promptDraftsByScope }
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

export const parseStoredComposerDrafts = (
  value: string | null,
  readImage: (key: string) => string | null = () => null
): ComposerDraftState => {
  const state: ComposerDraftState = {
    composerDrafts: new Map(),
    promptDraftsByScope: new Map()
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
      const attachments: AppSelectedAttachment[] = []
      if (Array.isArray(draft.attachments)) {
        for (const attachment of draft.attachments) {
          if (isAttachment(attachment)) attachments.push(attachment)
          else if (
            isRecord(attachment) &&
            attachment.kind === 'image' &&
            typeof attachment.name === 'string' &&
            typeof attachment.path === 'string' &&
            isImageKey(attachment.imageKey)
          ) {
            const dataUrl = readImage(attachment.imageKey)
            if (dataUrl === null) continue
            const image: AppSelectedAttachment = {
              kind: 'image',
              name: attachment.name,
              path: attachment.path,
              dataUrl
            }
            storedImageKeys.set(image, attachment.imageKey)
            attachments.push(image)
          }
        }
      }
      const skills = Array.isArray(draft.skills) ? draft.skills.filter(isSkill) : []
      const apps = Array.isArray(draft.apps) ? draft.apps.filter(isApp) : []
      if (draft.message || attachments.length || skills.length || apps.length) {
        composerDrafts.set(key, { message: draft.message, attachments, skills, apps })
      }
    }
  }
  const promptDraftsByScope = new Map<string, readonly PromptDraft[]>()
  // Older versions shared saved prompts across a project. Keep these in its new-chat
  // composer, where they can be recovered without exposing them in every existing chat.
  const legacyPromptDrafts = !Array.isArray(parsed.promptDraftsByScope)
  const storedPromptDrafts = legacyPromptDrafts
    ? parsed.promptDraftsByProject
    : parsed.promptDraftsByScope
  if (Array.isArray(storedPromptDrafts)) {
    for (const entry of storedPromptDrafts) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1]))
        continue
      const drafts = entry[1].filter(isPromptDraft)
      const scopeKey = legacyPromptDrafts ? `new-chat:${entry[0]}` : entry[0]
      if (drafts.length) promptDraftsByScope.set(scopeKey, drafts)
    }
  }
  return { composerDrafts, promptDraftsByScope }
}

export const readStoredComposerDrafts = (): ComposerDraftState =>
  parseStoredComposerDrafts(preferences.getItem(composerDraftsStorageKey), preferences.getItem)

export const writeStoredComposerDrafts = (state: ComposerDraftState): void => {
  // Read only the small manifest. Image payloads are immutable and stay outside
  // the document that is serialized and sent through the preload on each edit.
  let previousImageKeys = new Set<string>()
  const previous = preferences.getItem(composerDraftsStorageKey)
  if (previous) {
    try {
      const parsed: unknown = JSON.parse(previous)
      if (isRecord(parsed) && Array.isArray(parsed.imageKeys)) {
        previousImageKeys = new Set(parsed.imageKeys.filter(isImageKey))
      }
    } catch (error) {
      console.error('Unable to read previous composer image references.', error)
    }
  }
  const imageKeys = new Set<string>()
  const composerDrafts = [...state.composerDrafts].map(([scope, draft]) => [
    scope,
    {
      ...draft,
      attachments: draft.attachments.map((attachment) => {
        if (attachment.kind !== 'image') return attachment
        let imageKey = storedImageKeys.get(attachment)
        if (!imageKey || (!previousImageKeys.has(imageKey) && !imageKeys.has(imageKey))) {
          imageKey = `${imageStoragePrefix}${crypto.randomUUID()}`
          // Persist the payload before publishing a reference to it.
          preferences.setItem(imageKey, attachment.dataUrl)
          storedImageKeys.set(attachment, imageKey)
        }
        imageKeys.add(imageKey)
        return { kind: attachment.kind, name: attachment.name, path: attachment.path, imageKey }
      })
    }
  ])
  if (state.composerDrafts.size === 0 && state.promptDraftsByScope.size === 0) {
    preferences.removeItem(composerDraftsStorageKey)
  } else {
    // Keep both maps together so stashing/restoring cannot save half the move.
    preferences.setItem(
      composerDraftsStorageKey,
      JSON.stringify({
        composerDrafts,
        promptDraftsByScope: [...state.promptDraftsByScope],
        imageKeys: [...imageKeys]
      })
    )
  }
  // Delete unreferenced payloads only after the new manifest has been published.
  for (const key of previousImageKeys) {
    if (!imageKeys.has(key)) preferences.removeItem(key)
  }
}
