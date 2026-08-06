import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { getSshCommandArgs } from './sshCommand.ts'

const environment = {
  id: 'environment-id',
  name: 'Development server',
  host: 'server.example.com',
  port: 2222,
  user: 'deploy',
  identityFile: '/home/user/.ssh/id_ed25519',
  createdAt: 1,
  updatedAt: 1
}

test('builds a non-interactive SSH command with configured authentication', () => {
  const args = getSshCommandArgs(environment, 'printf ready')

  assert.equal(args[0], '-T')
  assert.deepEqual(args.slice(-8, -1), [
    '-o',
    'IdentitiesOnly=yes',
    '-i',
    environment.identityFile,
    '-l',
    environment.user,
    environment.host
  ])
  assert.match(args.at(-1), /^exec sh -lc /)
})

test('quotes the remote script as one shell argument', () => {
  const args = getSshCommandArgs(
    { ...environment, user: null, identityFile: null },
    `printf '%s\\n' "it's remote"`,
    true
  )
  const remoteCommand = args.at(-1)
  assert.equal(args[0], '-tt')
  assert.ok(remoteCommand)

  const result = spawnSync('sh', ['-lc', remoteCommand], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "it's remote\n")
})
