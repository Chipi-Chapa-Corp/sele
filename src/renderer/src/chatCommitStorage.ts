import type { AppGitCommitAction } from '../../shared/app'
import type { ProviderId, ProviderToolActivity, ProviderToolIcon } from '../../shared/provider'
import { isProviderId } from '../../shared/provider'
import type { ChatCommitMarkerStatus } from './chatCommitMarker'
import type { ChatCommitMarker } from './components/AppStatusStates'

export type CommitActivityAction = {
  label: string
  activity: ProviderToolActivity
  icon?: ProviderToolIcon | null
}

export type ScopedCommitActivity = {
  source: 'ai'
  providerId: ProviderId
  chatId: string
  sourceChatId: string | null
  markerId: string
  projectCwd: string | null
  commitAction: AppGitCommitAction
  currentAction: CommitActivityAction
  startedAt: number
}

export type StartingScopedCommitActivity = {
  id: string
  providerId: ProviderId
  sourceChatId: string | null
  markerId: string | null
  projectCwd: string | null
  commitAction: AppGitCommitAction
  startedAt: number
}

export type ContinuedStoppedWorkingStepsByChat = Record<string, string[]>

const chatCommitMarkersStorageKey = 'sele:chat-commit-markers:v1'
const continuedStoppedWorkingStepsStorageKey = 'sele:continued-stopped-working-steps:v1'

const chatCommitMarkerStatuses = new Set<ChatCommitMarkerStatus>([
  'pending',
  'finished',
  'stopped',
  'interrupted',
  'failed'
])

export const readStoredChatCommitMarkers = (): Record<string, ChatCommitMarker> => {
  try {
    const storedValue = window.localStorage.getItem(chatCommitMarkersStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as unknown
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const markers: Record<string, ChatCommitMarker> = {}
    const restoredAt = Date.now()
    Object.values(parsedValue as Record<string, unknown>).forEach((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return

      const candidate = value as Partial<ChatCommitMarker>
      if (
        typeof candidate.id !== 'string' ||
        !candidate.id ||
        !isProviderId(candidate.providerId) ||
        typeof candidate.sourceChatId !== 'string' ||
        !candidate.sourceChatId ||
        (candidate.commitChatId !== null && typeof candidate.commitChatId !== 'string') ||
        (candidate.commitAction !== 'commit' && candidate.commitAction !== 'amend') ||
        !chatCommitMarkerStatuses.has(candidate.status as ChatCommitMarkerStatus) ||
        (candidate.afterItemId !== null && typeof candidate.afterItemId !== 'string') ||
        typeof candidate.startedAt !== 'number' ||
        !Number.isFinite(candidate.startedAt) ||
        (candidate.finishedAt !== null &&
          (typeof candidate.finishedAt !== 'number' || !Number.isFinite(candidate.finishedAt)))
      ) {
        return
      }

      // A persisted pending marker belongs to a renderer session that no longer exists. Without a
      // durable operation protocol, claiming it is still running would be invented state. Keep the
      // transcript annotation, but settle it without reading the backing transcript at startup.
      const restoredStatus =
        candidate.status === 'pending'
          ? candidate.commitChatId
            ? 'interrupted'
            : 'failed'
          : (candidate.status as ChatCommitMarkerStatus)
      markers[candidate.id] = {
        id: candidate.id,
        providerId: candidate.providerId,
        sourceChatId: candidate.sourceChatId,
        commitChatId: candidate.commitChatId,
        commitAction: candidate.commitAction,
        status: restoredStatus,
        afterItemId: candidate.afterItemId,
        startedAt: candidate.startedAt,
        finishedAt: candidate.status === 'pending' ? restoredAt : candidate.finishedAt
      }
    })

    return markers
  } catch {
    return {}
  }
}

export const writeStoredChatCommitMarkers = (markers: Record<string, ChatCommitMarker>): void => {
  try {
    if (Object.keys(markers).length === 0) {
      window.localStorage.removeItem(chatCommitMarkersStorageKey)
      return
    }

    window.localStorage.setItem(chatCommitMarkersStorageKey, JSON.stringify(markers))
  } catch {
    // Visual commit history remains available for this session if storage is unavailable.
  }
}

export const readStoredContinuedStoppedWorkingSteps = (): ContinuedStoppedWorkingStepsByChat => {
  try {
    const storedValue = window.localStorage.getItem(continuedStoppedWorkingStepsStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as unknown
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const continuedSteps: ContinuedStoppedWorkingStepsByChat = {}
    Object.entries(parsedValue as Record<string, unknown>).forEach(([chatKey, value]) => {
      if (!chatKey || !Array.isArray(value)) return

      const workingStepIds = Array.from(
        new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item)))
      )
      if (workingStepIds.length > 0) continuedSteps[chatKey] = workingStepIds
    })

    return continuedSteps
  } catch {
    return {}
  }
}

export const writeStoredContinuedStoppedWorkingSteps = (
  continuedSteps: ContinuedStoppedWorkingStepsByChat
): void => {
  try {
    if (Object.keys(continuedSteps).length === 0) {
      window.localStorage.removeItem(continuedStoppedWorkingStepsStorageKey)
      return
    }

    window.localStorage.setItem(
      continuedStoppedWorkingStepsStorageKey,
      JSON.stringify(continuedSteps)
    )
  } catch {
    // Continued-step grouping remains available for this session if storage is unavailable.
  }
}
