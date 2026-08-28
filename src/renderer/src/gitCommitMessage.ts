import {
  appGitCommitMessageLargeChangeLineThreshold,
  type AppGitCommitMessageContextResult,
  type AppGitCommitMessageFileChange
} from '../../shared/app.ts'
import type { AppGitCommitMessageGenerationSettings } from './settings'

const formatAiInstructions = (
  aiInstructions: string,
  settings: AppGitCommitMessageGenerationSettings
): string | null => {
  const instructions = aiInstructions.trim()
  if (!instructions) return null

  const prefix = settings.aiInstructionsPrefix.trim()
  return prefix ? `${prefix} ${JSON.stringify(instructions)}` : JSON.stringify(instructions)
}

const formatFileChange = (file: AppGitCommitMessageFileChange): string => {
  const path = file.previousPath
    ? `${JSON.stringify(file.previousPath)} -> ${JSON.stringify(file.path)}`
    : JSON.stringify(file.path)

  if (file.additions == null && file.deletions == null) return `- ${path}: binary change`

  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  return `- ${path}: ${additions + deletions} changed lines (+${additions}, -${deletions})`
}

const formatLargeChangeSummary = (context: AppGitCommitMessageContextResult): string => {
  const shownFileCount = context.files.length
  const fileCountDescription =
    shownFileCount < context.fileCount
      ? `${shownFileCount} largest of ${context.fileCount}`
      : `${shownFileCount}`

  return [
    `Total changed lines: ${context.totalChangedLines}`,
    `Changed files (${fileCountDescription}, largest first):`,
    context.files.map(formatFileChange).join('\n') || '(No changed files)'
  ].join('\n')
}

export const isLargeCommitMessageChange = (context: AppGitCommitMessageContextResult): boolean =>
  context.totalChangedLines > appGitCommitMessageLargeChangeLineThreshold

export const getCommitMessageGenerationPrompt = (
  context: AppGitCommitMessageContextResult,
  recentCommitMessages: string[],
  aiInstructions: string,
  settings: AppGitCommitMessageGenerationSettings
): string => {
  const recentCommitNames =
    recentCommitMessages.length > 0
      ? recentCommitMessages.map((message) => `- ${message}`).join('\n')
      : '(No recent commits)'
  const isLargeChange = isLargeCommitMessageChange(context)
  const changeContext = isLargeChange
    ? ['Changed-file summary:', formatLargeChangeSummary(context)].join('\n')
    : ['Git diff:', context.diff?.trim() ?? ''].join('\n')

  return [
    settings.prompt.trim(),
    isLargeChange ? settings.largeChangePrompt.trim() : null,
    ['Recent commit names:', recentCommitNames].join('\n'),
    changeContext,
    formatAiInstructions(aiInstructions, settings)
  ]
    .filter((section): section is string => Boolean(section))
    .join('\n\n')
}

export const normalizeGeneratedCommitMessage = (message: string): string => {
  const firstLine = message
    .trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()

  if (!firstLine) return ''

  return firstLine.replace(/^(["'`])(.+)\1$/, '$2').trim()
}
