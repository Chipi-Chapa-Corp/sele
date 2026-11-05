import { useState } from 'react'
import type { AppWindowState } from '../../../../shared/app'
import type { BrowserOpenRequest } from '../../../../shared/browser'
import type { ProviderReview, ProviderReviewComment } from '../../../../shared/provider'
import type { FileEditorTarget } from '../../components/FileEditorDialog'
import type { TerminalCommandLaunchRequest } from '../../components/TerminalPanel'

export function useWorkspaceDialogState() {
  const [fileEditorTarget, setFileEditorTarget] = useState<FileEditorTarget | null>(null)

  const [selectedReview, setSelectedReview] = useState<Omit<ProviderReview, 'prompt'> | null>(null)

  const [reviewCommentsDraft, setReviewCommentsDraft] = useState<ProviderReviewComment[]>([])

  const [terminalOpened, setTerminalOpened] = useState(false)

  const [terminalCommandLaunchRequest, setTerminalCommandLaunchRequest] =
    useState<TerminalCommandLaunchRequest | null>(null)

  const [browserOpened, setBrowserOpened] = useState(false)

  const [browserOpenRequest, setBrowserOpenRequest] = useState<BrowserOpenRequest | null>(null)

  const [windowState, setWindowState] = useState<AppWindowState>({ isMaximized: false })
  return {
    fileEditorTarget,
    setFileEditorTarget,
    selectedReview,
    setSelectedReview,
    reviewCommentsDraft,
    setReviewCommentsDraft,
    terminalOpened,
    setTerminalOpened,
    terminalCommandLaunchRequest,
    setTerminalCommandLaunchRequest,
    browserOpened,
    setBrowserOpened,
    browserOpenRequest,
    setBrowserOpenRequest,
    windowState,
    setWindowState
  }
}
