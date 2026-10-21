import type { TerminalProcessStatus } from '../../shared/terminal'

/** A panel tab stays open after a command ends; the task belongs to its launching chat. */
export const createPanelTerminalTask = (options: {
  initialChatKey: string | null
  currentChatKey: () => string | null
  readStatus: () => Promise<TerminalProcessStatus>
  report: (chatKey: string, running: boolean, completed: boolean) => void
}) => {
  let owner = options.initialChatKey
  let candidate = owner
  let running = false
  let foregroundSeen = false
  let disposed = false
  let revision = 0
  let input = ''
  let outputTail = ''
  const start = () => {
    if (disposed || running) return
    owner = candidate ?? options.currentChatKey()
    running = true
    foregroundSeen = false
    revision++
    if (owner) options.report(owner, true, false)
  }
  const finish = () => {
    if (disposed || !running) return
    running = false
    revision++
    if (owner) options.report(owner, false, true)
  }
  return {
    start,
    input: (data: string) => {
      if (!running) candidate = options.currentChatKey()
      input += data
      if (/[\r\n]/.test(data)) {
        if (input.trim()) start()
        input = ''
      }
      input = input.slice(-4096)
    },
    output: (data: string) => {
      const text = outputTail + data
      // Shell integration (OSC 133), plus completion of keep-open launcher commands.
      for (const match of text.matchAll(
        // biome-ignore lint/suspicious/noControlCharactersInRegex: OSC is a terminal control protocol.
        /\x1b\](?:133;([ACD])(?:;[^\x07\x1b]*)?|777;sele-command-finished;[^\x07\x1b]*)(?:\x07|\x1b\\)/g
      )) {
        if (match[1] === 'C') start()
        else finish()
      }
      const incomplete = text.lastIndexOf('\x1b]')
      outputTail =
        incomplete >= 0 &&
        !text.slice(incomplete).includes('\x07') &&
        !text.slice(incomplete).endsWith('\x1b\\')
          ? text.slice(incomplete, incomplete + 256)
          : ''
    },
    check: async () => {
      const before = revision
      const status = await options.readStatus()
      if (disposed || revision !== before) return
      if (status.hasActiveProcess) {
        start()
        foregroundSeen = true
      } else if (foregroundSeen) finish()
    },
    finish,
    dispose: () => {
      disposed = true
      revision++
      if (owner && running) options.report(owner, false, false)
    }
  }
}
