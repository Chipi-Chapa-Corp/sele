export type ChatMessageResource =
  | { kind: 'skill'; name: string }
  | { kind: 'app'; id: string; name: string }
  | { kind: 'browserContext' }

export type ChatMessagePresentation = {
  content: string
  resources: ChatMessageResource[]
}

const skillMentionPattern = /^\$([^\s[\]()]+)/
const appMentionPattern = /^\[\$((?:\\.|[^\]])+)\]\(app:\/\/([^\s)]+)\)/
const inAppBrowserContextPattern =
  /^[ \t]*<in-app-browser-context>[ \t]*[\s\S]*?^[ \t]*<\/in-app-browser-context>[ \t]*(?:\r?\n|$)/gm

const unescapeAppLabel = (value: string): string => value.replace(/\\([\\[\]])/g, '$1')

const parseResourcePrefix = (line: string): ChatMessageResource[] | null => {
  const resources: ChatMessageResource[] = []
  let remaining = line

  while (remaining) {
    const appMatch = appMentionPattern.exec(remaining)
    if (appMatch) {
      resources.push({
        kind: 'app',
        id: appMatch[2]!,
        name: unescapeAppLabel(appMatch[1]!)
      })
      remaining = remaining.slice(appMatch[0].length)
    } else {
      const skillMatch = skillMentionPattern.exec(remaining)
      if (!skillMatch) return null
      resources.push({ kind: 'skill', name: skillMatch[1]! })
      remaining = remaining.slice(skillMatch[0].length)
    }

    if (!remaining) break
    const separator = /^\s+/.exec(remaining)
    if (!separator) return null
    remaining = remaining.slice(separator[0].length)
  }

  return resources.length > 0 ? resources : null
}

export const getChatMessagePresentation = (content: string): ChatMessagePresentation => {
  let hasBrowserContext = false
  const visibleContent = content.replace(inAppBrowserContextPattern, () => {
    hasBrowserContext = true
    return ''
  })
  const browserContextResource: ChatMessageResource[] = hasBrowserContext
    ? [{ kind: 'browserContext' }]
    : []
  const firstLineEnd = visibleContent.indexOf('\n')
  const firstLine = (
    firstLineEnd < 0 ? visibleContent : visibleContent.slice(0, firstLineEnd)
  ).replace(/\r$/, '')
  const resources = parseResourcePrefix(firstLine)

  if (!resources) return { content: visibleContent, resources: browserContextResource }

  return {
    content: firstLineEnd < 0 ? '' : visibleContent.slice(firstLineEnd + 1),
    resources: [...resources, ...browserContextResource]
  }
}
