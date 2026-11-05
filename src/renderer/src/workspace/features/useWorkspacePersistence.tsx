import { useEffect } from 'react'
import {
  writeStoredChatCommitMarkers,
  writeStoredContinuedStoppedWorkingSteps
} from '../../chatCommitStorage'
import { writeManuallyUnreadChats } from '../../manualChatReadState'
import { writeStoredPinnedRecentChatReferences } from '../../recentReferencePins'
import { writeStoredRecentlyOpenedFiles } from '../../recentlyOpenedFiles'
import { writeStoredAppProjectSettings, writeStoredAppSettings } from '../../settings'
import { useChatTerminalActivity } from '../../useChatTerminalActivity'
import { getChatKey } from '../chatControllerUtils'
import { writeGitCommitMode } from '../controllerTypes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'

type WorkspacePersistenceDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  gitState: ReturnType<typeof useWorkspaceGitState>
  preferences: ReturnType<typeof useWorkspacePreferenceState>
}

export function useWorkspacePersistence({
  chatState,
  sourceState,
  gitState,
  preferences
}: WorkspacePersistenceDependencies) {
  useChatTerminalActivity(chatState.chats)

  useEffect(
    () => writeManuallyUnreadChats(chatState.manuallyUnreadChatKeys),
    [chatState.manuallyUnreadChatKeys]
  )

  useEffect(() => {
    sourceState.newSessionContainerKeyRef.current = sourceState.newSessionContainerKey
  }, [sourceState.newSessionContainerKey])

  useEffect(() => {
    chatState.chatsRef.current = chatState.chats
  }, [chatState.chats])

  useEffect(() => {
    chatState.selectedChatRef.current = chatState.selectedChat
    chatState.selectedChatKeyRef.current = chatState.selectedChat
      ? getChatKey(chatState.selectedChat)
      : null
    chatState.selectedChatUpdatedAtRef.current = chatState.selectedChat?.updatedAt ?? null
  }, [chatState.selectedChat])

  useEffect(() => {
    chatState.chatDetailRef.current = chatState.chatDetail
  }, [chatState.chatDetail])

  useEffect(() => {
    chatState.chatTurnWindowRef.current = chatState.chatTurnWindow
  }, [chatState.chatTurnWindow])

  useEffect(() => {
    gitState.scopedCommitActivitiesRef.current = gitState.scopedCommitActivities
  }, [gitState.scopedCommitActivities])

  useEffect(() => {
    writeStoredChatCommitMarkers(gitState.chatCommitMarkers)
  }, [gitState.chatCommitMarkers])

  useEffect(() => {
    writeStoredContinuedStoppedWorkingSteps(gitState.continuedStoppedWorkingStepsByChat)
  }, [gitState.continuedStoppedWorkingStepsByChat])

  useEffect(() => {
    writeStoredPinnedRecentChatReferences(chatState.pinnedRecentChatReferences)
  }, [chatState.pinnedRecentChatReferences])

  useEffect(() => {
    writeStoredRecentlyOpenedFiles(chatState.recentlyOpenedFilesByWorkspace)
  }, [chatState.recentlyOpenedFilesByWorkspace])

  useEffect(() => {
    writeGitCommitMode(gitState.gitCommitMode)
  }, [gitState.gitCommitMode])

  useEffect(() => {
    writeStoredAppSettings(preferences.appSettings)
  }, [preferences.appSettings])

  useEffect(() => {
    writeStoredAppProjectSettings(preferences.projectSettingsByCwd)
  }, [preferences.projectSettingsByCwd])
  return {}
}
