import { getProviderChatTurnCount } from '../../shared/chatTurns.ts'
import { Marked } from 'marked'
import { getVideoMimeType } from '../../shared/video.ts'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rm, open } from 'node:fs/promises'
import { basename, join, posix, resolve } from 'node:path'
import type { SeleChatArchive, ChatImportPreview } from '../../shared/chatArchive.ts'
import { isProviderId } from '../../shared/provider.ts'
import type {
  ProviderChatDetail,
  ProviderChatItem,
  ProviderWorkingItem,
  ProviderWorkingTool,
  ProviderMessageAttachment
} from '../../shared/provider.ts'

const compress = promisify(gzip)
const decompress = promisify(gunzip)
const maxArchiveBytes = 512 * 1024 * 1024

export const encodeChatArchive = async (archive: SeleChatArchive): Promise<Buffer> => {
  const bytes = Buffer.from(JSON.stringify(archive))
  if (bytes.length > maxArchiveBytes) throw new Error('Chat archive exceeds the 512 MB limit.')
  return compress(bytes)
}

export const decodeChatArchive = async (bytes: Buffer): Promise<SeleChatArchive> => {
  if (bytes.length > maxArchiveBytes) throw new Error('Chat archive exceeds the 512 MB limit.')
  let value: SeleChatArchive
  try {
    value = JSON.parse(
      (await decompress(bytes, { maxOutputLength: maxArchiveBytes })).toString('utf8')
    )
  } catch {
    throw new Error('This file is not a valid .sele chat archive.')
  }
  if (value?.format !== 'sele-chat' || value.version !== 1 || !isProviderId(value.providerId))
    throw new Error('Unsupported Sele chat archive format or version.')
  const validateMedia = (entry: { path?: string | null; dataUrl?: string | null }): void => {
    if (
      !entry ||
      (entry.path != null && typeof entry.path !== 'string') ||
      (entry.dataUrl != null &&
        (typeof entry.dataUrl !== 'string' || !entry.dataUrl.startsWith('data:')))
    )
      throw new Error('Invalid archive media.')
  }
  const validateAttachment = (attachment: ProviderMessageAttachment): void => {
    if (!attachment || !['file', 'image', 'review'].includes(attachment.kind))
      throw new Error('Invalid message attachment.')
    if (attachment.kind === 'review') {
      if (
        typeof attachment.id !== 'string' ||
        !Array.isArray(attachment.comments) ||
        attachment.comments.some(
          (comment) =>
            !comment || typeof comment.path !== 'string' || typeof comment.comment !== 'string'
        )
      )
        throw new Error('Invalid review attachment.')
    } else {
      if (typeof attachment.name !== 'string') throw new Error('Invalid attachment name.')
      validateMedia(attachment)
    }
  }
  const validateTool = (tool: ProviderWorkingTool): void => {
    if (
      !tool ||
      tool.type !== 'tool' ||
      typeof tool.id !== 'string' ||
      typeof tool.toolId !== 'string' ||
      typeof tool.label !== 'string' ||
      !['running', 'finished'].includes(tool.status) ||
      !Array.isArray(tool.images) ||
      !Array.isArray(tool.diffs)
    )
      throw new Error('Invalid archived tool.')
    if (
      (tool.command != null && typeof tool.command !== 'string') ||
      (tool.stdout != null && typeof tool.stdout !== 'string')
    )
      throw new Error('Invalid tool output.')
    tool.images.forEach(validateMedia)
    if (
      tool.diffs.some(
        (diff) =>
          !diff ||
          typeof diff.path !== 'string' ||
          typeof diff.diff !== 'string' ||
          !['edit', 'create', 'delete'].includes(diff.kind)
      )
    )
      throw new Error('Invalid archived diff.')
  }
  const validateActivity = (item: ProviderWorkingItem): void => {
    if (!item || typeof item.id !== 'string') throw new Error('Invalid working item.')
    if (item.type === 'tool') validateTool(item)
    else if (item.type === 'toolGroup') {
      if (!Array.isArray(item.tools)) throw new Error('Invalid tool group.')
      item.tools.forEach(validateTool)
    } else if (item.type !== 'message' || typeof item.content !== 'string')
      throw new Error('Invalid working message.')
  }
  const validateItems = (items: ProviderChatItem[]): void => {
    if (!Array.isArray(items)) throw new Error('Invalid chat transcript.')
    const ids = new Set<string>()
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || typeof item.type !== 'string')
        throw new Error('Invalid chat item.')
      if (
        item.type === 'message' &&
        (typeof item.content !== 'string' || !['user', 'assistant'].includes(item.role))
      )
        throw new Error('Invalid chat message.')
      if (ids.has(item.id)) throw new Error('Duplicate chat item identifier.')
      ids.add(item.id)
      if (item.type === 'message' || item.type === 'pendingMessage') {
        if (
          typeof item.content !== 'string' ||
          (item.attachments != null && !Array.isArray(item.attachments))
        )
          throw new Error('Invalid message content.')
        item.attachments?.forEach(validateAttachment)
      }
      if (item.type === 'working') {
        if (
          !Array.isArray(item.items) ||
          !['working', 'worked', 'stopped', 'failed', 'queued'].includes(item.status)
        )
          throw new Error('Invalid tool history.')
        item.items.forEach(validateActivity)
      }
      if (
        ![
          'message',
          'working',
          'pendingMessage',
          'contextCompaction',
          'goalContinuation',
          'timelineAnchor'
        ].includes(item.type)
      )
        throw new Error('Unknown chat item type.')
    }
  }
  if (
    !value.chat ||
    typeof value.chat.title !== 'string' ||
    typeof value.chat.id !== 'string' ||
    !Number.isFinite(value.chat.createdAt)
  )
    throw new Error('Invalid chat metadata.')
  validateItems(value.chat.items)
  if (!Array.isArray(value.subagents) || !Array.isArray(value.assets))
    throw new Error('Invalid archive contents.')
  if (value.chat.subagents != null && !Array.isArray(value.chat.subagents))
    throw new Error('Invalid subagent list.')
  for (const subagent of [...value.subagents, ...(value.chat.subagents ?? [])]) {
    if (!subagent || typeof subagent.id !== 'string' || typeof subagent.title !== 'string')
      throw new Error('Invalid archived subagent.')
  }
  for (const subagent of value.subagents) validateItems(subagent.items)
  for (const asset of value.assets) {
    if (
      typeof asset?.path !== 'string' ||
      typeof asset.data !== 'string' ||
      asset.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)
    )
      throw new Error('Invalid archive attachment.')
  }
  return value
}

export const archivePreview = (id: string, archive: SeleChatArchive): ChatImportPreview => ({
  id,
  title: archive.chat.title,
  turnCount: getProviderChatTurnCount(archive.chat.items),
  providerId: archive.providerId
})

// Keep generated Markdown media portable too, without bundling ordinary source-code links.
const visitMarkdownFiles = (
  message: { content: string },
  visit: (entry: { path?: string | null }) => void
): void => {
  const markdown = new Marked()
  markdown.walkTokens(markdown.lexer(message.content), (token) => {
    if (token.type !== 'image' && token.type !== 'link') return
    const href = token.href
    if (!href || /^(?:https?:|data:|#)/i.test(href)) return
    let path: string
    try {
      if (/^file:\/\//i.test(href)) path = decodeURIComponent(new URL(href).pathname)
      else if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return
      else path = decodeURIComponent(href)
    } catch {
      return
    }
    if (token.type === 'link' && !getVideoMimeType(path)) return
    const sourcePath = path
    visit({
      get path() {
        return sourcePath
      },
      set path(value: string | null | undefined) {
        const label = token.text.replace(/[[\]]/g, '\\$&')
        const replacement = value
          ? `${token.type === 'image' ? '!' : ''}[${label}](<${value}>)`
          : label
        message.content = message.content.replaceAll(token.raw, replacement)
      }
    })
  })
}

// Visit only declared media/attachment paths, never arbitrary paths in raw tool input/output.
export const visitArchiveFiles = (
  archive: SeleChatArchive,
  visit: (entry: { path?: string | null; dataUrl?: string | null }) => void
): void => {
  const items = (detail: Pick<ProviderChatDetail, 'items'>): void => {
    for (const item of detail.items) {
      if (item.type === 'message' || item.type === 'pendingMessage') {
        visitMarkdownFiles(item, visit)
        item.attachments?.forEach((attachment) => {
          if (attachment.kind !== 'review') visit(attachment)
        })
      }
      if (item.type === 'working')
        for (const activity of item.items) {
          if (activity.type === 'message') visitMarkdownFiles(activity, visit)
          if (activity.type === 'tool') activity.images.forEach(visit)
          if (activity.type === 'toolGroup')
            activity.tools.forEach((tool) => tool.images.forEach(visit))
        }
    }
  }
  items(archive.chat)
  archive.subagents.forEach(items)
}

export const collectArchiveAssets = async (
  archive: SeleChatArchive,
  read: (path: string) => Promise<Buffer> = readFile
): Promise<void> => {
  const paths = new Set<string>()
  visitArchiveFiles(archive, (entry) => {
    if (entry.path && !entry.dataUrl) paths.add(entry.path)
  })
  archive.assets = []
  for (const path of paths) {
    try {
      archive.assets.push({
        path,
        data: (await read(resolve(archive.chat.cwd ?? '.', path))).toString('base64')
      })
    } catch {
      throw new Error(`Unable to export attachment: ${path}`)
    }
  }
}

export const restoreArchiveAssets = async (
  archive: SeleChatArchive,
  directory: string,
  files = {
    mkdir: async (path: string): Promise<void> => {
      await mkdir(path, { recursive: true, mode: 0o700 })
    },
    write: async (path: string, data: Buffer): Promise<void> => {
      await writeFile(path, data, { mode: 0o600, flag: 'wx' })
    }
  }
): Promise<void> => {
  await files.mkdir(directory)
  const paths = new Map<string, string>()
  for (const asset of archive.assets) {
    const path = (directory.startsWith('/') ? posix.join : join)(
      directory,
      `${randomUUID()}-${[...basename(asset.path).replace(/[^\p{L}\p{N}._-]/gu, '_')].slice(0, 48).join('') || 'attachment'}`
    )
    await files.write(path, Buffer.from(asset.data, 'base64'))
    paths.set(asset.path, path)
  }
  visitArchiveFiles(archive, (entry) => {
    if (entry.path && paths.has(entry.path)) entry.path = paths.get(entry.path)!
    // Don't turn imported absolute source paths into reads on the receiving computer.
    else if (entry.path) entry.path = null
  })
}

/** Exclusive filenames avoid overwriting a previous export with the same title. */
export const saveChatArchive = async (
  directory: string,
  archive: SeleChatArchive
): Promise<string> => {
  const name =
    [...archive.chat.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').replace(/[. ]+$/g, '')]
      .slice(0, 48)
      .join('') || 'Chat'
  const bytes = await encodeChatArchive(archive)
  for (let suffix = 0; ; suffix++) {
    const path = join(directory, `${name}${suffix ? ` (${suffix})` : ''}.sele`)
    let file: Awaited<ReturnType<typeof open>>
    try {
      file = await open(path, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    try {
      await file.writeFile(bytes)
      await file.sync()
      await file.close()
      return path
    } catch (error) {
      await file.close().catch(() => {})
      await rm(path, { force: true }).catch(() => {})
      throw error
    }
  }
}
