import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

// Source archives and packaged installs do not have repository hooks to install.
if (existsSync(new URL('../.git', import.meta.url))) {
  const result = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    cwd: root,
    stdio: 'inherit'
  })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
}
