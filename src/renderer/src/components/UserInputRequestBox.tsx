import { Check, X } from 'lucide-react'
import { useId, useState } from 'react'
import type { ProviderPendingUserInput } from '../../../shared/provider'
import { Button } from './Button'
import { Input } from './Input'

type UserInputRequestBoxProps = {
  disabled?: boolean
  error?: string | null
  request: ProviderPendingUserInput
  onCancel: () => Promise<void> | void
  onSubmit: (answer: string, wasFreeform: boolean) => Promise<void> | void
}

export const UserInputRequestBox = ({
  disabled = false,
  error = null,
  request,
  onCancel,
  onSubmit
}: UserInputRequestBoxProps): React.ReactElement => {
  const questionId = useId()
  const [freeformAnswer, setFreeformAnswer] = useState('')

  const answer = freeformAnswer.trim()

  const handleSubmit = (): void => {
    if (disabled || !answer) return
    void onSubmit(answer, true)
  }

  return (
    <section
      className="chat-approval chat-user-input"
      aria-labelledby={questionId}
      aria-label="Interactive question"
    >
      <span className="chat-user-input__dismiss">
        <Button
          aria-label="Cancel question"
          callback={() => void onCancel()}
          disabled={disabled}
          icon={<X aria-hidden="true" />}
          size="small"
          theme="transparent"
          title="Cancel"
        />
      </span>
      <div className="chat-approval__main">
        <span className="chat-approval__summary chat-user-input__question" id={questionId}>
          {request.question}
        </span>
        {request.choices.length > 0 && (
          <div className="chat-user-input__choices" role="group" aria-label="Answer choices">
            {request.choices.map((choice, index) => (
              <Button
                callback={() => onSubmit(choice, false)}
                disabled={disabled}
                key={`${index}:${choice}`}
                label={<span>{choice}</span>}
                size="small"
                theme="secondary"
                title={choice}
              />
            ))}
          </div>
        )}
        {request.allowFreeform && (
          <div className="chat-user-input__answer">
            <Input
              aria-label="Answer Copilot's question"
              autoFocus
              className="chat-user-input__input"
              disabled={disabled}
              placeholder={request.choices.length > 0 ? 'Or type an answer…' : 'Type your answer…'}
              value={freeformAnswer}
              onChange={(event) => setFreeformAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                handleSubmit()
              }}
            />
            {answer && (
              <Button
                callback={handleSubmit}
                disabled={disabled}
                icon={<Check aria-hidden="true" />}
                label={<span>Submit</span>}
                theme="primary"
              />
            )}
          </div>
        )}
        {error && (
          <span className="chat-approval__error" role="status">
            {error}
          </span>
        )}
      </div>
    </section>
  )
}
