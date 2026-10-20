import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk'
import {
  listRemoteClaudeSessionCandidates,
  readRemoteClaudeSessionInfo
} from './ClaudeRemoteSessionDiscovery.ts'
import { listLocalClaudeSessionCandidates } from './ClaudeSessionCatalog.ts'

import { readLocalClaudeSessionInfo } from './ClaudeSessionSummary.ts'

const execute = promisify(execFile)
const base = (id) => ({
  sessionId: id,
  cwd: '/fixture with spaces',
  gitBranch: 'main',
  isSidechain: false,
  timestamp: '2026-09-25T12:00:00.000Z'
})
const user = (id) => ({
  ...base(id),
  type: 'user',
  uuid: 'user',
  parentUuid: null,
  message: { role: 'user', content: 'Build a counter 🐱' }
})
const encode = (entries) => entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'

test('remote summaries stay bounded and preserve local SDK metadata, sidecars, UTF-8 and partial writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-summary-'))
  const previousRoot = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = root
  let transferred = 0
  const commands = []
  const run = async (script, args = []) => {
    commands.push({ script, args })
    const { stdout } = await execute('/bin/sh', ['-lc', script, 'sele-test', ...args], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: root },
      maxBuffer: 1024 * 1024
    })
    transferred += Buffer.byteLength(stdout)
    return stdout
  }
  try {
    const project = join(root, 'projects', '-fixture with spaces')
    await mkdir(project, { recursive: true })
    const ids = []
    for (const bytes of [0, 65_000, 90_000, 16 * 1024 * 1024]) {
      const id = randomUUID()
      ids.push(id)
      const entries = [user(id)]
      if (bytes)
        entries.push({
          ...base(id),
          type: 'assistant',
          uuid: 'answer',
          parentUuid: 'user',
          message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(bytes) }] }
        })
      entries.push({ type: 'custom-title', sessionId: id, customTitle: `Title ${bytes} 🐱` })
      await writeFile(join(project, `${id}.jsonl`), encode(entries) + '{"partial":')
      await utimes(join(project, `${id}.jsonl`), 1000 + ids.length, 1000 + ids.length)
    }
    const sidecarId = randomUUID()
    ids.push(sidecarId)
    await writeFile(join(project, `${sidecarId}.jsonl`), encode([user(sidecarId)]))
    await mkdir(join(project, sidecarId))
    await writeFile(
      join(project, sidecarId, 'custom-title.json'),
      JSON.stringify({ customTitle: 'Sidecar title' })
    )
    // Metadata in the head must not bleed into the tail across a large unread middle.
    const branchId = randomUUID()
    ids.push(branchId)
    await writeFile(
      join(project, `${branchId}.jsonl`),
      encode([
        user(branchId),
        { ...base(branchId), type: 'system', gitBranch: 'old-head-branch' },
        { type: 'assistant', message: { role: 'assistant', content: 'x'.repeat(200_000) } },
        { type: 'custom-title', customTitle: 'Large gap' }
      ])
    )
    // A full tail record can start exactly on the range boundary.
    const alignedId = randomUUID()
    ids.push(alignedId)
    const end = encode([{ type: 'custom-title', customTitle: 'Boundary title' }])
    const paddingLine = JSON.stringify({
      type: 'padding',
      value: 'x'.repeat(65_536 - Buffer.byteLength(end) - 30)
    })
    const alignedEnd =
      end + paddingLine + ' '.repeat(65_536 - Buffer.byteLength(end + paddingLine) - 1) + '\n'
    assert.equal(Buffer.byteLength(alignedEnd), 65_536)
    await writeFile(
      join(project, `${alignedId}.jsonl`),
      encode([
        user(alignedId),
        { type: 'assistant', message: { role: 'assistant', content: 'x'.repeat(200_000) } }
      ]) + alignedEnd
    )
    const remote = await listRemoteClaudeSessionCandidates(run)
    const local = await listLocalClaudeSessionCandidates()
    assert.deepEqual(remote.map((c) => c.sessionId).sort(), ids.toSorted())
    assert.deepEqual(local.map((c) => c.sessionId).sort(), ids.toSorted())
    for (const candidate of remote) {
      const before = transferred
      const actual = await readRemoteClaudeSessionInfo(candidate, run)
      const expected = await getSessionInfo(candidate.sessionId)
      const localInfo = await readLocalClaudeSessionInfo(candidate)
      assert.ok(actual, candidate.sessionId)
      for (const field of [
        'summary',
        'customTitle',
        'firstPrompt',
        'cwd',
        'gitBranch',
        'createdAt',
        'fileSize'
      ]) {
        assert.equal(localInfo[field], expected[field], `local ${candidate.sessionId} ${field}`)
        assert.equal(actual[field], expected[field], `${candidate.sessionId} ${field}`)
      }
      assert.ok(
        transferred - before < 180_000,
        'only bounded base64 head/tail metadata crosses the transport'
      )
    }
    assert.equal(
      commands.length,
      remote.length + 1,
      'one batched stat plus one summary command per selected file'
    )
    assert.ok(
      commands.every(({ script }) => !script.includes('cat ')),
      'discovery never cats a transcript'
    )

    const chainId = randomUUID()
    await writeFile(
      join(project, `${chainId}.jsonl`),
      encode([{ ...user(chainId), isSidechain: true }])
    )
    const chain = (await listRemoteClaudeSessionCandidates(run)).find(
      (c) => c.sessionId === chainId
    )
    assert.equal(await readRemoteClaudeSessionInfo(chain, run), undefined)
    const original = randomUUID()
    const continued = randomUUID()
    const originalPath = join(project, `${original}.jsonl`)
    await writeFile(
      originalPath,
      encode([user(original), { type: 'continued-in', continuedInSessionId: continued }])
    )
    let originalCandidate = (await listRemoteClaudeSessionCandidates(run)).find(
      (c) => c.sessionId === original
    )
    assert.ok(
      await readLocalClaudeSessionInfo(originalCandidate),
      'missing continuation keeps the original visible'
    )
    assert.ok(await readRemoteClaudeSessionInfo(originalCandidate, run))
    await writeFile(join(project, `${continued}.jsonl`), encode([user(continued)]))
    assert.ok(
      !(await listSessions()).some((s) => s.sessionId === original),
      'native SDK hides the superseded original'
    )
    assert.equal(await readLocalClaudeSessionInfo(originalCandidate), undefined)
    assert.equal(await readRemoteClaudeSessionInfo(originalCandidate, run), undefined)
    await writeFile(
      originalPath,
      encode([
        user(original),
        { type: 'continued-in', continuedInSessionId: continued },
        { ...user(original), message: { role: 'user', content: 'Resume this original instead' } }
      ])
    )
    assert.ok(
      await readLocalClaudeSessionInfo(originalCandidate),
      'resuming after the continuation marker restores visibility'
    )
    assert.ok(await readRemoteClaudeSessionInfo(originalCandidate, run))

    // Duplicate IDs must hydrate the newest file selected by the catalog, not the first project match.
    const duplicateProject = join(root, 'projects', '-another')
    await mkdir(duplicateProject)
    await writeFile(
      join(duplicateProject, `${original}.jsonl`),
      encode([user(original), { type: 'custom-title', customTitle: 'Newest copy' }])
    )
    await utimes(join(duplicateProject, `${original}.jsonl`), 2000000000, 2000000000)
    const duplicates = (await listLocalClaudeSessionCandidates())
      .filter((c) => c.sessionId === original)
      .sort((a, b) => b.mtime - a.mtime)
    assert.equal(duplicates.length, 2)
    assert.equal((await readLocalClaudeSessionInfo(duplicates[0])).customTitle, 'Newest copy')
    assert.equal((await readRemoteClaudeSessionInfo(duplicates[0], run)).customTitle, 'Newest copy')
    await rm(chain.path)
    assert.equal(
      await readRemoteClaudeSessionInfo(chain, run),
      undefined,
      'deleted files are skipped'
    )
  } finally {
    if (previousRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})
