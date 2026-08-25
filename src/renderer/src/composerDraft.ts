import type { SetStateAction } from 'react'
import type { AppSelectedAttachment } from '../../shared/app'
import type { ProviderApp, ProviderSkill } from '../../shared/provider'

export type ComposerDraft = {
  message: string
  attachments: AppSelectedAttachment[]
  skills: ProviderSkill[]
  apps: ProviderApp[]
}

export type PromptDraft = {
  id: string
  prompt: string
}

const emptyComposerDraft: ComposerDraft = {
  message: '',
  attachments: [],
  skills: [],
  apps: []
}

const isComposerDraftEmpty = (draft: ComposerDraft): boolean =>
  !draft.message &&
  draft.attachments.length === 0 &&
  draft.skills.length === 0 &&
  draft.apps.length === 0

const resolveStateAction = <Value>(current: Value, action: SetStateAction<Value>): Value =>
  typeof action === 'function' ? (action as (value: Value) => Value)(current) : action

export const getComposerDraft = (
  drafts: ReadonlyMap<string, ComposerDraft>,
  scopeKey: string
): ComposerDraft => drafts.get(scopeKey) ?? emptyComposerDraft

export const getComposerDraftScopeKey = (chatKey: string | null, workspaceKey: string): string =>
  chatKey ?? `new-chat:${workspaceKey}`

export const updateComposerDraft = <Field extends keyof ComposerDraft>(
  drafts: ReadonlyMap<string, ComposerDraft>,
  scopeKey: string,
  field: Field,
  action: SetStateAction<ComposerDraft[Field]>
): ReadonlyMap<string, ComposerDraft> => {
  const currentDraft = getComposerDraft(drafts, scopeKey)
  const nextValue = resolveStateAction(currentDraft[field], action)
  if (Object.is(currentDraft[field], nextValue)) return drafts

  const nextDraft = { ...currentDraft, [field]: nextValue }
  const nextDrafts = new Map(drafts)

  if (isComposerDraftEmpty(nextDraft)) nextDrafts.delete(scopeKey)
  else nextDrafts.set(scopeKey, nextDraft)

  return nextDrafts
}

export const restoreFailedComposerMessage = (
  drafts: ReadonlyMap<string, ComposerDraft>,
  scopeKey: string,
  message: string
): ReadonlyMap<string, ComposerDraft> => {
  if (!message || getComposerDraft(drafts, scopeKey).message) return drafts

  return updateComposerDraft(drafts, scopeKey, 'message', message)
}

export const getPromptDrafts = (
  drafts: ReadonlyMap<string, readonly PromptDraft[]>,
  scopeKey: string
): readonly PromptDraft[] => drafts.get(scopeKey) ?? []

export const addPromptDraft = (
  drafts: ReadonlyMap<string, readonly PromptDraft[]>,
  scopeKey: string,
  draft: PromptDraft
): ReadonlyMap<string, readonly PromptDraft[]> => {
  const nextDrafts = new Map(drafts)
  nextDrafts.set(scopeKey, [...getPromptDrafts(drafts, scopeKey), draft])
  return nextDrafts
}

export const removePromptDraft = (
  drafts: ReadonlyMap<string, readonly PromptDraft[]>,
  scopeKey: string,
  draftId: string
): ReadonlyMap<string, readonly PromptDraft[]> => {
  const currentDrafts = getPromptDrafts(drafts, scopeKey)
  const nextProjectDrafts = currentDrafts.filter((draft) => draft.id !== draftId)
  if (nextProjectDrafts.length === currentDrafts.length) return drafts

  const nextDrafts = new Map(drafts)
  if (nextProjectDrafts.length === 0) nextDrafts.delete(scopeKey)
  else nextDrafts.set(scopeKey, nextProjectDrafts)

  return nextDrafts
}

export const appendPromptDraft = (message: string, prompt: string): string =>
  message.trim() ? `${message.trimEnd()}\n\n${prompt}` : prompt

export const getPromptDraftPreview = (prompt: string, maxLength = 48): string => {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ')
  if (normalizedPrompt.length <= maxLength) return normalizedPrompt

  return `${normalizedPrompt.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}
