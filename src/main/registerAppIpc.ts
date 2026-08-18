import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  shell
} from 'electron'
import type {
  AppColorScheme,
  AppAddProjectOptions,
  AppContainerTarget,
  AppCreateSshEnvironmentOptions,
  AppDeleteSshEnvironmentOptions,
  AppExternalLinkAction,
  AppExternalLinkOptions,
  AppExternalLinkResult,
  AppFileContentsOptions,
  AppFileTreeFile,
  AppFileTreeOptions,
  AppGitCommitAction,
  AppGitCommitOptions,
  AppGitBranchesOptions,
  AppGitBranchesResult,
  AppGitDeleteBranchOptions,
  AppGitDeleteBranchResult,
  AppGitDeleteBranchScope,
  AppGitCreateWorktreeOptions,
  AppGitCreateWorktreeResult,
  AppGitDiffOptions,
  AppGitFileDiffOptions,
  AppGitChangesResult,
  AppGitChangeKind,
  AppGitChangesOptions,
  AppGitFileChange,
  AppGitChangeSource,
  AppGitPullStrategy,
  AppGitPatchChange,
  AppGitRecentCommitMessagesOptions,
  AppGitRecoverableFailure,
  AppGitSwitchBranchOptions,
  AppGitUncommittedPatchChangesOptions,
  AppLocalImage,
  AppLocalImageOptions,
  AppProjectIcon,
  AppProjectIconOptions,
  AppSelectedAttachment,
  AppSelectedImage,
  AppSourceAvailability,
  AppSourceAvailabilityOptions,
  AppUpdateSshEnvironmentOptions,
  AppWriteFileContentsOptions,
  AppWindowState
} from '../shared/app'
import { appIpcChannels, isAppProjectIconKind, normalizeAppWindowZoomLevel } from '../shared/app'
import type { ProviderId } from '../shared/provider'
import { requireContainerTarget } from './containerTarget'
import { getCurrentContainerHostBridge } from './currentContainer'
import {
  getProjectIcon as getStoredProjectIcon,
  setProjectIcon as setStoredProjectIcon
} from './database/projectIcons'
import {
  addProject as addStoredProject,
  getProjects as getStoredProjects
} from './database/projects'
import {
  createSshEnvironment as createStoredSshEnvironment,
  deleteSshEnvironment as deleteStoredSshEnvironment,
  getSshEnvironments as getStoredSshEnvironments,
  updateSshEnvironment as updateStoredSshEnvironment
} from './database/sshEnvironments'
import { setStoredCwdMetadata } from './database/cwd'
import { getContainerSuggestions } from './containerSuggestions'
import { getFileTargetGitCwd, resolveFileTargetPath } from './fileTarget'
import { commitGitFileChanges } from './gitCommit'
import { getHostCommand } from './hostProcess'
import { getProcessFailureMessage } from './processFailure'
import { getCodexExecutable } from './providers/codex/CodexExecutable'
import { getClaudeExecutable } from './providers/claude/ClaudeExecutable'
import { getCopilotExecutable } from './providers/copilot/CopilotExecutable'

export const getAppWindowState = (window: BrowserWindow): AppWindowState => ({
  isMaximized: window.isMaximized()
})

export const sendAppWindowState = (window: BrowserWindow): void => {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(appIpcChannels.windowStateUpdated, getAppWindowState(window))
}

const getBrowserWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw new Error('Window not found')
  return window
}

const getDefaultPath = (value: unknown): string | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Invalid folder path')
  return value
}

const externalLinkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const maxExternalLinkLength = 8_192
const sourceAvailabilityTimeoutMs = 5_000
const sourceAvailabilityMaxBuffer = 64 * 1024
const sourceAvailabilityProviderIds = [
  'codex',
  'claude',
  'copilot'
] as const satisfies readonly ProviderId[]
const sourceAvailabilityCommands = ['git', ...sourceAvailabilityProviderIds] as const

const isExternalLinkAction = (value: unknown): value is AppExternalLinkAction =>
  value === 'copy' || value === 'open'

const getExternalLinkOptions = (value: unknown): AppExternalLinkOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid external link options')
  }

  const options = value as { url?: unknown; action?: unknown }
  if (
    typeof options.url !== 'string' ||
    options.url.length === 0 ||
    options.url.length > maxExternalLinkLength
  ) {
    throw new Error('Invalid external link')
  }

  let url: URL
  try {
    url = new URL(options.url)
  } catch {
    throw new Error('Invalid external link')
  }

  if (!externalLinkProtocols.has(url.protocol)) {
    throw new Error('Unsupported external link')
  }
  if (options.action !== undefined && !isExternalLinkAction(options.action)) {
    throw new Error('Invalid external link action')
  }

  return {
    url: url.toString(),
    action: options.action
  }
}

const performExternalLinkAction = async (
  action: AppExternalLinkAction,
  url: string
): Promise<void> => {
  if (action === 'copy') {
    clipboard.writeText(url)
    return
  }

  await shell.openExternal(url)
}

const imageMimeTypes = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
} satisfies Record<string, string>
const maxProjectIconBytes = 8 * 1024 * 1024
const maxLocalImageBytes = 32 * 1024 * 1024
const maxMessageAttachmentCount = 10
const messageImageExtensions = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])
const automaticProjectIconPaths = [
  '.idea/icon.svg',
  'favicon.svg',
  'favicon.png',
  'favicon.ico',
  'public/favicon.svg',
  'public/favicon.png',
  'public/favicon.ico',
  'static/favicon.svg',
  'static/favicon.png',
  'static/favicon.ico',
  'assets/favicon.svg',
  'assets/favicon.png',
  'assets/favicon.ico',
  'src/favicon.svg',
  'src/favicon.png',
  'src/favicon.ico',
  'src/assets/favicon.svg',
  'src/assets/favicon.png',
  'src/assets/favicon.ico',
  'src/app/favicon.svg',
  'src/app/favicon.png',
  'src/app/favicon.ico',
  'app/favicon.svg',
  'app/favicon.png',
  'app/favicon.ico'
]

const getOptionalCwd = (value: unknown): string | null => {
  if (value == null) return null
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Invalid cwd')
  return value
}

const getProjectIconOptions = (value: unknown): AppProjectIconOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid project icon options')
  }

  const options = value as { cwd?: unknown; persist?: unknown }
  if (options.persist != null && typeof options.persist !== 'boolean') {
    throw new Error('Invalid project icon persistence option')
  }

  return {
    cwd: getOptionalCwd(options.cwd),
    ...(options.persist == null ? {} : { persist: options.persist })
  }
}

const getAddProjectOptions = (value: unknown): AppAddProjectOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid project options')
  }

  const options = value as {
    cwd?: unknown
    name?: unknown
    icon?: unknown
    iconSelectionId?: unknown
    additionalCwds?: unknown
  }
  const cwd = getOptionalCwd(options.cwd)
  if (!cwd) throw new Error('Invalid project cwd')

  let name: string | undefined
  if (options.name !== undefined) {
    if (typeof options.name !== 'string') throw new Error('Invalid project name')
    name = options.name.trim()
    if (!name || name.length > 80) throw new Error('Invalid project name')
  }

  let icon: AppAddProjectOptions['icon'] | undefined
  if (options.icon !== undefined) {
    if (options.icon !== null && !isAppProjectIconKind(options.icon)) {
      throw new Error('Invalid project icon')
    }
    icon = options.icon
  }

  let additionalCwds: string[] | undefined
  if (options.additionalCwds !== undefined) {
    if (!Array.isArray(options.additionalCwds) || options.additionalCwds.length > 32) {
      throw new Error('Invalid additional project folders')
    }

    const uniqueCwds = new Set<string>()
    for (const candidate of options.additionalCwds) {
      const additionalCwd = getOptionalCwd(candidate)
      if (!additionalCwd) throw new Error('Invalid additional project folder')
      if (additionalCwd !== cwd) uniqueCwds.add(additionalCwd)
    }
    additionalCwds = Array.from(uniqueCwds)
  }

  let iconSelectionId: string | undefined
  if (options.iconSelectionId !== undefined) {
    if (
      typeof options.iconSelectionId !== 'string' ||
      !options.iconSelectionId ||
      options.iconSelectionId.length > 128 ||
      icon !== 'image'
    ) {
      throw new Error('Invalid project icon selection')
    }
    iconSelectionId = options.iconSelectionId
  }

  return {
    cwd,
    ...(name !== undefined ? { name } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(iconSelectionId !== undefined ? { iconSelectionId } : {}),
    ...(additionalCwds !== undefined ? { additionalCwds } : {})
  }
}

const getCreateSshEnvironmentOptions = (value: unknown): AppCreateSshEnvironmentOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid SSH environment options')
  }

  const options = value as {
    name?: unknown
    host?: unknown
    port?: unknown
    user?: unknown
    identityFile?: unknown
  }
  const name = typeof options.name === 'string' ? options.name.trim() : ''
  const host = typeof options.host === 'string' ? options.host.trim() : ''
  const user = typeof options.user === 'string' ? options.user.trim() : ''
  const identityFile = typeof options.identityFile === 'string' ? options.identityFile.trim() : ''

  if (!name || name.length > 80 || /[\0\r\n]/.test(name)) {
    throw new Error('Environment name must be 1–80 characters')
  }
  if (!host || host.length > 253 || host.startsWith('-') || /[\0\s]/.test(host)) {
    throw new Error('Enter a valid SSH host')
  }
  if (user && (user.length > 128 || /[\0\s@]/.test(user) || user.startsWith('-'))) {
    throw new Error('Enter a valid SSH user')
  }
  if (
    typeof options.port !== 'number' ||
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new Error('SSH port must be between 1 and 65535')
  }
  if (
    identityFile &&
    (!isAbsolute(identityFile) || identityFile.length > 4_096 || /[\0\r\n]/.test(identityFile))
  ) {
    throw new Error('Enter a valid absolute identity file path')
  }

  return {
    name,
    host,
    port: options.port,
    user: user || null,
    identityFile: identityFile || null
  }
}

const getSshEnvironmentId = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid SSH environment options')
  }

  const id = (value as { id?: unknown }).id
  if (typeof id !== 'string' || !id || id.length > 128 || /[\0\r\n]/.test(id)) {
    throw new Error('Invalid SSH environment id')
  }

  return id
}

const getUpdateSshEnvironmentOptions = (value: unknown): AppUpdateSshEnvironmentOptions => ({
  ...getCreateSshEnvironmentOptions(value),
  id: getSshEnvironmentId(value)
})

const getDeleteSshEnvironmentOptions = (value: unknown): AppDeleteSshEnvironmentOptions => ({
  id: getSshEnvironmentId(value)
})

const validateSshIdentityFile = async (identityFile?: string | null): Promise<void> => {
  if (!identityFile) return

  const identityStat = await stat(identityFile).catch(() => null)
  if (!identityStat?.isFile()) throw new Error('SSH identity file does not exist')
}

const getLocalImageOptions = (value: unknown): AppLocalImageOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid local image options')
  }

  const options = value as {
    container?: unknown
    cwd?: unknown
    path?: unknown
    relativeTo?: unknown
  }
  if (
    typeof options.path !== 'string' ||
    options.path.length === 0 ||
    options.path.includes('\0')
  ) {
    throw new Error('Invalid local image path')
  }

  const cwd = getOptionalCwd(options.cwd)
  if (!isAbsolute(options.path) && !cwd)
    throw new Error('A cwd is required for relative image paths')
  if (
    options.relativeTo !== undefined &&
    options.relativeTo !== 'cwd' &&
    options.relativeTo !== 'repository'
  ) {
    throw new Error('Invalid local image path base')
  }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd,
    path: options.path,
    relativeTo: options.relativeTo
  }
}

const getImageMimeType = (imagePath: string): string | null =>
  imageMimeTypes[extname(imagePath).toLocaleLowerCase()] ?? null

const getImageFile = async (imagePath: string, maxBytes: number): Promise<AppLocalImage | null> => {
  const mimeType = getImageMimeType(imagePath)
  if (!mimeType) return null

  const imageStat = await stat(imagePath)
  if (!imageStat.isFile() || imageStat.size > maxBytes) return null

  const file = await readFile(imagePath)
  return {
    data: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    mimeType,
    updatedAt: imageStat.mtimeMs
  }
}

const getImageDataUrl = (image: AppLocalImage): string =>
  `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`

const getProjectIconFile = async (
  imagePath: string
): Promise<{ dataUrl: string; updatedAt: number } | null> => {
  const image = await getImageFile(imagePath, maxProjectIconBytes)
  return image ? { dataUrl: getImageDataUrl(image), updatedAt: image.updatedAt } : null
}

const resolveLocalImagePath = async (
  cwd: string | null,
  path: string,
  relativeTo: AppLocalImageOptions['relativeTo'] = 'repository'
): Promise<string> => {
  let imagePath = path

  if (!isAbsolute(imagePath)) {
    if (relativeTo === 'cwd') return resolve(cwd ?? process.cwd(), imagePath)

    const repositoryRoot = await runGit(
      cwd ?? process.cwd(),
      ['rev-parse', '--show-toplevel'],
      true
    )
    if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')
    imagePath = resolve(repositoryRoot, imagePath)
  }

  return imagePath
}

const getLocalImage = async (
  cwd: string | null,
  path: string,
  relativeTo: AppLocalImageOptions['relativeTo'] = 'repository'
): Promise<AppLocalImage> => {
  if (isSshGitTarget()) return getSshLocalImage(cwd, path, relativeTo)

  const imagePath = await resolveLocalImagePath(cwd, path, relativeTo)
  const image = await getImageFile(imagePath, maxLocalImageBytes)
  if (!image) throw new Error('Unable to load this image.')
  return {
    data: image.data,
    mimeType: image.mimeType,
    updatedAt: image.updatedAt
  }
}

const getAppProjectIcon = async (cwd: string | null): Promise<AppProjectIcon | null> => {
  const customIcon = await getStoredProjectIcon(cwd)
  if (customIcon) {
    const image = await getProjectIconFile(customIcon.imagePath).catch(() => null)
    if (image) {
      return {
        cwd,
        dataUrl: image.dataUrl,
        updatedAt: customIcon.updatedAt
      }
    }
  }

  if (!cwd) return null

  for (const relativeIconPath of automaticProjectIconPaths) {
    const image = await getProjectIconFile(join(cwd, relativeIconPath)).catch(() => null)
    if (!image) continue

    return {
      cwd,
      dataUrl: image.dataUrl,
      updatedAt: image.updatedAt
    }
  }

  return null
}

const copyProjectIcon = async (sourcePath: string): Promise<string> => {
  const mimeType = getImageMimeType(sourcePath)
  if (!mimeType) throw new Error('Choose a PNG, JPEG, GIF, WebP, AVIF, SVG, or ICO image.')

  const sourceStat = await stat(sourcePath)
  if (!sourceStat.isFile()) throw new Error('Choose an image file.')
  if (sourceStat.size > maxProjectIconBytes) {
    throw new Error('Choose an image smaller than 8 MB.')
  }

  const sourceFile = await readFile(sourcePath)
  const hash = createHash('sha256').update(sourceFile).digest('hex')
  const extension = extname(sourcePath).toLocaleLowerCase()
  const iconDirectory = join(app.getPath('userData'), 'project-icons')
  const copiedPath = join(iconDirectory, `${hash}${extension}`)

  await mkdir(iconDirectory, { recursive: true })
  await copyFile(sourcePath, copiedPath)

  return copiedPath
}

const pendingProjectIconSelections = new Map<string, string>()
const maxPendingProjectIconSelections = 100

const rememberPendingProjectIconSelection = (imagePath: string): string => {
  const selectionId = randomUUID()
  pendingProjectIconSelections.set(selectionId, imagePath)

  while (pendingProjectIconSelections.size > maxPendingProjectIconSelections) {
    const oldestSelectionId = pendingProjectIconSelections.keys().next().value
    if (!oldestSelectionId) break
    pendingProjectIconSelections.delete(oldestSelectionId)
  }

  return selectionId
}

const getColorScheme = (): AppColorScheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

const runFontListCommand = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true
      },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      }
    )
  })

const normalizeInstalledFontFamilies = (families: Iterable<string>): string[] => {
  const uniqueFamilies = new Map<string, string>()

  for (const family of families) {
    const normalizedFamily = family.replace(/\s+/g, ' ').trim()
    if (!normalizedFamily) continue

    const key = normalizedFamily.toLocaleLowerCase()
    if (!uniqueFamilies.has(key)) uniqueFamilies.set(key, normalizedFamily)
  }

  return [...uniqueFamilies.values()].sort((first, second) =>
    first.localeCompare(second, undefined, { numeric: true, sensitivity: 'base' })
  )
}

const readInstalledFontFamilies = async (): Promise<string[]> => {
  if (process.platform === 'win32') {
    const output = await runFontListCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'
    ])
    return normalizeInstalledFontFamilies(output.split(/\r?\n/))
  }

  if (process.platform === 'darwin') {
    const output = await runFontListCommand('/usr/sbin/system_profiler', [
      'SPFontsDataType',
      '-json'
    ])
    const profile = JSON.parse(output) as {
      SPFontsDataType?: Array<{
        _name?: unknown
        family?: unknown
        fullname?: unknown
        typefaces?: Array<{ _name?: unknown; family?: unknown; fullname?: unknown }>
      }>
    }
    return normalizeInstalledFontFamilies(
      (profile.SPFontsDataType ?? []).flatMap((font) =>
        [font, ...(font.typefaces ?? [])].flatMap((typeface) =>
          typeof typeface.family === 'string'
            ? [typeface.family]
            : typeof typeface.fullname === 'string'
              ? [typeface.fullname]
              : typeof typeface._name === 'string'
                ? [typeface._name]
                : []
        )
      )
    )
  }

  const output = await runFontListCommand('fc-list', ['--format=%{family}\n'])
  return normalizeInstalledFontFamilies(
    output.split(/\r?\n/).flatMap((families) => families.split(','))
  )
}

let installedFontFamiliesPromise: Promise<string[]> | null = null

const getInstalledFontFamilies = (): Promise<string[]> => {
  installedFontFamiliesPromise ??= readInstalledFontFamilies().catch(() => [])
  return installedFontFamiliesPromise
}

type BranchBase = {
  ref: string
  commit: string
}

type RunGitOptions = {
  container?: AppContainerTarget | null
  env?: NodeJS.ProcessEnv
  input?: string
  required?: boolean
  timeoutMs?: number
}

const gitCommandContext = new AsyncLocalStorage<{ container?: AppContainerTarget | null }>()

const runWithGitContainer = <T>(
  container: AppContainerTarget | null | undefined,
  run: () => Promise<T>
): Promise<T> => gitCommandContext.run({ container }, run)

const getRunGitOptions = (options: boolean | RunGitOptions): RunGitOptions =>
  typeof options === 'boolean' ? { required: options } : options

const getGitCommandLabel = (args: string[]): string =>
  args[0]?.trim() ? `Git ${args[0].trim()}` : 'Git command'

const runGit = async (
  cwd: string,
  args: string[],
  options: boolean | RunGitOptions = false
): Promise<string | null> => {
  const runOptions = getRunGitOptions(options)
  const container = runOptions.container ?? gitCommandContext.getStore()?.container
  const env = { ...process.env, GIT_MERGE_AUTOEDIT: 'no', ...runOptions.env }
  const hostCommand = await getHostCommand('git', args, { container, cwd, env })
  const timeoutMs = runOptions.timeoutMs ?? 10_000

  return new Promise((resolve, reject) => {
    const child = execFile(
      hostCommand.file,
      hostCommand.args,
      {
        cwd: hostCommand.cwd,
        encoding: 'utf8',
        env: hostCommand.env,
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs
      },
      (error, stdout, stderr) => {
        if (error) {
          if (runOptions.required) {
            reject(
              new Error(
                getProcessFailureMessage(error, stdout, stderr, {
                  label: getGitCommandLabel(args),
                  timeoutMs
                })
              )
            )
          } else resolve(null)
          return
        }

        resolve(stdout.trimEnd())
      }
    )

    child.stdin?.end(runOptions.input)
  })
}

const getGitErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isGitPullStrategy = (value: unknown): value is AppGitPullStrategy =>
  value === 'ff-only' || value === 'rebase' || value === 'merge'

const isDivergedPullFailure = (message: string): boolean => {
  const normalizedMessage = message.toLocaleLowerCase()
  return (
    normalizedMessage.includes('not possible to fast-forward') ||
    normalizedMessage.includes("diverging branches can't be fast-forwarded") ||
    normalizedMessage.includes('need to specify how to reconcile divergent branches')
  )
}

const isPushRejectedFailure = (message: string): boolean => {
  const normalizedMessage = message.toLocaleLowerCase()
  return (
    normalizedMessage.includes('non-fast-forward') ||
    normalizedMessage.includes('fetch first') ||
    normalizedMessage.includes('updates were rejected') ||
    normalizedMessage.includes('failed to push some refs')
  )
}

const getDivergedPullFailure = (command: string): AppGitRecoverableFailure => ({
  kind: 'pull-diverged',
  title: 'Pull needs a strategy',
  message:
    'Local and remote commits have diverged. Choose whether to rebase your commits or create a merge commit.',
  command,
  actions: [
    {
      id: 'pull-rebase',
      label: 'Rebase',
      description: 'Replay local commits on top of the remote branch.'
    },
    {
      id: 'pull-merge',
      label: 'Merge',
      description: 'Create a merge commit that combines local and remote commits.'
    }
  ]
})

const getPushRejectedFailure = (command: string): AppGitRecoverableFailure => ({
  kind: 'push-rejected',
  title: 'Remote changed before push',
  message: 'The remote branch has commits that are not local yet. Pull them before pushing.',
  command,
  actions: [
    {
      id: 'pull-and-push',
      label: 'Pull & Push',
      description: 'Pull remote changes with fast-forward-only, then push local commits.'
    }
  ]
})

const getGitChangesOptions = (value: unknown): AppGitChangesOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git changes options')
  }

  const options = value as { container?: unknown; cwd?: unknown; source?: unknown }
  const source = options.source

  if (source !== 'branch' && source !== 'uncommitted') {
    throw new Error('Invalid Git changes source')
  }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getDefaultPath(options.cwd),
    source
  }
}

const getSourceAvailabilityOptions = (value: unknown): AppSourceAvailabilityOptions => {
  if (value == null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid source availability options')
  }

  return {
    container: requireContainerTarget((value as { container?: unknown }).container, {
      optional: true
    })
  }
}

const runAvailabilityCommand = async (
  file: string,
  args: string[],
  container: AppContainerTarget | null | undefined
): Promise<{ success: boolean; stdout: string }> => {
  const hostCommand = await getHostCommand(file, args, {
    container,
    env: process.env
  }).catch(() => null)
  if (!hostCommand) return { success: false, stdout: '' }

  return new Promise((resolve) => {
    const child = execFile(
      hostCommand.file,
      hostCommand.args,
      {
        cwd: hostCommand.cwd,
        encoding: 'utf8',
        env: hostCommand.env,
        maxBuffer: sourceAvailabilityMaxBuffer,
        timeout: sourceAvailabilityTimeoutMs
      },
      (error, stdout) => resolve({ success: !error, stdout })
    )
    child.stdin?.end()
  })
}

const isCommandAvailableInSource = (
  command: string,
  container: AppContainerTarget | null | undefined
): Promise<boolean> => {
  if (container?.kind === 'container') {
    return runAvailabilityCommand(
      'sh',
      ['-lc', `command -v ${command} >/dev/null 2>&1`],
      container
    ).then(({ success }) => success)
  }

  return runAvailabilityCommand(command, ['--version'], null).then(({ success }) => success)
}

const isProviderAvailableInSource = async (
  providerId: ProviderId,
  container: AppContainerTarget | null | undefined
): Promise<boolean> => {
  if (providerId === 'codex') {
    if (container?.kind === 'container' || (await getCurrentContainerHostBridge())) {
      return isCommandAvailableInSource('codex', container)
    }

    return runAvailabilityCommand(getCodexExecutable(), ['--version'], null).then(
      ({ success }) => success
    )
  }

  if (providerId === 'copilot') {
    if (container?.kind === 'container' || (await getCurrentContainerHostBridge())) {
      return isCommandAvailableInSource('copilot', container)
    }

    return runAvailabilityCommand(getCopilotExecutable(), ['--version'], null).then(
      ({ success }) => success
    )
  }

  if (providerId === 'claude') {
    if (container?.kind === 'container' || (await getCurrentContainerHostBridge())) {
      return isCommandAvailableInSource('claude', container)
    }

    return runAvailabilityCommand(getClaudeExecutable(), ['--version'], null).then(
      ({ success }) => success
    )
  }

  return false
}

const getSourceAvailability = async (
  options: AppSourceAvailabilityOptions = {}
): Promise<AppSourceAvailability> => {
  const container = options.container
  if (container?.kind === 'container') {
    const script = sourceAvailabilityCommands
      .map(
        (command) => `command -v ${command} >/dev/null 2>&1 && printf '%s\\n' '${command}' || true`
      )
      .join('\n')
    const { stdout } = await runAvailabilityCommand('sh', ['-lc', script], container)
    const availableCommands = new Set(stdout.split('\n').filter(Boolean))

    return {
      gitAvailable: availableCommands.has('git'),
      providers: sourceAvailabilityProviderIds.map((providerId) => ({
        providerId,
        available: availableCommands.has(providerId)
      }))
    }
  }

  const [gitAvailable, providers] = await Promise.all([
    isCommandAvailableInSource('git', container),
    Promise.all(
      (['codex', 'claude', 'copilot'] satisfies ProviderId[]).map(async (providerId) => ({
        providerId,
        available: await isProviderAvailableInSource(providerId, container)
      }))
    )
  ])

  return {
    gitAvailable,
    providers
  }
}

const getGitBranchesOptions = (value: unknown): AppGitBranchesOptions => {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git branch options')
  }

  return {
    container: requireContainerTarget((value as { container?: unknown }).container, {
      optional: true
    }),
    cwd: getDefaultPath((value as { cwd?: unknown }).cwd)
  }
}

const getGitSwitchBranchOptions = (value: unknown): AppGitSwitchBranchOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git branch switch options')
  }

  const options = value as {
    branchName?: unknown
    container?: unknown
    create?: unknown
    cwd?: unknown
  }
  const branchName = typeof options.branchName === 'string' ? options.branchName.trim() : ''

  if (!branchName || branchName.includes('\0') || branchName.includes('\n')) {
    throw new Error('Invalid branch name')
  }
  if (options.create != null && typeof options.create !== 'boolean') {
    throw new Error('Invalid Git create branch option')
  }

  return {
    branchName,
    container: requireContainerTarget(options.container, { optional: true }),
    create: Boolean(options.create),
    cwd: getDefaultPath(options.cwd)
  }
}

const isGitDeleteBranchScope = (value: unknown): value is AppGitDeleteBranchScope =>
  value === 'local' || value === 'remote' || value === 'both'

const getGitDeleteBranchOptions = (value: unknown): AppGitDeleteBranchOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git branch delete options')
  }

  const options = value as {
    branchName?: unknown
    container?: unknown
    force?: unknown
    removeWorktree?: unknown
    scope?: unknown
    cwd?: unknown
  }
  const branchName = typeof options.branchName === 'string' ? options.branchName.trim() : ''

  if (!branchName || branchName.includes('\0') || branchName.includes('\n')) {
    throw new Error('Invalid branch name')
  }
  if (options.force != null && typeof options.force !== 'boolean') {
    throw new Error('Invalid Git force delete option')
  }
  if (options.removeWorktree != null && typeof options.removeWorktree !== 'boolean') {
    throw new Error('Invalid Git worktree remove option')
  }
  if (options.scope != null && !isGitDeleteBranchScope(options.scope)) {
    throw new Error('Invalid Git branch delete scope')
  }

  return {
    branchName,
    container: requireContainerTarget(options.container, { optional: true }),
    force: Boolean(options.force),
    removeWorktree: Boolean(options.removeWorktree),
    scope: isGitDeleteBranchScope(options.scope) ? options.scope : undefined,
    cwd: getDefaultPath(options.cwd)
  }
}

const getGitCreateWorktreeOptions = (value: unknown): AppGitCreateWorktreeOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git worktree options')
  }

  const options = value as {
    container?: unknown
    cwd?: unknown
    name?: unknown
  }
  const name = typeof options.name === 'string' ? options.name.trim() : ''

  if (!name || name.includes('\0') || name.includes('\n') || name.includes('\r')) {
    throw new Error('Invalid worktree name')
  }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getDefaultPath(options.cwd),
    name
  }
}

const getFileTreeOptions = (value: unknown): AppFileTreeOptions => {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid file tree options')

  const options = value as { container?: unknown; cwd?: unknown }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getDefaultPath(options.cwd)
  }
}

const getFileContentsOptions = (value: unknown): AppFileContentsOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid file options')
  }

  const options = value as { container?: unknown; cwd?: unknown; path?: unknown }
  if (
    typeof options.path !== 'string' ||
    options.path.length === 0 ||
    options.path.includes('\0')
  ) {
    throw new Error('Invalid file path')
  }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getOptionalCwd(options.cwd),
    path: options.path
  }
}

const getWriteFileContentsOptions = (value: unknown): AppWriteFileContentsOptions => {
  const fileOptions = getFileContentsOptions(value)
  const options = value as {
    contents?: unknown
    expectedVersion?: unknown
  }

  if (typeof options.contents !== 'string') throw new Error('Invalid file contents')
  if (
    typeof options.expectedVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(options.expectedVersion)
  ) {
    throw new Error('Invalid file version')
  }

  return {
    ...fileOptions,
    contents: options.contents,
    expectedVersion: options.expectedVersion
  }
}

const isGitPatchChangeKind = (value: unknown): value is AppGitPatchChange['kind'] =>
  value === 'edit' || value === 'create' || value === 'delete'

const getGitPatchChanges = (value: unknown, errorMessage: string): AppGitPatchChange[] => {
  if (!Array.isArray(value)) throw new Error(errorMessage)

  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(errorMessage)
    }

    const patch = candidate as Partial<AppGitPatchChange>
    if (
      typeof patch.path !== 'string' ||
      patch.path.length === 0 ||
      patch.path.includes('\0') ||
      patch.path.includes('\n') ||
      !isGitPatchChangeKind(patch.kind) ||
      typeof patch.diff !== 'string'
    ) {
      throw new Error(errorMessage)
    }

    return {
      path: patch.path,
      kind: patch.kind,
      diff: patch.diff
    }
  })
}

const getGitCommitOptions = (value: unknown): AppGitCommitOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git commit options')
  }

  const options = value as {
    action?: unknown
    container?: unknown
    cwd?: unknown
    files?: unknown
    message?: unknown
    patches?: unknown
  }
  const action = options.action === 'amend' ? options.action : 'commit'
  const message = typeof options.message === 'string' ? options.message.trim() : ''

  if (action !== 'amend' && !message) throw new Error('Commit message is required')
  if (!Array.isArray(options.files)) throw new Error('Commit files are required')

  const files = [
    ...new Set(
      options.files.filter((file): file is string => typeof file === 'string').map((file) => file)
    )
  ]
  const patches =
    options.patches == null
      ? undefined
      : getGitPatchChanges(options.patches, 'Invalid Git commit patches')

  return {
    action,
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getDefaultPath(options.cwd),
    files,
    patches,
    message
  }
}

const getGitSyncOptions = (
  value: unknown
): {
  container?: AppContainerTarget | null
  cwd?: string | null
  rememberStrategy: boolean
  strategy?: AppGitPullStrategy
} => {
  if (value == null) return { rememberStrategy: false }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Git sync options')

  const options = value as {
    container?: unknown
    cwd?: unknown
    rememberStrategy?: unknown
    strategy?: unknown
  }
  const rememberStrategy = options.rememberStrategy
  const strategy = options.strategy

  if (rememberStrategy != null && typeof rememberStrategy !== 'boolean') {
    throw new Error('Invalid Git remember strategy option')
  }

  if (strategy != null && !isGitPullStrategy(strategy)) {
    throw new Error('Invalid Git pull strategy')
  }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getDefaultPath(options.cwd),
    rememberStrategy: Boolean(rememberStrategy),
    strategy: isGitPullStrategy(strategy) ? strategy : undefined
  }
}

const getGitRecentCommitMessagesOptions = (value: unknown): AppGitRecentCommitMessagesOptions => {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git commit history options')
  }

  const options = value as { container?: unknown; cwd?: unknown; limit?: unknown }
  const limit = options.limit

  if (
    limit != null &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20)
  ) {
    throw new Error('Invalid Git commit history limit')
  }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getDefaultPath(options.cwd),
    limit: limit ?? null
  }
}

const getGitDiffOptions = (value: unknown): AppGitDiffOptions => {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git diff options')
  }

  const options = value as { container?: unknown; cwd?: unknown }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getDefaultPath(options.cwd)
  }
}

const getGitFileDiffOptions = (value: unknown): AppGitFileDiffOptions => {
  const fileOptions = getFileContentsOptions(value)
  const previousPath = (value as { previousPath?: unknown }).previousPath

  if (
    previousPath != null &&
    (typeof previousPath !== 'string' || previousPath.length === 0 || previousPath.includes('\0'))
  ) {
    throw new Error('Invalid previous file path')
  }

  return {
    ...fileOptions,
    previousPath: previousPath ?? null
  }
}

const getGitUncommittedPatchChangesOptions = (
  value: unknown
): AppGitUncommittedPatchChangesOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git patch filter options')
  }

  const options = value as { container?: unknown; cwd?: unknown; patches?: unknown }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getDefaultPath(options.cwd),
    patches: getGitPatchChanges(options.patches, 'Invalid Git patch filter patches')
  }
}

const getCurrentBranchName = async (cwd: string): Promise<string | null> => {
  const branchName = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return branchName && branchName !== 'HEAD' ? branchName : null
}

const getGitBranches = async (cwd: string): Promise<AppGitBranchesResult> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (!repositoryRoot) {
    return {
      repositoryRoot: cwd,
      currentBranch: null,
      branches: []
    }
  }

  const [currentBranch, branchOutput] = await Promise.all([
    getCurrentBranchName(repositoryRoot),
    runGit(repositoryRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], true)
  ])
  const branches = (branchOutput ?? '')
    .split('\n')
    .map((branch) => branch.trim())
    .filter(Boolean)
    .sort((firstBranch, secondBranch) => firstBranch.localeCompare(secondBranch))

  return {
    repositoryRoot,
    currentBranch,
    branches
  }
}

const switchGitBranch = async (
  cwd: string,
  branchName: string,
  create: boolean
): Promise<AppGitBranchesResult> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  await runGit(repositoryRoot, ['check-ref-format', '--branch', branchName], true)
  await runGit(repositoryRoot, create ? ['switch', '-c', branchName] : ['switch', branchName], true)

  return getGitBranches(repositoryRoot)
}

const getGitBranchRemote = async (cwd: string, branchName: string): Promise<string> => {
  const remote = await runGit(cwd, [
    'for-each-ref',
    '--count=1',
    '--format=%(upstream:remotename)',
    `refs/heads/${branchName}`
  ])

  return remote?.trim() || 'origin'
}

const isForceBranchDeleteSuggestion = (message: string): boolean =>
  /\bgit\s+branch\s+-D\b/.test(message) || /\bbranch\s+-D\b/.test(message)

type GitWorktreeEntry = {
  branchRef: string | null
  path: string
}

const parseGitWorktreeList = (output: string): GitWorktreeEntry[] => {
  const entries: GitWorktreeEntry[] = []
  let path: string | null = null
  let branchRef: string | null = null

  const finishEntry = (): void => {
    if (path) entries.push({ branchRef, path })
    path = null
    branchRef = null
  }

  for (const field of output.split('\0')) {
    if (!field) {
      finishEntry()
      continue
    }

    if (field.startsWith('worktree ')) path = field.slice('worktree '.length)
    if (field.startsWith('branch ')) branchRef = field.slice('branch '.length)
  }

  finishEntry()
  return entries
}

const getLinkedBranchWorktreePath = async (
  repositoryRoot: string,
  branchName: string
): Promise<string | null> => {
  const output = await runGit(repositoryRoot, ['worktree', 'list', '--porcelain', '-z'], true)
  const branchRef = `refs/heads/${branchName}`
  const worktrees = parseGitWorktreeList(output ?? '')

  return (
    worktrees.find(
      (worktree, index) =>
        index > 0 && worktree.path !== repositoryRoot && worktree.branchRef === branchRef
    )?.path ?? null
  )
}

const isBranchUsedByWorktreeFailure = (message: string): boolean => {
  const normalizedMessage = message.toLocaleLowerCase()
  return (
    normalizedMessage.includes('cannot delete branch') &&
    normalizedMessage.includes('used by worktree at')
  )
}

const deleteGitBranch = async (
  cwd: string,
  branchName: string,
  scope: AppGitDeleteBranchScope,
  force: boolean,
  removeWorktree: boolean
): Promise<AppGitDeleteBranchResult> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  await runGit(repositoryRoot, ['check-ref-format', '--branch', branchName], true)
  const remote =
    scope === 'remote' || scope === 'both'
      ? await getGitBranchRemote(repositoryRoot, branchName)
      : null

  try {
    if (removeWorktree) {
      const worktreePath = await getLinkedBranchWorktreePath(repositoryRoot, branchName)
      if (worktreePath) {
        await runGit(repositoryRoot, ['worktree', 'remove', worktreePath], {
          required: true,
          timeoutMs: 120_000
        })
      }
    }

    if (scope === 'local' || scope === 'both') {
      await runGit(repositoryRoot, ['branch', force ? '-D' : '-d', '--', branchName], true)
    }

    if (scope === 'remote' || scope === 'both') {
      await runGit(repositoryRoot, ['push', '--delete', remote ?? 'origin', branchName], {
        required: true,
        timeoutMs: 120_000
      })
    }
  } catch (error) {
    const message = getGitErrorMessage(error)
    const worktreePath =
      !removeWorktree && scope !== 'remote' && isBranchUsedByWorktreeFailure(message)
        ? await getLinkedBranchWorktreePath(repositoryRoot, branchName)
        : null
    return {
      branches: await getGitBranches(repositoryRoot),
      cancelled: false,
      deleted: false,
      error: message,
      force,
      forceSuggested: !force && scope !== 'remote' && isForceBranchDeleteSuggestion(message),
      scope,
      worktreePath
    }
  }

  return {
    branches: await getGitBranches(repositoryRoot),
    cancelled: false,
    deleted: true,
    error: null,
    force,
    forceSuggested: false,
    scope,
    worktreePath: null
  }
}

const gitWorktreeCreateTimeoutMs = 120_000

const normalizeGitWorktreeName = (name: string): string => {
  const normalizedName = name
    .trim()
    .replace(/^```(?:[a-z0-9_-]+)?/i, '')
    .replace(/```$/i, '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^agents\//, '')
    .trim()

  if (
    !normalizedName ||
    normalizedName.includes('\0') ||
    normalizedName.includes('\n') ||
    normalizedName.includes('\r') ||
    normalizedName.includes('\\') ||
    isAbsolute(normalizedName)
  ) {
    throw new Error('AI returned an invalid worktree name')
  }

  const segments = normalizedName.split('/')
  if (
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.toLocaleLowerCase() === '.git'
    )
  ) {
    throw new Error('AI returned an invalid worktree name')
  }

  return normalizedName
}

const createGitWorktree = async (
  cwd: string,
  name: string
): Promise<AppGitCreateWorktreeResult> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const baseBranchName = await getCurrentBranchName(repositoryRoot)
  if (!baseBranchName) {
    throw new Error('Cannot create a worktree while the selected repository is detached.')
  }

  const worktreeName = normalizeGitWorktreeName(name)
  const branchName = `agents/${worktreeName}`
  await runGit(repositoryRoot, ['check-ref-format', '--branch', branchName], true)

  const worktreePath = join(repositoryRoot, 'agents', ...worktreeName.split('/'))
  const relativeWorktreePath = relative(repositoryRoot, worktreePath)
  if (
    !relativeWorktreePath ||
    relativeWorktreePath === '..' ||
    relativeWorktreePath.startsWith('../') ||
    relativeWorktreePath.startsWith('..\\') ||
    isAbsolute(relativeWorktreePath)
  ) {
    throw new Error('AI returned an invalid worktree name')
  }

  await runGit(
    repositoryRoot,
    ['worktree', 'add', '-b', branchName, worktreePath, baseBranchName],
    {
      required: true,
      timeoutMs: gitWorktreeCreateTimeoutMs
    }
  )
  await setStoredCwdMetadata(worktreePath, {
    kind: 'gitWorktree',
    projectCwd: repositoryRoot,
    branchName,
    worktreeBaseBranchName: baseBranchName
  })

  return {
    repositoryRoot,
    worktreePath,
    branchName,
    baseBranchName
  }
}

const getOriginHeadBranch = async (cwd: string): Promise<string | null> => {
  const originHead = await runGit(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  const prefix = 'refs/remotes/'

  return originHead?.startsWith(prefix) ? originHead.slice(prefix.length) : null
}

const getVerifiedBranchBase = async (
  cwd: string,
  candidateRef: string
): Promise<BranchBase | null> => {
  const verifiedRef = await runGit(cwd, ['rev-parse', '--verify', '--quiet', candidateRef])
  if (!verifiedRef) return null

  const commit = await runGit(cwd, ['merge-base', 'HEAD', candidateRef])
  return commit ? { ref: candidateRef, commit } : null
}

const getBranchBase = async (
  cwd: string,
  branchName: string | null
): Promise<BranchBase | null> => {
  const originHeadBranch = await getOriginHeadBranch(cwd)
  const candidateRefs = [
    originHeadBranch,
    'origin/main',
    'origin/master',
    'upstream/main',
    'upstream/master',
    'main',
    'master'
  ]
  const uniqueRefs = [...new Set(candidateRefs.filter((ref): ref is string => Boolean(ref)))]

  for (const candidateRef of uniqueRefs) {
    if (candidateRef === branchName) continue

    const branchBase = await getVerifiedBranchBase(cwd, candidateRef)
    if (branchBase) return branchBase
  }

  const upstreamRef = await runGit(cwd, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}'
  ])

  if (upstreamRef && upstreamRef !== branchName) {
    const upstreamBase = await getVerifiedBranchBase(cwd, upstreamRef)
    if (upstreamBase) return upstreamBase
  }

  return null
}

const getUpstreamCommitCounts = async (
  cwd: string
): Promise<{ unpulledCount: number; unpushedCount: number }> => {
  const counts = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
  const [unpushedRaw, unpulledRaw] = counts?.trim().split(/\s+/, 2) ?? []
  const unpulledCount = Number(unpulledRaw)
  const unpushedCount = Number(unpushedRaw)

  return {
    unpulledCount: Number.isFinite(unpulledCount) ? unpulledCount : 0,
    unpushedCount: Number.isFinite(unpushedCount) ? unpushedCount : 0
  }
}

const getChangeKind = (status: string): AppGitChangeKind => {
  const code = status[0]
  if (code === '?') return 'untracked'
  if (code === 'A' || code === 'C' || code === '?') return 'create'
  if (code === 'D') return 'delete'
  if (code === 'R') return 'rename'
  return 'edit'
}

const getPorcelainChangeKind = (status: string): AppGitChangeKind => {
  if (status.includes('?')) return 'untracked'
  if (status.includes('R')) return 'rename'
  if (status.includes('A') || status.includes('C') || status.includes('?')) return 'create'
  if (status.includes('D')) return 'delete'
  return 'edit'
}

const parseNameStatusChanges = (output: string): AppGitFileChange[] => {
  if (!output) return []

  const fields = output.split('\0')
  const changes: AppGitFileChange[] = []
  let index = 0

  while (index < fields.length && fields[index]) {
    const status = fields[index]
    index += 1

    if (status[0] === 'R' || status[0] === 'C') {
      const previousPath = fields[index]
      const path = fields[index + 1]
      index += 2

      if (path) {
        changes.push({
          path,
          previousPath: previousPath || null,
          kind: getChangeKind(status),
          status
        })
      }

      continue
    }

    const path = fields[index]
    index += 1

    if (path) {
      changes.push({
        path,
        kind: getChangeKind(status),
        status
      })
    }
  }

  return changes
}

const parsePorcelainChanges = (output: string): AppGitFileChange[] => {
  if (!output) return []

  const fields = output.split('\0')
  const changes: AppGitFileChange[] = []
  let index = 0

  while (index < fields.length && fields[index]) {
    const entry = fields[index]
    index += 1

    if (entry.length < 4) continue

    const status = entry.slice(0, 2)
    const path = entry.slice(3)

    if (status.includes('R') || status.includes('C')) {
      const previousPath = fields[index]
      index += 1

      changes.push({
        path,
        previousPath: previousPath || null,
        kind: getPorcelainChangeKind(status),
        status
      })

      continue
    }

    changes.push({
      path,
      kind: getPorcelainChangeKind(status),
      status
    })
  }

  return changes
}

const parseGitPathList = (output: string): string[] =>
  output.split('\0').filter((path) => path.length > 0)

const getGitChanges = async (
  cwd: string,
  source: AppGitChangeSource
): Promise<AppGitChangesResult> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (!repositoryRoot) {
    return {
      repositoryRoot: cwd,
      branchName: null,
      baseRef: null,
      unpulledCount: 0,
      unpushedCount: 0,
      files: []
    }
  }

  const branchName = await getCurrentBranchName(repositoryRoot)
  const { unpulledCount, unpushedCount } = await getUpstreamCommitCounts(repositoryRoot)

  if (source === 'uncommitted') {
    const status = await runGit(
      repositoryRoot,
      ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
      true
    )

    return {
      repositoryRoot,
      branchName,
      baseRef: null,
      unpulledCount,
      unpushedCount,
      files: parsePorcelainChanges(status ?? '')
    }
  }

  const branchBase = await getBranchBase(repositoryRoot, branchName)
  if (!branchBase) {
    return {
      repositoryRoot,
      branchName,
      baseRef: null,
      unpulledCount,
      unpushedCount,
      files: []
    }
  }

  const diff = await runGit(
    repositoryRoot,
    ['diff', '--name-status', '-z', '--find-renames', `${branchBase.commit}...HEAD`, '--'],
    true
  )

  return {
    repositoryRoot,
    branchName,
    baseRef: branchBase.ref,
    unpulledCount,
    unpushedCount,
    files: parseNameStatusChanges(diff ?? '')
  }
}

const getFileTree = async (
  cwd: string
): Promise<{
  repositoryRoot: string
  branchName: string | null
  files: AppFileTreeFile[]
}> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const [branchName, fileOutput, statusOutput] = await Promise.all([
    getCurrentBranchName(repositoryRoot),
    runGit(repositoryRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], true),
    runGit(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], true)
  ])
  const changesByPath = new Map(
    parsePorcelainChanges(statusOutput ?? '').map((file) => [file.path, file])
  )
  const filesByPath = new Map<string, AppFileTreeFile>()

  for (const path of parseGitPathList(fileOutput ?? '')) {
    const change = changesByPath.get(path)
    filesByPath.set(path, change ? { ...change } : { path })
  }

  for (const change of changesByPath.values()) {
    if (!filesByPath.has(change.path)) filesByPath.set(change.path, { ...change })
  }

  return {
    repositoryRoot,
    branchName,
    files: Array.from(filesByPath.values()).sort((firstFile, secondFile) =>
      firstFile.path.localeCompare(secondFile.path)
    )
  }
}

const maxEditableFileBytes = 2 * 1024 * 1024
const remoteFileMetadataBufferBytes = 16 * 1024

const getFileVersion = (contents: Buffer | string): string =>
  createHash('sha256').update(contents).digest('hex')

const isSshGitTarget = (): boolean => {
  const container = gitCommandContext.getStore()?.container
  return container?.kind === 'container' && container.tool === 'ssh'
}

const runSshFileCommand = async (
  cwd: string,
  args: string[],
  options: { input?: Buffer; maxBuffer?: number } = {}
): Promise<Buffer> => {
  const container = gitCommandContext.getStore()?.container
  if (container?.kind !== 'container' || container.tool !== 'ssh') {
    throw new Error('SSH target is required')
  }
  const hostCommand = await getHostCommand('sh', args, {
    container,
    cwd,
    env: process.env
  })

  return new Promise((resolve, reject) => {
    const child = execFile(
      hostCommand.file,
      hostCommand.args,
      {
        cwd: hostCommand.cwd,
        encoding: 'buffer',
        env: hostCommand.env,
        maxBuffer: options.maxBuffer ?? maxEditableFileBytes + remoteFileMetadataBufferBytes,
        timeout: 30_000
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = Buffer.from(stderr).toString('utf8').trim()
          reject(new Error(detail || error.message))
          return
        }

        resolve(Buffer.from(stdout))
      }
    )

    child.stdin?.end(options.input)
  })
}

const getRemoteRepositoryFilePath = (repositoryRoot: string, path: string): string => {
  const absolutePath = isAbsolute(path) ? path : resolve(repositoryRoot, path)
  const relativePath = relative(repositoryRoot, absolutePath).replace(/\\/g, '/')
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    isAbsolute(relativePath)
  ) {
    throw new Error('File is outside the repository')
  }

  return relativePath
}

const resolveFileTarget = async (
  cwd: string,
  path: string
): Promise<{ absolutePath: string; commandCwd: string }> => {
  const cwdRepositoryRoot = isAbsolute(path)
    ? null
    : await runGit(cwd, ['rev-parse', '--show-toplevel'])
  const absolutePath = resolveFileTargetPath(cwd, path, cwdRepositoryRoot)

  return {
    absolutePath,
    commandCwd: getFileTargetGitCwd(absolutePath)
  }
}

const readSshFileContents = async (
  cwd: string,
  path: string
): Promise<{
  contents: string
  editable: boolean
  gitRepositoryRoot: string | null
  version: string
}> => {
  const target = await resolveFileTarget(cwd, path)
  const script = [
    'set -eu',
    'file=$(realpath -- "$1")',
    '[ -f "$file" ] || { echo "Choose a regular file to open." >&2; exit 1; }',
    'size=$(wc -c < "$file")',
    `[ "$size" -le ${maxEditableFileBytes} ] || { echo "Files larger than 2 MB cannot be opened." >&2; exit 1; }`,
    'printf "%s\\0%s\\0" "$file" "$size"',
    'cat -- "$file"'
  ].join('\n')
  const output = await runSshFileCommand(target.commandCwd, [
    '-lc',
    script,
    'sele-read-file',
    target.absolutePath
  ])
  const pathSeparator = output.indexOf(0)
  const sizeSeparator = output.indexOf(0, pathSeparator + 1)
  if (pathSeparator < 0 || sizeSeparator < 0) throw new Error('Invalid remote file response')

  const resolvedPath = output.subarray(0, pathSeparator).toString('utf8')
  const size = Number(output.subarray(pathSeparator + 1, sizeSeparator).toString('utf8'))
  const file = output.subarray(sizeSeparator + 1)
  if (!Number.isSafeInteger(size) || size < 0 || file.byteLength !== size) {
    throw new Error('Invalid remote file response')
  }

  const contents = file.toString('utf8')
  if (!Buffer.from(contents, 'utf8').equals(file)) throw new Error('Binary files cannot be opened.')

  const gitRepositoryRoot = await runGit(getFileTargetGitCwd(resolvedPath), [
    'rev-parse',
    '--show-toplevel'
  ])

  return { contents, editable: true, gitRepositoryRoot, version: getFileVersion(file) }
}

const writeSshFileContents = async (
  cwd: string,
  path: string,
  contents: string,
  expectedVersion: string
): Promise<{ version: string }> => {
  const currentFile = await readSshFileContents(cwd, path)
  if (currentFile.version !== expectedVersion) {
    throw new Error('This file changed on disk. Reload it before saving.')
  }

  const target = await resolveFileTarget(cwd, path)
  const script = [
    'set -eu',
    'file=$(realpath -- "$1")',
    '[ -f "$file" ] || { echo "File cannot be edited." >&2; exit 1; }',
    'cat > "$file"'
  ].join('\n')
  await runSshFileCommand(
    target.commandCwd,
    ['-lc', script, 'sele-write-file', target.absolutePath],
    {
      input: Buffer.from(contents, 'utf8')
    }
  )

  return { version: getFileVersion(contents) }
}

const getSshLocalImage = async (
  cwd: string | null,
  path: string,
  relativeTo: AppLocalImageOptions['relativeTo'] = 'repository'
): Promise<AppLocalImage> => {
  const mimeType = getImageMimeType(path)
  if (!mimeType) throw new Error('Unable to load this image.')

  let commandCwd = cwd ?? '/'
  let imagePath = path
  if (!isAbsolute(imagePath)) {
    if (!cwd) throw new Error('A cwd is required for relative image paths')
    if (relativeTo === 'repository') {
      const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
      if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')
      commandCwd = repositoryRoot
      imagePath = getRemoteRepositoryFilePath(repositoryRoot, imagePath)
    }
  }

  const script = [
    'set -eu',
    '[ -f "$1" ] || { echo "Choose a regular image file." >&2; exit 1; }',
    'size=$(wc -c < "$1")',
    `[ "$size" -le ${maxLocalImageBytes} ] || { echo "Choose an image smaller than 32 MB." >&2; exit 1; }`,
    'printf "%s\\0" "$size"',
    'cat -- "$1"'
  ].join('\n')
  const output = await runSshFileCommand(
    commandCwd,
    ['-lc', script, 'sele-read-image', imagePath],
    { maxBuffer: maxLocalImageBytes + remoteFileMetadataBufferBytes }
  )
  const sizeSeparator = output.indexOf(0)
  if (sizeSeparator < 0) throw new Error('Invalid remote image response')
  const size = Number(output.subarray(0, sizeSeparator).toString('utf8'))
  const file = output.subarray(sizeSeparator + 1)
  if (!Number.isSafeInteger(size) || size < 0 || file.byteLength !== size) {
    throw new Error('Invalid remote image response')
  }

  return {
    data: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    mimeType,
    updatedAt: Date.now()
  }
}

const resolveReadableFile = async (
  cwd: string,
  path: string
): Promise<{
  absolutePath: string
  editable: boolean
  gitRepositoryRoot: string | null
  size: number
}> => {
  const { absolutePath } = await resolveFileTarget(cwd, path)
  const resolvedFileStat = await stat(absolutePath)

  if (!resolvedFileStat.isFile()) throw new Error('Choose a regular file to open.')
  if (resolvedFileStat.size > maxEditableFileBytes) {
    throw new Error('Files larger than 2 MB cannot be opened.')
  }

  const gitRepositoryRoot = await runGit(getFileTargetGitCwd(absolutePath), [
    'rev-parse',
    '--show-toplevel'
  ])

  return {
    absolutePath,
    editable: true,
    gitRepositoryRoot,
    size: resolvedFileStat.size
  }
}

const resolveEditableFile = async (
  cwd: string,
  path: string
): Promise<{ absolutePath: string; size: number }> => {
  const file = await resolveReadableFile(cwd, path)
  return { absolutePath: file.absolutePath, size: file.size }
}

const readFileContents = async (
  cwd: string,
  path: string
): Promise<{
  contents: string
  editable: boolean
  gitRepositoryRoot: string | null
  version: string
}> => {
  if (isSshGitTarget()) return readSshFileContents(cwd, path)

  const { absolutePath, editable, gitRepositoryRoot } = await resolveReadableFile(cwd, path)
  const file = await readFile(absolutePath)
  const contents = file.toString('utf8')

  if (!Buffer.from(contents, 'utf8').equals(file)) {
    throw new Error('Binary files cannot be opened.')
  }

  return {
    contents,
    editable,
    gitRepositoryRoot,
    version: getFileVersion(file)
  }
}

const writeEditableFile = async (
  cwd: string,
  path: string,
  contents: string,
  expectedVersion: string
): Promise<{ version: string }> => {
  if (Buffer.byteLength(contents, 'utf8') > maxEditableFileBytes) {
    throw new Error('Files larger than 2 MB cannot be edited.')
  }

  if (isSshGitTarget()) return writeSshFileContents(cwd, path, contents, expectedVersion)

  const { absolutePath } = await resolveEditableFile(cwd, path)
  const currentContents = await readFile(absolutePath)

  if (getFileVersion(currentContents) !== expectedVersion) {
    throw new Error('This file changed on disk. Reload it before saving.')
  }

  await writeFile(absolutePath, contents, 'utf8')
  return { version: getFileVersion(contents) }
}

const getRecentGitCommitMessages = async (
  cwd: string,
  limit = 3
): Promise<{ messages: string[] }> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const output = await runGit(repositoryRoot, ['log', `--max-count=${limit}`, '--format=%s'])

  return {
    messages:
      output
        ?.split('\n')
        .map((message) => message.trim())
        .filter(Boolean) ?? []
  }
}

const normalizePatchPath = (repositoryRoot: string, path: string): string => {
  const absolutePath = isAbsolute(path) ? path : resolve(repositoryRoot, path)
  const relativePath = relative(repositoryRoot, absolutePath).replace(/\\/g, '/')

  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Patch path is outside the repository: ${path}`)
  }

  return relativePath
}

const ensureTrailingNewline = (value: string): string =>
  value.endsWith('\n') ? value : `${value}\n`

const isFullUnifiedDiff = (diff: string): boolean => {
  const trimmedDiff = diff.trimStart()
  return trimmedDiff.startsWith('diff --git ') || trimmedDiff.startsWith('--- ')
}

const getUnifiedPatch = (change: AppGitPatchChange, path: string): string => {
  if (isFullUnifiedDiff(change.diff)) return ensureTrailingNewline(change.diff)

  const oldPath = change.kind === 'create' ? '/dev/null' : `a/${path}`
  const newPath = change.kind === 'delete' ? '/dev/null' : `b/${path}`

  return `diff --git a/${path} b/${path}\n--- ${oldPath}\n+++ ${newPath}\n${ensureTrailingNewline(change.diff)}`
}

const getTemporaryIndexEnv = (indexPath: string): NodeJS.ProcessEnv => ({
  GIT_INDEX_FILE: indexPath
})

const initializeTemporaryIndex = async (
  repositoryRoot: string,
  indexPath: string
): Promise<void> => {
  const env = getTemporaryIndexEnv(indexPath)
  const head = await runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])

  await runGit(repositoryRoot, head ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], {
    env,
    required: true
  })
}

const getUncommittedGitDiff = async (cwd: string): Promise<{ diff: string }> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const tempDirectory = await mkdtemp(join(tmpdir(), 'sele-git-index-'))
  const indexPath = join(tempDirectory, 'index')
  const env = getTemporaryIndexEnv(indexPath)

  try {
    await initializeTemporaryIndex(repositoryRoot, indexPath)
    await runGit(repositoryRoot, ['add', '-A', '--', '.'], { env, required: true })

    const diff = await runGit(
      repositoryRoot,
      ['diff', '--cached', '--binary', '--full-index', '--find-renames'],
      { env, required: true }
    )

    return { diff: diff ?? '' }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

const getGitFileDiff = async (
  cwd: string,
  path: string,
  previousPath?: string | null
): Promise<{ diff: string }> => {
  const target = await resolveFileTarget(cwd, path)
  const repositoryRoot = await runGit(target.commandCwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const paths = [
    normalizePatchPath(repositoryRoot, target.absolutePath),
    ...(previousPath ? [normalizePatchPath(repositoryRoot, previousPath)] : [])
  ]
  const tempDirectory = await mkdtemp(join(tmpdir(), 'sele-git-index-'))
  const indexPath = join(tempDirectory, 'index')
  const env = getTemporaryIndexEnv(indexPath)

  try {
    await initializeTemporaryIndex(repositoryRoot, indexPath)
    await runGit(repositoryRoot, ['add', '-A', '--', '.'], { env, required: true })

    const diff = await runGit(
      repositoryRoot,
      [
        'diff',
        '--cached',
        '--binary',
        '--full-index',
        '--find-renames',
        '--unified=10000000',
        '--',
        ...paths
      ],
      { env, required: true }
    )

    return { diff: diff ?? '' }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

const applyUnifiedPatchToIndex = async (
  repositoryRoot: string,
  indexPath: string,
  patch: string
): Promise<void> => {
  const env = getTemporaryIndexEnv(indexPath)
  const applyArgs = ['apply', '--cached', '--whitespace=nowarn', '--recount', '-C0']

  try {
    await runGit(repositoryRoot, applyArgs, { env, input: patch, required: true })
  } catch (error) {
    const reverseCheck = await runGit(repositoryRoot, [...applyArgs, '--reverse', '--check'], {
      env,
      input: patch
    })

    if (reverseCheck != null) return

    throw error
  }
}

const writeContentToIndex = async (
  repositoryRoot: string,
  indexPath: string,
  path: string,
  content: string
): Promise<void> => {
  const objectHash = await runGit(repositoryRoot, ['hash-object', '-w', '--stdin'], {
    input: content,
    required: true
  })
  if (!objectHash) throw new Error(`Unable to write patch content for ${path}`)

  await runGit(
    repositoryRoot,
    ['update-index', '--add', '--cacheinfo', `100644,${objectHash},${path}`],
    { env: getTemporaryIndexEnv(indexPath), required: true }
  )
}

const removePathFromIndex = async (
  repositoryRoot: string,
  indexPath: string,
  path: string
): Promise<void> => {
  await runGit(repositoryRoot, ['update-index', '--force-remove', '--', path], {
    env: getTemporaryIndexEnv(indexPath),
    required: true
  })
}

const applyPatchChangeToIndex = async (
  repositoryRoot: string,
  indexPath: string,
  change: AppGitPatchChange
): Promise<string> => {
  const path = normalizePatchPath(repositoryRoot, change.path)

  if (change.kind === 'create' && !isFullUnifiedDiff(change.diff)) {
    await writeContentToIndex(repositoryRoot, indexPath, path, change.diff)
    return path
  }

  if (change.kind === 'delete' && !isFullUnifiedDiff(change.diff)) {
    await removePathFromIndex(repositoryRoot, indexPath, path)
    return path
  }

  await applyUnifiedPatchToIndex(repositoryRoot, indexPath, getUnifiedPatch(change, path))
  return path
}

const reverseApplyPatchChangeToIndex = async (
  repositoryRoot: string,
  indexPath: string,
  change: AppGitPatchChange
): Promise<string> => {
  const path = normalizePatchPath(repositoryRoot, change.path)

  if (change.kind === 'create' && !isFullUnifiedDiff(change.diff)) {
    await removePathFromIndex(repositoryRoot, indexPath, path)
    return path
  }

  if (change.kind === 'delete' && !isFullUnifiedDiff(change.diff)) {
    await writeContentToIndex(repositoryRoot, indexPath, path, change.diff)
    return path
  }

  await runGit(
    repositoryRoot,
    ['apply', '--cached', '--whitespace=nowarn', '--recount', '-C0', '--reverse'],
    {
      env: getTemporaryIndexEnv(indexPath),
      input: getUnifiedPatch(change, path),
      required: true
    }
  )
  return path
}

const patchChangesHead = async (
  repositoryRoot: string,
  tempDirectory: string,
  patchIndex: number,
  change: AppGitPatchChange
): Promise<boolean> => {
  const indexPath = join(tempDirectory, `patch-${patchIndex}.index`)

  try {
    await initializeTemporaryIndex(repositoryRoot, indexPath)
    await applyPatchChangeToIndex(repositoryRoot, indexPath, change)

    return (await getTemporaryIndexChangedPaths(repositoryRoot, indexPath)).length > 0
  } catch {
    return false
  }
}

const getTemporaryIndexDiffWeight = async (
  repositoryRoot: string,
  indexPath: string,
  paths: string[]
): Promise<number> => {
  const output = await runGit(repositoryRoot, ['diff', '--cached', '--shortstat', '--', ...paths], {
    env: getTemporaryIndexEnv(indexPath),
    required: true
  })

  const files = Number.parseInt(output?.match(/(\d+) files? changed/)?.[1] ?? '0', 10)
  const insertions = Number.parseInt(output?.match(/(\d+) insertions?\(\+\)/)?.[1] ?? '0', 10)
  const deletions = Number.parseInt(output?.match(/(\d+) deletions?\(-\)/)?.[1] ?? '0', 10)

  return files * 1000 + insertions + deletions
}

const reversePatchReducesWorktreeDiff = async (
  repositoryRoot: string,
  tempDirectory: string,
  patchIndex: number,
  worktreeIndexPath: string,
  change: AppGitPatchChange
): Promise<boolean> => {
  const path = normalizePatchPath(repositoryRoot, change.path)
  const reverseIndexPath = join(tempDirectory, `reverse-${patchIndex}.index`)
  const beforeWeight = await getTemporaryIndexDiffWeight(repositoryRoot, worktreeIndexPath, [path])

  if (beforeWeight === 0) return false

  try {
    await copyFile(worktreeIndexPath, reverseIndexPath)
    await reverseApplyPatchChangeToIndex(repositoryRoot, reverseIndexPath, change)

    return (
      (await getTemporaryIndexDiffWeight(repositoryRoot, reverseIndexPath, [path])) < beforeWeight
    )
  } catch {
    return false
  }
}

const getGitPatchChangeKey = (patch: AppGitPatchChange): string =>
  [patch.path, patch.kind, patch.diff].join('\0')

const getUniqueGitPatchChanges = (patches: AppGitPatchChange[]): AppGitPatchChange[] => {
  const seenPatchKeys = new Set<string>()
  const uniquePatches: AppGitPatchChange[] = []

  for (const patch of patches) {
    const key = getGitPatchChangeKey(patch)
    if (seenPatchKeys.has(key)) continue

    seenPatchKeys.add(key)
    uniquePatches.push(patch)
  }

  return uniquePatches
}

const getUncommittedGitPatchChanges = async (
  cwd: string,
  patches: AppGitPatchChange[]
): Promise<{ patches: AppGitPatchChange[] }> => {
  if (patches.length === 0) return { patches: [] }

  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const status = await runGit(repositoryRoot, ['status', '--porcelain=v1', '-z'], true)
  if (!status) return { patches: [] }

  const tempDirectory = await mkdtemp(join(tmpdir(), 'sele-git-index-'))
  const worktreeIndexPath = join(tempDirectory, 'worktree.index')

  try {
    await initializeTemporaryIndex(repositoryRoot, worktreeIndexPath)
    await runGit(repositoryRoot, ['add', '-A', '--', '.'], {
      env: getTemporaryIndexEnv(worktreeIndexPath),
      required: true
    })

    const uncommittedPatches: AppGitPatchChange[] = []

    for (const [patchIndex, patch] of getUniqueGitPatchChanges(patches).entries()) {
      if (!(await patchChangesHead(repositoryRoot, tempDirectory, patchIndex, patch))) continue
      if (
        !(await reversePatchReducesWorktreeDiff(
          repositoryRoot,
          tempDirectory,
          patchIndex,
          worktreeIndexPath,
          patch
        ))
      ) {
        continue
      }

      uncommittedPatches.push(patch)
    }

    return { patches: uncommittedPatches }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

const getTemporaryIndexChangedPaths = async (
  repositoryRoot: string,
  indexPath: string
): Promise<string[]> => {
  const output = await runGit(repositoryRoot, ['diff', '--cached', '--name-only', '-z'], {
    env: getTemporaryIndexEnv(indexPath),
    required: true
  })

  return parseGitPathList(output ?? '')
}

const commitGitPatchChanges = async (
  repositoryRoot: string,
  patches: AppGitPatchChange[],
  message: string | null | undefined,
  action: AppGitCommitAction
): Promise<void> => {
  if (patches.length === 0) throw new Error('Patch changes are required')

  const tempDirectory = await mkdtemp(join(tmpdir(), 'sele-git-index-'))
  const indexPath = join(tempDirectory, 'index')

  try {
    await initializeTemporaryIndex(repositoryRoot, indexPath)

    for (const patch of patches) {
      await applyPatchChangeToIndex(repositoryRoot, indexPath, patch)
    }

    const changedPaths = await getTemporaryIndexChangedPaths(repositoryRoot, indexPath)
    if (changedPaths.length === 0) throw new Error('No patch changes to commit')

    if (action === 'amend') {
      await runGit(repositoryRoot, ['commit', '--amend', '--no-edit'], {
        env: getTemporaryIndexEnv(indexPath),
        required: true
      })
    } else {
      const commitMessage = message?.trim()
      if (!commitMessage) throw new Error('Commit message is required')

      await runGit(repositoryRoot, ['commit', '-m', commitMessage], {
        env: getTemporaryIndexEnv(indexPath),
        required: true
      })
    }

    await runGit(repositoryRoot, ['reset', '-q', 'HEAD', '--', ...changedPaths], true)
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

const commitGitChanges = async (
  cwd: string,
  files: string[],
  message: string | null | undefined,
  action: AppGitCommitAction,
  patches?: AppGitPatchChange[]
): Promise<{ commitHash: string; pushed: boolean }> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  if (patches && patches.length > 0) {
    const { patches: uncommittedPatches } = await getUncommittedGitPatchChanges(
      repositoryRoot,
      patches
    )
    if (uncommittedPatches.length === 0) {
      throw new Error(
        'The selected chat changes are no longer present in the working tree. Refresh Changes and try again.'
      )
    }

    await commitGitPatchChanges(repositoryRoot, uncommittedPatches, message, action)
    const commitHash = await runGit(repositoryRoot, ['rev-parse', 'HEAD'], true)
    if (!commitHash) throw new Error('Unable to read commit hash')

    return { commitHash, pushed: false }
  }

  await commitGitFileChanges({ action, files, message, repositoryRoot, runGit })

  const commitHash = await runGit(repositoryRoot, ['rev-parse', 'HEAD'], true)
  if (!commitHash) throw new Error('Unable to read commit hash')

  return { commitHash, pushed: false }
}

const pushGitChanges = async (
  cwd: string
): Promise<{ pushed: boolean; failure?: AppGitRecoverableFailure | null }> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  try {
    await runGit(repositoryRoot, ['push'], true)
  } catch (error) {
    const message = getGitErrorMessage(error)
    if (isPushRejectedFailure(message)) {
      return { pushed: false, failure: getPushRejectedFailure('git push') }
    }

    throw new Error(message)
  }

  return { pushed: true, failure: null }
}

const hasLocalGitPullConfig = async (repositoryRoot: string): Promise<boolean> => {
  const pullRebase = await runGit(repositoryRoot, ['config', '--local', '--get', 'pull.rebase'])
  const pullFf = await runGit(repositoryRoot, ['config', '--local', '--get', 'pull.ff'])

  return Boolean(pullRebase || pullFf)
}

const rememberGitPullStrategy = async (
  repositoryRoot: string,
  strategy: AppGitPullStrategy
): Promise<void> => {
  if (strategy === 'rebase') {
    await runGit(repositoryRoot, ['config', 'pull.rebase', 'true'], true)
    await runGit(repositoryRoot, ['config', '--unset-all', 'pull.ff'])
  }

  if (strategy === 'merge') {
    await runGit(repositoryRoot, ['config', 'pull.rebase', 'false'], true)
    await runGit(repositoryRoot, ['config', '--unset-all', 'pull.ff'])
  }
}

const getGitPullArgs = async (
  repositoryRoot: string,
  strategy?: AppGitPullStrategy
): Promise<string[]> => {
  if (strategy === 'rebase') return ['pull', '--rebase']
  if (strategy === 'merge') return ['pull', '--no-rebase', '--no-ff', '--no-edit']
  if (!strategy && (await hasLocalGitPullConfig(repositoryRoot))) return ['pull']

  return ['pull', '--ff-only']
}

const pullGitChanges = async (
  cwd: string,
  strategy?: AppGitPullStrategy,
  rememberStrategy = false
): Promise<{ pulled: boolean; failure?: AppGitRecoverableFailure | null }> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  if (rememberStrategy && strategy) {
    await rememberGitPullStrategy(repositoryRoot, strategy)
  }

  const args = await getGitPullArgs(repositoryRoot, strategy)

  try {
    await runGit(repositoryRoot, args, true)
  } catch (error) {
    const message = getGitErrorMessage(error)
    if ((strategy == null || strategy === 'ff-only') && isDivergedPullFailure(message)) {
      return {
        pulled: false,
        failure: getDivergedPullFailure(`git ${args.join(' ')}`)
      }
    }

    throw new Error(message)
  }

  return { pulled: true, failure: null }
}

export const registerAppIpc = (): void => {
  ipcMain.handle(appIpcChannels.getColorScheme, getColorScheme)

  ipcMain.handle(appIpcChannels.getInstalledFontFamilies, getInstalledFontFamilies)

  ipcMain.handle(appIpcChannels.getDefaultCwd, () => process.cwd())

  ipcMain.handle(appIpcChannels.getProjects, () => getStoredProjects())

  ipcMain.handle(appIpcChannels.addProject, async (_event, value: unknown) => {
    const options = getAddProjectOptions(value)
    const cwds = [options.cwd, ...(options.additionalCwds ?? [])]
    const cwdStats = await Promise.all(cwds.map((cwd) => stat(cwd).catch(() => null)))
    if (!cwdStats[0]?.isDirectory()) throw new Error('Project folder does not exist')
    if (cwdStats.slice(1).some((cwdStat) => !cwdStat?.isDirectory())) {
      throw new Error('An additional project folder does not exist')
    }

    const selectedImagePath = options.iconSelectionId
      ? pendingProjectIconSelections.get(options.iconSelectionId)
      : null
    if (options.iconSelectionId && !selectedImagePath) {
      throw new Error('Project icon selection has expired')
    }

    const project = await addStoredProject(options)
    if (options.iconSelectionId && selectedImagePath) {
      await setStoredProjectIcon(options.cwd, selectedImagePath)
      pendingProjectIconSelections.delete(options.iconSelectionId)
    }

    return project
  })

  ipcMain.handle(appIpcChannels.getSshEnvironments, () => getStoredSshEnvironments())

  ipcMain.handle(appIpcChannels.createSshEnvironment, async (_event, value: unknown) => {
    const options = getCreateSshEnvironmentOptions(value)
    await validateSshIdentityFile(options.identityFile)

    return createStoredSshEnvironment(options)
  })

  ipcMain.handle(appIpcChannels.updateSshEnvironment, async (_event, value: unknown) => {
    const options = getUpdateSshEnvironmentOptions(value)
    await validateSshIdentityFile(options.identityFile)

    return updateStoredSshEnvironment(options)
  })

  ipcMain.handle(appIpcChannels.deleteSshEnvironment, async (_event, value: unknown) => {
    const options = getDeleteSshEnvironmentOptions(value)
    await deleteStoredSshEnvironment(options.id)
  })

  ipcMain.handle(appIpcChannels.selectSshIdentityFile, async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      title: 'Choose SSH identity file',
      properties: ['openFile']
    } satisfies Electron.OpenDialogOptions
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(appIpcChannels.getContainerSuggestions, (_event, value: unknown) =>
    getContainerSuggestions(getSourceAvailabilityOptions(value))
  )

  ipcMain.handle(appIpcChannels.getSourceAvailability, (_event, value: unknown) =>
    getSourceAvailability(getSourceAvailabilityOptions(value))
  )

  ipcMain.handle(appIpcChannels.getWindowState, (event) =>
    getAppWindowState(getBrowserWindow(event))
  )

  ipcMain.handle(appIpcChannels.minimizeWindow, (event) => {
    getBrowserWindow(event).minimize()
  })

  ipcMain.handle(appIpcChannels.toggleWindowMaximized, (event) => {
    const window = getBrowserWindow(event)
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()

    const state = getAppWindowState(window)
    sendAppWindowState(window)
    return state
  })

  ipcMain.handle(appIpcChannels.closeWindow, (event) => {
    getBrowserWindow(event).close()
  })

  ipcMain.handle(appIpcChannels.setWindowZoomLevel, (event, value: unknown) => {
    getBrowserWindow(event).webContents.setZoomLevel(normalizeAppWindowZoomLevel(value))
  })

  ipcMain.handle(appIpcChannels.handleExternalLink, async (event, value: unknown) => {
    const options = getExternalLinkOptions(value)
    let action = options.action
    let always = false

    if (!action) {
      const browserWindow = getBrowserWindow(event)
      const result = await dialog.showMessageBox(browserWindow, {
        type: 'question',
        title: 'External link',
        message: 'Copy or open this link?',
        detail: options.url,
        buttons: ['Copy', 'Open', 'Cancel'],
        defaultId: 1,
        cancelId: 2,
        checkboxLabel: 'Always',
        checkboxChecked: false,
        noLink: true
      })

      if (result.response === 2) return null
      action = result.response === 0 ? 'copy' : 'open'
      always = result.checkboxChecked
    }

    await performExternalLinkAction(action, options.url)
    return { action, always } satisfies AppExternalLinkResult
  })

  ipcMain.handle(appIpcChannels.getGitChanges, async (_event, value: unknown) => {
    const options = getGitChangesOptions(value)
    return runWithGitContainer(options.container, () =>
      getGitChanges(options.cwd ?? process.cwd(), options.source)
    )
  })

  ipcMain.handle(appIpcChannels.getGitBranches, async (_event, value: unknown) => {
    const options = getGitBranchesOptions(value)
    return runWithGitContainer(options.container, () =>
      getGitBranches(options.cwd ?? process.cwd())
    )
  })

  ipcMain.handle(appIpcChannels.switchGitBranch, async (_event, value: unknown) => {
    const options = getGitSwitchBranchOptions(value)
    return runWithGitContainer(options.container, () =>
      switchGitBranch(options.cwd ?? process.cwd(), options.branchName, Boolean(options.create))
    )
  })

  ipcMain.handle(appIpcChannels.deleteGitBranch, async (event, value: unknown) => {
    const options = getGitDeleteBranchOptions(value)
    let scope = options.scope ?? null
    let force = Boolean(options.force)

    if (!scope) {
      const result = await dialog.showMessageBox(getBrowserWindow(event), {
        type: 'warning',
        title: 'Delete branch',
        message: `Delete “${options.branchName}”?`,
        detail:
          'Choose whether to delete the local branch, its remote branch, or both. Force only applies to local deletion.',
        buttons: ['Delete Local', 'Delete Remote', 'Delete Both', 'Cancel'],
        defaultId: 3,
        cancelId: 3,
        checkboxLabel: 'Force',
        checkboxChecked: false,
        noLink: true
      })

      scope = (['local', 'remote', 'both'] as const)[result.response] ?? null
      force = result.checkboxChecked
    }

    if (!scope) {
      return {
        branches: null,
        cancelled: true,
        deleted: false,
        error: null,
        force,
        forceSuggested: false,
        scope: null,
        worktreePath: null
      } satisfies AppGitDeleteBranchResult
    }

    return runWithGitContainer(options.container, () =>
      deleteGitBranch(
        options.cwd ?? process.cwd(),
        options.branchName,
        scope,
        force,
        Boolean(options.removeWorktree)
      )
    )
  })

  ipcMain.handle(appIpcChannels.createGitWorktree, async (_event, value: unknown) => {
    const options = getGitCreateWorktreeOptions(value)
    return runWithGitContainer(options.container, () =>
      createGitWorktree(options.cwd ?? process.cwd(), options.name)
    )
  })

  ipcMain.handle(appIpcChannels.getFileTree, async (_event, value: unknown) => {
    const options = getFileTreeOptions(value)
    return runWithGitContainer(options.container, () => getFileTree(options.cwd ?? process.cwd()))
  })

  ipcMain.handle(appIpcChannels.getFileContents, async (_event, value: unknown) => {
    const options = getFileContentsOptions(value)
    return runWithGitContainer(options.container, () =>
      readFileContents(options.cwd ?? process.cwd(), options.path)
    )
  })

  ipcMain.handle(appIpcChannels.writeFileContents, async (_event, value: unknown) => {
    const options = getWriteFileContentsOptions(value)
    return runWithGitContainer(options.container, () =>
      writeEditableFile(
        options.cwd ?? process.cwd(),
        options.path,
        options.contents,
        options.expectedVersion
      )
    )
  })

  ipcMain.handle(appIpcChannels.getRecentGitCommitMessages, async (_event, value: unknown) => {
    const options = getGitRecentCommitMessagesOptions(value)
    return runWithGitContainer(options.container, () =>
      getRecentGitCommitMessages(options.cwd ?? process.cwd(), options.limit ?? 3)
    )
  })

  ipcMain.handle(appIpcChannels.getUncommittedGitDiff, async (_event, value: unknown) => {
    const options = getGitDiffOptions(value)
    return runWithGitContainer(options.container, () =>
      getUncommittedGitDiff(options.cwd ?? process.cwd())
    )
  })

  ipcMain.handle(appIpcChannels.getGitFileDiff, async (_event, value: unknown) => {
    const options = getGitFileDiffOptions(value)
    return runWithGitContainer(options.container, () =>
      getGitFileDiff(options.cwd ?? process.cwd(), options.path, options.previousPath)
    )
  })

  ipcMain.handle(appIpcChannels.getUncommittedGitPatchChanges, async (_event, value: unknown) => {
    const options = getGitUncommittedPatchChangesOptions(value)
    return runWithGitContainer(options.container, () =>
      getUncommittedGitPatchChanges(options.cwd ?? process.cwd(), options.patches)
    )
  })

  ipcMain.handle(appIpcChannels.commitGitChanges, async (_event, value: unknown) => {
    const options = getGitCommitOptions(value)
    return runWithGitContainer(options.container, () =>
      commitGitChanges(
        options.cwd ?? process.cwd(),
        options.files,
        options.message,
        options.action ?? 'commit',
        options.patches
      )
    )
  })

  ipcMain.handle(appIpcChannels.pullGitChanges, async (_event, value: unknown) => {
    const options = getGitSyncOptions(value)
    return runWithGitContainer(options.container, () =>
      pullGitChanges(options.cwd ?? process.cwd(), options.strategy, options.rememberStrategy)
    )
  })

  ipcMain.handle(appIpcChannels.pushGitChanges, async (_event, value: unknown) => {
    const options = getGitSyncOptions(value)
    return runWithGitContainer(options.container, () =>
      pushGitChanges(options.cwd ?? process.cwd())
    )
  })

  ipcMain.handle(appIpcChannels.selectFolder, async (event, options: unknown) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const folderOptions =
      options && typeof options === 'object' && !Array.isArray(options)
        ? (options as { defaultPath?: unknown })
        : {}

    const dialogOptions = {
      defaultPath: getDefaultPath(folderOptions.defaultPath),
      properties: ['openDirectory']
    } satisfies Electron.OpenDialogOptions

    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle(appIpcChannels.getProjectIcon, async (_event, value: unknown) => {
    const options = getProjectIconOptions(value)
    return getAppProjectIcon(options.cwd ?? null)
  })

  ipcMain.handle(appIpcChannels.selectProjectIcon, async (event, value: unknown) => {
    const options = getProjectIconOptions(value)
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico']
        }
      ]
    } satisfies Electron.OpenDialogOptions
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled) return null

    const sourcePath = result.filePaths[0]
    if (!sourcePath) return null

    const copiedPath = await copyProjectIcon(sourcePath)
    if (options.persist !== false) {
      await setStoredProjectIcon(options.cwd ?? null, copiedPath)
      return getAppProjectIcon(options.cwd ?? null)
    }

    const image = await getProjectIconFile(copiedPath)
    if (!image) throw new Error('Unable to load the selected project image')
    return {
      cwd: options.cwd ?? null,
      dataUrl: image.dataUrl,
      selectionId: rememberPendingProjectIconSelection(copiedPath),
      updatedAt: image.updatedAt
    }
  })

  ipcMain.handle(appIpcChannels.selectMessageAttachments, async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      properties: ['openFile', 'multiSelections']
    } satisfies Electron.OpenDialogOptions
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled) return []
    if (result.filePaths.length > maxMessageAttachmentCount) {
      throw new Error(`Choose up to ${maxMessageAttachmentCount} files at a time.`)
    }

    return Promise.all(
      result.filePaths.map(async (path): Promise<AppSelectedAttachment> => {
        const name = basename(path)
        if (!messageImageExtensions.has(extname(path).toLocaleLowerCase())) {
          return { kind: 'file', name, path }
        }

        const image = await getImageFile(path, maxLocalImageBytes)
        if (!image) {
          throw new Error('Choose PNG, JPEG, GIF, or WebP images smaller than 32 MB.')
        }

        return {
          kind: 'image',
          dataUrl: getImageDataUrl(image),
          name,
          path
        }
      })
    )
  })

  ipcMain.handle(appIpcChannels.readClipboardText, () => clipboard.readText())

  ipcMain.handle(appIpcChannels.writeClipboardText, (_event, value: unknown) => {
    if (typeof value !== 'string') throw new Error('Invalid clipboard text')
    clipboard.writeText(value)
  })

  ipcMain.handle(appIpcChannels.getClipboardImage, async () => {
    const clipboardImage = clipboard.readImage()
    if (clipboardImage.isEmpty()) return null

    const imageFile = clipboardImage.toPNG()
    if (imageFile.byteLength > maxLocalImageBytes) {
      throw new Error('Paste an image smaller than 32 MB.')
    }

    const imageDirectory = join(app.getPath('temp'), 'sele-message-images')
    const imageName = 'Pasted image.png'
    const imagePath = join(imageDirectory, `pasted-image-${randomUUID()}.png`)
    await mkdir(imageDirectory, { recursive: true })
    await writeFile(imagePath, imageFile)

    return {
      kind: 'image',
      dataUrl: `data:image/png;base64,${imageFile.toString('base64')}`,
      name: imageName,
      path: imagePath
    } satisfies AppSelectedImage
  })

  ipcMain.handle(appIpcChannels.getLocalImage, async (_event, value: unknown) => {
    const options = getLocalImageOptions(value)
    return runWithGitContainer(options.container, () =>
      getLocalImage(options.cwd ?? null, options.path, options.relativeTo)
    )
  })

  ipcMain.handle(appIpcChannels.copyLocalImage, async (_event, value: unknown) => {
    const options = getLocalImageOptions(value)
    const image = await runWithGitContainer(options.container, () =>
      getLocalImage(options.cwd ?? null, options.path, options.relativeTo)
    )
    const clipboardImage = nativeImage.createFromBuffer(Buffer.from(image.data))
    if (clipboardImage.isEmpty()) throw new Error('Unable to copy this image.')
    clipboard.writeImage(clipboardImage)
  })

  ipcMain.handle(appIpcChannels.saveLocalImage, async (event, value: unknown) => {
    const options = getLocalImageOptions(value)
    if (options.container?.kind === 'container' && options.container.tool === 'ssh') {
      const image = await runWithGitContainer(options.container, () =>
        getLocalImage(options.cwd ?? null, options.path, options.relativeTo)
      )
      const extension = extname(options.path).slice(1)
      const dialogOptions = {
        defaultPath: join(app.getPath('downloads'), basename(options.path)),
        filters: extension ? [{ name: 'Image', extensions: [extension] }] : undefined
      } satisfies Electron.SaveDialogOptions
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const result = browserWindow
        ? await dialog.showSaveDialog(browserWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (result.canceled || !result.filePath) return null

      await writeFile(result.filePath, Buffer.from(image.data))
      return result.filePath
    }

    const sourcePath = await resolveLocalImagePath(
      options.cwd ?? null,
      options.path,
      options.relativeTo
    )
    const image = await getImageFile(sourcePath, maxLocalImageBytes)
    if (!image) throw new Error('Unable to save this image.')

    const extension = extname(sourcePath).slice(1)
    const dialogOptions = {
      defaultPath: join(app.getPath('downloads'), basename(sourcePath)),
      filters: extension ? [{ name: 'Image', extensions: [extension] }] : undefined
    } satisfies Electron.SaveDialogOptions
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const result = browserWindow
      ? await dialog.showSaveDialog(browserWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) return null
    if (resolve(result.filePath) !== resolve(sourcePath)) {
      await copyFile(sourcePath, result.filePath)
    }
    return result.filePath
  })
}
