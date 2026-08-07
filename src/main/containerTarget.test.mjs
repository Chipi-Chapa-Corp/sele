import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getContainerTargetKey,
  normalizeContainerTarget,
  requireContainerTarget
} from './containerTarget.ts'

test('normalizes an SSH target to the remote host runtime', () => {
  assert.deepEqual(normalizeContainerTarget({ kind: 'container', tool: 'ssh', name: 'server' }), {
    kind: 'container',
    tool: 'ssh',
    name: 'server',
    runtime: { kind: 'host' }
  })
})

test('keys remote container targets independently from the remote host', () => {
  assert.equal(
    getContainerTargetKey({
      kind: 'container',
      tool: 'ssh',
      name: 'server',
      runtime: { kind: 'container', tool: 'docker', name: 'workspace' }
    }),
    'ssh:server/from:docker:workspace'
  )
  assert.equal(
    getContainerTargetKey({ kind: 'container', tool: 'ssh', name: 'server' }),
    'ssh:server/from:host'
  )
})

test('validates a local container runtime nested under SSH', () => {
  assert.deepEqual(
    requireContainerTarget({
      kind: 'container',
      tool: 'ssh',
      name: ' server ',
      runtime: { kind: 'container', tool: 'podman', name: ' workspace ' }
    }),
    {
      kind: 'container',
      tool: 'ssh',
      name: 'server',
      runtime: { kind: 'container', tool: 'podman', name: 'workspace' }
    }
  )

  assert.throws(
    () =>
      requireContainerTarget({
        kind: 'container',
        tool: 'ssh',
        name: 'server',
        runtime: { kind: 'container', tool: 'ssh', name: 'another-server' }
      }),
    /Invalid remote runtime target/
  )
})
