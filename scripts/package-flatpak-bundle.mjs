import { readFile, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function packageFlatpakBundle({
  repository = 'dist/flatpak-pages/flatpak',
  bundlePath = 'dist/sele-linux-x64.flatpak'
} = {}) {
  await access(join(repository, 'summary'))
  const metadata = JSON.parse(await readFile(join(repository, 'sele-build.json'), 'utf8'))
  const { appId, arch, branch, repoUrl } = metadata
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  if (metadata.version !== manifest.version)
    throw new Error('Exported Flatpak repository does not match the validated source version')
  const started = performance.now()
  const result = spawnSync(
    'flatpak',
    [
      'build-bundle',
      `--arch=${arch}`,
      `--repo-url=${repoUrl}`,
      '--runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo',
      resolve(repository),
      resolve(bundlePath),
      appId,
      branch
    ],
    { stdio: 'inherit' }
  )
  if (result.status !== 0) throw result.error ?? new Error('Flatpak bundle creation failed')
  console.log(
    `Standalone Flatpak bundle finished in ${((performance.now() - started) / 1000).toFixed(1)}s`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [repository, bundlePath] = process.argv.slice(2)
  await packageFlatpakBundle({ repository, bundlePath })
}
