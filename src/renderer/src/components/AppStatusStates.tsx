import {
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type RefAttributes,
  useEffect,
  useRef
} from 'react'
import {
  Bot,
  Check,
  Download,
  GitBranch,
  History,
  Minus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Upload,
  X
} from 'lucide-react'
import {
  DownloadIcon as AnimatedDownloadIcon,
  GitBranchIcon as AnimatedGitBranchIcon,
  GitCommitHorizontalIcon as AnimatedGitCommitHorizontalIcon,
  MessageSquareMoreIcon as AnimatedMessageSquareMoreIcon,
  UploadIcon as AnimatedUploadIcon
} from 'lucide-animated'
import type { AppGitCommitAction } from '../../../shared/app'
import type { ProviderId, ProviderSubagent } from '../../../shared/provider'
import type { ChatCommitMarkerStatus } from '../chatCommitMarker'
import { getSubagentMarkerPresentation } from '../subagentUi'
import { Button } from './Button'

type AnimatedIconHandle = {
  startAnimation: () => void
  stopAnimation: () => void
}

type AnimatedIconComponent = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & {
    size?: number
    animateOnHover?: boolean
  } & RefAttributes<AnimatedIconHandle>
>

export type ChatCommitMarker = {
  id: string
  providerId: ProviderId
  sourceChatId: string
  commitChatId: string | null
  commitAction: AppGitCommitAction
  status: ChatCommitMarkerStatus
  afterItemId: string | null
  startedAt: number
  finishedAt: number | null
}

const refreshIconReplayMs = 1_050

export const GitRefreshIcon: React.FC = () => (
  <RefreshCw className="changes-sidebar__refresh-icon" aria-hidden="true" />
)

export const AnimatedStatusIcon: React.FC<{
  Icon: AnimatedIconComponent
  active: boolean
  className?: string
  size?: number
}> = ({ Icon, active, className, size = 20 }) => {
  const iconRef = useRef<AnimatedIconHandle | null>(null)

  useEffect(() => {
    const icon = iconRef.current

    if (!active) {
      icon?.stopAnimation()
      return undefined
    }

    icon?.startAnimation()
    const interval = window.setInterval(() => icon?.startAnimation(), refreshIconReplayMs)

    return () => {
      window.clearInterval(interval)
      icon?.stopAnimation()
    }
  }, [active])

  return (
    <Icon
      ref={iconRef}
      className={['app-animated-icon', className ?? 'app-animated-icon--control']
        .filter(Boolean)
        .join(' ')}
      size={size}
      animateOnHover={false}
      aria-hidden="true"
    />
  )
}

const getChatCommitMarkerLabel = (marker: ChatCommitMarker): string => {
  if (marker.status === 'pending') {
    return marker.commitAction === 'amend'
      ? 'AI is amending the commit…'
      : 'AI is committing changes…'
  }
  if (marker.status === 'failed') {
    return marker.commitAction === 'amend' ? 'AI amend failed' : 'AI commit failed'
  }
  if (marker.status === 'stopped') {
    return marker.commitAction === 'amend' ? 'AI amend stopped' : 'AI commit stopped'
  }
  if (marker.status === 'interrupted') {
    return marker.commitAction === 'amend' ? 'AI amend interrupted' : 'AI commit interrupted'
  }

  return marker.commitAction === 'amend' ? 'AI amend finished' : 'AI commit finished'
}

export const ChatCommitMarkerItem: React.FC<{
  marker: ChatCommitMarker
  canceling?: boolean
  opening?: boolean
  onCancel?: () => Promise<void> | void
  onOpen?: () => Promise<void> | void
}> = ({ marker, canceling = false, opening = false, onCancel, onOpen }) => {
  const label = getChatCommitMarkerLabel(marker)
  const cancelLabel = `Cancel AI ${marker.commitAction}`
  const openLabel = `Open AI ${marker.commitAction} chat`
  const markerContent = (
    <>
      {marker.status === 'pending' ? (
        <AnimatedStatusIcon
          Icon={AnimatedGitCommitHorizontalIcon}
          active
          className="chat-detail__commit-marker-icon"
        />
      ) : (
        <span className="chat-detail__commit-marker-icon" aria-hidden="true">
          {marker.status === 'finished' ? (
            <Check />
          ) : marker.status === 'stopped' || marker.status === 'interrupted' ? (
            <Minus />
          ) : (
            <X />
          )}
        </span>
      )}
      <span>{label}</span>
    </>
  )

  return (
    <div
      className={`chat-detail__commit-marker chat-detail__commit-marker--${marker.status}`}
      role="status"
      aria-live={marker.status === 'pending' ? 'polite' : undefined}
    >
      {onOpen ? (
        <button
          aria-label={openLabel}
          className="chat-detail__commit-marker-open"
          disabled={opening}
          title={openLabel}
          type="button"
          onClick={onOpen}
        >
          {markerContent}
        </button>
      ) : (
        <span className="chat-detail__commit-marker-open">{markerContent}</span>
      )}
      {marker.status === 'pending' && onCancel && (
        <span className="chat-detail__commit-marker-cancel">
          <Button
            aria-label={cancelLabel}
            callback={onCancel}
            disabled={canceling}
            icon={<X aria-hidden="true" />}
            size="small"
            theme="transparent"
            title={cancelLabel}
          />
        </span>
      )}
    </div>
  )
}

export const ChatSubagentMarkerItem: React.FC<{
  canceling?: boolean
  onCancel?: () => Promise<void> | void
  subagent: ProviderSubagent
  onOpen: () => Promise<void> | void
}> = ({ canceling = false, onCancel, subagent, onOpen }) => {
  const presentation = getSubagentMarkerPresentation(subagent)
  const cancelLabel = `Cancel ${subagent.title}`
  const openLabel = `Open ${subagent.title} chat`

  return (
    <div
      className={`chat-detail__commit-marker chat-detail__commit-marker--${presentation.status}`}
      role="status"
      aria-live={presentation.status === 'pending' ? 'polite' : undefined}
    >
      <button
        aria-label={openLabel}
        className="chat-detail__commit-marker-open"
        title={openLabel}
        type="button"
        onClick={() => void onOpen()}
      >
        {presentation.status === 'pending' ? (
          <AnimatedStatusIcon
            Icon={AnimatedMessageSquareMoreIcon}
            active
            className="chat-detail__commit-marker-icon"
          />
        ) : (
          <span className="chat-detail__commit-marker-icon" aria-hidden="true">
            {presentation.status === 'failed' ? (
              <X />
            ) : presentation.status === 'stopped' ? (
              <Minus />
            ) : subagent.status === 'completed' ? (
              <Check />
            ) : (
              <Bot />
            )}
          </span>
        )}
        <span>{presentation.label}</span>
      </button>
      {presentation.status === 'pending' && onCancel && (
        <span className="chat-detail__commit-marker-cancel">
          <Button
            aria-label={cancelLabel}
            callback={onCancel}
            disabled={canceling}
            icon={<X aria-hidden="true" />}
            size="small"
            theme="transparent"
            title={cancelLabel}
          />
        </span>
      )}
    </div>
  )
}

export const ChangesSidebarGitState: React.FC<{ active: boolean; label: string }> = ({
  active,
  label
}) => (
  <div className="changes-sidebar__git-state" role="status">
    {active ? (
      <AnimatedStatusIcon
        Icon={AnimatedGitBranchIcon}
        active
        className="changes-sidebar__git-state-icon"
        size={72}
      />
    ) : (
      <GitBranch className="changes-sidebar__git-state-icon" aria-hidden="true" />
    )}
    <span className="sr-only">{label}</span>
  </div>
)

export const ChangesSidebarRecentsState: React.FC<{ label: string }> = ({ label }) => (
  <div className="changes-sidebar__git-state" role="status">
    <History className="changes-sidebar__git-state-icon" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </div>
)

export const ChangesSidebarGitPerformanceWarning: React.FC<{
  disabled: boolean
  onSolve: () => Promise<void> | void
}> = ({ disabled, onSolve }) => (
  <section className="changes-sidebar__performance-warning" role="alert">
    <TriangleAlert className="changes-sidebar__performance-warning-icon" aria-hidden="true" />
    <div className="changes-sidebar__performance-warning-content">
      <strong>More than 200 untracked files hidden</strong>
      <p>
        They’re not shown to keep this view responsive. Did you mean to add generated artifacts to{' '}
        <code>.gitignore</code>?
      </p>
      <div className="changes-sidebar__performance-warning-actions">
        <Button
          title="Ask AI to resolve the untracked files"
          disabled={disabled}
          callback={onSolve}
          icon={<Sparkles aria-hidden="true" />}
          label={<span>Solve with AI</span>}
          size="small"
          theme="secondary"
        />
      </div>
    </div>
  </section>
)

export const ChatSidebarLoadingState: React.FC<{ label: string }> = ({ label }) => (
  <div className="chat-sidebar__loading-state" role="status">
    <AnimatedStatusIcon
      Icon={AnimatedMessageSquareMoreIcon}
      active
      className="chat-sidebar__loading-icon"
      size={72}
    />
    <span className="sr-only">{label}</span>
  </div>
)

export const GitSyncCountsLabel: React.FC<{
  active: boolean
  unpulledCount: number
  unpushedCount: number
}> = ({ active, unpulledCount, unpushedCount }) => {
  const showPull = unpulledCount > 0
  const showPush = unpushedCount > 0

  return (
    <span className="changes-sidebar__sync-label">
      {showPull && (
        <span className="changes-sidebar__sync-label-segment">
          {active ? (
            <AnimatedStatusIcon
              Icon={AnimatedDownloadIcon}
              active={active}
              className="changes-sidebar__sync-label-icon"
            />
          ) : (
            <Download className="changes-sidebar__sync-label-icon" aria-hidden="true" />
          )}
          <span>Pull</span>
          <span className="changes-sidebar__sync-label-count">{unpulledCount}</span>
        </span>
      )}
      {showPull && showPush && <span className="changes-sidebar__sync-label-separator">·</span>}
      {showPush && (
        <span className="changes-sidebar__sync-label-segment">
          {active ? (
            <AnimatedStatusIcon
              Icon={AnimatedUploadIcon}
              active={active}
              className="changes-sidebar__sync-label-icon"
            />
          ) : (
            <Upload className="changes-sidebar__sync-label-icon" aria-hidden="true" />
          )}
          <span>Push</span>
          <span className="changes-sidebar__sync-label-count">{unpushedCount}</span>
        </span>
      )}
    </span>
  )
}
