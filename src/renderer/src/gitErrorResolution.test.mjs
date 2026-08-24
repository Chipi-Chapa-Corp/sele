import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultGitErrorResolutionPrompt,
  defaultPermanentGitErrorResolutionPrompt,
  getGitAiResolutionPrompt
} from './gitErrorResolution.ts'

const context = {
  cwd: '/workspace/project',
  operation: 'git push',
  error: 'The branch has no upstream branch.'
}

test('asks AI to investigate an immediate Git error without prescribing a fix', () => {
  const prompt = getGitAiResolutionPrompt(context, defaultGitErrorResolutionPrompt)

  assert.match(prompt, /Git error: The branch has no upstream branch\./)
  assert.match(prompt, /Investigate the root cause and resolve the immediate error\./)
  assert.doesNotMatch(prompt, /push\.autoSetupRemote|--set-upstream|pull\.rebase/)
  assert.doesNotMatch(prompt, /\bask\b|workflow/i)
})

test('asks AI to prefer a permanent fix while leaving the solution open', () => {
  const prompt = getGitAiResolutionPrompt(context, defaultPermanentGitErrorResolutionPrompt)

  assert.match(prompt, /prefer a safe, repository-scoped permanent fix/i)
  assert.match(prompt, /Use your judgment; do not assume a particular cause/i)
  assert.doesNotMatch(prompt, /push\.autoSetupRemote|--set-upstream|pull\.rebase/)
  assert.doesNotMatch(prompt, /\bask\b|workflow/i)
})

test('interpolates all supported variables in a configured prompt', () => {
  assert.equal(
    getGitAiResolutionPrompt(context, 'cwd={cwd}\noperation={operation}\nerror={error}'),
    [
      'cwd=/workspace/project',
      'operation=git push',
      'error=The branch has no upstream branch.'
    ].join('\n')
  )
})
