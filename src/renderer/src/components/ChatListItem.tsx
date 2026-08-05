import {
  Check,
  Folder,
  GitCommitHorizontal,
  GitFork,
  LoaderCircle,
  Pin,
  PinOff,
  ShieldQuestionMark,
  Target,
  Undo2,
  X
} from 'lucide-react'
import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { Button } from './Button'
import './ChatListItem.css'

type ChatListItemProps = {
  chat: ProviderChat
  selected: boolean
  showProject: boolean
  committing?: boolean
  canMarkDone?: boolean
  canMarkUndone?: boolean
  onClick: () => void
  onMarkDone: (done?: boolean) => void
  onResolveApproval: (decision: ProviderApprovalDecision) => void
  onTogglePinned: () => void
  approvalDecisionInFlight?: ProviderApprovalDecision | null
}

const statusLabels = {
  active: 'In progress',
  error: 'Error',
  waitingOnApproval: 'Waiting for approval',
  waitingOnUserInput: 'Waiting for your input'
} as const
const finishedUnseenLabel = 'Finished since last viewed'

const workingStatuses = new Set<NonNullable<ProviderChat['status']>>(['active'])

const getLastPathPart = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

const getChatProjectName = (cwd: string | null): string => {
  const normalizedCwd = cwd?.trim()
  return normalizedCwd ? getLastPathPart(normalizedCwd) : 'Unknown cwd'
}

const getApprovalTarget = (approval: NonNullable<ProviderChat['pendingApproval']>): string => {
  if (approval.command) return approval.command
  if (approval.reason) return approval.reason
  if (approval.cwd) return approval.cwd

  return approval.type === 'fileChange'
    ? 'File changes require approval'
    : 'Command requires approval'
}

export const ChatListItem: React.FC<ChatListItemProps> = ({
  chat,
  selected,
  showProject,
  committing = false,
  canMarkDone = true,
  canMarkUndone = false,
  onClick,
  onMarkDone,
  onResolveApproval,
  onTogglePinned,
  approvalDecisionInFlight = null
}) => {
  const now = useSemanticDateNow()
  const createdAt = formatSemanticLexicalDateDifference(chat.createdAt, { now })
  const isGitWorktree = chat.cwdKind === 'gitWorktree'
  const worktreeContextName = chat.worktreeBaseBranchName ?? getChatProjectName(chat.cwd)
  const contextName = isGitWorktree
    ? worktreeContextName
    : (chat.branchName ?? getChatProjectName(chat.cwd))
  const projectName = getChatProjectName(chat.projectCwd ?? chat.cwd)
  const visibleProjectName = showProject && projectName !== contextName ? projectName : null
  const ProjectIcon = isGitWorktree ? GitFork : Folder
  const contextTitle =
    isGitWorktree && chat.cwd ? `${worktreeContextName}: ${chat.cwd}` : (chat.cwd ?? contextName)
  const workingStatus = chat.status && workingStatuses.has(chat.status) ? chat.status : null
  const approvalStatus = chat.status === 'waitingOnApproval' ? chat.status : null
  const userInputStatus = chat.status === 'waitingOnUserInput' ? chat.status : null
  const trailingStatus =
    chat.status && !workingStatus && !approvalStatus && !userInputStatus ? chat.status : null
  const pendingApproval = chat.pendingApproval
  const approvalTarget = pendingApproval ? getApprovalTarget(pendingApproval) : null
  const unread = !selected && !chat.done && chat.updatedAt > (chat.seenUpdatedAt ?? chat.updatedAt)
  const finishedUnseen = unread && chat.status === null
  const showFinishedUnseen = !committing && !workingStatus && !approvalStatus && finishedUnseen

  return (
    <article
      className={`chat-list-item${pendingApproval ? ' chat-list-item--approval' : ''}${chat.pinned ? ' chat-list-item--pinned' : ''}${selected ? ' chat-list-item--selected' : ''}${showFinishedUnseen ? ' chat-list-item--unread' : ''}${userInputStatus ? ' chat-list-item--waiting-input' : ''}`}
    >
      <button
        className="chat-list-item__main"
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
      >
        <span className="chat-list-item__header">
          {committing ? (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title="Committing changes"
            >
              <GitCommitHorizontal
                className="chat-list-item__committing"
                aria-label="Committing changes"
              />
            </span>
          ) : workingStatus ? (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title={statusLabels[workingStatus]}
            >
              <LoaderCircle
                className="chat-list-item__loading"
                aria-label={statusLabels[workingStatus]}
              />
            </span>
          ) : approvalStatus ? (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title={statusLabels[approvalStatus]}
            >
              <ShieldQuestionMark
                className="chat-list-item__approval-icon"
                aria-label={statusLabels[approvalStatus]}
              />
            </span>
          ) : userInputStatus ? (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title={statusLabels[userInputStatus]}
            >
              <span
                className="chat-list-item__status chat-list-item__status--waitingOnUserInput"
                role="img"
                aria-label={statusLabels[userInputStatus]}
              />
            </span>
          ) : (
            showFinishedUnseen && (
              <span
                className="chat-list-item__status-container chat-list-item__status-container--leading"
                title={finishedUnseenLabel}
              >
                <span
                  className="chat-list-item__status chat-list-item__status--finished-unseen"
                  role="img"
                  aria-label={finishedUnseenLabel}
                />
              </span>
            )
          )}
          <span className="chat-list-item__title">{chat.title}</span>
          {trailingStatus && (
            <span className="chat-list-item__meta">
              <span
                className="chat-list-item__status-container"
                title={statusLabels[trailingStatus]}
              >
                <span
                  className={`chat-list-item__status chat-list-item__status--${trailingStatus}`}
                  role="img"
                  aria-label={statusLabels[trailingStatus]}
                />
              </span>
            </span>
          )}
        </span>
        {!pendingApproval && (
          <span className="chat-list-item__body">
            <span
              className={`chat-list-item__context${visibleProjectName ? ' chat-list-item__context--with-project' : ''}`}
              title={contextTitle}
            >
              {visibleProjectName && (
                <>
                  <span className="chat-list-item__project-category">{visibleProjectName}</span>
                  <span className="chat-list-item__separator">·</span>
                </>
              )}
              <ProjectIcon className="chat-list-item__folder" aria-hidden="true" />
              <span className="chat-list-item__project">{contextName}</span>
              {createdAt && (
                <>
                  <span className="chat-list-item__separator">·</span>
                  <time dateTime={createdAt.dateTime} title={createdAt.title}>
                    {createdAt.label}
                  </time>
                </>
              )}
            </span>
          </span>
        )}
      </button>
      {pendingApproval && approvalTarget && (
        <div className="chat-list-item__approval-row">
          <span className="chat-list-item__approval-target" title={approvalTarget}>
            <Target className="chat-list-item__approval-target-icon" aria-hidden="true" />
            <span className="chat-list-item__approval-target-text">{approvalTarget}</span>
          </span>
          <span
            className="chat-list-item__approval-actions"
            role="group"
            aria-label="Approval actions"
          >
            <Button
              aria-label={`Reject approval for ${chat.title}`}
              callback={() => onResolveApproval('deny')}
              disabled={Boolean(approvalDecisionInFlight)}
              icon={<X aria-hidden="true" />}
              size="small"
              theme="secondary"
              title="Reject"
            />
            <Button
              aria-label={`Approve approval for ${chat.title}`}
              callback={() => onResolveApproval('allow')}
              disabled={Boolean(approvalDecisionInFlight)}
              icon={<Check aria-hidden="true" />}
              size="small"
              theme="primary"
              title="Approve"
            />
          </span>
        </div>
      )}
      <span className="chat-list-item__actions">
        {!chat.done && canMarkDone && (
          <Button
            theme="transparent"
            size="small"
            aria-label="Mark chat done"
            title="Mark done"
            callback={() => onMarkDone(true)}
            icon={<Check aria-hidden="true" />}
          />
        )}
        {chat.done && canMarkUndone && (
          <Button
            theme="transparent"
            size="small"
            aria-label="Mark chat not done"
            title="Mark not done"
            callback={() => onMarkDone(false)}
            icon={<Undo2 aria-hidden="true" />}
          />
        )}
        <Button
          theme={chat.pinned ? 'secondary' : 'transparent'}
          size="small"
          aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          callback={onTogglePinned}
          icon={chat.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
        />
      </span>
    </article>
  )
}
