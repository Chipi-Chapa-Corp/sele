import { useId, useRef, useState } from 'react'
import { ChevronUp, Pencil, Target, X } from 'lucide-react'
import type { ProviderChatGoal } from '../../../shared/provider'
import { Button } from './Button'
import './ChatPlan.css'
import './ChatGoal.css'

type ChatGoalProps = {
  goal: ProviderChatGoal
  onSaveObjective: (objective: string | null) => Promise<void>
}

export const ChatGoal: React.FC<ChatGoalProps> = ({ goal, onSaveObjective }) => {
  const drawerId = useId()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [objective, setObjective] = useState(goal.objective)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)
  const expanded = open || editing

  const save = async (value: string | null): Promise<void> => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await onSaveObjective(value?.trim() || null)
      setEditing(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to update goal')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <section className="chat-plan chat-goal" aria-label="Active goal">
      <div className="chat-goal__header">
        <button
          type="button"
          className="chat-plan__toggle chat-goal__toggle"
          aria-controls={drawerId}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide goal' : 'Show goal'}
          onClick={() => {
            if (!editing) setOpen(!open)
          }}
        >
          <Target className="chat-goal__icon" aria-hidden="true" />
          <span className="chat-plan__current" title={goal.objective}>
            {goal.objective}
          </span>
          <ChevronUp className="chat-plan__chevron" aria-hidden="true" />
        </button>
        <Button
          aria-label="Edit goal"
          title="Edit goal"
          theme="secondary"
          size="small"
          disabled={saving || editing}
          icon={<Pencil aria-hidden="true" />}
          callback={() => {
            setObjective(goal.objective)
            setEditing(true)
            setError(null)
          }}
        />
        <Button
          aria-label="Cancel goal"
          title="Cancel goal"
          theme="secondary"
          size="small"
          disabled={saving}
          icon={<X aria-hidden="true" />}
          callback={() => save(null)}
        />
      </div>
      {expanded && (
        <div className="chat-plan__drawer chat-goal__drawer" id={drawerId}>
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void save(objective)
              }}
            >
              <label className="sr-only" htmlFor={`${drawerId}-objective`}>
                Goal objective
              </label>
              <textarea
                id={`${drawerId}-objective`}
                className="chat-goal__objective"
                autoFocus
                value={objective}
                disabled={saving}
                rows={4}
                onChange={(event) => setObjective(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !saving) {
                    event.preventDefault()
                    setEditing(false)
                  }
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    void save(objective)
                  }
                }}
              />
              <div className="chat-goal__actions">
                <Button
                  label="Discard"
                  theme="secondary"
                  size="small"
                  disabled={saving}
                  callback={() => setEditing(false)}
                />
                <Button
                  label={saving ? 'Saving…' : 'Save'}
                  size="small"
                  disabled={saving}
                  callback={() => save(objective)}
                />
              </div>
            </form>
          ) : (
            <p className="chat-goal__text">{goal.objective}</p>
          )}
        </div>
      )}
      {error && (
        <p className="chat-goal__error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
