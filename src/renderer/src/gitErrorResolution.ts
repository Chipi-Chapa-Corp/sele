export type GitAiResolutionPromptContext = {
  cwd: string
  error: string
  operation?: string | null
}

export const defaultGitErrorResolutionPrompt = [
  'Resolve this Git error in {cwd}.',
  'Failed Git operation: {operation}.',
  'Git error: {error}',
  'Investigate the root cause and resolve the immediate error.',
  'Preserve local work. Do not discard changes or rewrite published history; if either would be required, stop and explain what remains unresolved.'
].join('\n')

export const defaultPermanentGitErrorResolutionPrompt = [
  'Resolve this Git error in {cwd}.',
  'Failed Git operation: {operation}.',
  'Git error: {error}',
  'Investigate the root cause and prefer a safe, repository-scoped permanent fix over a one-time workaround when one exists. Use your judgment; do not assume a particular cause or configuration change.',
  'Preserve local work. Do not discard changes or rewrite published history; if either would be required, stop and explain what remains unresolved.'
].join('\n')

export const getGitAiResolutionPrompt = (
  context: GitAiResolutionPromptContext,
  template: string
): string => {
  const values = {
    cwd: context.cwd,
    error: context.error,
    operation: context.operation ?? 'Git operation'
  }

  return template.replace(
    /\{(cwd|error|operation)\}/g,
    (_placeholder, key: keyof typeof values) => values[key]
  )
}
