import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { packageFlatpak } from './package-flatpak.mjs'

const require = createRequire(import.meta.url)
const result = spawnSync(
  process.execPath,
  [require.resolve('electron-builder/cli.js'), '--linux', '--dir', ...process.argv.slice(2)],
  { stdio: 'inherit' }
)
if (result.status !== 0) throw result.error ?? new Error('Linux packaging failed')
await packageFlatpak()
