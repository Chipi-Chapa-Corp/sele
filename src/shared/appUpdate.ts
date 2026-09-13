export type AppUpdateState = {
  version: string | null
  status: 'idle' | 'available' | 'updating' | 'error'
  progress: number | null
  error: string | null
}

export type AppUpdateDismissal = 'session' | 'version' | 'forever'

export function isNewerStableVersion(candidate: string, current: string): boolean {
  const parse = (value: string): number[] | null => {
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
    return match ? match.slice(1).map(Number) : null
  }
  const next = parse(candidate)
  const installed = parse(current)
  if (!next || !installed) return false
  for (let index = 0; index < 3; index++) {
    if (next[index] !== installed[index]) return next[index] > installed[index]
  }
  return false
}
