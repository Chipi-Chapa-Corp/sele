import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/Button'

type ConversationHeaderContentProps = WorkspaceController['conversationHeader']

export function ConversationHeaderContent(props: ConversationHeaderContentProps): ReactElement {
  const { handleBack } = props

  return (
    <header className="chat-detail__header">
      <div className="chat-detail__drag-region">
        <div className="chat-detail__header-inner">
          <span className="chat-detail__back-slot">
            <Button
              theme="transparent"
              aria-label="Back"
              title="Back"
              callback={handleBack}
              icon={<ArrowLeft aria-hidden="true" />}
            />
          </span>
        </div>
      </div>
    </header>
  )
}
