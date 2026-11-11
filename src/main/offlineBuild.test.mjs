import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveOfflineSource } from '../../scripts/resolve-offline-source.mjs'
import { resolveUbuntuMirror } from '../../scripts/resolve-ubuntu-mirror.mjs'

const source = {
  status: 'completed',
  conclusion: 'success',
  event: 'push',
  path: '.github/workflows/build.yml',
  head_branch: 'v3.28.2',
  head_sha: 'a'.repeat(40),
  head_repository: { full_name: 'owner/repo' }
}
const environment = {
  GITHUB_REPOSITORY: 'owner/repo',
  GH_TOKEN: 'fixture',
  RETRY_REF: 'offline-run-123'
}

test('retry tags reuse the exact successful release source and original artifact run', async () => {
  const urls = []
  const selected = await resolveOfflineSource({
    env: environment,
    fetcher: async (url) => {
      urls.push(url)
      return new Response(JSON.stringify(source))
    }
  })
  assert.deepEqual(selected, { run_id: '123', source_sha: 'a'.repeat(40), release_tag: 'v3.28.2' })
  assert.equal(urls[0], 'https://api.github.com/repos/owner/repo/actions/runs/123')
  const automatic = await resolveOfflineSource({
    env: { ...environment, SOURCE_RUN_ID: '456' },
    fetcher: async () => new Response(JSON.stringify(source))
  })
  assert.equal(automatic.run_id, '456')
})

test('failed builds, PRs, forks, wrong workflows and non-release branches cannot publish installer retries', async () => {
  for (const patch of [
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { event: 'pull_request' },
    { head_branch: 'main' },
    { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'fork/repo' } },
    { head_sha: 'invalid' }
  ]) {
    await assert.rejects(
      resolveOfflineSource({
        env: environment,
        fetcher: async () => new Response(JSON.stringify({ ...source, ...patch }))
      }),
      /Only successful/
    )
  }
  await assert.rejects(
    resolveOfflineSource({ env: { ...environment, RETRY_REF: 'v3.28.2' } }),
    /source workflow/
  )
})

test('Ubuntu tooling uses signed official sources and recovers from a transient download failure', {
  skip: process.platform !== 'linux'
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-apt-fixture-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bin = join(directory, 'bin')
  await mkdir(bin)
  for (const [name, body] of Object.entries({
    sudo: '#!/bin/sh\nexec "$@"\n',
    dpkg: '#!/bin/sh\necho amd64\n',
    sleep: '#!/bin/sh\nexit 0\n',
    getent: '#!/bin/sh\nexit 2\n',
    node: '#!/bin/sh\necho 192.0.2.1\n',
    'apt-get': `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const root=process.env.SELE_APT_FIXTURE;
const log=path.join(root,'calls.json');
const calls=fs.existsSync(log)?JSON.parse(fs.readFileSync(log,'utf8')):[];
const args=process.argv.slice(2); calls.push(args);fs.writeFileSync(log,JSON.stringify(calls));
const source=args.find(value=>value.startsWith('Dir::Etc::sourcelist=')).split('=')[1];
fs.copyFileSync(source,path.join(root,'sources'));
if(process.env.SELE_APT_ALWAYS_FAIL==='1'||calls.length===1)process.exit(100);
`
  }))
    await writeFile(join(bin, name), body, { mode: 0o755 })
  const osRelease = join(directory, 'os-release')
  await writeFile(osRelease, 'ID=ubuntu\nVERSION_CODENAME=noble\n')
  const env = {
    ...process.env,
    GITHUB_ACTIONS: 'false',
    PATH: `${bin}:${process.env.PATH}`,
    SELE_APT_FIXTURE: directory,
    SELE_OS_RELEASE_FILE: osRelease
  }
  const result = spawnSync('bash', ['scripts/install-ubuntu-ci-tools.sh', 'flatpak'], {
    env,
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  const calls = JSON.parse(await readFile(join(directory, 'calls.json'), 'utf8'))
  assert.equal(calls.length, 3)
  assert.ok(calls[2].includes('--no-install-recommends'))
  assert.ok(calls[0].includes('APT::Update::Error-Mode=any'))
  const repositories = await readFile(join(directory, 'sources'), 'utf8')
  assert.match(repositories, /https:\/\/archive\.ubuntu\.com\/ubuntu/)
  assert.match(repositories, /https:\/\/security\.ubuntu\.com\/ubuntu/)
  assert.match(repositories, /Signed-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring\.gpg/)
  assert.ok(!repositories.includes('azure'))
  await rm(join(directory, 'calls.json'))
  const failed = spawnSync('bash', ['scripts/install-ubuntu-ci-tools.sh', 'flatpak'], {
    env: { ...env, SELE_APT_ALWAYS_FAIL: '1' },
    encoding: 'utf8'
  })
  assert.equal(failed.status, 1)
  assert.equal(JSON.parse(await readFile(join(directory, 'calls.json'), 'utf8')).length, 3)
  assert.match(failed.stderr, /three bounded attempts/)
  await rm(join(directory, 'calls.json'))
  const hosts = join(directory, 'hosts')
  const repaired = spawnSync('bash', ['scripts/install-ubuntu-ci-tools.sh', 'flatpak'], {
    env: { ...env, GITHUB_ACTIONS: 'true', SELE_CI_HOSTS_FILE: hosts },
    encoding: 'utf8'
  })
  assert.equal(repaired.status, 0, repaired.stderr)
  assert.match(repaired.stdout, /Restored Ubuntu mirror resolution/)
  assert.match(await readFile(hosts, 'utf8'), /192\.0\.2\.1 archive\.ubuntu\.com/)
  assert.match(await readFile(hosts, 'utf8'), /192\.0\.2\.1 security\.ubuntu\.com/)
})

test('Ubuntu DNS fallback validates answers and tries an independent HTTPS provider', async () => {
  const providers = []
  const address = await resolveUbuntuMirror('archive.ubuntu.com', {
    queryDns: async (provider, hostname) => {
      providers.push(provider.hostname)
      assert.equal(hostname, 'archive.ubuntu.com')
      if (providers.length === 1) throw new Error('First resolver unavailable')
      return {
        Status: 0,
        Answer: [
          { type: 5, data: 'alias.example' },
          { type: 1, data: '91.189.90.13' }
        ]
      }
    }
  })
  assert.equal(address, '91.189.90.13')
  assert.deepEqual(providers, ['dns.google', 'cloudflare-dns.com'])
  for (const response of [
    { Status: 3, Answer: [{ type: 1, data: '91.189.90.13' }] },
    { Status: 0, Answer: [{ type: 1, data: 'invalid\ninjected-host' }] },
    { Status: 0, Answer: [{ type: 5, data: '91.189.90.13' }] }
  ]) {
    await assert.rejects(
      resolveUbuntuMirror('security.ubuntu.com', { queryDns: async () => response }),
      /Unable to resolve/
    )
  }
  await assert.rejects(resolveUbuntuMirror('unrelated.example'), /Only Ubuntu/)
})
