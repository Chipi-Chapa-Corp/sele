import { load } from 'js-yaml'
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { packageFlatpakBundle } from './package-flatpak-bundle.mjs'

// Use the same manifest settings as electron-builder, but keep the exported
// repository. Building a bundle, importing it, then rebuilding it doubles the
// expensive OSTree compression of Electron and the bundled agent runtime.
export async function packageFlatpak({
  appDirectory = 'dist/linux-unpacked',
  bundlePath = 'dist/sele-linux-x64.flatpak',
  pagesRoot = 'dist/flatpak-pages',
  repositoryOnly = false
} = {}) {
  await access(join(appDirectory, 'sele'))
  await access(join(appDirectory, 'resources/app.asar'))
  const config = load(await readFile('electron-builder.yml', 'utf8'))
  const { appId, flatpak } = config
  const repoUrl = 'https://chipi-chapa-corp.github.io/sele/flatpak'
  const stage = await mkdtemp(join(tmpdir(), 'sele-flatpak-'))
  const buildDirectory = join(stage, 'build')
  const files = join(buildDirectory, 'files')
  const repository = resolve(pagesRoot, 'flatpak')
  const run = (args) => {
    const started = performance.now()
    console.log(`Flatpak: ${args[0]}`)
    const result = spawnSync('flatpak', args, { stdio: 'inherit' })
    if (result.status !== 0) throw result.error ?? new Error(`flatpak ${args[0]} failed`)
    console.log(
      `Flatpak: ${args[0]} finished in ${((performance.now() - started) / 1000).toFixed(1)}s`
    )
  }
  try {
    run([
      'build-init',
      '--arch=x86_64',
      `--base=${flatpak.base}`,
      `--base-version=${flatpak.baseVersion}`,
      buildDirectory,
      appId,
      flatpak.sdk,
      flatpak.runtime,
      flatpak.runtimeVersion
    ])
    await mkdir(join(files, 'bin'), { recursive: true })
    await mkdir(join(files, 'share/applications'), { recursive: true })
    await writeFile(
      join(files, 'bin/electron-wrapper'),
      `#!/bin/sh
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
if [ "\${XDG_SESSION_TYPE}" = wayland ]; then
  exec zypak-wrapper sele --enable-features=UseOzonePlatform --ozone-platform=wayland "$@"
else
  exec zypak-wrapper sele "$@"
fi
`,
      { mode: 0o755 }
    )
    await writeFile(
      join(files, 'share/applications', `${appId}.desktop`),
      `[Desktop Entry]
Name=Sele
Comment=${config.linux.synopsis}
Exec=electron-wrapper %U
Terminal=false
Type=Application
Icon=${appId}
Categories=${config.linux.category};
`
    )
    for (const size of [16, 32, 48, 64, 128, 256, 512]) {
      const icons = join(files, 'share/icons/hicolor', `${size}x${size}`, 'apps')
      await mkdir(icons, { recursive: true })
      await copyFile(`build/icons/${size}x${size}.png`, join(icons, `${appId}.png`))
    }
    await cp(resolve(appDirectory), join(files, 'lib', appId), {
      recursive: true,
      verbatimSymlinks: true
    })
    await symlink(`/app/lib/${appId}/sele`, join(files, 'bin/sele'))
    for (const [source, destination] of flatpak.files) {
      const target = join(files, destination)
      await mkdir(dirname(target), { recursive: true })
      await cp(source, target, { recursive: true })
    }
    // Use the SDK's composer so the repository retains Software Center metadata
    // without requiring a separate host appstream-compose installation.
    run([
      'build',
      '--die-with-parent',
      buildDirectory,
      'appstreamcli',
      'compose',
      '--prefix=/',
      `--origin=${appId}`,
      '--result-root=/app',
      '--data-dir=/app/share/app-info/xmls',
      '--icons-dir=/app/share/app-info/icons/flatpak',
      `--components=${appId},${appId}.desktop`,
      '/app'
    ])
    run(['build-finish', '--command=electron-wrapper', ...flatpak.finishArgs, buildDirectory])
    await mkdir(pagesRoot, { recursive: true })
    run(['build-export', '--arch=x86_64', repository, buildDirectory, flatpak.branch])
    run([
      'build-update-repo',
      '--title=Sele',
      '--comment=Stable releases of Sele',
      '--description=Stable Flatpak releases of the Sele desktop AI harness',
      '--homepage=https://github.com/Chipi-Chapa-Corp/sele',
      `--icon=${repoUrl}/sele.png`,
      `--default-branch=${flatpak.branch}`,
      '--generate-static-deltas',
      repository
    ])
    await copyFile('build/sele.flatpakrepo', join(repository, 'sele.flatpakrepo'))
    await copyFile('build/sele.flatpakref', join(repository, 'sele.flatpakref'))
    await copyFile('build/icon.png', join(repository, 'sele.png'))
    await copyFile('build/sele.flatpakrepo', resolve(bundlePath, '..', 'sele.flatpakrepo'))
    await copyFile('build/sele.flatpakref', resolve(bundlePath, '..', 'sele.flatpakref'))
    await writeFile(
      join(repository, 'sele-build.json'),
      JSON.stringify({
        version: JSON.parse(await readFile('package.json', 'utf8')).version,
        appId,
        arch: 'x86_64',
        branch: flatpak.branch,
        repoUrl
      })
    )
    await writeFile(join(pagesRoot, '.nojekyll'), '')
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
  if (!repositoryOnly) await packageFlatpakBundle({ repository, bundlePath })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const [appDirectory, bundlePath, pagesRoot] = args.filter((arg) => arg !== '--repository-only')
  await packageFlatpak({
    appDirectory,
    bundlePath,
    pagesRoot,
    repositoryOnly: args.includes('--repository-only')
  })
}
