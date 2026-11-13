import { useRef, useState } from 'react'
import { useChatPaneLayout } from '../../useChatPaneLayout'
import { type ChangesPaneView } from '../controllerTypes'
import { useWorkspaceSettingsContext } from './useWorkspaceSettingsContext'

type WorkspacePanesDependencies = {
  settings: ReturnType<typeof useWorkspaceSettingsContext>
}

export function useWorkspacePanes({ settings }: WorkspacePanesDependencies) {
  const [storedChangesPaneView, setChangesPaneView] = useState<ChangesPaneView>('git')

  const [storedGitPaneView, setGitPaneView] = useState<'changes' | 'pull-requests'>('changes')
  const gitPaneView = settings.effectiveAppSettings.git.enablePullRequests
    ? storedGitPaneView
    : 'changes'

  const changesPaneView =
    settings.noProject && (storedChangesPaneView === 'git' || storedChangesPaneView === 'files')
      ? 'recents'
      : storedChangesPaneView

  const [changesSidebarExpanded, setChangesSidebarExpanded] = useState(false)

  const { changesResizeHandleRef, handleStartChatResize, panelsRef, panelsStyle, resizeHandleRef } =
    useChatPaneLayout(changesSidebarExpanded)

  const lastNonTerminalChangesPaneViewRef = useRef<Exclude<ChangesPaneView, 'terminal'>>('git')
  return {
    setChangesPaneView,
    gitPaneView,
    setGitPaneView,
    changesPaneView,
    changesSidebarExpanded,
    setChangesSidebarExpanded,
    changesResizeHandleRef,
    handleStartChatResize,
    panelsRef,
    panelsStyle,
    resizeHandleRef,
    lastNonTerminalChangesPaneViewRef
  }
}
