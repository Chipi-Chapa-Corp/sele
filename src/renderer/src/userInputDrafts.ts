import type { ProviderPendingUserInput } from '../../shared/provider'
import { preferences } from './preferences.ts'

const storageKey = (chatKey: string): string => `sele:user-input-draft:v1:${chatKey}`

export const readUserInputDraft = (chatKey: string, request: ProviderPendingUserInput): string => {
  if (request.isSecret) return ''
  const stored = preferences.getItem(storageKey(chatKey))
  if (!stored) return ''
  try {
    const draft = JSON.parse(stored)
    return draft?.requestId === request.id && typeof draft.answer === 'string' ? draft.answer : ''
  } catch (error) {
    console.error('Unable to parse saved question answer.', error)
    return ''
  }
}

export const writeUserInputDraft = (
  chatKey: string,
  request: ProviderPendingUserInput,
  answer: string
): void => {
  if (request.isSecret) return
  if (answer) {
    preferences.setItem(storageKey(chatKey), JSON.stringify({ requestId: request.id, answer }))
  } else {
    clearUserInputDraft(chatKey, request)
  }
}

export const clearUserInputDraft = (chatKey: string, request: ProviderPendingUserInput): void => {
  if (readUserInputDraft(chatKey, request)) preferences.removeItem(storageKey(chatKey))
}
