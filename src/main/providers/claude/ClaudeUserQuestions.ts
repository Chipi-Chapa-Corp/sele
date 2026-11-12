import type { ProviderPendingUserInput, ProviderUserInputChoice } from '../../../shared/provider'
import { getString, isRecord } from '../providerValues.ts'

export type ClaudeUserQuestion = Pick<
  ProviderPendingUserInput,
  'question' | 'choices' | 'allowFreeform'
>

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
