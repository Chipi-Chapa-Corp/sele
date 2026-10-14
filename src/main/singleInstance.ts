import type { App } from 'electron'

type PrimaryApplication = { focus: () => void }
type InstanceApp = Pick<App, 'requestSingleInstanceLock' | 'exit' | 'on'>

export const isProviderCliInvocation = (args: readonly string[]): boolean => {
  const hasArg = (argument: string): boolean => args.includes(argument)
  const isCodexInvocation = hasArg('app-server') || hasArg('update') || hasArg('--version')
  const isClaudeRuntimeInvocation =
    hasArg('--input-format') && hasArg('--output-format') && hasArg('stream-json')
  const isCopilotRuntimeInvocation = hasArg('--headless') && (hasArg('--stdio') || hasArg('--port'))
  return (
    isCodexInvocation || isClaudeRuntimeInvocation || isCopilotRuntimeInvocation || hasArg('-V')
  )
}

export const startSingleInstance = async (
  app: InstanceApp,
  loadApplication: () => Promise<PrimaryApplication>,
  args: readonly string[] = process.argv.slice(1)
): Promise<void> => {
  if (isProviderCliInvocation(args)) {
    console.error(
      'A coding-agent CLI invocation resolved to Sele itself. ' +
        'Check the provider executable path or shell PATH configuration.'
    )
    app.exit(1)
    return
  }

  if (!app.requestSingleInstanceLock()) {
    // A rejected launch has no work to save. Do not run the primary instance's
    // asynchronous quit handlers or initialize Chromium sessions while exiting.
    app.exit(0)
    return
  }

  let primary: PrimaryApplication | undefined
  let focusPending = false
  app.on('second-instance', () => {
    if (primary) primary.focus()
    else focusPending = true
  })

  try {
    primary = await loadApplication()
    if (focusPending) primary.focus()
  } catch (error) {
    console.error('Unable to load the primary Sele application:', error)
    app.exit(1)
  }
}
