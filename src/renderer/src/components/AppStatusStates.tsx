import {
  Check,
  Download,
  GitBranch,
  GitCommitHorizontal,
  History,
  type LucideIcon,
  MessageSquareMore,
  Minus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Upload,
  X
} from 'lucide-react'
import { Fragment } from 'react'
import type { AppGitCommitAction } from '../../../shared/app'
import type { ProviderId } from '../../../shared/provider'
import type { ChatCommitMarkerStatus } from '../chatCommitMarker'
import { Button } from './Button'

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

export const GitRefreshIcon: React.FC = () => (
  <RefreshCw className="changes-sidebar__refresh-icon" aria-hidden="true" />
)

// A CSS animation rather than a per-frame script: busy states often coincide with
// main-thread work, which would otherwise stall the indicator.
export const AnimatedStatusIcon: React.FC<{
  Icon: LucideIcon
  active: boolean
  className?: string
  size?: number
}> = ({ Icon, active, className, size = 20 }) => (
  <div
    className={[
      'app-animated-icon',
      className ?? 'app-animated-icon--control',
      active ? 'app-busy-icon' : null
    ]
      .filter(Boolean)
      .join(' ')}
    aria-hidden="true"
  >
    <Icon size={size} />
  </div>
)

const getChatCommitMarkerLabel = (marker: ChatCommitMarker): string =>
  marker.status !== 'pending'
    ? `AI ${marker.commitAction} ${marker.status}`
    : marker.commitAction === 'amend'
      ? 'AI is amending the commit…'
      : 'AI is committing changes…'

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
          Icon={GitCommitHorizontal}
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

export const ChangesSidebarGitState: React.FC<{
  active: boolean
  label: string
  Icon?: LucideIcon
}> = ({ active, label, Icon = GitBranch }) => (
  <div className="changes-sidebar__git-state" role="status">
    {active ? (
      <AnimatedStatusIcon
        Icon={Icon}
        active
        className="changes-sidebar__git-state-icon"
        size={72}
      />
    ) : (
      <Icon className="changes-sidebar__git-state-icon" aria-hidden="true" />
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
      Icon={MessageSquareMore}
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
}> = ({ active, unpulledCount, unpushedCount }) => (
  <span className="changes-sidebar__sync-label">
    {(
      [
        [Download, 'Pull', unpulledCount],
        [Upload, 'Push', unpushedCount]
      ] as const
    )
      .filter(([, , count]) => count > 0)
      .map(([Icon, label, count], index) => (
        <Fragment key={label}>
          {index > 0 && <span className="changes-sidebar__sync-label-separator">·</span>}
          <span className="changes-sidebar__sync-label-segment">
            {active ? (
              <AnimatedStatusIcon Icon={Icon} active className="changes-sidebar__sync-label-icon" />
            ) : (
              <Icon className="changes-sidebar__sync-label-icon" aria-hidden="true" />
            )}
            <span>{label}</span>
            <span className="changes-sidebar__sync-label-count">{count}</span>
          </span>
        </Fragment>
      ))}
  </span>
)
