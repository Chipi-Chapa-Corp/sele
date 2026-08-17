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
  assert.match(args.at(-1), /^exec sh -c /)
})

test('encodes the remote script so the login shell cannot reinterpret it', () => {
  const script = [
    `printf '%s\\n' "it's remote"`,
    `printf '%s\\n' '$HOME' '\`literal\`' '\\slash' '"double"'`,
    `read terminalInput; printf '%s\\n' "$terminalInput"`
  ].join('\n')
  const args = getSshCommandArgs({ ...environment, user: null, identityFile: null }, script, true)
  const remoteCommand = args.at(-1)
  assert.equal(args[0], '-tt')
  assert.equal(
    remoteCommand,
    `exec sh -c 'exec sh -lc "$(printf %s "$1" | base64 -d)"' sh '${Buffer.from(script).toString('base64')}'`
  )

  const result = spawnSync('sh', ['-lc', remoteCommand], {
    encoding: 'utf8',
    input: 'terminal input\n'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'it\'s remote\n$HOME\n`literal`\n\\slash\n"double"\nterminal input\n')
})
