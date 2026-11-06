import type { SessionHooks } from '@github/copilot-sdk'

/** Environment ownership survives nohup, setsid, reparenting, and application restarts. */
export const chatProcessEnvironment = (chatId: string): Record<string, string> => ({
  SELE_CHAT_ID: chatId
})

export const copilotProcessHooks = (chatId: string): SessionHooks => ({
  onPreToolUse: (input) => {
    if (!/^(bash|shell|powershell)$/.test(input.toolName)) return
    const args = input.toolArgs as { command?: unknown } | null
    if (!args || typeof args.command !== 'string') return
    const escaped = chatId.replace(/'/g, input.toolName === 'powershell' ? "''" : "'\\''")
    const prefix =
      input.toolName === 'powershell'
        ? `$env:SELE_CHAT_ID = '${escaped}'`
        : `export SELE_CHAT_ID='${escaped}'`
    return { modifiedArgs: { ...args, command: `${prefix}\n${args.command}` } }
  }
})
