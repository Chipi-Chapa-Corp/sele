import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
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
  AppWriteFileContentsOptions,
  AppWindowState
} from '../shared/app'
import { appIpcChannels } from '../shared/app'
import {
  getProjectIcon as getStoredProjectIcon,
  setProjectIcon as setStoredProjectIcon
} from './database/projectIcons'
import { getHostCommand } from './hostProcess'

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

  return {
    cwd: getOptionalCwd((value as { cwd?: unknown }).cwd)
  }
}

const getLocalImageOptions = (value: unknown): AppLocalImageOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid local image options')
  }

  const options = value as { cwd?: unknown; path?: unknown }
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

  return { cwd, path: options.path }
}

const getImageMimeType = (imagePath: string): string | null =>
  imageMimeTypes[extname(imagePath).toLocaleLowerCase()] ?? null

const getImageFile = async (
  imagePath: string,
  maxBytes: number
): Promise<{ dataUrl: string; updatedAt: number } | null> => {
  const mimeType = getImageMimeType(imagePath)
  if (!mimeType) return null

  const imageStat = await stat(imagePath)
  if (!imageStat.isFile() || imageStat.size > maxBytes) return null

  const file = await readFile(imagePath)
  return {
    dataUrl: `data:${mimeType};base64,${file.toString('base64')}`,
    updatedAt: imageStat.mtimeMs
  }
}

const getProjectIconFile = async (
  imagePath: string
): Promise<{ dataUrl: string; updatedAt: number } | null> =>
  getImageFile(imagePath, maxProjectIconBytes)

const resolveLocalImagePath = async (cwd: string | null, path: string): Promise<string> => {
  let imagePath = path

  if (!isAbsolute(imagePath)) {
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

const getLocalImage = async (cwd: string | null, path: string): Promise<AppLocalImage> => {
  const imagePath = await resolveLocalImagePath(cwd, path)
  const image = await getImageFile(imagePath, maxLocalImageBytes)
  if (!image) throw new Error('Unable to load this image.')
  return image
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

const getColorScheme = (): AppColorScheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

type BranchBase = {
  ref: string
  commit: string
}

type RunGitOptions = {
  env?: NodeJS.ProcessEnv
  input?: string
  required?: boolean
}

const getRunGitOptions = (options: boolean | RunGitOptions): RunGitOptions =>
  typeof options === 'boolean' ? { required: options } : options

const runGit = async (
  cwd: string,
  args: string[],
  options: boolean | RunGitOptions = false
): Promise<string | null> => {
  const runOptions = getRunGitOptions(options)
  const env = { ...process.env, GIT_MERGE_AUTOEDIT: 'no', ...runOptions.env }
  const hostCommand = await getHostCommand('git', args, { cwd, env })

  return new Promise((resolve, reject) => {
    const child = execFile(
      hostCommand.file,
      hostCommand.args,
      {
        cwd: hostCommand.cwd,
        encoding: 'utf8',
        env: hostCommand.env,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10_000
      },
      (error, stdout, stderr) => {
        if (error) {
          if (runOptions.required) {
            const message = stderr.trim() || error.message
            reject(new Error(message))
          } else resolve(null)
          return
        }

        resolve(stdout.trimEnd())
      }
    )

    if (runOptions.input != null) {
      child.stdin?.end(runOptions.input)
    }
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

  const options = value as { cwd?: unknown; source?: unknown }
  const source = options.source

  if (source !== 'branch' && source !== 'uncommitted') {
    throw new Error('Invalid Git changes source')
  }

  return {
    cwd: getDefaultPath(options.cwd),
    source
  }
}

const getGitBranchesOptions = (value: unknown): AppGitBranchesOptions => {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git branch options')
  }

  return {
    cwd: getDefaultPath((value as { cwd?: unknown }).cwd)
  }
}

const getGitSwitchBranchOptions = (value: unknown): AppGitSwitchBranchOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git branch switch options')
  }

  const options = value as { branchName?: unknown; create?: unknown; cwd?: unknown }
  const branchName = typeof options.branchName === 'string' ? options.branchName.trim() : ''

  if (!branchName || branchName.includes('\0') || branchName.includes('\n')) {
    throw new Error('Invalid branch name')
  }
  if (options.create != null && typeof options.create !== 'boolean') {
    throw new Error('Invalid Git create branch option')
  }

  return {
    branchName,
    create: Boolean(options.create),
    cwd: getDefaultPath(options.cwd)
  }
}

const getFileTreeOptions = (value: unknown): AppFileTreeOptions => {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid file tree options')

  const options = value as { cwd?: unknown }

  return {
    cwd: getDefaultPath(options.cwd)
  }
}

const getFileContentsOptions = (value: unknown): AppFileContentsOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid file options')
  }

  const options = value as { cwd?: unknown; path?: unknown }
  if (
    typeof options.path !== 'string' ||
    options.path.length === 0 ||
    options.path.includes('\0')
  ) {
    throw new Error('Invalid file path')
  }

  return {
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
    cwd: getDefaultPath(options.cwd),
    files,
    patches,
    message
  }
}

const getGitSyncOptions = (
  value: unknown
): { cwd?: string | null; rememberStrategy: boolean; strategy?: AppGitPullStrategy } => {
  if (value == null) return { rememberStrategy: false }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Git sync options')

  const options = value as { cwd?: unknown; rememberStrategy?: unknown; strategy?: unknown }
  const rememberStrategy = options.rememberStrategy
  const strategy = options.strategy

  if (rememberStrategy != null && typeof rememberStrategy !== 'boolean') {
    throw new Error('Invalid Git remember strategy option')
  }

  if (strategy != null && !isGitPullStrategy(strategy)) {
    throw new Error('Invalid Git pull strategy')
  }

  return {
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

  const options = value as { cwd?: unknown; limit?: unknown }
  const limit = options.limit

  if (
    limit != null &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20)
  ) {
    throw new Error('Invalid Git commit history limit')
  }

  return {
    cwd: getDefaultPath(options.cwd),
    limit: limit ?? null
  }
}

const getGitDiffOptions = (value: unknown): AppGitDiffOptions => {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git diff options')
  }

  const options = value as { cwd?: unknown }

  return {
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

  const options = value as { cwd?: unknown; patches?: unknown }

  return {
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

const getFileVersion = (contents: Buffer | string): string =>
  createHash('sha256').update(contents).digest('hex')

const isPathInsideDirectory = (directoryPath: string, filePath: string): boolean => {
  const relativePath = relative(directoryPath, filePath)
  const normalizedRelativePath = relativePath.replace(/\\/g, '/')

  return Boolean(
    normalizedRelativePath &&
    normalizedRelativePath !== '..' &&
    !normalizedRelativePath.startsWith('../') &&
    !isAbsolute(relativePath)
  )
}

const resolveReadableFile = async (
  cwd: string,
  path: string
): Promise<{
  absolutePath: string
  editable: boolean
  isSymbolicLink: boolean
  size: number
}> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const absolutePath = isAbsolute(path) ? path : resolve(repositoryRoot, path)
  const [fileStat, resolvedFileStat, repositoryRealPath, fileRealPath] = await Promise.all([
    lstat(absolutePath),
    stat(absolutePath),
    realpath(repositoryRoot),
    realpath(absolutePath)
  ])
  const isSymbolicLink = fileStat.isSymbolicLink()

  if (!resolvedFileStat.isFile()) throw new Error('Choose a regular file to open.')
  if (resolvedFileStat.size > maxEditableFileBytes) {
    throw new Error('Files larger than 2 MB cannot be opened.')
  }

  return {
    absolutePath,
    editable: !isSymbolicLink && isPathInsideDirectory(repositoryRealPath, fileRealPath),
    isSymbolicLink,
    size: resolvedFileStat.size
  }
}

const resolveEditableFile = async (
  cwd: string,
  path: string
): Promise<{ absolutePath: string; size: number }> => {
  const file = await resolveReadableFile(cwd, path)

  if (file.isSymbolicLink) throw new Error('Symbolic links cannot be edited.')
  if (!file.editable) throw new Error('Files outside the repository cannot be edited.')

  return { absolutePath: file.absolutePath, size: file.size }
}

const readFileContents = async (
  cwd: string,
  path: string
): Promise<{ contents: string; editable: boolean; version: string }> => {
  const { absolutePath, editable } = await resolveReadableFile(cwd, path)
  const file = await readFile(absolutePath)
  const contents = file.toString('utf8')

  if (!Buffer.from(contents, 'utf8').equals(file)) {
    throw new Error('Binary files cannot be opened.')
  }

  return {
    contents,
    editable,
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
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const paths = [
    normalizePatchPath(repositoryRoot, path),
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
      throw new Error('No selected patch changes are still uncommitted')
    }

    await commitGitPatchChanges(repositoryRoot, uncommittedPatches, message, action)
    const commitHash = await runGit(repositoryRoot, ['rev-parse', 'HEAD'], true)
    if (!commitHash) throw new Error('Unable to read commit hash')

    return { commitHash, pushed: false }
  }

  await runGit(repositoryRoot, ['add', '-A', '--', ...files], true)

  if (action === 'amend') {
    await runGit(repositoryRoot, ['commit', '--amend', '--no-edit', '--only', '--', ...files], true)
  } else {
    const commitMessage = message?.trim()
    if (!commitMessage) throw new Error('Commit message is required')

    await runGit(repositoryRoot, ['commit', '--only', '-m', commitMessage, '--', ...files], true)
  }

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

  ipcMain.handle(appIpcChannels.getDefaultCwd, () => process.cwd())

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
    return getGitChanges(options.cwd ?? process.cwd(), options.source)
  })

  ipcMain.handle(appIpcChannels.getGitBranches, async (_event, value: unknown) => {
    const options = getGitBranchesOptions(value)
    return getGitBranches(options.cwd ?? process.cwd())
  })

  ipcMain.handle(appIpcChannels.switchGitBranch, async (_event, value: unknown) => {
    const options = getGitSwitchBranchOptions(value)
    return switchGitBranch(
      options.cwd ?? process.cwd(),
      options.branchName,
      Boolean(options.create)
    )
  })

  ipcMain.handle(appIpcChannels.getFileTree, async (_event, value: unknown) => {
    const options = getFileTreeOptions(value)
    return getFileTree(options.cwd ?? process.cwd())
  })

  ipcMain.handle(appIpcChannels.getFileContents, async (_event, value: unknown) => {
    const options = getFileContentsOptions(value)
    return readFileContents(options.cwd ?? process.cwd(), options.path)
  })

  ipcMain.handle(appIpcChannels.writeFileContents, async (_event, value: unknown) => {
    const options = getWriteFileContentsOptions(value)
    return writeEditableFile(
      options.cwd ?? process.cwd(),
      options.path,
      options.contents,
      options.expectedVersion
    )
  })

  ipcMain.handle(appIpcChannels.getRecentGitCommitMessages, async (_event, value: unknown) => {
    const options = getGitRecentCommitMessagesOptions(value)
    return getRecentGitCommitMessages(options.cwd ?? process.cwd(), options.limit ?? 3)
  })

  ipcMain.handle(appIpcChannels.getUncommittedGitDiff, async (_event, value: unknown) => {
    const options = getGitDiffOptions(value)
    return getUncommittedGitDiff(options.cwd ?? process.cwd())
  })

  ipcMain.handle(appIpcChannels.getGitFileDiff, async (_event, value: unknown) => {
    const options = getGitFileDiffOptions(value)
    return getGitFileDiff(options.cwd ?? process.cwd(), options.path, options.previousPath)
  })

  ipcMain.handle(appIpcChannels.getUncommittedGitPatchChanges, async (_event, value: unknown) => {
    const options = getGitUncommittedPatchChangesOptions(value)
    return getUncommittedGitPatchChanges(options.cwd ?? process.cwd(), options.patches)
  })

  ipcMain.handle(appIpcChannels.commitGitChanges, async (_event, value: unknown) => {
    const options = getGitCommitOptions(value)
    return commitGitChanges(
      options.cwd ?? process.cwd(),
      options.files,
      options.message,
      options.action ?? 'commit',
      options.patches
    )
  })

  ipcMain.handle(appIpcChannels.pullGitChanges, async (_event, value: unknown) => {
    const options = getGitSyncOptions(value)
    return pullGitChanges(options.cwd ?? process.cwd(), options.strategy, options.rememberStrategy)
  })

  ipcMain.handle(appIpcChannels.pushGitChanges, async (_event, value: unknown) => {
    const options = getGitSyncOptions(value)
    return pushGitChanges(options.cwd ?? process.cwd())
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
    await setStoredProjectIcon(options.cwd ?? null, copiedPath)
    return getAppProjectIcon(options.cwd ?? null)
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
          dataUrl: image.dataUrl,
          name,
          path
        }
      })
    )
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
    return getLocalImage(options.cwd ?? null, options.path)
  })

  ipcMain.handle(appIpcChannels.copyLocalImage, async (_event, value: unknown) => {
    const options = getLocalImageOptions(value)
    const image = await getLocalImage(options.cwd ?? null, options.path)
    const clipboardImage = nativeImage.createFromDataURL(image.dataUrl)
    if (clipboardImage.isEmpty()) throw new Error('Unable to copy this image.')
    clipboard.writeImage(clipboardImage)
  })

  ipcMain.handle(appIpcChannels.saveLocalImage, async (event, value: unknown) => {
    const options = getLocalImageOptions(value)
    const sourcePath = await resolveLocalImagePath(options.cwd ?? null, options.path)
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
