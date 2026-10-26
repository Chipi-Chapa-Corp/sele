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

const browserToolActions: Record<string, string> = {
  tabs_context: 'Listed browser tabs',
  tabs_create: 'Opened a new tab',
  tabs_select: 'Selected browser tab',
  tabs_close: 'Closed browser tab',
  navigate: 'Navigated to webpage',
  read_page: 'Read webpage',
  find: 'Searched webpage',
  get_page_text: 'Read webpage text',
  form_input: 'Filled a field',
  javascript_tool: 'Ran webpage script',
  resize_window: 'Resized browser viewport',
  read_console_messages: 'Read browser console',
  read_network_requests: 'Read network requests',
  upload_files: 'Uploaded files to webpage',
  downloads: 'Checked browser downloads',
  handle_dialog: 'Handled browser dialog',
  save_screenshot: 'Took browser screenshot',
  print_pdf: 'Saved webpage as PDF',
  record_gif: 'Recorded browser interaction'
}

const computerActions: Record<string, string> = {
  screenshot: 'Took browser screenshot',
  zoom: 'Read browser screenshot',
  left_click: 'Clicked on webpage',
  right_click: 'Clicked on webpage',
  middle_click: 'Clicked on webpage',
  double_click: 'Clicked on webpage',
  triple_click: 'Clicked on webpage',
  hover: 'Hovered on webpage',
  type: 'Typed on webpage',
  key: 'Pressed a key',
  scroll: 'Scrolled webpage',
  scroll_to: 'Scrolled webpage',
  wait: 'Waited for webpage',
  left_click_drag: 'Dragged on webpage'
}

export function getBrowserToolLabel(names: string[], input: unknown): string | null {
  const browserTool = names
    .map(
      (name) =>
        name.match(
          /^(?:mcp__)?(?:Claude_Browser|Sele_Browser|OpenCode_Browser)(?:__|\/|_)(.+)$/i
        )?.[1]
    )
    .find(Boolean)
  if (browserTool) {
    const tool = browserTool.replace(/^chrome_/, '')
    if (tool === 'computer' || tool === 'native_computer') {
      const action = input && typeof input === 'object' && 'action' in input ? input.action : null
      if (tool === 'native_computer') return 'Used shared desktop'
      return typeof action === 'string'
        ? (computerActions[action] ?? 'Interacted with webpage')
        : 'Interacted with webpage'
    }
    return browserToolActions[tool] ?? null
  }
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
