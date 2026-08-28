import assert from 'node:assert/strict'
import test from 'node:test'
import { getClaudeUserQuestions } from './ClaudeUserQuestions.ts'

test('preserves AskUserQuestion option descriptions', () => {
  assert.deepEqual(
    getClaudeUserQuestions({
      questions: [
        {
          question: 'Which database should we use?',
          options: [
            {
              label: 'PostgreSQL',
              description: 'Reliable relational database with strong SQL support'
            },
            {
              label: 'MongoDB',
              description: 'Document database with a flexible schema'
            }
          ]
        }
      ]
    }),
    [
      {
        question: 'Which database should we use?',
        choices: [
          {
            label: 'PostgreSQL',
            description: 'Reliable relational database with strong SQL support'
          },
          {
            label: 'MongoDB',
            description: 'Document database with a flexible schema'
          }
        ],
        allowFreeform: true
      }
    ]
  )
})

test('keeps valid choices when an option omits its description', () => {
  assert.deepEqual(
    getClaudeUserQuestions({
      questions: [
        {
          question: 'Continue?',
          options: [{ label: 'Yes' }, { label: 'No', description: 'Stop here' }]
        }
      ]
    })[0]?.choices,
    [
      { label: 'Yes', description: null },
      { label: 'No', description: 'Stop here' }
    ]
  )
})
