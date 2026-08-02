export const copilotExecutablePathEnvKey = 'SELE_COPILOT_PATH'
export const copilotSdkExecutablePathEnvKey = 'COPILOT_CLI_PATH'

export const getCopilotExecutable = (): string => {
  const configuredExecutable =
    process.env[copilotExecutablePathEnvKey]?.trim() ||
    process.env[copilotSdkExecutablePathEnvKey]?.trim()
  return configuredExecutable || 'copilot'
}
