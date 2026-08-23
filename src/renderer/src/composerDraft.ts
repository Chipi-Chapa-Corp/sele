import type { SetStateAction } from 'react'
import type { AppSelectedAttachment } from '../../shared/app'
import type { ProviderApp, ProviderSkill } from '../../shared/provider'

export type ComposerDraft = {
  message: string
  attachments: AppSelectedAttachment[]
  skills: ProviderSkill[]
  apps: ProviderApp[]
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
