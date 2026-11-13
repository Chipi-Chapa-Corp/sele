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
import type { WorkspaceState } from '../composition/useWorkspaceState'

export function useWorkspacePersistence({
  chatState,
  sourceState,
  gitState,
  preferences
}: WorkspaceState) {
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
    const previousKey = chatState.selectedChatRef.current
      ? getChatKey(chatState.selectedChatRef.current)
      : null
    const committedKey = chatState.selectedChat ? getChatKey(chatState.selectedChat) : null
    chatState.selectedChatRef.current = chatState.selectedChat
    // A read marker for the still-visible chat may commit while another chat's
    // transition is pending. Metadata must not replace the latest navigation intent.
    if (previousKey !== committedKey) chatState.selectedChatKeyRef.current = committedKey
    if (chatState.selectedChatKeyRef.current === committedKey)
      chatState.selectedChatUpdatedAtRef.current = chatState.selectedChat?.updatedAt ?? null
  }, [chatState.selectedChat])

  useEffect(() => {
    const committedKey = chatState.selectedChat ? getChatKey(chatState.selectedChat) : null
    if (chatState.selectedChatKeyRef.current === committedKey)
      chatState.chatDetailRef.current = chatState.chatDetail
  }, [chatState.chatDetail, chatState.selectedChat?.id, chatState.selectedChat?.providerId])

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
