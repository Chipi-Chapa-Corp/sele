import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  getRemoteContainerDiscoveryScript,
  parseRemoteContainerDiscoveryOutput,
  remoteContainerDiscoveryTimeoutMs
} from './remoteContainerDiscovery.ts'
import { sshConnectTimeoutSeconds } from './sshCommand.ts'

test('discovers container runtime output in one remote shell pass', () => {
  const fixtureCommands = `
distrobox() {
  printf 'ID | NAME | STATUS | IMAGE\nabc123 | devbox | Up | example/dev:latest\n'
}
toolbox() {
  printf 'CONTAINER ID  CONTAINER NAME  CREATED  STATUS  IMAGE NAME\ndef456  toolbox-dev  now  running  example/toolbox:latest\n'
}
podman() {
  printf '111111111111\tpodman-dev\texample/podman:latest\tUp 2 hours\n'
}
docker() {
  printf '222222222222\tdocker-dev\texample/docker:latest\tUp 3 hours\n'
}
`
  const result = spawnSync(
    '/bin/sh',
    ['-lc', `${fixtureCommands}\n${getRemoteContainerDiscoveryScript()}`],
    {
      encoding: 'utf8',
      env: { PATH: '/path-without-container-tools' }
    }
  )

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(parseRemoteContainerDiscoveryOutput(result.stdout), {
    distrobox: 'ID | NAME | STATUS | IMAGE\nabc123 | devbox | Up | example/dev:latest',
    toolbox:
      'CONTAINER ID  CONTAINER NAME  CREATED  STATUS  IMAGE NAME\ndef456  toolbox-dev  now  running  example/toolbox:latest',
    podman: '111111111111\tpodman-dev\texample/podman:latest\tUp 2 hours',
    docker: '222222222222\tdocker-dev\texample/docker:latest\tUp 3 hours'
  })
})

test('allows remote discovery to outlive the SSH connection timeout', () => {
  assert.ok(remoteContainerDiscoveryTimeoutMs > sshConnectTimeoutSeconds * 1_000)
})
