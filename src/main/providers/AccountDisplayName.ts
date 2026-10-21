import { createHash } from 'node:crypto'

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 256) : null

/** Read presentation metadata only; JWT claims never authorize account operations. */
export const codexAccountDisplayName = (content: string): string | null => {
  try {
    const auth = JSON.parse(content)
    const token = auth.tokens?.id_token
    if (typeof token !== 'string') return null
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())
    return (
      text(claims.name) ??
      text(claims.email) ??
      text(claims['https://api.openai.com/profile']?.email)
    )
  } catch {
    // Parse errors can contain credentials. Never expose them to IPC or logs.
    return null
  }
}

const profiles = new Map<string, { expiresAt: number; request: Promise<string | null> }>()

const cachedProfile = (key: string, load: () => Promise<string | null>): Promise<string | null> => {
  const now = Date.now()
  for (const [id, entry] of profiles) if (entry.expiresAt <= now) profiles.delete(id)
  const cached = profiles.get(key)
  if (cached) return cached.request
  const request = load()
    .catch(() => null)
    .then((name) => {
      // Retry transient failures on the next lookup, including menu-open refreshes.
      if (!name && profiles.get(key)?.request === request) profiles.delete(key)
      return name
    })
  if (profiles.size >= 256) profiles.delete(profiles.keys().next().value!)
  profiles.set(key, { expiresAt: now + 5 * 60_000, request })
  return request
}

export const claudeAccountDisplayName = (
  token: string,
  version: string,
  fetchFn: typeof fetch = fetch
): Promise<string | null> =>
  cachedProfile(`claude:${createHash('sha256').update(token).digest('hex')}`, async () => {
    const response = await fetchFn('https://api.anthropic.com/api/oauth/profile', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': `claude-code/${version}`
      },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) return null
    const profile = await response.json()
    return (
      text(profile.account?.display_name) ??
      text(profile.account?.full_name) ??
      text(profile.account?.email)
    )
  })

export const copilotAccountDisplayName = (
  login: string,
  host?: string,
  fetchFn: typeof fetch = fetch
): Promise<string | null> =>
  cachedProfile(`copilot:${host ?? 'github.com'}:${login}`, async () => {
    const base = new URL(host?.includes('://') ? host : `https://${host || 'github.com'}`)
    if (base.protocol !== 'https:' || base.username || base.password) return null
    const url =
      base.hostname === 'github.com'
        ? new URL(`/users/${encodeURIComponent(login)}`, 'https://api.github.com')
        : new URL(`/api/v3/users/${encodeURIComponent(login)}`, base.origin)
    const response = await fetchFn(url, {
      headers: { Accept: 'application/vnd.github+json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) return null
    return text((await response.json()).name)
  })
