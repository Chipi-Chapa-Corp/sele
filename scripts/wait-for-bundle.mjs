import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export async function waitForBundle({
  env = process.env,
  fetcher = fetch,
  pause = delay,
  timeout = 600_000
} = {}) {
  const {
    GITHUB_API_URL = 'https://api.github.com',
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID,
    GH_TOKEN
  } = env
  if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID || !GH_TOKEN)
    throw new Error('GitHub Actions repository, run ID and token are required')
  const base = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
  const get = async (path) => {
    const response = await fetcher(base + path, {
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' }
    })
    if (!response.ok) throw new Error(`Unable to check application bundle (${response.status})`)
    return response.json()
  }
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const { artifacts } = await get('/artifacts?per_page=100')
    if (
      artifacts?.some(
        (artifact) =>
          artifact.name === 'application-bundle' && !artifact.expired && artifact.size_in_bytes > 0
      )
    )
      return
    const { jobs } = await get('/jobs?per_page=100')
    const bundle = jobs?.find((job) => job.name === 'Bundle application once')
    if (bundle?.status === 'completed' && bundle.conclusion !== 'success')
      throw new Error(`Application bundling failed (${bundle.conclusion})`)
    await pause(3_000)
  }
  throw new Error('Timed out waiting for the application bundle')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await waitForBundle()
