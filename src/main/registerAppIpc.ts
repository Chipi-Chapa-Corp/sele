import { watchWorkspace, publishWorkspace } from './workspaceEvents'
import { appGitHubPullRequestStates } from '../shared/app'
import {
  getGitHubPullRequest,
  getGitHubPullRequestManagement,
  getGitHubPullRequestCommitChanges,
  performGitHubPullRequestAction,
  gitHubPullRequestActionSchema,
  listGitHubPullRequests,
  getGitHubPullRequestChanges,
  submitGitHubPullRequestReview,
  gitHubPullRequestReviewSchema
} from './githubPullRequests'
import { bufferedCommands } from './BufferedCommandWorker'
import { PastedImageStore } from './pastedImages'
import { prepareMessageAttachments } from './messageAttachments'
import { getVideoMimeType } from '../shared/video'
import { copyVideoFile } from './videoClipboard'
import { writeClipboardImage } from './imageClipboard'
import { diagnosticLog, handleLoggedIpc, handleClientRequest } from './logging'
import { AsyncLocalStorage } from 'node:async_hooks'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, nativeTheme, shell } from 'electron'
import type {
  AppColorScheme,
  AppAddProjectOptions,
  AppContainerTarget,
  AppCreateSshEnvironmentOptions,
  AppExternalLinkAction,
  AppExternalLinkOptions,
  AppExternalLinkResult,
  AppFileContentsOptions,
  AppGitCommitAction,
  AppGitBranchesOptions,
  AppGitHubPullRequestsOptions,
  AppGitHubPullRequestOptions,
  AppGitBranchesResult,
  AppGitDeleteBranchResult,
  AppGitDeleteBranchScope,
  AppGitCreateWorktreeOptions,
  AppGitCreateWorktreeResult,
  AppGitFileDiffOptions,
  AppGitChangesResult,
  AppGitChangeKind,
  AppGitChangesOptions,
  AppGitCommitMessageContextResult,
  AppGitFileChange,
  AppGitPullStrategy,
  AppGitPushTarget,
  AppGitRecoverableFailure,
  AppLocalImage,
  AppLocalImageOptions,
  AppProjectIcon,
  AppSelectedAttachment,
  AppSelectedImage,
  AppSourceAvailabilityOptions,
  AppUpdateSshEnvironmentOptions,
  AppWriteFileContentsOptions,
  AppWindowState
} from '../shared/app'
import {
  appGitCommitMessageLargeChangeLineThreshold,
  appIpcChannels,
  isAppProjectIconKind,
  normalizeAppWindowZoomLevel
} from '../shared/app'
import { isExpectedCommandAbsenceError } from '../shared/expectedAbsence.ts'
import { requireContainerTarget } from './containerTarget'
import { getCurrentContainerTarget, isCurrentContainerTarget } from './currentContainer'
import {
  getProjectIcon as getStoredProjectIcon,
  setProjectIcon as setStoredProjectIcon
} from './database/projectIcons'
import {
  addProject as addStoredProject,
  deleteProject as deleteStoredProject,
  getDeletedProjectCwds as getStoredDeletedProjectCwds,
  getProjects as getStoredProjects,
  setProjectOrder as setStoredProjectOrder
} from './database/projects'
import {
  createSshEnvironment as createStoredSshEnvironment,
  deleteSshEnvironment as deleteStoredSshEnvironment,
  getSshEnvironments as getStoredSshEnvironments,
  updateSshEnvironment as updateStoredSshEnvironment
} from './database/sshEnvironments'
import { setStoredCwdMetadata } from './database/cwd'
import { getContainerSuggestions } from './containerSuggestions'
import { showFileInFileManager } from './fileManager'
import { getFileTargetGitCwd, resolveFileTargetPath } from './fileTarget'
import {
  createFileTreeListing,
  createFileTreeResult,
  type FileTreePaths,
  parseTargetFileTreePaths,
  readLocalFileTreePaths,
  targetFileTreeScript
} from './fileTree'
import { summarizeGitNumstat } from './gitCommitMessage'
import { limitVisibleUntrackedGitFiles } from './gitChanges'
import { stageGitFileDiffPaths } from './gitFileDiff'
import { fetchGitRemote } from './gitRemoteFetch'
import {
  getGitCommitCounts,
  getNoUpstreamPushFailure,
  getPushDefaultForTarget,
  getPushToCurrentBranchArgs,
  getPushToUpstreamBranchArgs,
  getSameNameUpstreamPushArgs,
  getUpstreamBranchMismatchPushFailure,
  isNoUpstreamPushFailure,
  isUpstreamBranchMismatchPushFailure,
  selectGitPushRemote
} from './gitSync'
import { getHostCommand, isRunningInFlatpak } from './hostProcess'
import { loadOptionalFile, logUnexpectedOptionalGitProbeFailure } from './optionalProbe'
import { getSourceAvailability } from './providerAvailability'
import { getProcessFailureMessage } from './processFailure'
import { openExternalLink } from './externalLink'
import { browserIpcChannels } from '../shared/browser'

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

const getOptionsRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

const getGitTarget = (options: Record<string, unknown>): AppGitBranchesOptions => ({
  container: requireContainerTarget(options.container, { optional: true }),
  cwd: getDefaultPath(options.cwd)
})

const externalLinkProtocols = new Set(['http:', 'https:', 'file:', 'mailto:', 'tel:'])
const maxExternalLinkLength = 8_192

const isExternalLinkAction = (value: unknown): value is AppExternalLinkAction =>
  value === 'copy' || value === 'open'

const getExternalLinkOptions = (value: unknown): AppExternalLinkOptions => {
  const options = getOptionsRecord(value, 'Invalid external link options')
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
const maxLocalVideoBytes = 128 * 1024 * 1024
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

const getProjectIconOptions = (value: unknown): { cwd: string | null; persist?: boolean } => {
  const options = getOptionsRecord(value, 'Invalid project icon options')
  if (options.persist != null && typeof options.persist !== 'boolean') {
    throw new Error('Invalid project icon persistence option')
  }

  return {
    cwd: getOptionalCwd(options.cwd),
    ...(options.persist == null ? {} : { persist: options.persist })
  }
}

const getProjectOrderCwds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new Error('Invalid project order')
  }

  const cwds: string[] = []
  for (const candidate of value) {
    const cwd = getOptionalCwd(candidate)
    if (!cwd) throw new Error('Invalid project order')
    cwds.push(cwd)
  }
  return Array.from(new Set(cwds))
}

const getAddProjectOptions = (value: unknown): AppAddProjectOptions => {
  const options = getOptionsRecord(value, 'Invalid project options')
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
  const options = getOptionsRecord(value, 'Invalid SSH environment options')
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
  const id = getOptionsRecord(value, 'Invalid SSH environment options').id
  if (typeof id !== 'string' || !id || id.length > 128 || /[\0\r\n]/.test(id)) {
    throw new Error('Invalid SSH environment id')
  }

  return id
}

const getUpdateSshEnvironmentOptions = (value: unknown): AppUpdateSshEnvironmentOptions => ({
  ...getCreateSshEnvironmentOptions(value),
  id: getSshEnvironmentId(value)
})

const validateSshIdentityFile = async (identityFile?: string | null): Promise<void> => {
  if (!identityFile) return

  const identityStat = await stat(identityFile).catch((error: unknown) => {
    console.warn('Unable to inspect the configured SSH identity file', error)
    return null
  })
  if (!identityStat?.isFile()) throw new Error('SSH identity file does not exist')
}

const getLocalMediaOptions = (value: unknown): AppLocalImageOptions & { cwd: string | null } => {
  const options = getOptionsRecord(value, 'Invalid local media options')
  if (
    typeof options.path !== 'string' ||
    options.path.length === 0 ||
    options.path.includes('\0')
  ) {
    throw new Error('Invalid local media path')
  }

  const cwd = getOptionalCwd(options.cwd)
  if (!isAbsolute(options.path) && !cwd)
    throw new Error('A cwd is required for relative media paths')
  if (
    options.relativeTo !== undefined &&
    options.relativeTo !== 'cwd' &&
    options.relativeTo !== 'repository'
  ) {
    throw new Error('Invalid local media path base')
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

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const getLocalImageMimeType = (imagePath: string, file: Buffer): string | null => {
  const knownMimeType = getImageMimeType(imagePath)
  if (knownMimeType) return knownMimeType

  // Some tools save PNGs under names such as MakeHuman's `.thumb` files.
  return file.subarray(0, pngSignature.length).equals(pngSignature) ? 'image/png' : null
}

const getImageFile = async (
  imagePath: string,
  maxBytes: number,
  kind: 'image' | 'video' = 'image'
): Promise<AppLocalImage | null> => {
  const imageStat = await stat(imagePath)
  if (!imageStat.isFile() || imageStat.size > maxBytes) return null

  const file = await readFile(imagePath)
  const mimeType =
    kind === 'video' ? getVideoMimeType(imagePath) : getLocalImageMimeType(imagePath, file)
  if (!mimeType) return null
  return {
    data: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    mimeType,
    updatedAt: imageStat.mtimeMs
  }
}

const getImageDataUrl = (image: AppLocalImage): string =>
  `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`

const getMessageAttachments = async (paths: string[]): Promise<AppSelectedAttachment[]> =>
  Promise.all(
    paths.map(async (path): Promise<AppSelectedAttachment> => {
      const fileStat = await stat(path).catch((error: unknown) => {
        console.warn('Unable to inspect a selected attachment', error)
        return null
      })
      if (!fileStat) throw new Error('Unable to read one of the selected files.')
      if (!fileStat.isFile()) throw new Error('Only files can be attached to a message.')

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

const getProjectIconFile = async (
  imagePath: string
): Promise<{ dataUrl: string; updatedAt: number } | null> => {
  const image = await getImageFile(imagePath, maxProjectIconBytes)
  return image ? { dataUrl: getImageDataUrl(image), updatedAt: image.updatedAt } : null
}

const resolveLocalMediaPath = async (
  cwd: string | null,
  path: string,
  relativeTo: AppLocalImageOptions['relativeTo']
): Promise<string> => {
  let imagePath = path

  if (!isAbsolute(imagePath)) {
    if (relativeTo === 'cwd') return resolve(cwd ?? process.cwd(), imagePath)

    const repositoryRoot = await runGit(cwd ?? process.cwd(), ['rev-parse', '--show-toplevel'])
    imagePath = resolve(repositoryRoot ?? cwd ?? process.cwd(), imagePath)
  }

  return imagePath
}

const getLocalMedia = async (
  cwd: string | null,
  path: string,
  relativeTo: AppLocalImageOptions['relativeTo'] = 'repository',
  kind: 'image' | 'video' = 'image'
): Promise<AppLocalImage> => {
  const container = gitCommandContext.getStore()?.container
  if (await shouldReadFilesThroughTarget(container)) {
    return getTargetLocalMedia(container, cwd, path, relativeTo, kind)
  }

  const imagePath = await resolveLocalMediaPath(cwd, path, relativeTo)
  const image = await getImageFile(
    imagePath,
    kind === 'video' ? maxLocalVideoBytes : maxLocalImageBytes,
    kind
  )
  if (!image) throw new Error(`Unable to load this ${kind}.`)
  return image
}

const getAppProjectIcon = async (cwd: string | null): Promise<AppProjectIcon | null> => {
  const customIcon = await getStoredProjectIcon(cwd)
  if (customIcon) {
    const image = await loadOptionalFile(
      () => getProjectIconFile(customIcon.imagePath),
      'Unable to load the configured project icon'
    )
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
    const image = await loadOptionalFile(
      () => getProjectIconFile(join(cwd, relativeIconPath)),
      `Unable to load automatic project icon ${relativeIconPath}`
    )
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
  installedFontFamiliesPromise ??= readInstalledFontFamilies().catch((error: unknown) => {
    if (!isExpectedCommandAbsenceError(error)) {
      console.warn('Unable to read installed font families', error)
    }
    return []
  })
  return installedFontFamiliesPromise
}

type RunGitOptions = {
  env?: NodeJS.ProcessEnv
  required?: boolean
  timeoutMs?: number
}

const gitCommandContext = new AsyncLocalStorage<{ container?: AppContainerTarget | null }>()

const runWithGitContainer = <T>(
  container: AppContainerTarget | null | undefined,
  run: () => T
): T => gitCommandContext.run({ container }, run)

const runGitHub = async (
  cwd: string,
  container: AppContainerTarget | null | undefined,
  args: string[],
  input?: string
): Promise<string> => {
  const command = await getHostCommand('gh', args, {
    cwd,
    container,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' }
  }).catch((cause: unknown) => {
    throw new Error(
      'GitHub CLI was not found. Install gh on the machine hosting this project and run gh auth login.',
      { cause }
    )
  })
  const { error, stdout, stderr } = await bufferedCommands.run(command, {
    input,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024
  })
  if (error) {
    const detail = stderr.trim() || error.message
    const hint =
      error.code === 'ENOENT'
        ? 'Install GitHub CLI and run gh auth login on the machine hosting this project.'
        : error.code === 4 || /gh auth login|not logged|authentication/i.test(detail)
          ? 'Run gh auth login on the machine hosting this project.'
          : ''
    throw new Error(
      [
        input === undefined
          ? 'Unable to load GitHub pull requests.'
          : 'Unable to update the GitHub pull request.',
        hint,
        detail
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
  return stdout
}

// Transfers and remote hooks can take much longer than local repository probes.
const gitRemoteOperationTimeoutMs = 10 * 60_000

const getGitCommandLabel = (args: string[]): string => {
  const optionsWithValues = new Set([
    '-c',
    '--config-env',
    '--exec-path',
    '--git-dir',
    '--namespace',
    '--super-prefix',
    '--work-tree'
  ])
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]?.trim() ?? ''
    if (!argument) continue
    if (optionsWithValues.has(argument)) {
      index += 1
      continue
    }
    if (!argument.startsWith('-')) return `Git ${argument}`
  }
  return 'Git command'
}

const runGit = async (
  cwd: string,
  args: string[],
  options: boolean | RunGitOptions = false
): Promise<string | null> => {
  const runOptions: RunGitOptions = typeof options === 'boolean' ? { required: options } : options
  const container = gitCommandContext.getStore()?.container
  const env = { ...process.env, GIT_MERGE_AUTOEDIT: 'no', ...runOptions.env }
  const hostCommand = await getHostCommand('git', args, { container, cwd, env })
  const timeoutMs = runOptions.timeoutMs ?? 10_000

  const { error, stdout, stderr } = await bufferedCommands.run(hostCommand, {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024
  })
  if (error) {
    if (runOptions.required) {
      throw new Error(
        getProcessFailureMessage(error, stdout, stderr, {
          label: getGitCommandLabel(args),
          timeoutMs
        })
      )
    }
    logUnexpectedOptionalGitProbeFailure(
      args,
      error,
      stderr,
      getProcessFailureMessage(error, stdout, stderr, {
        label: `${getGitCommandLabel(args)} failed during an optional check`,
        timeoutMs
      })
    )
    return null
  }
  return stdout.trimEnd()
}

const getRepositoryRoot = async (cwd: string): Promise<string> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')
  return repositoryRoot
}

const getGitErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isGitPullStrategy = (value: unknown): value is AppGitPullStrategy =>
  value === 'ff-only' || value === 'rebase' || value === 'merge'

const isGitPushTarget = (value: unknown): value is AppGitPushTarget =>
  value === 'current-branch' || value === 'upstream-branch'

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

const getDivergedPullFailure = (command: string, error: string): AppGitRecoverableFailure => ({
  kind: 'pull-diverged',
  title: 'Pull needs a strategy',
  message:
    'Local and remote commits have diverged. Choose whether to rebase your commits or create a merge commit.',
  command,
  error,
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

const getPushRejectedFailure = (command: string, error: string): AppGitRecoverableFailure => ({
  kind: 'push-rejected',
  title: 'Remote changed before push',
  message: 'The remote branch has commits that are not local yet. Pull them before pushing.',
  command,
  error,
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

  const options = value as {
    container?: unknown
    cwd?: unknown
    fetchRemote?: unknown
  }
  if (options.fetchRemote != null && typeof options.fetchRemote !== 'boolean') {
    throw new Error('Invalid Git remote fetch option')
  }

  return {
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: getDefaultPath(options.cwd),
    fetchRemote: options.fetchRemote === true
  }
}

const getSourceAvailabilityOptions = (value: unknown): AppSourceAvailabilityOptions => {
  if (value == null) return {}
  const options = getOptionsRecord(value, 'Invalid source availability options')
  return { container: requireContainerTarget(options.container, { optional: true }) }
}

const getGitTargetOptions =
  (message: string) =>
  (value: unknown): AppGitBranchesOptions =>
    value == null ? {} : getGitTarget(getOptionsRecord(value, message))

const getGitBranchesOptions = getGitTargetOptions('Invalid Git branch options')
const getFileTreeOptions = getGitTargetOptions('Invalid file tree options')
const getGitDiffOptions = getGitTargetOptions('Invalid Git diff options')

const getGitHubPullRequestsOptions = (value: unknown): AppGitHubPullRequestsOptions => {
  const options = getGitBranchesOptions(value)
  const { page, states, search } =
    (value as { page?: unknown; states?: unknown; search?: unknown } | null) ?? {}
  if (
    page !== undefined &&
    (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 || page > 50)
  ) {
    throw new Error('Invalid GitHub pull request page')
  }
  if (
    states !== undefined &&
    (!Array.isArray(states) ||
      states.length > 4 ||
      states.some((state) => !appGitHubPullRequestStates.includes(state)) ||
      new Set(states).size !== states.length)
  ) {
    throw new Error('Invalid GitHub pull request states')
  }
  if (
    search !== undefined &&
    (typeof search !== 'string' || search.length > 256 || search.includes('\0'))
  ) {
    throw new Error('Invalid GitHub pull request search')
  }
  return {
    ...options,
    page: page as number | undefined,
    states: states as AppGitHubPullRequestsOptions['states'],
    search: search as string | undefined
  }
}

const getGitHubPullRequestOptions = (value: unknown): AppGitHubPullRequestOptions => {
  const options = getGitBranchesOptions(value)
  const { number, repository } = (value as { number?: unknown; repository?: unknown } | null) ?? {}
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1)
    throw new Error('Invalid GitHub pull request number')
  if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error('Invalid GitHub repository')
  return { ...options, number, repository }
}

const getGitSwitchBranchOptions = (value: unknown) => {
  const options = getOptionsRecord(value, 'Invalid Git branch switch options')
  const branchName = typeof options.branchName === 'string' ? options.branchName.trim() : ''

  if (!branchName || branchName.includes('\0') || branchName.includes('\n')) {
    throw new Error('Invalid branch name')
  }
  if (options.create != null && typeof options.create !== 'boolean') {
    throw new Error('Invalid Git create branch option')
  }

  return {
    branchName,
    ...getGitTarget(options),
    create: Boolean(options.create)
  }
}

const isGitDeleteBranchScope = (value: unknown): value is AppGitDeleteBranchScope =>
  value === 'local' || value === 'remote' || value === 'both'

const getGitDeleteBranchOptions = (value: unknown) => {
  const options = getOptionsRecord(value, 'Invalid Git branch delete options')
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
    ...getGitTarget(options),
    force: Boolean(options.force),
    removeWorktree: Boolean(options.removeWorktree),
    scope: isGitDeleteBranchScope(options.scope) ? options.scope : null
  }
}

const getGitCreateWorktreeOptions = (value: unknown): AppGitCreateWorktreeOptions => {
  const options = getOptionsRecord(value, 'Invalid Git worktree options')
  const name = typeof options.name === 'string' ? options.name.trim() : ''

  if (!name || name.includes('\0') || name.includes('\n') || name.includes('\r')) {
    throw new Error('Invalid worktree name')
  }

  return { ...getGitTarget(options), name }
}

const getFileContentsOptions = (value: unknown): AppFileContentsOptions => {
  const options = getOptionsRecord(value, 'Invalid file options')
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
  const options = value as Record<string, unknown>

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

const getGitCommitOptions = (value: unknown) => {
  const options = getOptionsRecord(value, 'Invalid Git commit options')
  const action: AppGitCommitAction = options.action === 'amend' ? 'amend' : 'commit'
  const message = typeof options.message === 'string' ? options.message.trim() : ''

  if (action !== 'amend' && !message) throw new Error('Commit message is required')

  return { action, ...getGitTarget(options), message }
}

const getGitSyncOptions = (value: unknown) => {
  const options: Record<string, unknown> =
    value == null ? {} : getOptionsRecord(value, 'Invalid Git sync options')
  const { rememberStrategy, rememberTarget, setUpstream, strategy, target } = options

  if (rememberStrategy != null && typeof rememberStrategy !== 'boolean') {
    throw new Error('Invalid Git remember strategy option')
  }

  if (strategy != null && !isGitPullStrategy(strategy)) {
    throw new Error('Invalid Git pull strategy')
  }

  if (rememberTarget != null && typeof rememberTarget !== 'boolean') {
    throw new Error('Invalid Git remember push target option')
  }

  if (setUpstream != null && typeof setUpstream !== 'boolean') {
    throw new Error('Invalid Git set upstream option')
  }

  if (target != null && !isGitPushTarget(target)) {
    throw new Error('Invalid Git push target')
  }

  return {
    ...getGitTarget(options),
    rememberStrategy: Boolean(rememberStrategy),
    rememberTarget: Boolean(rememberTarget),
    setUpstream: Boolean(setUpstream),
    strategy: isGitPullStrategy(strategy) ? strategy : undefined,
    target: isGitPushTarget(target) ? target : undefined
  }
}

const getGitRecentCommitMessagesOptions = (value: unknown) => {
  const options: Record<string, unknown> =
    value == null ? {} : getOptionsRecord(value, 'Invalid Git commit history options')
  const limit = options.limit

  if (
    limit != null &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20)
  ) {
    throw new Error('Invalid Git commit history limit')
  }

  return { ...getGitTarget(options), limit: limit ?? 3 }
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
  const repositoryRoot = await getRepositoryRoot(cwd)

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

const getGitPushRemote = async (cwd: string, branchName: string): Promise<string> => {
  const [branchPushRemote, defaultPushRemote, branchRemote, remoteOutput] = await Promise.all([
    runGit(cwd, ['config', '--get', `branch.${branchName}.pushRemote`]),
    runGit(cwd, ['config', '--get', 'remote.pushDefault']),
    runGit(cwd, ['config', '--get', `branch.${branchName}.remote`]),
    runGit(cwd, ['remote'], true)
  ])
  const remotes = (remoteOutput ?? '')
    .split('\n')
    .map((remote) => remote.trim())
    .filter(Boolean)
  return selectGitPushRemote(remotes, [branchPushRemote, defaultPushRemote, branchRemote])
}

const getGitUpstreamTarget = async (
  cwd: string,
  branchName: string
): Promise<{ branchName: string; remoteName: string } | null> => {
  const [remoteName, mergeRef] = await Promise.all([
    runGit(cwd, ['config', '--get', `branch.${branchName}.remote`]),
    runGit(cwd, ['config', '--get', `branch.${branchName}.merge`])
  ])
  const normalizedRemoteName = remoteName?.trim()
  const normalizedMergeRef = mergeRef?.trim()
  if (!normalizedRemoteName || !normalizedMergeRef?.startsWith('refs/heads/')) return null

  return {
    branchName: normalizedMergeRef.slice('refs/heads/'.length),
    remoteName: normalizedRemoteName
  }
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
  const repositoryRoot = await getRepositoryRoot(cwd)

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
        timeoutMs: gitRemoteOperationTimeoutMs
      })
    }
  } catch (error) {
    console.error(`Unable to delete Git branch ${branchName}`, error)
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

/** Shared with delayed chat creation; uses the same workspace and container handling as the UI. */
export const createChatGitWorktree = (
  options: AppGitCreateWorktreeOptions
): Promise<AppGitCreateWorktreeResult> =>
  runWithGitContainer(options.container, () =>
    createGitWorktree(options.cwd ?? process.cwd(), options.name)
  )

const createGitWorktree = async (
  cwd: string,
  name: string
): Promise<AppGitCreateWorktreeResult> => {
  const repositoryRoot = await getRepositoryRoot(cwd)

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

const getPorcelainChangeKind = (status: string): AppGitChangeKind => {
  if (status.includes('?')) return 'untracked'
  if (status.includes('R')) return 'rename'
  if (status.includes('A') || status.includes('C')) return 'create'
  if (status.includes('D')) return 'delete'
  return 'edit'
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

const getGitChanges = async (cwd: string, fetchRemote = false): Promise<AppGitChangesResult> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (!repositoryRoot) {
    return {
      repositoryRoot: cwd,
      branchName: null,
      unpulledCount: 0,
      unpushedCount: 0,
      untrackedFilesHiddenForPerformance: false,
      files: []
    }
  }

  const branchName = await getCurrentBranchName(repositoryRoot)
  let remoteFetchError: string | undefined
  if (fetchRemote) {
    try {
      await fetchGitRemote(
        repositoryRoot,
        branchName,
        runGit,
        JSON.stringify(gitCommandContext.getStore()?.container ?? null)
      )
    } catch (error) {
      console.error('[getGitChanges:fetchRemote] Unable to fetch Git remote', error)
      remoteFetchError = getGitErrorMessage(error)
    }
  }
  const { unpulledCount, unpushedCount } = await getGitCommitCounts(
    repositoryRoot,
    branchName,
    runGit
  )

  const status = await runGit(
    repositoryRoot,
    ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
    true
  )

  const visibleChanges = limitVisibleUntrackedGitFiles(parsePorcelainChanges(status ?? ''))

  return {
    repositoryRoot,
    branchName,
    unpulledCount,
    unpushedCount,
    remoteFetchError,
    ...visibleChanges
  }
}

const readFileTreePaths = async (cwd: string): Promise<FileTreePaths> => {
  const container = gitCommandContext.getStore()?.container
  if (!(await shouldReadFilesThroughTarget(container))) return readLocalFileTreePaths(cwd)

  const output = await runTargetFileCommand(
    container,
    cwd,
    ['-lc', targetFileTreeScript, 'sele-list-files', cwd],
    { maxBuffer: 32 * 1024 * 1024 }
  )
  return parseTargetFileTreePaths(output)
}

const maxEditableFileBytes = 2 * 1024 * 1024
const remoteFileMetadataBufferBytes = 16 * 1024

const getFileVersion = (contents: Buffer | string): string =>
  createHash('sha256').update(contents).digest('hex')

const isSshGitTarget = (): boolean => {
  const container = gitCommandContext.getStore()?.container
  return container?.kind === 'container' && container.tool === 'ssh'
}

const runTargetFileCommand = async (
  container: AppContainerTarget | null | undefined,
  cwd: string,
  args: string[],
  options: { input?: Buffer; maxBuffer?: number } = {}
): Promise<Buffer> => {
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

const runSshFileCommand = async (
  cwd: string,
  args: string[],
  options: { input?: Buffer; maxBuffer?: number } = {}
): Promise<Buffer> => {
  const container = gitCommandContext.getStore()?.container
  if (container?.kind !== 'container' || container.tool !== 'ssh') {
    throw new Error('SSH target is required')
  }

  return runTargetFileCommand(container, cwd, args, options)
}

const getRemoteRepositoryFilePath = (
  repositoryRoot: string,
  path: string,
  outsideMessage = 'File is outside the repository'
): string => {
  const absolutePath = isAbsolute(path) ? path : resolve(repositoryRoot, path)
  const relativePath = relative(repositoryRoot, absolutePath).replace(/\\/g, '/')
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    isAbsolute(relativePath)
  ) {
    throw new Error(outsideMessage)
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

const getTargetLocalMedia = async (
  container: AppContainerTarget | null | undefined,
  cwd: string | null,
  path: string,
  relativeTo: AppLocalImageOptions['relativeTo'],
  kind: 'image' | 'video'
): Promise<AppLocalImage> => {
  let commandCwd = cwd ?? '/'
  let imagePath = path
  if (!isAbsolute(imagePath)) {
    if (!cwd) throw new Error('A cwd is required for relative media paths')
    if (relativeTo === 'repository') {
      const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'])
      if (repositoryRoot) {
        commandCwd = repositoryRoot
        imagePath = getRemoteRepositoryFilePath(repositoryRoot, imagePath)
      }
    }
  }

  const maxBytes = kind === 'video' ? maxLocalVideoBytes : maxLocalImageBytes
  const script = [
    'set -eu',
    '[ -f "$1" ] || { echo "Choose a regular media file." >&2; exit 1; }',
    'size=$(wc -c < "$1")',
    `[ "$size" -le ${maxBytes} ] || { echo "Choose a ${kind} smaller than ${maxBytes / 1024 / 1024} MB." >&2; exit 1; }`,
    'printf "%s\\0" "$size"',
    'cat -- "$1"'
  ].join('\n')
  const output = await runTargetFileCommand(
    container,
    commandCwd,
    ['-lc', script, 'sele-read-image', imagePath],
    { maxBuffer: maxBytes + remoteFileMetadataBufferBytes }
  )
  const sizeSeparator = output.indexOf(0)
  if (sizeSeparator < 0) throw new Error('Invalid remote image response')
  const size = Number(output.subarray(0, sizeSeparator).toString('utf8'))
  const file = output.subarray(sizeSeparator + 1)
  if (!Number.isSafeInteger(size) || size < 0 || file.byteLength !== size) {
    throw new Error('Invalid remote image response')
  }
  const mimeType = kind === 'video' ? getVideoMimeType(path) : getLocalImageMimeType(path, file)
  if (!mimeType) throw new Error(`Unable to load this ${kind}.`)

  return {
    data: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    mimeType,
    updatedAt: Date.now()
  }
}

const shouldReadFilesThroughTarget = async (
  container: AppContainerTarget | null | undefined
): Promise<boolean> => {
  if (container?.kind === 'container') {
    return container.tool === 'ssh' || !(await isCurrentContainerTarget(container))
  }

  if (isRunningInFlatpak()) return true
  return Boolean(await getCurrentContainerTarget())
}

const resolveReadableFile = async (
  cwd: string,
  path: string
): Promise<{ absolutePath: string; editable: boolean; gitRepositoryRoot: string | null }> => {
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

  return { absolutePath, editable: true, gitRepositoryRoot }
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

  const { absolutePath } = await resolveReadableFile(cwd, path)
  const currentContents = await readFile(absolutePath)

  if (getFileVersion(currentContents) !== expectedVersion) {
    throw new Error('This file changed on disk. Reload it before saving.')
  }

  await writeFile(absolutePath, contents, 'utf8')
  return { version: getFileVersion(contents) }
}

const copyTargetFile = async (
  container: AppContainerTarget | null | undefined,
  cwd: string,
  path: string,
  destinationPath: string
): Promise<void> => {
  const target = await resolveFileTarget(cwd, path)
  const script = [
    'set -eu',
    '[ -f "$1" ] || { echo "Choose a regular file." >&2; exit 1; }',
    'cat -- "$1"'
  ].join('\n')
  const hostCommand = await getHostCommand(
    'sh',
    ['-lc', script, 'sele-copy-file', target.absolutePath],
    {
      container,
      cwd: target.commandCwd,
      env: process.env
    }
  )
  const child = spawn(hostCommand.file, hostCommand.args, {
    cwd: hostCommand.cwd,
    env: hostCommand.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const stderrChunks: Buffer[] = []
  let stderrBytes = 0

  child.stderr.on('data', (chunk: Buffer) => {
    if (stderrBytes >= remoteFileMetadataBufferBytes) return
    const remainingBytes = remoteFileMetadataBufferBytes - stderrBytes
    const capturedChunk = chunk.subarray(0, remainingBytes)
    stderrChunks.push(capturedChunk)
    stderrBytes += capturedChunk.byteLength
  })

  const processCompleted = new Promise<void>((resolveProcess, rejectProcess) => {
    child.once('error', rejectProcess)
    child.once('close', (code) => {
      if (code === 0) {
        resolveProcess()
        return
      }

      const detail = Buffer.concat(stderrChunks).toString('utf8').trim()
      rejectProcess(new Error(detail || 'Unable to read this file.'))
    })
  })

  try {
    await Promise.all([
      pipeline(child.stdout, createWriteStream(destinationPath)),
      processCompleted
    ])
  } catch (error) {
    child.kill()
    throw error
  }
}

const shouldStageFileForSystemApp = async (
  container: AppContainerTarget | null | undefined
): Promise<boolean> =>
  Boolean(
    container?.kind === 'container' &&
      (container.tool === 'ssh' || !(await isCurrentContainerTarget(container)))
  )

const getFileOpenPath = async (options: AppFileContentsOptions): Promise<string> => {
  const cwd = options.cwd ?? process.cwd()
  if (!(await shouldStageFileForSystemApp(options.container))) {
    return (await resolveFileTarget(cwd, options.path)).absolutePath
  }

  const tempDirectory = await mkdtemp(join(tmpdir(), 'sele-open-file-'))
  const openPath = join(tempDirectory, basename(options.path) || 'file')
  try {
    await copyTargetFile(options.container, cwd, options.path, openPath)
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true }).catch((cleanupError: unknown) => {
      console.warn('Unable to remove a staged system-app file after a copy failure', cleanupError)
    })
    throw error
  }

  return openPath
}

const openFileInSystemApp = async (options: AppFileContentsOptions): Promise<void> => {
  const openError = await shell.openPath(await getFileOpenPath(options))
  if (openError) throw new Error(openError)
}

const downloadFile = async (
  event: Electron.IpcMainInvokeEvent,
  options: AppFileContentsOptions
): Promise<string | null> => {
  const dialogOptions = {
    defaultPath: join(app.getPath('downloads'), basename(options.path) || 'download')
  } satisfies Electron.SaveDialogOptions
  const result = await dialog.showSaveDialog(getBrowserWindow(event), dialogOptions)
  if (result.canceled || !result.filePath) return null

  const tempDirectory = await mkdtemp(join(tmpdir(), 'sele-download-file-'))
  const tempPath = join(tempDirectory, basename(options.path) || 'download')
  try {
    await copyTargetFile(options.container, options.cwd ?? process.cwd(), options.path, tempPath)
    await copyFile(tempPath, result.filePath)
    return result.filePath
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch((error: unknown) => {
      console.warn('Unable to remove a temporary downloaded-file directory', error)
    })
  }
}

const showFileInFolder = async (options: AppLocalImageOptions): Promise<void> => {
  const cwd = options.cwd ?? process.cwd()
  const absolutePath =
    isAbsolute(options.path) || options.relativeTo === 'cwd'
      ? resolve(cwd, options.path)
      : (await resolveFileTarget(cwd, options.path)).absolutePath
  await showFileInFileManager(options.container, absolutePath)
}

const getRecentGitCommitMessages = async (
  cwd: string,
  limit: number
): Promise<{ messages: string[] }> => {
  const repositoryRoot = await getRepositoryRoot(cwd)

  const output = await runGit(repositoryRoot, ['log', `--max-count=${limit}`, '--format=%s'])

  return {
    messages:
      output
        ?.split('\n')
        .map((message) => message.trim())
        .filter(Boolean) ?? []
  }
}

const normalizePatchPath = (repositoryRoot: string, path: string): string =>
  getRemoteRepositoryFilePath(repositoryRoot, path, `Patch path is outside the repository: ${path}`)

const getTemporaryIndexEnv = (indexPath: string): NodeJS.ProcessEnv => ({
  GIT_INDEX_FILE: indexPath
})

const withTemporaryGitIndex = async <Result>(
  repositoryRoot: string,
  label: string,
  run: (indexPath: string) => Promise<Result>
): Promise<Result> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'sele-git-index-'))
  const indexPath = join(tempDirectory, 'index')

  try {
    const head = await runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])
    await runGit(repositoryRoot, head ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], {
      env: getTemporaryIndexEnv(indexPath),
      required: true
    })
    return await run(indexPath)
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch((error: unknown) => {
      console.warn(`Unable to remove a temporary ${label} directory`, error)
    })
  }
}

const getGitCommitMessageContext = async (
  cwd: string
): Promise<AppGitCommitMessageContextResult> => {
  const repositoryRoot = await getRepositoryRoot(cwd)

  return withTemporaryGitIndex(repositoryRoot, 'Git commit-context', async (indexPath) => {
    const env = getTemporaryIndexEnv(indexPath)
    await runGit(repositoryRoot, ['add', '-A', '--', '.'], { env, required: true })

    const numstat = await runGit(
      repositoryRoot,
      ['diff', '--cached', '--numstat', '-z', '--find-renames'],
      { env, required: true }
    )
    const summary = summarizeGitNumstat(numstat ?? '')
    const diff =
      summary.totalChangedLines <= appGitCommitMessageLargeChangeLineThreshold
        ? await runGit(
            repositoryRoot,
            [
              'diff',
              '--cached',
              '--no-textconv',
              '--no-ext-diff',
              '--full-index',
              '--find-renames'
            ],
            { env, required: true }
          )
        : null

    return {
      ...summary,
      diff: diff?.replace(/^Binary files .+ differ$/gm, 'BINARY') ?? null
    }
  })
}

const getGitFileDiff = async (
  cwd: string,
  path: string,
  previousPath?: string | null
): Promise<{ diff: string }> => {
  const target = await resolveFileTarget(cwd, path)
  const repositoryRoot = await getRepositoryRoot(target.commandCwd)

  const paths = [
    normalizePatchPath(repositoryRoot, target.absolutePath),
    ...(previousPath ? [normalizePatchPath(repositoryRoot, previousPath)] : [])
  ]
  return withTemporaryGitIndex(repositoryRoot, 'Git file-diff', async (indexPath) => {
    const env = getTemporaryIndexEnv(indexPath)
    await stageGitFileDiffPaths(repositoryRoot, indexPath, paths, runGit)

    const diff = await runGit(
      repositoryRoot,
      [
        '--literal-pathspecs',
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
  })
}

const commitGitChanges = async (
  cwd: string,
  message: string,
  action: AppGitCommitAction
): Promise<{ commitHash: string; pushed: boolean }> => {
  const repositoryRoot = await getRepositoryRoot(cwd)
  const options = { required: true, timeoutMs: 120_000 }

  await runGit(repositoryRoot, ['add', '-A', '--', '.'], options)
  await runGit(
    repositoryRoot,
    action === 'amend' ? ['commit', '--amend', '--no-edit'] : ['commit', '-m', message],
    options
  )

  const commitHash = await runGit(repositoryRoot, ['rev-parse', 'HEAD'], true)
  if (!commitHash) throw new Error('Unable to read commit hash')

  return { commitHash, pushed: false }
}

const pushGitChanges = async (
  cwd: string,
  setUpstream = false,
  target?: AppGitPushTarget,
  rememberTarget = false
): Promise<{ pushed: boolean; failure?: AppGitRecoverableFailure | null }> => {
  const repositoryRoot = await getRepositoryRoot(cwd)
  if (setUpstream && target) throw new Error('Cannot set an upstream and choose a push target.')
  if (rememberTarget && !target) {
    throw new Error('Cannot remember a push target without choosing one.')
  }

  if (rememberTarget && target) {
    await runGit(
      repositoryRoot,
      ['config', '--local', 'push.default', getPushDefaultForTarget(target)],
      true
    )
  }

  let args = ['push']
  if (setUpstream) {
    const branchName = await getCurrentBranchName(repositoryRoot)
    if (!branchName) throw new Error('Cannot set an upstream while HEAD is detached.')

    const remoteName = await getGitPushRemote(repositoryRoot, branchName)
    args = getSameNameUpstreamPushArgs(remoteName, branchName)
  } else if (target) {
    const branchName = await getCurrentBranchName(repositoryRoot)
    if (!branchName) throw new Error('Cannot choose a push target while HEAD is detached.')

    if (target === 'current-branch') {
      const remoteName = await getGitPushRemote(repositoryRoot, branchName)
      args = rememberTarget
        ? getSameNameUpstreamPushArgs(remoteName, branchName)
        : getPushToCurrentBranchArgs(remoteName)
    } else {
      const upstream = await getGitUpstreamTarget(repositoryRoot, branchName)
      if (!upstream) throw new Error(`The local branch ${branchName} has no configured upstream.`)
      args = getPushToUpstreamBranchArgs(upstream.remoteName, upstream.branchName)
    }
  }

  try {
    await runGit(repositoryRoot, args, {
      required: true,
      timeoutMs: gitRemoteOperationTimeoutMs
    })
  } catch (error) {
    const message = getGitErrorMessage(error)
    if (!setUpstream && isNoUpstreamPushFailure(message)) {
      console.warn('Git push requires an upstream selection', error)
      const branchName = await getCurrentBranchName(repositoryRoot)
      if (branchName) {
        return {
          pushed: false,
          failure: getNoUpstreamPushFailure(branchName, `git ${args.join(' ')}`, message)
        }
      }
    }

    if (!setUpstream && !target && isUpstreamBranchMismatchPushFailure(message)) {
      console.warn('Git push found an upstream branch name mismatch', error)
      const branchName = await getCurrentBranchName(repositoryRoot)
      const upstream = branchName ? await getGitUpstreamTarget(repositoryRoot, branchName) : null
      if (branchName && upstream) {
        return {
          pushed: false,
          failure: getUpstreamBranchMismatchPushFailure(
            branchName,
            upstream.branchName,
            `git ${args.join(' ')}`,
            message
          )
        }
      }
    }

    if (isPushRejectedFailure(message)) {
      return {
        pushed: false,
        failure: getPushRejectedFailure(`git ${args.join(' ')}`, message)
      }
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
  if (strategy === 'ff-only') return

  await runGit(repositoryRoot, ['config', 'pull.rebase', String(strategy === 'rebase')], true)
  await runGit(repositoryRoot, ['config', '--unset-all', 'pull.ff'])
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
  const repositoryRoot = await getRepositoryRoot(cwd)

  if (rememberStrategy && strategy) {
    await rememberGitPullStrategy(repositoryRoot, strategy)
  }

  const args = await getGitPullArgs(repositoryRoot, strategy)

  try {
    await runGit(repositoryRoot, args, {
      required: true,
      timeoutMs: gitRemoteOperationTimeoutMs
    })
  } catch (error) {
    const message = getGitErrorMessage(error)
    if ((strategy == null || strategy === 'ff-only') && isDivergedPullFailure(message)) {
      console.warn('Git pull requires a divergence strategy', error)
      return {
        pulled: false,
        failure: getDivergedPullFailure(`git ${args.join(' ')}`, message)
      }
    }

    throw new Error(message)
  }

  return { pulled: true, failure: null }
}

const showOpenDialog = (
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> => {
  const browserWindow = BrowserWindow.fromWebContents(event.sender)
  return browserWindow
    ? dialog.showOpenDialog(browserWindow, options)
    : dialog.showOpenDialog(options)
}

const handleGitRequest = <Options extends AppGitBranchesOptions>(
  channel: string,
  getOptions: (value: unknown) => Options,
  run: (cwd: string, options: Options) => unknown
): void =>
  handleClientRequest(channel, (_event, value) => {
    const options = getOptions(value)
    return runWithGitContainer(options.container, () => run(options.cwd ?? process.cwd(), options))
  })

const handleGitHubRequest = <Options extends AppGitBranchesOptions>(
  channel: string,
  getOptions: (value: unknown) => Options,
  run: (
    cwd: string,
    options: Options,
    git: typeof runGit,
    gitHub: (args: string[], input?: string) => Promise<string>
  ) => unknown
): void =>
  handleGitRequest(channel, getOptions, (cwd, options) =>
    run(cwd, options, runGit, (args, input) => runGitHub(cwd, options.container, args, input))
  )

export const registerAppIpc = (): void => {
  handleLoggedIpc(appIpcChannels.exportDiagnosticLog, async (event) => {
    const window = getBrowserWindow(event)
    const result = await dialog.showSaveDialog(window, {
      title: 'Save diagnostic log',
      defaultPath: `sele-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
      filters: [{ name: 'Log files', extensions: ['log'] }]
    })
    if (result.canceled || !result.filePath) return null
    try {
      if (
        [diagnosticLog.path, `${diagnosticLog.path}.1`].some(
          (path) => resolve(path) === resolve(result.filePath!)
        )
      ) {
        throw new Error('Choose a different location from the active diagnostic log')
      }
      await writeFile(result.filePath, diagnosticLog.snapshot(), { mode: 0o600 })
      return result.filePath
    } catch (error) {
      await dialog.showMessageBox(window, {
        type: 'error',
        title: 'Unable to save diagnostic log',
        message: 'The diagnostic log could not be saved. Try another location.'
      })
      throw error
    }
  })
  handleLoggedIpc(appIpcChannels.getColorScheme, getColorScheme)

  handleLoggedIpc(appIpcChannels.getInstalledFontFamilies, getInstalledFontFamilies)

  handleClientRequest(appIpcChannels.getDefaultCwd, () => process.cwd())

  handleClientRequest(appIpcChannels.getProjects, (event) => {
    watchWorkspace(event.sender)
    return getStoredProjects()
  })
  handleClientRequest(appIpcChannels.getDeletedProjectCwds, () => getStoredDeletedProjectCwds())
  handleClientRequest(appIpcChannels.deleteProject, async (_event, value: unknown) => {
    const cwd = getOptionalCwd(value)
    if (!cwd) throw new Error('Invalid project cwd')
    const result = await deleteStoredProject(cwd)
    publishWorkspace()
    return result
  })

  handleClientRequest(appIpcChannels.addProject, async (_event, value: unknown) => {
    const options = getAddProjectOptions(value)
    const cwds = [options.cwd, ...(options.additionalCwds ?? [])]
    const cwdStats = await Promise.all(
      cwds.map((cwd) =>
        stat(cwd).catch((error: unknown) => {
          console.warn('Unable to inspect a project directory', error)
          return null
        })
      )
    )
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

    publishWorkspace()
    return project
  })

  handleClientRequest(appIpcChannels.setProjectOrder, async (_event, value: unknown) => {
    const result = await setStoredProjectOrder(getProjectOrderCwds(value))
    publishWorkspace()
    return result
  })

  handleClientRequest(appIpcChannels.getSshEnvironments, () => getStoredSshEnvironments())

  handleClientRequest(appIpcChannels.createSshEnvironment, async (_event, value: unknown) => {
    const options = getCreateSshEnvironmentOptions(value)
    await validateSshIdentityFile(options.identityFile)

    const result = await createStoredSshEnvironment(options)
    publishWorkspace()
    return result
  })

  handleClientRequest(appIpcChannels.updateSshEnvironment, async (_event, value: unknown) => {
    const options = getUpdateSshEnvironmentOptions(value)
    await validateSshIdentityFile(options.identityFile)

    const result = await updateStoredSshEnvironment(options)
    publishWorkspace()
    return result
  })

  handleClientRequest(appIpcChannels.deleteSshEnvironment, async (_event, value: unknown) => {
    await deleteStoredSshEnvironment(getSshEnvironmentId(value))
    publishWorkspace()
  })

  handleLoggedIpc(appIpcChannels.selectSshIdentityFile, async (event) => {
    const result = await showOpenDialog(event, {
      title: 'Choose SSH identity file',
      properties: ['openFile']
    })

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handleClientRequest(appIpcChannels.getContainerSuggestions, (_event, value: unknown) =>
    getContainerSuggestions(getSourceAvailabilityOptions(value))
  )

  handleClientRequest(appIpcChannels.getSourceAvailability, (_event, value: unknown) =>
    getSourceAvailability(getSourceAvailabilityOptions(value))
  )

  handleLoggedIpc(appIpcChannels.getWindowState, (event) =>
    getAppWindowState(getBrowserWindow(event))
  )

  handleLoggedIpc(appIpcChannels.minimizeWindow, (event) => {
    getBrowserWindow(event).minimize()
  })

  handleLoggedIpc(appIpcChannels.toggleWindowMaximized, (event) => {
    const window = getBrowserWindow(event)
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()

    const state = getAppWindowState(window)
    sendAppWindowState(window)
    return state
  })

  handleLoggedIpc(appIpcChannels.closeWindow, (event) => {
    getBrowserWindow(event).close()
  })

  handleLoggedIpc(appIpcChannels.setWindowZoomLevel, (event, value: unknown) => {
    getBrowserWindow(event).webContents.setZoomLevel(normalizeAppWindowZoomLevel(value))
  })

  handleLoggedIpc(appIpcChannels.handleExternalLink, async (event, value: unknown) => {
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

    if (action === 'copy') clipboard.writeText(options.url)
    else await openExternalLink(options.url)
    return { action, always } satisfies AppExternalLinkResult
  })

  handleGitRequest(appIpcChannels.getGitChanges, getGitChangesOptions, (cwd, options) =>
    getGitChanges(cwd, options.fetchRemote)
  )

  handleGitHubRequest(
    appIpcChannels.getGitHubPullRequests,
    getGitHubPullRequestsOptions,
    listGitHubPullRequests
  )

  handleGitHubRequest(
    appIpcChannels.getGitHubPullRequest,
    getGitHubPullRequestOptions,
    getGitHubPullRequest
  )

  handleGitHubRequest(
    appIpcChannels.getGitHubPullRequestChanges,
    getGitHubPullRequestOptions,
    getGitHubPullRequestChanges
  )

  handleGitHubRequest(
    appIpcChannels.submitGitHubPullRequestReview,
    (value) => ({
      ...getGitHubPullRequestOptions(value),
      ...gitHubPullRequestReviewSchema.parse(value)
    }),
    submitGitHubPullRequestReview
  )

  handleGitHubRequest(
    appIpcChannels.getGitHubPullRequestManagement,
    getGitHubPullRequestOptions,
    getGitHubPullRequestManagement
  )

  handleGitHubRequest(
    appIpcChannels.getGitHubPullRequestCommitChanges,
    (value) => {
      const options = getGitHubPullRequestOptions(value)
      const commitSha = (value as { commitSha?: unknown }).commitSha
      if (typeof commitSha !== 'string' || !/^[a-f\d]{40,64}$/i.test(commitSha))
        throw new Error('Invalid commit SHA')
      return { ...options, commitSha }
    },
    getGitHubPullRequestCommitChanges
  )

  handleGitHubRequest(
    appIpcChannels.performGitHubPullRequestAction,
    (value) => ({
      ...getGitHubPullRequestOptions(value),
      ...gitHubPullRequestActionSchema.parse(value)
    }),
    performGitHubPullRequestAction
  )

  handleGitRequest(appIpcChannels.getGitBranches, getGitBranchesOptions, getGitBranches)

  handleGitRequest(appIpcChannels.switchGitBranch, getGitSwitchBranchOptions, (cwd, options) =>
    switchGitBranch(cwd, options.branchName, options.create)
  )

  handleLoggedIpc(appIpcChannels.deleteGitBranch, async (event, value: unknown) => {
    const options = getGitDeleteBranchOptions(value)
    let scope = options.scope
    let force = options.force

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
        options.removeWorktree
      )
    )
  })

  handleGitRequest(appIpcChannels.createGitWorktree, getGitCreateWorktreeOptions, (cwd, options) =>
    createGitWorktree(cwd, options.name)
  )

  handleGitRequest(appIpcChannels.getFileTree, getFileTreeOptions, async (cwd) =>
    createFileTreeResult(await readFileTreePaths(cwd))
  )

  handleGitRequest(appIpcChannels.getFileTreeListing, getFileTreeOptions, async (cwd) =>
    createFileTreeListing(await readFileTreePaths(cwd))
  )

  handleGitRequest(appIpcChannels.getFileContents, getFileContentsOptions, (cwd, options) =>
    readFileContents(cwd, options.path)
  )

  handleLoggedIpc(appIpcChannels.openFileInSystemApp, async (_event, value: unknown) => {
    const options = getFileContentsOptions(value)
    return runWithGitContainer(options.container, () => openFileInSystemApp(options))
  })

  handleLoggedIpc(appIpcChannels.openFileInBrowser, async (event, value: unknown) => {
    const options = getFileContentsOptions(value)
    const path = await runWithGitContainer(options.container, () => getFileOpenPath(options))
    event.sender.send(browserIpcChannels.openRequested, {
      id: randomUUID(),
      url: pathToFileURL(path).href
    })
  })

  handleLoggedIpc(appIpcChannels.downloadFile, async (event, value: unknown) => {
    const options = getFileContentsOptions(value)
    return runWithGitContainer(options.container, () => downloadFile(event, options))
  })

  handleLoggedIpc(appIpcChannels.showFileInFolder, async (_event, value: unknown) => {
    const options = getLocalMediaOptions(value)
    return runWithGitContainer(options.container, () => showFileInFolder(options))
  })

  handleGitRequest(appIpcChannels.writeFileContents, getWriteFileContentsOptions, (cwd, options) =>
    writeEditableFile(cwd, options.path, options.contents, options.expectedVersion)
  )

  handleGitRequest(
    appIpcChannels.getRecentGitCommitMessages,
    getGitRecentCommitMessagesOptions,
    (cwd, options) => getRecentGitCommitMessages(cwd, options.limit)
  )

  handleGitRequest(
    appIpcChannels.getGitCommitMessageContext,
    getGitDiffOptions,
    getGitCommitMessageContext
  )

  handleGitRequest(appIpcChannels.getGitFileDiff, getGitFileDiffOptions, (cwd, options) =>
    getGitFileDiff(cwd, options.path, options.previousPath)
  )

  handleGitRequest(appIpcChannels.commitGitChanges, getGitCommitOptions, (cwd, options) =>
    commitGitChanges(cwd, options.message, options.action)
  )

  handleGitRequest(appIpcChannels.pullGitChanges, getGitSyncOptions, (cwd, options) =>
    pullGitChanges(cwd, options.strategy, options.rememberStrategy)
  )

  handleGitRequest(appIpcChannels.pushGitChanges, getGitSyncOptions, (cwd, options) =>
    pushGitChanges(cwd, options.setUpstream, options.target, options.rememberTarget)
  )

  handleLoggedIpc(appIpcChannels.selectFolder, async (event, options: unknown) => {
    const folderOptions =
      options && typeof options === 'object' && !Array.isArray(options)
        ? (options as { defaultPath?: unknown })
        : {}
    const result = await showOpenDialog(event, {
      defaultPath: getDefaultPath(folderOptions.defaultPath),
      properties: ['openDirectory']
    })

    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  handleClientRequest(appIpcChannels.getProjectIcon, (_event, value: unknown) =>
    getAppProjectIcon(getProjectIconOptions(value).cwd)
  )

  handleLoggedIpc(appIpcChannels.selectProjectIcon, async (event, value: unknown) => {
    const options = getProjectIconOptions(value)
    const result = await showOpenDialog(event, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico']
        }
      ]
    })

    if (result.canceled) return null

    const sourcePath = result.filePaths[0]
    if (!sourcePath) return null

    const copiedPath = await copyProjectIcon(sourcePath)
    if (options.persist !== false) {
      await setStoredProjectIcon(options.cwd, copiedPath)
      publishWorkspace()
      return getAppProjectIcon(options.cwd)
    }

    const image = await getProjectIconFile(copiedPath)
    if (!image) throw new Error('Unable to load the selected project image')
    return {
      cwd: options.cwd,
      dataUrl: image.dataUrl,
      selectionId: rememberPendingProjectIconSelection(copiedPath),
      updatedAt: image.updatedAt
    }
  })

  handleClientRequest(
    appIpcChannels.prepareMessageAttachments,
    async (_event, attachments: unknown, value: unknown) => {
      const options: Record<string, unknown> =
        value == null ? {} : getOptionsRecord(value, 'Invalid message attachment options')
      const container = requireContainerTarget(options.container, { optional: true })
      const cwd = getOptionalCwd(options.cwd)
      return runWithGitContainer(container, () =>
        prepareMessageAttachments(
          attachments,
          join(app.getPath('userData'), 'sele-message-images'),
          (path) => getLocalMedia(cwd, path)
        )
      )
    }
  )

  handleLoggedIpc(appIpcChannels.selectMessageAttachments, async (event) => {
    const result = await showOpenDialog(event, { properties: ['openFile', 'multiSelections'] })

    if (result.canceled) return []
    if (result.filePaths.length > maxMessageAttachmentCount) {
      throw new Error(`Choose up to ${maxMessageAttachmentCount} files at a time.`)
    }

    return getMessageAttachments(result.filePaths)
  })

  handleLoggedIpc(appIpcChannels.getDroppedMessageAttachments, async (_event, value: unknown) => {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.length > maxMessageAttachmentCount ||
      value.some((path) => typeof path !== 'string' || !path || !isAbsolute(path))
    ) {
      throw new Error(`Drop up to ${maxMessageAttachmentCount} files at a time.`)
    }

    return getMessageAttachments([...new Set(value)])
  })

  handleLoggedIpc(appIpcChannels.readClipboardText, () => clipboard.readText())

  handleLoggedIpc(appIpcChannels.writeClipboardText, (_event, value: unknown) => {
    if (typeof value !== 'string') throw new Error('Invalid clipboard text')
    clipboard.writeText(value)
  })

  const pastedImages = new PastedImageStore(join(app.getPath('userData'), 'sele-message-images'))
  const pastedImageSenders = new Set<number>()
  handleLoggedIpc(appIpcChannels.getClipboardImage, async (event, value: unknown) => {
    const imageDirectory = join(app.getPath('userData'), 'sele-message-images')
    if (value !== undefined) {
      const owner = event.sender.id
      if (!pastedImageSenders.has(owner)) {
        pastedImageSenders.add(owner)
        event.sender.once('destroyed', () => {
          pastedImageSenders.delete(owner)
          void pastedImages.cancelOwner(owner)
        })
      }
      return pastedImages.write(value, owner)
    }
    const clipboardImage = clipboard.readImage()
    if (clipboardImage.isEmpty()) return null

    const imageFile = clipboardImage.toPNG()
    if (imageFile.byteLength > maxLocalImageBytes) {
      throw new Error('Paste an image smaller than 32 MB.')
    }

    const imagePath = join(imageDirectory, `pasted-image-${randomUUID()}.png`)
    await mkdir(imageDirectory, { recursive: true })
    await writeFile(imagePath, imageFile)

    return {
      kind: 'image',
      dataUrl: `data:image/png;base64,${imageFile.toString('base64')}`,
      name: 'Pasted image.png',
      path: imagePath
    } satisfies AppSelectedImage
  })

  handleClientRequest(appIpcChannels.getLocalVideo, async (_event, value: unknown) => {
    const options = getLocalMediaOptions(value)
    return runWithGitContainer(options.container, () =>
      getLocalMedia(options.cwd, options.path, options.relativeTo, 'video')
    )
  })

  handleLoggedIpc(appIpcChannels.copyLocalVideo, async (_event, value: unknown) => {
    const options = getLocalMediaOptions(value)
    const video = await runWithGitContainer(options.container, () =>
      getLocalMedia(options.cwd, options.path, options.relativeTo, 'video')
    )
    await copyVideoFile(basename(options.path), Buffer.from(video.data))
  })

  handleClientRequest(appIpcChannels.getLocalImage, async (_event, value: unknown) => {
    const options = getLocalMediaOptions(value)
    return runWithGitContainer(options.container, () =>
      getLocalMedia(options.cwd, options.path, options.relativeTo)
    )
  })

  handleLoggedIpc(appIpcChannels.writeClipboardImage, (_event, value: unknown) =>
    writeClipboardImage(value)
  )

  for (const kind of ['image', 'video'] as const) {
    handleLoggedIpc(
      kind === 'video' ? appIpcChannels.saveLocalVideo : appIpcChannels.saveLocalImage,
      async (event, value: unknown) => {
        const options = getLocalMediaOptions(value)
        const image = await runWithGitContainer(options.container, () =>
          getLocalMedia(options.cwd, options.path, options.relativeTo, kind)
        )
        const extension = extname(options.path).slice(1)
        const dialogOptions = {
          defaultPath: join(app.getPath('downloads'), basename(options.path)),
          filters: extension
            ? [{ name: kind === 'video' ? 'Video' : 'Image', extensions: [extension] }]
            : undefined
        } satisfies Electron.SaveDialogOptions
        const browserWindow = BrowserWindow.fromWebContents(event.sender)
        const result = browserWindow
          ? await dialog.showSaveDialog(browserWindow, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)

        if (result.canceled || !result.filePath) return null
        await writeFile(result.filePath, Buffer.from(image.data))
        return result.filePath
      }
    )
  }
}
