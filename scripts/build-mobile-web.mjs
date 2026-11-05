import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// A desktop dev session exports NODE_ENV=development. A packaged phone renderer
// must still use React's production runtime and production JSX transform.
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--config',
    resolve(root, 'vite.mobile.config.ts')
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } }
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
