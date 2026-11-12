import { compareProviderVersions } from '../providerUpdate'

// resumeDropsTurn was added to Claude Code alongside Agent SDK 0.3.228. Older
// CLIs reject the SDK-generated flag before a resumed edit can start.
const resumeDropsTurnMinimumVersion = '2.1.228'

export const supportsClaudeResumeDropsTurn = (version: string): boolean =>
  compareProviderVersions(version, resumeDropsTurnMinimumVersion) >= 0
