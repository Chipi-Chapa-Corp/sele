import { app, BrowserWindow, dialog, type WebContents } from 'electron'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isProviderId, providerIpcChannels, type ProviderId } from '../../shared/provider'
import { handleLoggedIpc } from '../logging'
import { getChatMetadata, setChatContainer } from '../database/chat'
import { requireContainerTarget } from '../containerTarget'
import { ChatArchiveWorker } from './ChatArchiveWorker'
import { createChatImportWorkspace } from './ChatImportWorkspace'
import { getHostCommand, isRunningInFlatpak } from '../hostProcess'
import { importedConversations, providerApi, getChatUpdateSummary } from './providerService'
import { collectArchiveAssets, saveChatArchive } from './ChatArchive'

const exec = promisify(execFile)
type PendingImport = { id: string; worker: ChatArchiveWorker; cancelled: boolean; running: boolean }
const pending = new Map<WebContents, PendingImport>()
const watchedContents = new WeakSet<WebContents>()
const provider = (value: unknown): ProviderId => {
  if (!isProviderId(value)) throw new Error('Invalid provider.')
  return value
}
const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid chat identifier.')
  return value
}

export const registerChatArchiveIpc = (): void => {
  handleLoggedIpc(
    providerIpcChannels.exportChat,
    async (event, providerId: unknown, chatId: unknown) => {
      const source = provider(providerId)
      const id = identifier(chatId)
      const window = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: 'Choose a directory for the chat export',
        properties: ['openDirectory', 'createDirectory'] as Array<
          'openDirectory' | 'createDirectory'
        >
      }
      const result = await (window
        ? dialog.showOpenDialog(window, options)
        : dialog.showOpenDialog(options))
      if (result.canceled || !result.filePaths[0]) return null
      const metadata = await getChatMetadata(id)
      const archive = await importedConversations.archive(source, id, metadata.container)
      const enriched = await providerApi.getChat(source, id)
      archive.chat = {
        ...enriched,
        items: archive.chat.items,
        subagents: archive.chat.subagents,
        itemsStartTurnIndex: 0,
        turnCount: undefined,
        turnPagination: undefined
      }
      await collectArchiveAssets(archive, async (path) => {
        if ((!metadata.container || metadata.container.kind === 'host') && !isRunningInFlatpak())
          return readFile(path)
        const command = await getHostCommand('sh', ['-c', 'cat -- "$1"', 'sele-export', path], {
          container: metadata.container,
          env: process.env
        })
        const { stdout } = await exec(command.file, command.args, {
          cwd: command.cwd,
          env: command.env,
          encoding: 'buffer',
          maxBuffer: 512 * 1024 * 1024,
          timeout: 120_000
        })
        return stdout
      })
      return saveChatArchive(result.filePaths[0], archive)
    }
  )
  handleLoggedIpc(providerIpcChannels.openChatImport, async (event) => {
    if (pending.get(event.sender)?.running && !pending.get(event.sender)?.cancelled)
      throw new Error('A chat import is already running.')
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Import a Sele chat',
      filters: [{ name: 'Sele chat', extensions: ['sele'] }],
      properties: ['openFile'] as Array<'openFile'>
    }
    const result = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options))
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    const worker = new ChatArchiveWorker()
    const operation: PendingImport = { id: randomUUID(), worker, cancelled: false, running: false }
    pending.get(event.sender)?.worker.dispose()
    pending.set(event.sender, operation)
    if (!watchedContents.has(event.sender)) {
      watchedContents.add(event.sender)
      event.sender.once('destroyed', () => {
        const active = pending.get(event.sender)
        if (active) {
          active.cancelled = true
          active.worker.dispose()
        }
        pending.delete(event.sender)
      })
    }
    try {
      return await worker.read(path, operation.id)
    } catch (error) {
      worker.dispose()
      if (pending.get(event.sender) === operation) pending.delete(event.sender)
      throw error
    }
  })
  handleLoggedIpc(
    providerIpcChannels.importChat,
    async (event, importId: unknown, providerId: unknown, target: unknown) => {
      const container = requireContainerTarget(target, { optional: true })
      const destination = provider(providerId)
      const operation = pending.get(event.sender)
      if (
        !operation ||
        operation.id !== identifier(importId) ||
        operation.cancelled ||
        operation.running
      )
        throw new Error('This chat import is no longer available.')
      operation.running = true
      let workspace: Awaited<ReturnType<typeof createChatImportWorkspace>> | undefined
      let complete = false
      try {
        workspace = await createChatImportWorkspace(
          app.getPath('userData'),
          operation.id,
          container
        )
        const archive = await workspace.restore(operation.worker)
        if (operation.cancelled) return null
        const models = await providerApi.getModels(destination, { container })
        const model = models.find((entry) => entry.isDefault) ?? models[0]
        if (!model) throw new Error('No models are available for this provider.')
        const detail = await importedConversations.importArchive(
          archive,
          destination,
          {
            cwd: workspace.directory,
            container,
            model: model.id,
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            sandboxMode: 'workspace-write',
            serviceTier: null,
            reasoningEffort: model.defaultReasoningEffort
          },
          () => operation.cancelled
        )
        if (!detail) return null
        await setChatContainer(detail.id, container)
        complete = true
        return getChatUpdateSummary(detail, Date.now())
      } catch (error) {
        if (operation.cancelled) return null
        throw error
      } finally {
        if (complete || operation.cancelled) {
          operation.worker.dispose()
          if (pending.get(event.sender) === operation) pending.delete(event.sender)
        }
        operation.running = false
        if (!complete) await workspace?.remove()
      }
    }
  )
  handleLoggedIpc(providerIpcChannels.cancelChatImport, async (event, importId: unknown) => {
    const operation = pending.get(event.sender)
    if (!operation || operation.id !== identifier(importId)) return
    operation.cancelled = true
    operation.worker.dispose()
    if (!operation.running) pending.delete(event.sender)
  })
}
