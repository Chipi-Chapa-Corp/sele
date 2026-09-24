import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { HostCommand } from '../../hostProcess'

export type ClaudeLoginCompletion = { success: boolean; error: string | null }

const claudeAuthorizationEndpoints = new Set([
  'https://claude.com/cai/oauth/authorize',
  'https://claude.ai/oauth/authorize',
  'https://console.anthropic.com/oauth/authorize',
  'https://platform.claude.com/oauth/authorize'
])

export const findClaudeAuthorizationUrl = (output: string): string | null => {
  // The CLI can emit OSC hyperlinks and split a URL across multiple stdout chunks.
  const text = output.replaceAll('\u0007', ' ').replaceAll('\u001b', ' ')
  for (const match of text.matchAll(/https:\/\/[^\s<>"']+(?=[\s<>"'])/g)) {
    if (URL.canParse(match[0])) {
      const url = new URL(match[0])
      if (
        claudeAuthorizationEndpoints.has(`${url.origin}${url.pathname}`) &&
        !url.username &&
        !url.password &&
        url.searchParams.has('state') &&
        url.searchParams.get('response_type') === 'code'
      )
        return url.href
    }
  }
  return null
}

/** Owns the CLI's OAuth flow. Tokens stay in Claude's credential store, never in IPC. */
export class ClaudeAccountLogin {
  readonly ready: Promise<string>
  readonly completion: Promise<ClaudeLoginCompletion>
  private child: ChildProcessWithoutNullStreams
  private canceling = false
  private closed = false
  private closePromise: Promise<void>

  constructor(command: HostCommand, timeoutMs = 5 * 60_000) {
    this.child = spawn(command.file, command.args, {
      cwd: command.cwd,
      env: command.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let resolveReady!: (url: string) => void
    let rejectReady!: (error: Error) => void
    let resolveCompletion!: (value: ClaudeLoginCompletion) => void
    let resolveClosed!: () => void
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // Cancellation may happen before the renderer starts awaiting the URL.
    void this.ready.catch((error: unknown) => {
      console.warn('Claude account authorization did not start.', error)
    })
    this.completion = new Promise((resolve) => {
      resolveCompletion = resolve
    })
    this.closePromise = new Promise((resolve) => {
      resolveClosed = resolve
    })
    let ready = false
    let output = ''
    let failure: string | null = null
    const finish = (success: boolean): void => {
      if (this.closed) return
      this.closed = true
      clearTimeout(timer)
      clearTimeout(urlTimer)
      const error = success
        ? null
        : failure ||
          (this.canceling
            ? 'Claude sign-in was canceled.'
            : 'Claude sign-in failed. Please try again.')
      if (!ready)
        rejectReady(new Error(error || 'Claude sign-in finished without an authorization URL.'))
      output = ''
      resolveCompletion({ success, error })
      resolveClosed()
    }
    const timer = setTimeout(() => {
      failure = 'Claude sign-in timed out. Please try again.'
      void this.cancel()
    }, timeoutMs)
    const urlTimer = setTimeout(
      () => {
        if (ready || this.canceling) return
        failure = 'Claude did not provide a sign-in URL. Check your connection and try again.'
        void this.cancel()
      },
      Math.min(30_000, timeoutMs)
    )
    const readOutput = (chunk: Buffer): void => {
      if (ready || this.canceling) return
      output = (output + chunk.toString('utf8')).slice(-64 * 1024)
      const url = findClaudeAuthorizationUrl(output)
      if (url) {
        ready = true
        clearTimeout(urlTimer)
        output = ''
        resolveReady(url)
      }
    }
    this.child.stdout.on('data', readOutput)
    this.child.stderr.on('data', readOutput)
    this.child.stdin.on('error', () => {
      void this.cancel()
    })
    this.child.once('error', () => finish(false))
    this.child.once('close', (code) => finish(code === 0 && !this.canceling))
  }

  submitCode = (value: string): void => {
    const code = value.trim()
    if (this.closed || this.canceling) throw new Error('Claude sign-in is no longer pending.')
    if (
      !code ||
      code.length > 4096 ||
      Array.from(code).some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error('Invalid authorization code.')
    this.child.stdin.write(`${code}\n`)
  }

  cancel = async (): Promise<void> => {
    if (this.closed) return
    this.canceling = true
    this.child.stdin.end()
    if (process.platform === 'win32' && this.child.pid) {
      // npm-installed CLIs can be launched through cmd.exe; terminate its children too.
      execFile(
        'taskkill',
        ['/pid', String(this.child.pid), '/T', '/F'],
        { windowsHide: true },
        () => {}
      )
    } else this.child.kill('SIGTERM')
    const force = setTimeout(() => this.child.kill('SIGKILL'), 2_000)
    try {
      await this.closePromise
    } finally {
      clearTimeout(force)
    }
  }
}
