import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type ProcessMetric,
  type WebContents
} from 'electron'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { freemem, loadavg, totalmem } from 'node:os'
import { join } from 'node:path'
import {
  appIpcChannels,
  type AppDiagnosticsHeartbeat,
  type AppDiagnosticsInteraction,
  type AppDiagnosticsInteractionKind
} from '../shared/app'
import { getCodexResourceIdentity } from './providers/codex/CodexAppServerClient'
import { getProviderIpcDiagnostics } from './providers/registerProviderIpc'

type DiagnosticsProcessMetric = {
  pid: number
  type: ProcessMetric['type']
  name: string | null
  serviceName: string | null
  cpuPercent: number
  cumulativeCpuSeconds: number | null
  workingSetBytes: number
  peakWorkingSetBytes: number
}

type RendererHeartbeat = AppDiagnosticsHeartbeat & {
  receivedAt: number
  webContentsId: number
}

type LinuxProcessMemoryDetails = {
  pid: number
  statusMemoryBytes: Record<string, number>
  smapsRollupBytes: Record<string, number>
  fileDescriptorCount: number | null
  inotifyDescriptorCount: number | null
  inotifyWatchCount: number | null
}

type ChromiumMemoryDetails = {
  webContentsId: number
  rendererPid: number
  runtimeHeapUsage: Record<string, number> | null
  domCounters: Record<string, number> | null
  nativeAllocationProfile: {
    sampleCount: number
    totalSampledBytes: number
    topSamples: Array<{
      size: number
      total: number
      stack: string[]
    }>
  } | null
  globalMemoryDump: {
    dumpGuid: string | null
    allocatorCount: number
    topAllocators: Array<{
      pid: number
      path: string
      sizeBytes: number
    }>
  } | null
  unavailableReason: string | null
}

type DiagnosticsSample = {
  timestamp: number
  mainProcess: NodeJS.MemoryUsage
  electronProcesses: DiagnosticsProcessMetric[]
  rendererPids: number[]
  rendererWorkingSetBytes: number
  electronWorkingSetBytes: number
  codexResource: {
    pid: number
    systemdUnitName: string | null
    memoryBytes: number | null
  } | null
  rendererHeartbeats: Array<
    RendererHeartbeat & {
      ageMs: number
    }
  >
  providerIpc: Record<string, unknown>
}

const sampleIntervalMs = 2_000
const retainedSampleCount = 90
const incidentCooldownMs = 60_000
const rendererMemoryHighBytes = 768 * 1024 * 1024
const rendererMemoryRiseFloorBytes = 384 * 1024 * 1024
const rendererMemoryRiseBytes = 192 * 1024 * 1024
const rendererMemoryRiseWindowMs = 12_000
const electronMemoryHighBytes = 1536 * 1024 * 1024
const codexMemoryHighBytes = 1536 * 1024 * 1024
const rendererMemoryResetBytes = 512 * 1024 * 1024
const electronMemoryResetBytes = 1024 * 1024 * 1024
const codexMemoryResetBytes = 1024 * 1024 * 1024

const rendererHeartbeats = new Map<number, RendererHeartbeat>()
const rendererInteractions = new Map<number, AppDiagnosticsInteraction>()
const samples: DiagnosticsSample[] = []
const lastIncidentAtByReason = new Map<string, number>()
let sampling = false
let disposed = false
let memoryIncidentActive = false

const interactionKinds = new Set<AppDiagnosticsInteractionKind>([
  'edit-message',
  'message-input',
  'notes-toggle',
  'plan-toggle',
  'stop-response'
])

const linuxStatusMemoryFields = new Set([
  'VmPeak',
  'VmSize',
  'VmHWM',
  'VmRSS',
  'RssAnon',
  'RssFile',
  'RssShmem',
  'VmData',
  'VmStk',
  'VmExe',
  'VmLib',
  'VmPTE',
  'VmSwap',
  'HugetlbPages'
])

const linuxSmapsRollupFields = new Set([
  'Rss',
  'Pss',
  'Pss_Dirty',
  'Pss_Anon',
  'Pss_File',
  'Pss_Shmem',
  'Shared_Clean',
  'Shared_Dirty',
  'Private_Clean',
  'Private_Dirty',
  'Referenced',
  'Anonymous',
  'LazyFree',
  'AnonHugePages',
  'ShmemPmdMapped',
  'FilePmdMapped',
  'Shared_Hugetlb',
  'Private_Hugetlb',
  'Swap',
  'SwapPss',
  'Locked'
])

const getFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const getBoundedCount = (value: unknown): number | null => {
  const count = getFiniteNumber(value)
  return count !== null && count >= 0 && count <= 10_000_000 ? Math.floor(count) : null
}

const getInteractionKind = (value: unknown): AppDiagnosticsInteractionKind | null =>
  typeof value === 'string' && interactionKinds.has(value as AppDiagnosticsInteractionKind)
    ? (value as AppDiagnosticsInteractionKind)
    : null

const getInteraction = (value: unknown): AppDiagnosticsInteraction | null => {
  if (!value || typeof value !== 'object') return null
  const interaction = value as Partial<AppDiagnosticsInteraction>
  const timestamp = getFiniteNumber(interaction.timestamp)
  const kind = getInteractionKind(interaction.kind)
  return timestamp === null || kind === null ? null : { timestamp, kind }
}

const getHeartbeat = (event: IpcMainEvent, value: unknown): RendererHeartbeat | null => {
  if (!value || typeof value !== 'object') return null
  const heartbeat = value as Partial<AppDiagnosticsHeartbeat>
  const timestamp = getFiniteNumber(heartbeat.timestamp)
  const domNodeCount = getBoundedCount(heartbeat.domNodeCount)
  const activeAnimationCount = getBoundedCount(heartbeat.activeAnimationCount)
  const animatedIconCount = getBoundedCount(heartbeat.animatedIconCount)
  const streamingMessageCount = getBoundedCount(heartbeat.streamingMessageCount)
  const workingSpinnerCount = getBoundedCount(heartbeat.workingSpinnerCount)
  const messageInputLength = getBoundedCount(heartbeat.messageInputLength)
  const openNotesCount = getBoundedCount(heartbeat.openNotesCount)
  const openPlanCount = getBoundedCount(heartbeat.openPlanCount)
  const openWorkingDetailsCount = getBoundedCount(heartbeat.openWorkingDetailsCount)
  if (
    timestamp === null ||
    domNodeCount === null ||
    activeAnimationCount === null ||
    animatedIconCount === null ||
    streamingMessageCount === null ||
    workingSpinnerCount === null ||
    messageInputLength === null ||
    typeof heartbeat.messageInputFocused !== 'boolean' ||
    openNotesCount === null ||
    openPlanCount === null ||
    openWorkingDetailsCount === null
  ) {
    return null
  }

  const immediateInteraction = rendererInteractions.get(event.sender.id) ?? null
  const heartbeatInteractionAt =
    heartbeat.lastInteractionAt === null ? null : getFiniteNumber(heartbeat.lastInteractionAt)
  const useImmediateInteraction =
    immediateInteraction !== null &&
    (heartbeatInteractionAt === null || immediateInteraction.timestamp > heartbeatInteractionAt)

  return {
    timestamp,
    jsHeapUsedBytes: getFiniteNumber(heartbeat.jsHeapUsedBytes),
    jsHeapTotalBytes: getFiniteNumber(heartbeat.jsHeapTotalBytes),
    domNodeCount,
    activeAnimationCount,
    animatedIconCount,
    streamingMessageCount,
    workingSpinnerCount,
    messageInputLength,
    messageInputFocused: heartbeat.messageInputFocused,
    openNotesCount,
    openPlanCount,
    openWorkingDetailsCount,
    lastInteractionAt: useImmediateInteraction
      ? immediateInteraction.timestamp
      : heartbeatInteractionAt,
    lastInteractionKind: useImmediateInteraction
      ? immediateInteraction.kind
      : getInteractionKind(heartbeat.lastInteractionKind),
    visibilityState:
      typeof heartbeat.visibilityState === 'string'
        ? heartbeat.visibilityState.slice(0, 32)
        : 'unknown',
    receivedAt: Date.now(),
    webContentsId: event.sender.id
  }
}

const parseLinuxMemoryFields = (
  contents: string,
  allowedFields: ReadonlySet<string>
): Record<string, number> => {
  const values: Record<string, number> = {}
  for (const line of contents.split('\n')) {
    const match = line.match(/^([A-Za-z_]+):\s+(\d+)\s+kB$/)
    if (!match || !allowedFields.has(match[1])) continue

    const valueKiB = Number.parseInt(match[2], 10)
    if (Number.isFinite(valueKiB)) values[match[1]] = valueKiB * 1024
  }
  return values
}

const readLinuxProcessMemoryDetails = async (
  pid: number
): Promise<LinuxProcessMemoryDetails | null> => {
  if (process.platform !== 'linux') return null

  try {
    const [status, smapsRollup, fileDescriptors] = await Promise.all([
      readFile(`/proc/${pid}/status`, 'utf8'),
      readFile(`/proc/${pid}/smaps_rollup`, 'utf8').catch(() => ''),
      readdir(`/proc/${pid}/fd`).catch(() => null)
    ])
    const fileDescriptorInfo = fileDescriptors
      ? await Promise.all(
          fileDescriptors.map((descriptor) =>
            readFile(`/proc/${pid}/fdinfo/${descriptor}`, 'utf8').catch(() => '')
          )
        )
      : []
    const inotifyDescriptorInfo = fileDescriptorInfo.filter((contents) =>
      /^inotify wd:/m.test(contents)
    )

    return {
      pid,
      statusMemoryBytes: parseLinuxMemoryFields(status, linuxStatusMemoryFields),
      smapsRollupBytes: parseLinuxMemoryFields(smapsRollup, linuxSmapsRollupFields),
      fileDescriptorCount: fileDescriptors?.length ?? null,
      inotifyDescriptorCount: fileDescriptors ? inotifyDescriptorInfo.length : null,
      inotifyWatchCount: fileDescriptors
        ? inotifyDescriptorInfo.reduce(
            (total, contents) => total + (contents.match(/^inotify wd:/gm)?.length ?? 0),
            0
          )
        : null
    }
  } catch {
    return null
  }
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out')), timeoutMs)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

const getNumericRecord = (value: unknown): Record<string, number> | null => {
  if (!value || typeof value !== 'object') return null

  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])
  )
  return Object.fromEntries(entries)
}

const getNativeAllocationProfile = (
  value: unknown
): ChromiumMemoryDetails['nativeAllocationProfile'] => {
  if (!value || typeof value !== 'object') return null
  const profile = (value as { profile?: unknown }).profile
  if (!profile || typeof profile !== 'object') return null
  const rawSamples = (profile as { samples?: unknown }).samples
  if (!Array.isArray(rawSamples)) return null

  const samples = rawSamples.flatMap((sample) => {
    if (!sample || typeof sample !== 'object') return []
    const candidate = sample as { size?: unknown; total?: unknown; stack?: unknown }
    if (
      typeof candidate.size !== 'number' ||
      !Number.isFinite(candidate.size) ||
      typeof candidate.total !== 'number' ||
      !Number.isFinite(candidate.total) ||
      !Array.isArray(candidate.stack)
    ) {
      return []
    }

    return [
      {
        size: candidate.size,
        total: candidate.total,
        stack: candidate.stack
          .filter((frame): frame is string => typeof frame === 'string')
          .slice(0, 16)
          .map((frame) => frame.slice(0, 240))
      }
    ]
  })

  return {
    sampleCount: samples.length,
    totalSampledBytes: samples.reduce((total, sample) => total + sample.total, 0),
    topSamples: samples.sort((first, second) => second.total - first.total).slice(0, 50)
  }
}

const getSettledValue = <T>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null

const getSettledError = (result: PromiseSettledResult<unknown>, command: string): string | null => {
  if (result.status === 'fulfilled') return null
  const message =
    result.reason instanceof Error ? result.reason.message : String(result.reason ?? 'unknown')
  return `${command}: ${message}`.slice(0, 200)
}

const getMemoryDumpScalarBytes = (value: unknown): number | null => {
  if (!value || typeof value !== 'object') return null
  const rawValue = (value as { value?: unknown }).value
  if (typeof rawValue === 'number') return Number.isFinite(rawValue) ? rawValue : null
  if (typeof rawValue !== 'string' || !/^[0-9a-f]+$/i.test(rawValue)) return null

  const parsed = Number.parseInt(rawValue, 16)
  return Number.isFinite(parsed) ? parsed : null
}

const collectGlobalMemoryDump = async (
  webContents: WebContents
): Promise<ChromiumMemoryDetails['globalMemoryDump']> => {
  const memoryDumps: Array<{ pid: number; value: Record<string, unknown> }> = []
  let resolveTracingComplete: (() => void) | null = null
  const tracingComplete = new Promise<void>((resolve) => {
    resolveTracingComplete = resolve
  })
  const handleDebuggerMessage = (
    _event: Electron.Event,
    method: string,
    params: Record<string, unknown>
  ): void => {
    if (method === 'Tracing.tracingComplete') {
      resolveTracingComplete?.()
      return
    }
    if (method !== 'Tracing.dataCollected' || !Array.isArray(params.value)) return

    for (const traceEvent of params.value) {
      if (!traceEvent || typeof traceEvent !== 'object') continue
      const eventRecord = traceEvent as {
        pid?: unknown
        args?: { dumps?: unknown }
      }
      if (
        typeof eventRecord.pid !== 'number' ||
        !eventRecord.args?.dumps ||
        typeof eventRecord.args.dumps !== 'object'
      ) {
        continue
      }
      memoryDumps.push({
        pid: eventRecord.pid,
        value: eventRecord.args.dumps as Record<string, unknown>
      })
    }
  }

  webContents.debugger.on('message', handleDebuggerMessage)
  let tracingStarted = false
  let tracingEnded = false
  try {
    await webContents.debugger.sendCommand('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: {
        recordMode: 'recordUntilFull',
        traceBufferSizeInKb: 16_384,
        includedCategories: ['disabled-by-default-memory-infra']
      }
    })
    tracingStarted = true
    const dumpResult = await webContents.debugger.sendCommand('Tracing.requestMemoryDump', {
      deterministic: false,
      levelOfDetail: 'detailed'
    })
    await webContents.debugger.sendCommand('Tracing.end')
    tracingEnded = true
    await withTimeout(tracingComplete, 1_500)

    const allocatorSizes = new Map<
      string,
      {
        pid: number
        path: string
        sizeBytes: number
      }
    >()
    const visitAllocator = (pid: number, value: unknown, path: string): void => {
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      const attrs = record.attrs
      if (attrs && typeof attrs === 'object') {
        const sizeBytes = getMemoryDumpScalarBytes((attrs as Record<string, unknown>).size)
        if (sizeBytes !== null) {
          const key = `${pid}:${path}`
          const previous = allocatorSizes.get(key)
          if (!previous || sizeBytes > previous.sizeBytes) {
            allocatorSizes.set(key, { pid, path, sizeBytes })
          }
        }
      }

      for (const [key, child] of Object.entries(record)) {
        if (key === 'attrs') continue
        visitAllocator(pid, child, path ? `${path}/${key}` : key)
      }
    }

    for (const memoryDump of memoryDumps) {
      visitAllocator(memoryDump.pid, memoryDump.value.allocators, 'allocators')
    }
    const allocators = Array.from(allocatorSizes.values())

    return {
      dumpGuid:
        dumpResult &&
        typeof dumpResult === 'object' &&
        typeof (dumpResult as { dumpGuid?: unknown }).dumpGuid === 'string'
          ? (dumpResult as { dumpGuid: string }).dumpGuid.slice(0, 64)
          : null,
      allocatorCount: allocators.length,
      topAllocators: allocators
        .sort((first, second) => second.sizeBytes - first.sizeBytes)
        .slice(0, 100)
    }
  } finally {
    webContents.debugger.removeListener('message', handleDebuggerMessage)
    if (tracingStarted && !tracingEnded && webContents.debugger.isAttached()) {
      await webContents.debugger.sendCommand('Tracing.end').catch(() => {})
    }
  }
}

const collectChromiumMemoryDetails = async (
  currentSample: DiagnosticsSample | null
): Promise<ChromiumMemoryDetails[]> => {
  const rendererPids = new Set(currentSample?.rendererPids ?? [])
  const windows = BrowserWindow.getAllWindows().filter(
    (window) =>
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      rendererPids.has(window.webContents.getOSProcessId())
  )

  return Promise.all(
    windows.map(async (window, windowIndex): Promise<ChromiumMemoryDetails> => {
      const { webContents } = window
      const base = {
        webContentsId: webContents.id,
        rendererPid: webContents.getOSProcessId()
      }
      if (webContents.debugger.isAttached()) {
        return {
          ...base,
          runtimeHeapUsage: null,
          domCounters: null,
          nativeAllocationProfile: null,
          globalMemoryDump: null,
          unavailableReason: 'debugger-already-attached'
        }
      }

      let attachedByDiagnostics = false
      try {
        webContents.debugger.attach('1.3')
        attachedByDiagnostics = true
        const [runtimeHeapUsageResult, domCountersResult, nativeAllocationProfileResult] =
          await withTimeout(
            Promise.allSettled([
              webContents.debugger.sendCommand('Runtime.getHeapUsage'),
              webContents.debugger.sendCommand('Memory.getDOMCounters'),
              webContents.debugger.sendCommand('Memory.getAllTimeSamplingProfile')
            ]),
            1_500
          )
        const errors = [
          getSettledError(runtimeHeapUsageResult, 'Runtime.getHeapUsage'),
          getSettledError(domCountersResult, 'Memory.getDOMCounters'),
          getSettledError(nativeAllocationProfileResult, 'Memory.getAllTimeSamplingProfile')
        ].filter((error): error is string => error !== null)
        const [globalMemoryDumpResult] =
          windowIndex === 0
            ? await Promise.allSettled([collectGlobalMemoryDump(webContents)])
            : ([{ status: 'fulfilled', value: null }] as const)
        const globalMemoryDumpError = getSettledError(
          globalMemoryDumpResult,
          'Tracing.requestMemoryDump'
        )
        if (globalMemoryDumpError) errors.push(globalMemoryDumpError)
        return {
          ...base,
          runtimeHeapUsage: getNumericRecord(getSettledValue(runtimeHeapUsageResult)),
          domCounters: getNumericRecord(getSettledValue(domCountersResult)),
          nativeAllocationProfile: getNativeAllocationProfile(
            getSettledValue(nativeAllocationProfileResult)
          ),
          globalMemoryDump: getSettledValue(globalMemoryDumpResult),
          unavailableReason: errors.length > 0 ? errors.join('; ').slice(0, 600) : null
        }
      } catch (error) {
        return {
          ...base,
          runtimeHeapUsage: null,
          domCounters: null,
          nativeAllocationProfile: null,
          globalMemoryDump: null,
          unavailableReason: error instanceof Error ? error.message.slice(0, 160) : 'unknown'
        }
      } finally {
        if (attachedByDiagnostics && webContents.debugger.isAttached()) {
          webContents.debugger.detach()
        }
      }
    })
  )
}

const collectIncidentDiagnostics = async (
  currentSample: DiagnosticsSample | null
): Promise<Record<string, unknown>> => {
  const processIds = new Set([
    process.pid,
    ...(currentSample?.rendererPids ?? []),
    ...(currentSample?.codexResource ? [currentSample.codexResource.pid] : [])
  ])
  const [linuxProcesses, chromiumRenderers] = await Promise.all([
    Promise.all(Array.from(processIds, readLinuxProcessMemoryDetails)),
    collectChromiumMemoryDetails(currentSample)
  ])

  return {
    system: {
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      loadAverage: loadavg()
    },
    linuxProcesses: linuxProcesses.filter(
      (details): details is LinuxProcessMemoryDetails => details !== null
    ),
    chromiumRenderers
  }
}

const toDiagnosticsProcessMetric = (metric: ProcessMetric): DiagnosticsProcessMetric => ({
  pid: metric.pid,
  type: metric.type,
  name: metric.name ?? null,
  serviceName: metric.serviceName ?? null,
  cpuPercent: metric.cpu.percentCPUUsage,
  cumulativeCpuSeconds: metric.cpu.cumulativeCPUUsage ?? null,
  workingSetBytes: metric.memory.workingSetSize * 1024,
  peakWorkingSetBytes: metric.memory.peakWorkingSetSize * 1024
})

const readNumberFile = async (path: string): Promise<number | null> => {
  try {
    const value = Number.parseInt((await readFile(path, 'utf8')).trim(), 10)
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

const getCodexResourceMemory = async (
  identity: NonNullable<ReturnType<typeof getCodexResourceIdentity>>
): Promise<number | null> => {
  if (identity.systemdUnitName && process.platform === 'linux') {
    const uid = process.getuid?.()
    if (uid !== undefined) {
      return readNumberFile(
        join(
          '/sys/fs/cgroup/user.slice',
          `user-${uid}.slice`,
          `user@${uid}.service`,
          'app.slice',
          `${identity.systemdUnitName}.service`,
          'memory.current'
        )
      )
    }
  }

  if (process.platform !== 'linux') return null

  try {
    const status = await readFile(`/proc/${identity.pid}/status`, 'utf8')
    const rssKiB = Number.parseInt(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] ?? '', 10)
    return Number.isFinite(rssKiB) ? rssKiB * 1024 : null
  } catch {
    return null
  }
}

const collectSample = async (): Promise<DiagnosticsSample | null> => {
  if (sampling || disposed) return null
  sampling = true

  try {
    const timestamp = Date.now()
    const rendererPids = BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed() && !window.webContents.isDestroyed())
      .map((window) => window.webContents.getOSProcessId())
    const rendererPidSet = new Set(rendererPids)
    const electronProcesses = app.getAppMetrics().map(toDiagnosticsProcessMetric)
    const rendererWorkingSetBytes = electronProcesses
      .filter((metric) => rendererPidSet.has(metric.pid))
      .reduce((total, metric) => total + metric.workingSetBytes, 0)
    const electronWorkingSetBytes = electronProcesses.reduce(
      (total, metric) => total + metric.workingSetBytes,
      0
    )
    const codexIdentity = getCodexResourceIdentity()
    const codexMemoryBytes = codexIdentity ? await getCodexResourceMemory(codexIdentity) : null
    const sample = {
      timestamp,
      mainProcess: process.memoryUsage(),
      electronProcesses,
      rendererPids,
      rendererWorkingSetBytes,
      electronWorkingSetBytes,
      codexResource: codexIdentity
        ? {
            ...codexIdentity,
            memoryBytes: codexMemoryBytes
          }
        : null,
      rendererHeartbeats: Array.from(rendererHeartbeats.values()).map((heartbeat) => ({
        ...heartbeat,
        ageMs: Math.max(0, timestamp - heartbeat.receivedAt)
      })),
      providerIpc: getProviderIpcDiagnostics()
    } satisfies DiagnosticsSample

    samples.push(sample)
    if (samples.length > retainedSampleCount) {
      samples.splice(0, samples.length - retainedSampleCount)
    }
    return sample
  } finally {
    sampling = false
  }
}

const getIncidentPath = (): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(app.getPath('userData'), 'diagnostics', `freeze-${timestamp}.json`)
}

const persistIncident = async (
  reason: string,
  currentSample: DiagnosticsSample | null,
  detail: Record<string, unknown> = {}
): Promise<void> => {
  const now = Date.now()
  const lastIncidentAt = lastIncidentAtByReason.get(reason) ?? 0
  if (now - lastIncidentAt < incidentCooldownMs) return
  lastIncidentAtByReason.set(reason, now)

  const path = getIncidentPath()
  try {
    const incidentDiagnostics = await collectIncidentDiagnostics(currentSample)
    await mkdir(join(app.getPath('userData'), 'diagnostics'), { recursive: true })
    await writeFile(
      path,
      JSON.stringify(
        {
          schemaVersion: 1,
          capturedAt: now,
          reason,
          detail,
          appVersion: app.getVersion(),
          platform: process.platform,
          currentSample,
          samples,
          incidentDiagnostics
        },
        null,
        2
      ),
      'utf8'
    )
    console.error(`Sele freeze diagnostics captured: ${path}`)
  } catch (error) {
    console.error('Unable to write Sele freeze diagnostics', error)
  }
}

const findPriorSample = (
  currentSample: DiagnosticsSample,
  ageMs: number
): DiagnosticsSample | null =>
  samples.findLast((sample) => sample.timestamp <= currentSample.timestamp - ageMs) ?? null

const inspectSample = (sample: DiagnosticsSample): void => {
  if (memoryIncidentActive) {
    if (
      sample.rendererWorkingSetBytes < rendererMemoryResetBytes &&
      sample.electronWorkingSetBytes < electronMemoryResetBytes &&
      (sample.codexResource?.memoryBytes ?? 0) < codexMemoryResetBytes
    ) {
      memoryIncidentActive = false
    }
    return
  }

  if (sample.rendererWorkingSetBytes >= rendererMemoryHighBytes) {
    memoryIncidentActive = true
    void persistIncident('renderer-memory-high', sample)
    return
  }

  const priorSample = findPriorSample(sample, rendererMemoryRiseWindowMs)
  if (
    priorSample &&
    sample.rendererWorkingSetBytes >= rendererMemoryRiseFloorBytes &&
    sample.rendererWorkingSetBytes - priorSample.rendererWorkingSetBytes >= rendererMemoryRiseBytes
  ) {
    memoryIncidentActive = true
    void persistIncident('renderer-memory-rise', sample, {
      riseBytes: sample.rendererWorkingSetBytes - priorSample.rendererWorkingSetBytes,
      riseWindowMs: sample.timestamp - priorSample.timestamp
    })
    return
  }

  if (sample.electronWorkingSetBytes >= electronMemoryHighBytes) {
    memoryIncidentActive = true
    void persistIncident('electron-memory-high', sample)
    return
  }

  if ((sample.codexResource?.memoryBytes ?? 0) >= codexMemoryHighBytes) {
    memoryIncidentActive = true
    void persistIncident('codex-memory-high', sample)
  }
}

const captureWindowIncident = (
  reason: string,
  webContentsId: number,
  detail: Record<string, unknown> = {}
): void => {
  void collectSample().then((sample) =>
    persistIncident(reason, sample ?? samples.at(-1) ?? null, {
      webContentsId,
      ...detail
    })
  )
}

const attachWindowDiagnostics = (window: BrowserWindow): void => {
  const { webContents } = window
  webContents.on('unresponsive', () => {
    captureWindowIncident('renderer-unresponsive', webContents.id)
  })
  webContents.on('render-process-gone', (_event, details) => {
    captureWindowIncident('renderer-process-gone', webContents.id, {
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  webContents.once('destroyed', () => {
    rendererHeartbeats.delete(webContents.id)
    rendererInteractions.delete(webContents.id)
  })
}

export const registerFreezeDiagnostics = (): (() => void) => {
  const handleDiagnosticsHeartbeat = (event: IpcMainEvent, value: unknown): void => {
    const heartbeat = getHeartbeat(event, value)
    if (heartbeat) rendererHeartbeats.set(event.sender.id, heartbeat)
  }
  ipcMain.on(appIpcChannels.diagnosticsHeartbeat, handleDiagnosticsHeartbeat)

  const handleDiagnosticsInteraction = (event: IpcMainEvent, value: unknown): void => {
    const interaction = getInteraction(value)
    if (!interaction) return

    const currentInteraction = rendererInteractions.get(event.sender.id)
    if (!currentInteraction || interaction.timestamp >= currentInteraction.timestamp) {
      rendererInteractions.set(event.sender.id, interaction)
    }
    const currentHeartbeat = rendererHeartbeats.get(event.sender.id)
    if (currentHeartbeat && interaction.timestamp >= (currentHeartbeat.lastInteractionAt ?? 0)) {
      currentHeartbeat.lastInteractionAt = interaction.timestamp
      currentHeartbeat.lastInteractionKind = interaction.kind
    }
  }
  ipcMain.on(appIpcChannels.diagnosticsInteraction, handleDiagnosticsInteraction)

  const handleBrowserWindowCreated = (_event: Electron.Event, window: BrowserWindow): void => {
    attachWindowDiagnostics(window)
  }
  app.on('browser-window-created', handleBrowserWindowCreated)

  const timer = setInterval(() => {
    void collectSample().then((sample) => {
      if (sample) inspectSample(sample)
    })
  }, sampleIntervalMs)
  timer.unref()

  return () => {
    disposed = true
    clearInterval(timer)
    app.removeListener('browser-window-created', handleBrowserWindowCreated)
    ipcMain.removeListener(appIpcChannels.diagnosticsHeartbeat, handleDiagnosticsHeartbeat)
    ipcMain.removeListener(appIpcChannels.diagnosticsInteraction, handleDiagnosticsInteraction)
  }
}
