import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getStdinSafeLoginShellArgs } from './targetShell.ts'

test('login startup cannot consume protocol input and still forwards environment and SDK arguments', {
  skip: process.platform === 'win32'
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-login-stdin-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  // Simulate a login profile running a command that reads from stdin, as
  // Distrobox's host-spawn environment probes do. Avoid real user profiles.
  const shell = join(directory, 'sh')
  await writeFile(
    shell,
    `#!/bin/sh
if [ "$1" = '-lc' ]; then
  shift
  IFS= read -r consumed || :
  export SELE_LOGIN_PROFILE=loaded
  exec /bin/sh -c "$@"
fi
exec /bin/sh "$@"
`,
    { mode: 0o755 }
  )
  const script = 'printf "%s\\n" "$SELE_LOGIN_PROFILE" "$0" "$@"; exec cat'
  const input = '{"id":1,"method":"initialize"}\n{"method":"initialized"}\n'
  const extraArgs = ['sele-provider', 'argument with spaces', 'quotes\'"$', 'line\nbreak']
  const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` }
  const baseline = spawnSync(shell, ['-lc', script, ...extraArgs], { env, input, encoding: 'utf8' })
  assert.equal(baseline.status, 0, baseline.stderr)
  assert.ok(!baseline.stdout.includes('"initialize"'), 'the fixture must reproduce lost input')

  const [file, ...args] = getStdinSafeLoginShellArgs(script)
  const result = spawnSync(file, [...args, ...extraArgs], { env, input, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `loaded\n${extraArgs.join('\n')}\n${input}`)
})
