import type { ProviderToolActivity, ProviderToolIcon } from '../../shared/provider'

export type AppToolPresentation = {
  activity: ProviderToolActivity
  label: string
  icon?: ProviderToolIcon
  compact?: boolean
}

type AppPresentation = {
  name: string
  resource: string
}

// App tools arrive both as codex_apps/github.fetch_file and as flattened MCP names.
const apps = new Map<string, AppPresentation>([
  ['github', { name: 'GitHub', resource: 'content' }],
  ['google_drive', { name: 'Google Drive', resource: 'file' }],
  ['gdrive', { name: 'Google Drive', resource: 'file' }],
  ['gmail', { name: 'Gmail', resource: 'email' }],
  ['google_calendar', { name: 'Google Calendar', resource: 'event' }],
  ['gcal', { name: 'Google Calendar', resource: 'event' }],
  ['slack', { name: 'Slack', resource: 'message' }],
  ['notion', { name: 'Notion', resource: 'page' }],
  ['linear', { name: 'Linear', resource: 'issue' }],
  ['dropbox', { name: 'Dropbox', resource: 'file' }],
  ['box', { name: 'Box', resource: 'file' }],
  ['sharepoint', { name: 'SharePoint', resource: 'file' }],
  ['outlook_calendar', { name: 'Outlook Calendar', resource: 'event' }],
  ['outlook_email', { name: 'Outlook Email', resource: 'email' }],
  ['outlook', { name: 'Outlook', resource: 'email' }],
  ['teams', { name: 'Teams', resource: 'message' }],
  ['figma', { name: 'Figma', resource: 'design' }],
  ['signoz', { name: 'SigNoz', resource: 'telemetry' }],
  ['pets', { name: 'ChatGPT Pets', resource: 'pet' }],
  ['plugin_management', { name: 'Plugin Management', resource: 'plugin' }],
  ['search_service', { name: 'Web', resource: 'webpage' }]
])

// Canonical past-tense labels are inflected by toolDisplayLabel while calls run.
const actions = new Map<string, [string, string]>([
  ['create', ['Created', 'in']],
  ['update', ['Updated', 'in']],
  ['edit', ['Changed', 'in']],
  ['save', ['Saved', 'in']],
  ['delete', ['Deleted', 'from']],
  ['remove', ['Removed', 'from']],
  ['add', ['Added', 'in']],
  ['send', ['Sent', 'via']],
  ['reply', ['Replied to', 'in']],
  ['post', ['Posted', 'in']],
  ['react', ['Reacted to', 'in']],
  ['merge', ['Merged', 'in']],
  ['fork', ['Forked', 'in']],
  ['push', ['Pushed', 'to']],
  ['upload', ['Uploaded', 'to']],
  ['download', ['Downloaded', 'from']],
  ['move', ['Moved', 'in']],
  ['copy', ['Copied', 'in']],
  ['rename', ['Renamed', 'in']],
  ['share', ['Shared', 'in']],
  ['unshare', ['Unshared', 'in']],
  ['publish', ['Published', 'in']],
  ['archive', ['Archived', 'in']],
  ['restore', ['Restored', 'in']],
  ['resolve', ['Resolved', 'in']],
  ['close', ['Closed', 'in']],
  ['reopen', ['Reopened', 'in']],
  ['assign', ['Assigned', 'in']],
  ['unassign', ['Unassigned', 'in']],
  ['install', ['Installed', 'in']],
  ['uninstall', ['Uninstalled', 'from']],
  ['enable', ['Enabled', 'in']],
  ['disable', ['Disabled', 'in']],
  ['suggest', ['Suggested', 'in']],
  ['prepare', ['Prepared', 'in']],
  ['validate', ['Validated', 'in']],
  ['adopt', ['Adopted', 'in']],
  ['select', ['Selected', 'in']],
  ['check', ['Checked', 'in']],
  ['inspect', ['Inspected', 'in']],
  ['open', ['Opened', 'in']],
  ['approve', ['Approved', 'in']],
  ['reject', ['Rejected', 'in']],
  ['invite', ['Invited', 'in']]
])

const normalizeOperation = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

const humanize = (value: string): string =>
  normalizeOperation(value)
    .replace(/[_.-]+/g, ' ')
    .replace(/\bpr\b/g, 'pull request')
    .replace(/\bprs\b/g, 'pull requests')
    .replace(/\brepo\b/g, 'repository')
    .replace(/\brepos\b/g, 'repositories')
    .replace(/\bspritesheet\b/g, 'sprite sheet')
    .replace(/\b(?:api|url|id|pdf|sha)\b/g, (word) => word.toUpperCase())
    .slice(0, 120)

const operationVerbs = new Set([
  'fetch',
  'get',
  'read',
  'retrieve',
  'list',
  'browse',
  'search',
  'find',
  ...actions.keys()
])

const parseAppToolName = (name: string): { app: AppPresentation; operation: string } | null => {
  const codexPrefix = /^(?:mcp__)?codex_apps(?:__|[/.])/
  const qualifiedName = name.replace(codexPrefix, '').replace(/^mcp__/, '')
  const lookupName = qualifiedName.toLowerCase()
  for (const [id, app] of apps) {
    if (!lookupName.startsWith(id)) continue
    const operation = qualifiedName.slice(id.length).match(/^(?:__|[/.]|_)([a-z][a-z0-9_]*)$/i)?.[1]
    if (operation) return { app, operation: normalizeOperation(operation) }
  }

  // A Codex app namespace is enough to give a newly enabled app readable labels.
  // Do not reinterpret arbitrary MCP servers as apps, or guess ambiguous flattened IDs.
  if (!codexPrefix.test(name)) return null
  const match = qualifiedName.match(/^([a-z][a-z0-9_-]*?)(?:__|[/.])([a-z][a-z0-9_]*)$/i)
  let appId = match?.[1]
  let operation = match?.[2]
  if (!match && /^[a-z][a-z0-9_]*$/.test(qualifiedName)) {
    const words = qualifiedName.split('_')
    const boundaries = words.flatMap((word, index) =>
      index > 0 && operationVerbs.has(word) ? [index] : []
    )
    if (boundaries.length === 1) {
      appId = words.slice(0, boundaries[0]).join('_')
      operation = words.slice(boundaries[0]).join('_')
    }
  }
  if (!appId || !operation) return null
  return {
    app: {
      name: humanize(appId).replace(/\b\w/g, (letter) => letter.toUpperCase()),
      resource: 'content'
    },
    operation: normalizeOperation(operation)
  }
}

const getWebToolPresentation = (input: unknown): AppToolPresentation => {
  const args = input && typeof input === 'object' ? input : {}
  for (const [keys, activity, label] of [
    [['image_query'], 'search', 'Searched web images'],
    [['search_query', 'system2_search_query'], 'search', 'Searched the web'],
    [['screenshot'], 'other', 'Took webpage screenshot'],
    [['open', 'click'], 'other', 'Read webpages'],
    [['find'], 'search', 'Searched webpages'],
    [['finance'], 'other', 'Checked market prices'],
    [['weather'], 'other', 'Checked weather'],
    [['sports'], 'other', 'Checked sports results'],
    [['time'], 'other', 'Checked time']
  ] as const) {
    if (keys.some((key) => key in args)) return { activity, label, icon: 'browser', compact: true }
  }
  return { activity: 'other', label: 'Used web tools', icon: 'browser', compact: true }
}

const docsLabels = new Map([
  ['search_openai_docs', 'Searched OpenAI docs'],
  ['fetch_openai_doc', 'Read OpenAI docs'],
  ['list_openai_docs', 'Listed OpenAI docs'],
  ['get_openapi_spec', 'Read OpenAI API specification'],
  ['list_api_endpoints', 'Listed OpenAI API endpoints']
])

export function getAppToolPresentation(
  names: string[],
  input?: unknown
): AppToolPresentation | null {
  for (const name of names) {
    const operation = name.replace(/^(?:mcp__)?openaiDeveloperDocs(?:__|\/)/, '')
    const label = docsLabels.get(operation)
    if (label) return { activity: 'other', icon: 'openai-docs', label, compact: true }
  }
  if (names.some((name) => /^(?:mcp__)?web(?:__|[/.])run$/.test(name)))
    return getWebToolPresentation(input)
  for (const name of names) {
    const parsed = parseAppToolName(name)
    if (!parsed) continue
    const { app, operation } = parsed
    if (app.name === 'Web' && operation === 'web_run') return getWebToolPresentation(input)

    if (/^(?:search|find)(?:_|$)/.test(operation)) {
      return { activity: 'search', label: `Searched ${app.name}` }
    }
    const listing = operation.match(/^(?:list|browse)_(.+)$/)?.[1]
    if (listing) return { activity: 'search', label: `Listed ${humanize(listing)} in ${app.name}` }

    // Compound operations that may write must not be mistaken for ordinary reads.
    const save = operation.match(/^(?:create_or_update|add_or_update)_(.+)$/)?.[1]
    const open = operation.match(/^get_or_create_(.+)$/)?.[1]
    const read = operation.match(/^(?:fetch|get|read|retrieve)(?:_(.+))?$/)
    if (read && !/^(?:or|and)_/.test(read[1] ?? '')) {
      const resource =
        read[1] === 'file_content' || read[1] === 'file_contents'
          ? 'file'
          : read[1]
            ? humanize(read[1])
            : app.resource
      return { activity: 'read', label: `Read ${resource} from ${app.name}` }
    }

    const [verb, ...subject] = operation.replace(/^(?:batch|bulk)_/, '').split('_')
    const action = actions.get(save ? 'save' : open ? 'open' : verb)
    if (action) {
      const [finished, preposition] = action
      const resource = humanize(save ?? open ?? (subject.join('_') || app.resource))
      return {
        activity: 'other',
        label: `${finished} ${resource} ${preposition} ${app.name}`,
        icon: 'app',
        compact: true
      }
    }

    // Keep unfamiliar operations inspectable, with a readable app and action name.
    return { activity: 'other', label: `Used ${app.name}: ${humanize(operation)}`, icon: 'app' }
  }
  return null
}
