import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getComposerMentionAtCaret } from './composerMention.ts'

test('caret mentions preserve token boundaries and replacement ranges', () => {
  for (const marker of ['@', '$', '#']) {
    const pattern = new RegExp(`(^|[\\s([{])\\${marker}([^${marker}\\s]*)$`)
    const messages = [
      `${marker}src/file.ts after`,
      `text (${marker}path`,
      `text [${marker}path`,
      `text {${marker}path`,
      `text\n${marker}path`,
      `email${marker}path`,
      `${marker}one${marker}two`,
      `${marker}one ${marker}two`,
      `${marker}path\tother`,
      `some text ${marker}emoji🙂`,
      '@file $skill',
      '$skill@file',
      '@file$skill'
    ]
    for (const message of messages) {
      for (let caret = 0; caret <= message.length; caret++) {
        const match = pattern.exec(message.slice(0, caret))
        const expected = match
          ? { start: caret - match[2].length - 1, end: caret, query: match[2] }
          : null
        assert.deepEqual(getComposerMentionAtCaret(message, caret, marker), expected)
      }
    }
  }
})

test('project references insert only the main directory and preserve surrounding text', async () => {
  const { getProjectMentionResults, replaceProjectMention } = await import('./projectMention.ts')
  const projects = [
    { name: 'Other', cwd: '/workspace/tool-copy', additionalCwds: ['/extra'] },
    { name: 'Toolbox', cwd: '/workspace/box', additionalCwds: [] },
    { name: 'Tool', cwd: '/workspace/My Project', additionalCwds: ['/ignored'] }
  ]
  assert.deepEqual(
    getProjectMentionResults(projects, 'TOOL').map((p) => p.name),
    ['Tool', 'Toolbox', 'Other']
  )
  assert.deepEqual(getProjectMentionResults(projects, 'missing'), [])
  assert.deepEqual(getProjectMentionResults(projects, '/workspace/box'), [projects[1]])
  const message = 'Use #tool after'
  const mention = getComposerMentionAtCaret(message, 9, '#')
  assert.deepEqual(replaceProjectMention(message, mention, projects[2]), {
    message: 'Use "/workspace/My Project" after',
    caret: 27
  })
  assert.deepEqual(replaceProjectMention('#', { start: 0, end: 1, query: '' }, projects[0]), {
    message: '/workspace/tool-copy ',
    caret: 21
  })
})
