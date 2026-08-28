import type { ProviderPendingUserInput, ProviderUserInputChoice } from '../../../shared/provider'

export type ClaudeUserQuestion = Pick<
  ProviderPendingUserInput,
  'question' | 'choices' | 'allowFreeform'
>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const getChoice = (value: unknown): ProviderUserInputChoice | null => {
  if (!isRecord(value)) return null
  const label = getString(value.label)
  if (!label) return null

  return {
    label,
    description: getString(value.description)
  }
}

export const getClaudeUserQuestions = (input: Record<string, unknown>): ClaudeUserQuestion[] => {
  if (!Array.isArray(input.questions)) return []

  return input.questions.flatMap((value) => {
    if (!isRecord(value)) return []
    const question = getString(value.question)
    if (!question) return []
    const choices = Array.isArray(value.options)
      ? value.options
          .map(getChoice)
          .filter((choice): choice is ProviderUserInputChoice => Boolean(choice))
      : []

    return [{ question, choices, allowFreeform: true }]
  })
}
