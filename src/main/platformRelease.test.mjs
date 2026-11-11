import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { load } from 'js-yaml'
import {
  selectPlatformRelease,
  findLatestPlatformRelease,
  releaseDownloadUrl
} from './platformRelease.ts'
import { publishRelease, releaseFiles } from '../../scripts/publish-release.mjs'
import { waitForBundle } from '../../scripts/wait-for-bundle.mjs'

const release = (version, platform, overrides = {}) => {
  const tag = `v${version}${platform ? `-${platform}` : ''}`
  const names = releaseFiles(version, platform ?? 'legacy')
  return {
    tag_name: tag,
    assets: names.map((name) => ({
      name,
      size: 123,
      digest: `sha256:${'a'.repeat(64)}`,
      browser_download_url: `https://github.com/Chipi-Chapa-Corp/sele/releases/download/${tag}/${name}`
    })),
    ...overrides
  }
}

test('platform releases update independently of globally newer and unfinished platforms', () => {
  const releases = [
    release('3.30.0', 'windows-x64'),
    release('3.29.0', 'macos-arm64'),
    release('3.28.0', 'linux-x64')
  ]
  assert.equal(selectPlatformRelease(releases, 'macos-arm64', '3.27.0').version, '3.29.0')
  assert.equal(selectPlatformRelease(releases, 'windows-x64', '3.27.0').version, '3.30.0')
  assert.equal(selectPlatformRelease(releases, 'linux-x64', '3.27.0').version, '3.28.0')
  assert.equal(selectPlatformRelease(releases, 'macos-x64', '3.27.0'), null)
})

test('chooses numeric version order, allows legacy migration, and never downgrades', () => {
  const releases = [
    release('3.9.0', 'windows-x64'),
    release('3.10.0', 'windows-x64'),
    release('3.11.0')
  ]
  assert.equal(selectPlatformRelease(releases, 'windows-x64', '3.8.0').version, '3.11.0')
  assert.equal(selectPlatformRelease(releases, 'windows-x64', '3.11.0'), null)
})

test('drafts, prereleases, missing artifacts and untrusted asset URLs never become updates', () => {
  const candidates = [
    release('3.30.0', 'macos-arm64', { draft: true }),
    release('3.30.0', 'macos-arm64', { prerelease: true }),
    release('3.30.0-beta.1', 'macos-arm64'),
    release('3.30.0', 'macos-arm64', { assets: [] }),
    release('3.30.0', 'macos-arm64', {
      assets: [
        {
          name: 'Sele-3.30.0-arm64-mac.zip',
          size: 10,
          browser_download_url: 'https://example.com/update.zip'
        }
      ]
    })
  ]
  assert.equal(selectPlatformRelease(candidates, 'macos-arm64', '3.27.0'), null)
})

test('follows release pagination when other platforms fill the first page', async (t) => {
  const urls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url)
    return new Response(
      JSON.stringify(
        urls.length === 1 ? [release('3.30.0', 'windows-x64')] : [release('3.29.0', 'macos-arm64')]
      ),
      {
        headers: urls.length === 1 ? { link: '<next>; rel="next"' } : {}
      }
    )
  })
  const selected = await findLatestPlatformRelease('macos-arm64', '3.27.0')
  assert.equal(selected.version, '3.29.0')
  assert.ok(releaseDownloadUrl(selected.release).endsWith('/v3.29.0-macos-arm64/'))
  assert.equal(urls.length, 2)
  assert.ok(urls[1].endsWith('page=2'))
})

test('release API failures are visible and do not fall back to the global latest feed', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }))
  await assert.rejects(findLatestPlatformRelease('windows-x64', '3.27.0'), /403/)
})

test('an up-to-date platform does not scan older release pages on every background check', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response(JSON.stringify([release('3.28.0', 'macos-arm64')]), {
      headers: { link: '<next>; rel="next"' }
    })
  })
  assert.equal(await findLatestPlatformRelease('macos-arm64', '3.28.0'), null)
  assert.equal(calls, 1)
})

test('publication gates only on validation and its own platform; compatibility waits for all', async () => {
  const { jobs } = load(await readFile('.github/workflows/build.yml', 'utf8'))
  const dependencies = (name) => {
    const needs = [jobs[name].needs ?? []].flat()
    return new Set(needs.flatMap((dependency) => [dependency, ...dependencies(dependency)]))
  }
  for (const [name, own] of [
    ['release-windows', 'windows'],
    ['release-macos', 'macos']
  ]) {
    const needs = dependencies(name)
    assert.ok(needs.has('validate'))
    assert.ok(needs.has(own))
    assert.equal(needs.has('linux'), false)
    assert.equal(needs.has('flatpak-pages'), false)
  }
  for (const platform of ['windows', 'macos', 'linux'])
    assert.ok(dependencies('legacy-release').has(platform))
  assert.ok(dependencies('release-linux').has('flatpak-pages'))
  assert.equal(dependencies('release-linux').has('linux-bundle'), false)
  assert.equal(dependencies('flatpak-pages').has('linux-bundle'), false)
  assert.equal(dependencies('legacy-release').has('linux-bundle'), false)
  const offline = load(await readFile('.github/workflows/linux-offline.yml', 'utf8'))
  assert.deepEqual(offline.on.workflow_run.workflows, ['Build distributables'])
  for (const guard of [
    "conclusion == 'success'",
    "event == 'push'",
    'head_repository.full_name == github.repository'
  ])
    assert.ok(offline.jobs.bundle.if.includes(guard))
  for (const name of ['windows', 'macos', 'linux']) {
    assert.equal(dependencies(name).has('bundle'), false)
    assert.ok(jobs[name].steps.some((step) => step.run?.includes('wait-for-bundle.mjs')))
  }
})

test('Linux update discovery does not wait for the standalone installer and still accepts older releases', () => {
  const ready = release('3.30.0', 'linux-x64')
  assert.ok(!ready.assets.some((asset) => asset.name.endsWith('.flatpak')))
  assert.equal(selectPlatformRelease([ready], 'linux-x64', '3.29.0').version, '3.30.0')
  const older = release('3.29.0', 'linux-x64')
  older.assets = older.assets.filter((asset) => asset.name !== 'sele.flatpakref')
  older.assets.push({
    name: 'sele-linux-x64.flatpak',
    size: 123,
    browser_download_url: `${releaseDownloadUrl(older)}sele-linux-x64.flatpak`
  })
  assert.equal(selectPlatformRelease([older], 'linux-x64', '3.28.0').version, '3.29.0')
})

test('parallel platform setup waits for a finalized bundle and aborts when compilation fails', async () => {
  const env = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '123', GH_TOKEN: 'fixture' }
  let attempts = 0,
    pauses = 0
  await waitForBundle({
    env,
    pause: async () => {
      pauses++
    },
    fetcher: async (url) => {
      if (url.includes('/artifacts')) {
        attempts++
        return new Response(
          JSON.stringify({
            artifacts:
              attempts === 1
                ? []
                : [
                    {
                      name: 'application-bundle',
                      expired: false,
                      size_in_bytes: 123
                    }
                  ]
          })
        )
      }
      return new Response(
        JSON.stringify({ jobs: [{ name: 'Bundle application once', status: 'in_progress' }] })
      )
    }
  })
  assert.equal(attempts, 2)
  assert.equal(pauses, 1)
  await assert.rejects(
    waitForBundle({
      env,
      pause: async () => {},
      fetcher: async (url) =>
        new Response(
          JSON.stringify(
            url.includes('/artifacts')
              ? { artifacts: [] }
              : {
                  jobs: [
                    { name: 'Bundle application once', status: 'completed', conclusion: 'failure' }
                  ]
                }
          )
        )
    }),
    /bundling failed/
  )
})

test('standalone attachment only uploads to an already-published Linux entry', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-bundle-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  await writeFile(join(directory, 'sele-linux-x64.flatpak'), 'fixture')
  const calls = []
  const run = (file, args) => {
    calls.push([file, ...args])
    if (file === 'git') return 'source-sha'
    if (args[0] === 'api') return 'v0.1.0'
    if (args[1] === 'view') return '{"isDraft":false}'
    return ''
  }
  await publishRelease(`v${version}`, 'linux-bundle', directory, run)
  assert.equal(calls.at(-1)[2], 'upload')
  assert.equal(calls.at(-1)[3], `v${version}-linux-x64`)
  assert.equal(
    calls.some((args) => args[2] === 'edit' || args[2] === 'create'),
    false
  )
})

test('Homebrew points at the macOS release as soon as it ships and rejects older reruns', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-cask-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const cask = join(directory, 'sele.rb'),
    dmg = join(directory, 'sele.dmg')
  await writeFile(dmg, 'fixture disk image')
  await writeFile(
    cask,
    `cask "sele" do
  version "3.27.0"
  sha256 "${'a'.repeat(64)}"
  url "https://github.com/Chipi-Chapa-Corp/sele/releases/download/v#{version}/sele-macos-arm64.dmg"
end
`
  )
  const run = (tag) => {
    const result = spawnSync(
      process.execPath,
      ['scripts/update-homebrew-cask.mjs', tag, dmg, cask],
      { encoding: 'utf8' }
    )
    assert.equal(result.status, 0, result.stderr)
  }
  run('v3.28.0-macos-arm64')
  const next = await readFile(cask, 'utf8')
  assert.match(next, /version "3.28.0"/)
  assert.match(next, /download\/v#\{version\}-macos-arm64\//)
  assert.ok(!next.includes('a'.repeat(64)))
  run('v3.27.0-macos-arm64')
  assert.equal(await readFile(cask, 'utf8'), next)
})

test('publisher uploads a complete draft before publishing a platform entry without marking it latest', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-release-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  for (const file of releaseFiles(version, 'windows-x64'))
    await writeFile(join(directory, file), 'fixture')
  const calls = []
  const run = (file, args) => {
    calls.push([file, ...args])
    if (file === 'git') return 'source-sha\n'
    if (args[0] === 'api') return 'v3.26.0\n'
    if (args[0] === 'release' && args[1] === 'view') return null
    return ''
  }
  await publishRelease(`v${version}`, 'windows-x64', directory, run)
  const create = calls.find((args) => args[2] === 'create')
  assert.equal(create[3], `v${version}-windows-x64`)
  assert.ok(create.includes('--draft'))
  assert.ok(create.includes('--latest=false'))
  assert.equal(create[create.indexOf('--target') + 1], 'source-sha')
  assert.ok(calls.at(-1).includes('--draft=false'))
  assert.ok(calls.at(-1).includes('--latest=false'))
  calls.length = 0
  await rm(join(directory, 'latest.yml'))
  await assert.rejects(
    publishRelease(`v${version}`, 'windows-x64', directory, run),
    /Missing release asset/
  )
  assert.equal(calls.length, 0)
})

test('compatibility reruns preserve the latest release and cannot mark an older version latest', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-release-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  for (const file of releaseFiles(version, 'legacy'))
    await writeFile(join(directory, file), 'fixture')
  for (const [current, expected] of [
    [`v${version}`, true],
    ['v0.1.0', true],
    ['v999.0.0', false]
  ]) {
    const calls = []
    await publishRelease(`v${version}`, 'legacy', directory, (file, args) => {
      calls.push([file, ...args])
      if (file === 'git') return 'source-sha'
      if (args[0] === 'api') return current
      if (args[1] === 'view') return '{"isDraft":false}'
      return ''
    })
    assert.ok(calls.some((args) => args[2] === 'upload'))
    assert.ok(!calls.some((args) => args[2] === 'create'))
    assert.ok(calls.at(-1).includes(`--latest=${expected}`))
  }
})

test('a failed asset upload leaves the release unpublished', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-release-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  for (const file of releaseFiles(version, 'windows-x64'))
    await writeFile(join(directory, file), 'fixture')
  const calls = []
  await assert.rejects(
    publishRelease(`v${version}`, 'windows-x64', directory, (file, args) => {
      calls.push([file, ...args])
      if (file === 'git') return 'source-sha'
      if (args[0] === 'api') return 'v0.1.0'
      if (args[1] === 'view') return null
      throw new Error('asset upload failed')
    }),
    /asset upload failed/
  )
  assert.equal(
    calls.some((args) => args[2] === 'edit'),
    false
  )
})
