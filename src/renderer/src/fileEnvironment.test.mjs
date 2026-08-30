import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAlternateFileEnvironments,
  getFileEnvironmentKey,
  isMissingFileError
} from './fileEnvironment.ts'

const suggestions = [
  {
    id: 'toolbox:dev',
    tool: 'toolbox',
    name: 'dev',
    label: 'dev',
    description: 'Toolbox - Running',
    status: 'Running'
  },
  {
    id: 'docker:web',
    tool: 'docker',
    name: 'web',
    label: 'web',
    description: 'Docker - Running',
    status: 'Running'
  }
]

test('offers local containers after a host file lookup fails', () => {
  const choices = getAlternateFileEnvironments({ kind: 'host' }, suggestions)

  assert.deepEqual(
    choices.map(({ value, label }) => ({ value, label })),
    [
      { value: 'toolbox:dev', label: 'dev' },
      { value: 'docker:web', label: 'web' }
    ]
  )
})

test('offers the host and other containers after a container lookup fails', () => {
  const choices = getAlternateFileEnvironments(
    { kind: 'container', tool: 'toolbox', name: 'dev' },
    suggestions
  )

  assert.deepEqual(
    choices.map(({ value, label }) => ({ value, label })),
    [
      { value: 'host', label: 'Host' },
      { value: 'docker:web', label: 'web' }
    ]
  )
})

test('keeps alternate runtime choices on the same SSH environment', () => {
  const remote = { kind: 'container', tool: 'ssh', name: 'server', runtime: { kind: 'host' } }
  const [choice] = getAlternateFileEnvironments(remote, suggestions)

  assert.equal(getFileEnvironmentKey(choice.container), 'ssh:server/from:toolbox:dev')
  assert.deepEqual(choice.container, {
    kind: 'container',
    tool: 'ssh',
    name: 'server',
    runtime: { kind: 'container', tool: 'toolbox', name: 'dev' }
  })
})

test('recognizes missing-file errors that can be retried in another environment', () => {
  assert.equal(isMissingFileError("ENOENT: no such file or directory, stat '/tmp/image.jpg'"), true)
  assert.equal(isMissingFileError('Choose a regular image file.'), true)
  assert.equal(isMissingFileError('Choose an image smaller than 32 MB.'), false)
})
