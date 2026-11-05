import type { HostCommand } from '../../hostProcess'
import { connectProcessRuntime, processRuntimeKey } from '../../processRuntime'
import runtimeSource from './codexRuntime.cjs?raw'

export type { RuntimeProcess as CodexProcess } from '../../processRuntime'
export const codexRuntimeKey = processRuntimeKey
export const connectCodexRuntime = (
  profile: string,
  identity: unknown,
  command: HostCommand | null
) =>
  connectProcessRuntime(profile, identity, command, {
    namespace: 'codex-runtime-v1',
    source: runtimeSource
  })
