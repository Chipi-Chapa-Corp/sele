import assert from 'node:assert/strict'
import test from 'node:test'
import { getChatMessagePresentation } from './chatMessageResources.ts'

test('extracts serialized skills and apps from the message prefix', () => {
  assert.deepEqual(
    getChatMessagePresentation(
      '$pdf:pdf $imagegen [$Google Calendar](app://google-calendar)\nPlan my week'
    ),
    {
      content: 'Plan my week',
      resources: [
        { kind: 'skill', name: 'pdf:pdf' },
        { kind: 'skill', name: 'imagegen' },
        { kind: 'app', id: 'google-calendar', name: 'Google Calendar' }
      ]
    }
  )
})

test('unescapes app labels serialized for Markdown', () => {
  assert.deepEqual(getChatMessagePresentation('[$Docs \\[beta\\] \\\\](app://docs)\nSearch'), {
    content: 'Search',
    resources: [{ kind: 'app', id: 'docs', name: 'Docs [beta] \\' }]
  })
})

test('extracts a resource-only message', () => {
  assert.deepEqual(getChatMessagePresentation('$imagegen'), {
    content: '',
    resources: [{ kind: 'skill', name: 'imagegen' }]
  })
})

test('leaves ordinary message text unchanged', () => {
  assert.deepEqual(getChatMessagePresentation('$HOME contains the current home directory'), {
    content: '$HOME contains the current home directory',
    resources: []
  })
})

test('leaves a mixed first line unchanged', () => {
  assert.deepEqual(getChatMessagePresentation('$pdf summarize this file\nPlease be concise'), {
    content: '$pdf summarize this file\nPlease be concise',
    resources: []
  })
})
