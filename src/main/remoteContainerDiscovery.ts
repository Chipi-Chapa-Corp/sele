import type { AppContainerTool } from '../shared/app'

const remoteContainerOutputMarker = '__SELE_REMOTE_CONTAINER_OUTPUT__:'

const remoteContainerCommands = [
  {
    tool: 'distrobox',
    command: 'distrobox list --no-color 2>/dev/null || distrobox list 2>/dev/null || true'
  },
  {
    tool: 'toolbox',
    command: 'toolbox list --containers 2>/dev/null || true'
  },
  {
    tool: 'podman',
    command:
      "podman ps --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}' 2>/dev/null || true"
  },
  {
    tool: 'docker',
    command:
      "docker ps --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}' 2>/dev/null || true"
  }
] as const satisfies ReadonlyArray<{ tool: AppContainerTool; command: string }>

const remoteContainerTools = new Set<AppContainerTool>(
  remoteContainerCommands.map(({ tool }) => tool)
)

// Leave enough time for SSH's connection timeout plus remote shell startup and runtime queries.
export const remoteContainerDiscoveryTimeoutMs = 30_000

export const getRemoteContainerDiscoveryScript = (): string =>
  remoteContainerCommands
    .flatMap(({ tool, command }) => [
      `printf '%s\\n' '${remoteContainerOutputMarker}${tool}'`,
      `if command -v ${tool} >/dev/null 2>&1; then`,
      `  ${command}`,
      'fi'
    ])
    .join('\n')

export const parseRemoteContainerDiscoveryOutput = (
  output: string
): Partial<Record<AppContainerTool, string>> => {
  const linesByTool: Partial<Record<AppContainerTool, string[]>> = {}
  let activeTool: AppContainerTool | null = null

  for (const line of output.split('\n')) {
    const marker = line.trim().startsWith(remoteContainerOutputMarker)
      ? line.trim().slice(remoteContainerOutputMarker.length)
      : null
    if (marker && remoteContainerTools.has(marker as AppContainerTool)) {
      activeTool = marker as AppContainerTool
      linesByTool[activeTool] = []
      continue
    }

    if (activeTool) linesByTool[activeTool]?.push(line)
  }

  return Object.fromEntries(
    Object.entries(linesByTool).map(([tool, lines]) => [tool, lines.join('\n').trimEnd()])
  )
}
