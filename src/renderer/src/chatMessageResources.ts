export type ChatMessageResource =
  { kind: 'skill'; name: string } | { kind: 'app'; id: string; name: string }

export type ChatMessagePresentation = {
  content: string
  resources: ChatMessageResource[]
}

const skillMentionPattern = /^\$([^\s[\]()]+)/
const appMentionPattern = /^\[\$((?:\\.|[^\]])+)\]\(app:\/\/([^\s)]+)\)/

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
  const firstLineEnd = content.indexOf('\n')
  const firstLine = (firstLineEnd < 0 ? content : content.slice(0, firstLineEnd)).replace(/\r$/, '')
  const resources = parseResourcePrefix(firstLine)

  if (!resources) return { content, resources: [] }

  return {
    content: firstLineEnd < 0 ? '' : content.slice(firstLineEnd + 1),
    resources
  }
}
