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

const scopedCommitActivitiesStorageKey = 'sele:scoped-commit-activities:v1'
const chatCommitMarkersStorageKey = 'sele:chat-commit-markers:v1'
const continuedStoppedWorkingStepsStorageKey = 'sele:continued-stopped-working-steps:v1'

const providerToolActivities = new Set<ProviderToolActivity>([
  'read',
  'search',
  'git',
  'edit',
  'create',
  'delete',
  'npm',
  'npx',
  'script',
  'command',
  'other'
])

const providerToolIcons = new Set<ProviderToolIcon>([
  'image-view',
  'image-generation',
  'openai-docs',
  'plan',
  'question'
])

const chatCommitMarkerStatuses = new Set<ChatCommitMarkerStatus>([
  'pending',
  'finished',
  'stopped',
  'interrupted',
  'failed'
])

const getProviderChatKey = (providerId: ProviderId, chatId: string): string =>
  `${providerId}:${chatId}`

export const readStoredScopedCommitActivities = (): Record<string, ScopedCommitActivity> => {
  try {
    const storedValue = window.localStorage.getItem(scopedCommitActivitiesStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as unknown
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const activities: Record<string, ScopedCommitActivity> = {}
    Object.values(parsedValue as Record<string, unknown>).forEach((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return

      const candidate = value as Partial<ScopedCommitActivity>
      const currentAction =
        candidate.currentAction &&
        typeof candidate.currentAction === 'object' &&
        !Array.isArray(candidate.currentAction)
          ? (candidate.currentAction as Partial<CommitActivityAction>)
          : null
      const markerId =
        typeof candidate.markerId === 'string' && candidate.markerId
          ? candidate.markerId
          : typeof candidate.providerId === 'string' &&
              typeof candidate.chatId === 'string' &&
              typeof candidate.startedAt === 'number'
            ? `legacy:${candidate.providerId}:${candidate.chatId}:${candidate.startedAt}`
            : ''
      if (
        candidate.source !== 'ai' ||
        !isProviderId(candidate.providerId) ||
        typeof candidate.chatId !== 'string' ||
        !candidate.chatId ||
        (candidate.sourceChatId !== null && typeof candidate.sourceChatId !== 'string') ||
        !markerId ||
        (candidate.projectCwd !== null && typeof candidate.projectCwd !== 'string') ||
        (candidate.commitAction !== 'commit' && candidate.commitAction !== 'amend') ||
        !currentAction ||
        typeof currentAction.label !== 'string' ||
        !providerToolActivities.has(currentAction.activity as ProviderToolActivity) ||
        (currentAction.icon != null &&
          !providerToolIcons.has(currentAction.icon as ProviderToolIcon)) ||
        typeof candidate.startedAt !== 'number' ||
        !Number.isFinite(candidate.startedAt)
      ) {
        return
      }

      const activity = {
        source: 'ai',
        providerId: candidate.providerId,
        chatId: candidate.chatId,
        sourceChatId: candidate.sourceChatId,
        markerId,
        projectCwd: candidate.projectCwd,
        commitAction: candidate.commitAction,
        currentAction: {
          label: currentAction.label,
          activity: currentAction.activity as ProviderToolActivity,
          icon: (currentAction.icon as ProviderToolIcon | null | undefined) ?? null
        },
        startedAt: candidate.startedAt
      } satisfies ScopedCommitActivity

      activities[getProviderChatKey(activity.providerId, activity.chatId)] = activity
    })

    return activities
  } catch {
    return {}
  }
}

export const readStoredChatCommitMarkers = (): Record<string, ChatCommitMarker> => {
  try {
    const storedValue = window.localStorage.getItem(chatCommitMarkersStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as unknown
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const markers: Record<string, ChatCommitMarker> = {}
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

      markers[candidate.id] = {
        id: candidate.id,
        providerId: candidate.providerId,
        sourceChatId: candidate.sourceChatId,
        commitChatId: candidate.commitChatId,
        commitAction: candidate.commitAction,
        status: candidate.status as ChatCommitMarkerStatus,
        afterItemId: candidate.afterItemId,
        startedAt: candidate.startedAt,
        finishedAt: candidate.finishedAt
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

export const writeStoredScopedCommitActivities = (
  activities: Record<string, ScopedCommitActivity>
): void => {
  try {
    if (Object.keys(activities).length === 0) {
      window.localStorage.removeItem(scopedCommitActivitiesStorageKey)
      return
    }

    window.localStorage.setItem(scopedCommitActivitiesStorageKey, JSON.stringify(activities))
  } catch {
    // Commit activity recovery is best-effort when storage is unavailable.
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
