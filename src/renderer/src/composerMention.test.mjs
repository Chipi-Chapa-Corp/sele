import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getComposerMentionAtCaret } from './composerMention.ts'

test('caret mentions preserve token boundaries and replacement ranges', () => {
  for (const marker of ['@', '$']) {
    const pattern = marker === '@' ? /(^|[\s([{])@([^@\s]*)$/ : /(^|[\s([{])\$([^$\s]*)$/
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
