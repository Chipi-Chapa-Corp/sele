import { basename } from 'node:path'
import type { ProviderToolActivity, ProviderToolIcon } from '../../shared/provider'
import { getAppToolPresentation } from './AppToolPresentation.ts'
import { getBrowserToolLabel } from './BrowserToolPresentation.ts'

type NativeProvider = 'claude' | 'opencode' | 'copilot'
type Operation =
  | 'read'
  | 'create'
  | 'edit'
  | 'delete'
  | 'search'
  | 'shell'
  | 'output'
  | 'stop'
  | 'git'
  | 'webfetch'
  | 'websearch'
  | 'plan'
  | 'question'
  | 'skill'
  | 'task-create'
  | 'task-update'
  | 'task-read'

export type ToolPresentation = {
  activity: ProviderToolActivity
  label: string
  icon?: ProviderToolIcon
  compact?: boolean
  hidePayload?: boolean
  command?: string | null
  summaryLabel?: string
}

const nativeTools: Record<NativeProvider, Map<string, Operation>> = {
  claude: new Map([
    ['read', 'read'],
    ['write', 'create'],
    ['edit', 'edit'],
    ['multiedit', 'edit'],
    ['notebookedit', 'edit'],
    ['grep', 'search'],
    ['glob', 'search'],
    ['bash', 'shell'],
    ['bashoutput', 'output'],
    ['killshell', 'stop'],
    ['webfetch', 'webfetch'],
    ['websearch', 'websearch'],
    ['todowrite', 'plan'],
    ['todoread', 'plan'],
    ['askuserquestion', 'question'],
    ['skill', 'skill'],
    ['toolsearch', 'search'],
    ['taskcreate', 'task-create'],
    ['taskupdate', 'task-update'],
    ['taskget', 'task-read'],
    ['tasklist', 'task-read']
  ]),
  opencode: new Map([
    ['read', 'read'],
    ['list', 'read'],
    ['write', 'create'],
    ['edit', 'edit'],
    ['multiedit', 'edit'],
    ['patch', 'edit'],
    ['apply_patch', 'edit'],
    ['grep', 'search'],
    ['glob', 'search'],
    ['codesearch', 'search'],
    ['websearch', 'websearch'],
    ['bash', 'shell'],
    ['shell', 'shell'],
    ['webfetch', 'webfetch'],
    ['todoread', 'plan'],
    ['todowrite', 'plan'],
    ['todo', 'plan'],
    ['question', 'question'],
    ['skill', 'skill']
  ]),
  copilot: new Map([
    ['read', 'read'],
    ['read_file', 'read'],
    ['view', 'read'],
    ['list', 'read'],
    ['list_dir', 'read'],
    ['list_directory', 'read'],
    ['list_files', 'read'],
    ['create', 'create'],
    ['create_file', 'create'],
    ['write_file', 'create'],
    ['edit', 'edit'],
    ['edit_file', 'edit'],
    ['str_replace', 'edit'],
    ['str_replace_editor', 'edit'],
    ['apply_patch', 'edit'],
    ['replace_string_in_file', 'edit'],
    ['multi_replace_string_in_file', 'edit'],
    ['insert_edit_into_file', 'edit'],
    ['delete', 'delete'],
    ['delete_file', 'delete'],
    ['grep', 'search'],
    ['glob', 'search'],
    ['grep_search', 'search'],
    ['file_search', 'search'],
    ['search', 'search'],
    ['search_files', 'search'],
    ['web_search', 'websearch'],
    ['websearch', 'websearch'],
    ['web_fetch', 'webfetch'],
    ['webfetch', 'webfetch'],
    ['bash', 'shell'],
    ['powershell', 'shell'],
    ['shell', 'shell'],
    ['run_in_terminal', 'shell'],
    ['run_command', 'shell'],
    ['exec_command', 'shell'],
    ['read_bash', 'output'],
    ['read_powershell', 'output'],
    ['stop_bash', 'stop'],
    ['stop_powershell', 'stop'],
    ['git_status', 'git'],
    ['git_diff', 'git'],
    ['git_log', 'git'],
    ['git_show', 'git'],
    ['skill', 'skill'],
    ['use_skill', 'skill'],
    ['load_skill', 'skill'],
    ['update_todo', 'plan'],
    ['write_todo', 'plan'],
    ['todo_write', 'plan'],
    ['update_plan', 'plan'],
    ['manage_todo_list', 'plan'],
    ['ask_user', 'question']
  ])
}

const argument = (input: unknown, ...keys: string[]): string | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const values = input as Record<string, unknown>
  for (const key of keys) {
    if (typeof values[key] === 'string' && values[key].trim()) return values[key].trim()
  }
  return null
}

export const getProviderToolPresentation = (
  provider: NativeProvider,
  name: string,
  input: unknown,
  options: { serverName?: string; mcpToolName?: string; finished?: boolean } = {}
): ToolPresentation | null => {
  const qualifiedPrefix = `mcp__${options.serverName}__`
  const mcpName =
    options.mcpToolName ||
    (name.startsWith(qualifiedPrefix) ? name.slice(qualifiedPrefix.length) : name)
  const names = options.serverName ? [`${options.serverName}/${mcpName}`] : [name]
  // Claude marketplace plugins qualify MCP servers as plugin_<plugin>_<server>.
  const plugin = names[0].match(/^(?:mcp__)?plugin_([a-z0-9_-]+?)(?:__|\/)(.+)$/i)
  if (plugin) {
    const server = plugin[1].match(/^(.+)_\1$/)?.[1] ?? plugin[1]
    names.unshift(`${server}/${plugin[2]}`)
  }
  const scoped = names[0].match(/^(?:mcp__)?(.+?)(?:__|\/)(.+)$/)
  if (scoped) {
    const server = scoped[1].replace(/^claude_ai_/i, '').replace(/[-_]mcp(?:[-_]server)?$/i, '')
    if (server !== scoped[1]) names.unshift(`${server}/${scoped[2]}`)
  }
  const browserLabel = getBrowserToolLabel(names, input)
  if (browserLabel)
    return {
      activity: 'other',
      label: browserLabel,
      icon: 'browser',
      compact: true,
      hidePayload: true
    }
  const app = getAppToolPresentation(names, input)
  if (app)
    return {
      ...app,
      hidePayload: app.compact || app.activity === 'read' || app.activity === 'search'
    }
  // MCP metadata is authoritative even when a connector calls its tool "read" or "bash".
  if (options.serverName || /^mcp__/.test(name)) return null
  const operation = nativeTools[provider].get(name.toLowerCase())
  if (!operation) return null

  const path = argument(
    input,
    'file_path',
    'filePath',
    'path',
    'file',
    'fileName',
    'notebook_path',
    'directory'
  )
  const file = path ? basename(path.replace(/\\/g, '/')) : null
  if (operation === 'shell') {
    const command = argument(input, 'command', 'cmd', 'script')
    const activity = command?.match(/^(git|npm|npx)(?:\s|$)/)?.[1] as
      | 'git'
      | 'npm'
      | 'npx'
      | undefined
    return {
      activity: activity ?? 'command',
      label: command ? `Ran ${command}` : 'Ran a command',
      command
    }
  }
  if (operation === 'git')
    return { activity: 'git', label: `Used Git ${name.replace(/^git_/, '')}` }
  if (operation === 'output') return { activity: 'command', label: 'Read command output' }
  if (operation === 'stop')
    return { activity: 'other', label: 'Stopped command', compact: true, hidePayload: true }
  if (operation === 'read')
    return { activity: 'read', label: file ? `Read ${file}` : 'Read files', hidePayload: true }
  if (operation === 'create' || operation === 'edit' || operation === 'delete') {
    const verb = operation === 'create' ? 'Created' : operation === 'edit' ? 'Edited' : 'Deleted'
    return { activity: operation, label: `${verb} ${file ?? 'file'}` }
  }
  if (operation === 'search' || operation === 'websearch') {
    const query = argument(input, 'pattern', 'query')
    return {
      activity: 'search',
      label: `Searched${operation === 'websearch' ? ' the web' : ''}${query ? ` for ${query}` : ''}${file ? ` in ${file}` : ''}`
    }
  }
  if (operation === 'webfetch') {
    const url = argument(input, 'url')
    return {
      activity: 'other',
      icon: 'browser',
      label: url ? `Fetched ${url}` : 'Fetched webpage',
      summaryLabel: 'Fetched web pages',
      hidePayload: true
    }
  }
  if (operation === 'plan')
    return {
      activity: 'other',
      icon: 'plan',
      label: /read/i.test(name) ? 'Read plan' : 'Updated plan',
      hidePayload: true
    }
  if (operation === 'question')
    return {
      activity: 'other',
      icon: 'question',
      label: options.finished ? 'Asked a question' : 'Asking question',
      hidePayload: true
    }
  if (operation === 'skill') {
    const skill = argument(input, 'skill', 'name', 'skill_name')
    return {
      activity: 'skill',
      icon: 'skill',
      label: skill ? `Used ${skill} skill` : 'Used skill',
      hidePayload: true
    }
  }
  const label =
    operation === 'task-create'
      ? 'Created task'
      : operation === 'task-update'
        ? 'Updated task'
        : /list/i.test(name)
          ? 'Listed tasks'
          : 'Read task'
  return { activity: 'other', icon: 'plan', label, hidePayload: true }
}
