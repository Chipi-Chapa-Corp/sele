type CodexSkillConfigClient = {
  request: <Result>(method: string, params: unknown) => Promise<Result>
}

type SkillsConfigWriteResponse = {
  effectiveEnabled: boolean
}

export const writeCodexSkillEnabled = async (
  client: CodexSkillConfigClient,
  path: string,
  enabled: boolean
): Promise<void> => {
  const response = await client.request<SkillsConfigWriteResponse>('skills/config/write', {
    enabled,
    path
  })
  if (response.effectiveEnabled !== enabled) {
    throw new Error(`Codex did not ${enabled ? 'enable' : 'disable'} the skill`)
  }
}
