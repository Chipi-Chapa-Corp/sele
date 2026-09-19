// Labels describe the requested action; they never execute or expose the tool's JavaScript.
const browserActions: Record<string, string> = {
  getBrowser: 'Opened browser',
  createBrowserTab: 'Opened a new tab',
  getTab: 'Opened browser tab',
  listBrowsers: 'Listed browsers',
  listTabs: 'Listed browser tabs',
  getState: 'Checked browser state',
  documentation: 'Read browser controls',
  goto: 'Navigated to webpage',
  back: 'Went back',
  forward: 'Went forward',
  reload: 'Reloaded webpage',
  close: 'Closed browser tab',
  markDeliverable: 'Showed webpage',
  markHandoff: 'Handed over browser',
  getAXState: 'Read webpage',
  getScreenshot: 'Took browser screenshot',
  getAXStateAndScreenshot: 'Inspected webpage',
  click: 'Clicked on webpage',
  drag: 'Dragged on webpage',
  pressKey: 'Pressed a key',
  scroll: 'Scrolled webpage',
  selectText: 'Selected text',
  setValue: 'Filled a field',
  typeText: 'Typed on webpage',
  paste: 'Pasted into webpage',
  performSecondaryAction: 'Interacted with webpage'
}
const observations = new Set([
  'getAXState',
  'getScreenshot',
  'getAXStateAndScreenshot',
  'getState',
  'listBrowsers',
  'listTabs',
  'documentation',
  'markDeliverable',
  'markHandoff'
])

export function getBrowserToolLabel(names: string[], input: unknown): string | null {
  const isCua = names.some((name) =>
    /(?:^|[ /])(?:mcp__)?cua_repl(?:__|\/)(?:js|js_reset)$/.test(name)
  )
  if (!isCua) return null
  if (names.some((name) => /(?:__|\/)js_reset$/.test(name))) return 'Reset browser controls'
  let args = input
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch (error) {
      /* Nested calls may contain raw JavaScript. */
      console.warn('Unable to parse nested Codex browser tool arguments as JSON', error)
    }
  }
  const code =
    args && typeof args === 'object' && 'code' in args && typeof args.code === 'string'
      ? args.code
      : typeof args === 'string'
        ? args
        : ''
  // Ignore quoted text and comments so page content is not mistaken for an action.
  const executable = code.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    ' '
  )
  const methods = [...executable.matchAll(/\b\w+\s*\.\s*(\w+)\s*\(/g)]
    .map((match) => match[1])
    .filter((method) => method in browserActions)
  const method = methods.find((name) => !observations.has(name)) ?? methods[0]
  return method ? browserActions[method] : 'Used browser'
}
