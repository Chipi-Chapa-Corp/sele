type ProcessMemoryMetric = Pick<Electron.ProcessMetric, 'pid' | 'type' | 'creationTime' | 'memory'>

export type ProcessMemorySample = {
  time: string
  processes: ProcessMemoryMetric[]
}

// Sample from the main process: a renderer approaching its heap limit may no
// longer be able to answer IPC. Keep only one sample in RAM, and use the bounded
// diagnostic log for the trend. Do not retain process handles or page content.
export const startProcessMemoryDiagnostics = (options: {
  read: () => readonly ProcessMemoryMetric[]
  logDiagnostic: (level: 'info' | 'warn', details: unknown) => void
  intervalMs?: number
}): { latest: () => ProcessMemorySample | null; dispose: () => void } => {
  let latest: ProcessMemorySample | null = null
  const sample = (): void => {
    try {
      latest = {
        time: new Date().toISOString(),
        processes: options.read().map(({ pid, type, creationTime, memory }) => ({
          pid,
          type,
          creationTime,
          memory: { ...memory }
        }))
      }
      options.logDiagnostic('info', latest)
    } catch (error) {
      options.logDiagnostic('warn', error)
    }
  }
  sample()
  const timer = setInterval(sample, options.intervalMs ?? 60_000)
  timer.unref()
  return { latest: () => latest, dispose: () => clearInterval(timer) }
}
