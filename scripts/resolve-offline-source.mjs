import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export async function resolveOfflineSource({ env = process.env, fetcher = fetch } = {}) {
  const repository = env.GITHUB_REPOSITORY
  const retry = /^offline-run-(\d+)(?:-retry-\d+)?$/.exec(env.RETRY_REF ?? '')
  const runId = env.SOURCE_RUN_ID || retry?.[1]
  if (!repository || !/^\d+$/.test(runId ?? '') || !env.GH_TOKEN)
    throw new Error('A source workflow run or an offline-run-RUN_ID retry tag is required')
  const response = await fetcher(
    `${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${repository}/actions/runs/${runId}`,
    {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    }
  )
  if (!response.ok) throw new Error(`Unable to verify source workflow (${response.status})`)
  const run = await response.json()
  if (
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.event !== 'push' ||
    run.path !== '.github/workflows/build.yml' ||
    run.head_repository?.full_name !== repository ||
    !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(run.head_branch ?? '') ||
    !/^[a-f0-9]{40}$/.test(run.head_sha ?? '')
  )
    throw new Error(
      'Only successful, same-repository release builds may supply an offline installer'
    )
  return { run_id: String(runId), source_sha: run.head_sha, release_tag: run.head_branch }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = await resolveOfflineSource()
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(source)
      .map(([key, value]) => `${key}=${value}\n`)
      .join('')
  )
  console.log(
    `Using validated ${source.release_tag} from run ${source.run_id} (${source.source_sha}).`
  )
}
