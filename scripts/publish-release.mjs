import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const platforms = ['windows-x64', 'macos-arm64', 'linux-x64']

export function releaseFiles(version, platform) {
  const channel = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest'
  const files = {
    'windows-x64': [
      'sele-windows-x64-setup.exe',
      'sele-windows-x64-setup.exe.blockmap',
      `${channel}.yml`
    ],
    'macos-arm64': [
      'sele-macos-arm64.dmg',
      `Sele-${version}-arm64-mac.zip`,
      `Sele-${version}-arm64-mac.zip.blockmap`,
      `${channel}-mac.yml`
    ],
    'linux-x64': ['sele-linux-x64.tar.gz', 'sele.flatpakrepo', 'sele.flatpakref'],
    'linux-bundle': ['sele-linux-x64.flatpak'],
    'legacy-bundle': ['sele-linux-x64.flatpak']
  }
  if (platform === 'legacy') return platforms.flatMap((key) => files[key])
  if (!files[platform]) throw new Error(`Unsupported release platform: ${platform}`)
  return files[platform]
}

export async function publishRelease(baseTag, platform, directory, run = command) {
  if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(baseTag ?? '')) throw new Error('Invalid release tag')
  const version = baseTag.slice(1)
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  if (version !== manifest.version) throw new Error('Release tag does not match package.json')
  const files = releaseFiles(version, platform)
  const present = new Set(await readdir(directory))
  for (const file of files) {
    if (!present.has(file)) throw new Error(`Missing release asset: ${file}`)
  }
  const tag =
    platform === 'legacy' || platform === 'legacy-bundle'
      ? baseTag
      : `${baseTag}-${platform === 'linux-bundle' ? 'linux-x64' : platform}`
  const title = platform === 'legacy' ? `Sele ${version}` : `Sele ${version} — ${platform}`
  const sha = run('git', ['rev-parse', 'HEAD']).trim()
  const current = run(
    'gh',
    ['api', 'repos/{owner}/{repo}/releases/latest', '--jq', '.tag_name'],
    true
  )
  const existing = run('gh', ['release', 'view', tag, '--json', 'isDraft'], true)
  if (platform === 'linux-bundle' || platform === 'legacy-bundle') {
    if (!existing || JSON.parse(existing).isDraft)
      throw new Error('The release must be published before attaching its standalone installer')
    run('gh', [
      'release',
      'upload',
      tag,
      ...files.map((file) => resolve(directory, file)),
      '--clobber'
    ])
    return
  }
  if (existing === null) {
    run('gh', [
      'release',
      'create',
      tag,
      ...files.map((file) => resolve(directory, file)),
      '--target',
      sha,
      '--title',
      title,
      '--generate-notes',
      ...(current && current.trim() !== baseTag ? ['--notes-start-tag', current.trim()] : []),
      '--draft',
      '--latest=false',
      ...(version.includes('-') ? ['--prerelease'] : [])
    ])
  } else {
    run('gh', [
      'release',
      'upload',
      tag,
      ...files.map((file) => resolve(directory, file)),
      '--clobber'
    ])
  }
  // Keep platform entries out of /releases/latest for older installed clients.
  // Publish only once every required asset has uploaded successfully.
  let latest = false
  if (platform === 'legacy' && !version.includes('-')) {
    const parts = (value) =>
      /^v?(\d+)\.(\d+)\.(\d+)$/
        .exec(value?.trim() ?? '')
        ?.slice(1)
        .map(Number)
    const old = parts(current),
      next = parts(version)
    latest = !old || (next.map((part, index) => part - old[index]).find(Boolean) ?? 0) >= 0
  }
  run('gh', ['release', 'edit', tag, '--draft=false', `--latest=${latest}`])
}

function command(file, args, allowMissing = false) {
  const result = spawnSync(file, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    // Authentication, permission and network failures must not be mistaken for
    // a missing release, or a rerun could publish an incomplete/downgraded feed.
    if (allowMissing && /(?:HTTP 404|Not Found|release not found)/i.test(result.stderr)) return null
    throw new Error(`${file} ${args.slice(0, 3).join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await publishRelease(...process.argv.slice(2))
}
