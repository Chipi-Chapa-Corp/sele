import { Check, X } from 'lucide-react'
import type { ProviderApprovalDecision, ProviderPendingApproval } from '../../../shared/provider'
import { Button } from './Button'

export const ApprovalRequestBox = ({
  approval,
  disabled,
  error,
  onResolve
}: {
  approval: ProviderPendingApproval
  disabled?: boolean
  error?: string | null
  onResolve: (decision: ProviderApprovalDecision) => Promise<void> | void
}): React.ReactElement => (
  <section
    className={`chat-approval${approval.type === 'permissions' ? ' chat-permission-request' : ''}`}
    aria-label="Approval request"
  >
    <div className="chat-approval__main">
      <span className="chat-approval__label">
        {
          {
            command: 'Command approval',
            fileChange: 'File change approval',
            browser: 'Browser permission',
            permissions: 'Additional access requested'
          }[approval.type]
        }
      </span>
      <span
        className="chat-approval__summary"
        title={approval.command ?? approval.reason ?? approval.cwd ?? ''}
      >
        {approval.command ?? approval.reason ?? approval.cwd ?? 'Approval required'}
      </span>
      {approval.cwd && (approval.command || approval.type === 'permissions') && (
        <span className="chat-approval__cwd">{approval.cwd}</span>
      )}
      {approval.permissionDetails && (
        <ul className="chat-permission-request__details">
          {approval.permissionDetails.map((detail, index) => (
            <li key={`${index}:${detail}`}>{detail}</li>
          ))}
        </ul>
      )}
      {error && (
        <span className="chat-approval__error" role="status">
          {error}
        </span>
      )}
    </div>
    <div className="chat-approval__actions">
      <Button
        disabled={disabled}
        callback={() => onResolve('deny')}
        icon={<X aria-hidden="true" />}
        label="Deny"
        theme="secondary"
      />
      {approval.type === 'permissions' && (
        <Button
          disabled={disabled}
          callback={() => onResolve('allowSession')}
          label="Allow for session"
          theme="secondary"
        />
      )}
      <Button
        disabled={disabled}
        callback={() => onResolve('allow')}
        icon={<Check aria-hidden="true" />}
        label={approval.type === 'permissions' ? 'Allow for this turn' : 'Allow'}
        theme="primary"
      />
    </div>
  </section>
)
