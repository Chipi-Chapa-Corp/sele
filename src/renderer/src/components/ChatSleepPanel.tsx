import { useState } from 'react'
import { formatSleepDuration, parseSleepDuration } from '../chatSleepStore.ts'
import { Button } from './Button'
import { Input } from './Input'
import './ChatSleepPanel.css'

const presets = ['30m', '1h', '1d'] as const

export const formatWakeIn = (wakeAt: number): string =>
  `Wakes in ${formatSleepDuration(wakeAt - Date.now())}`

type ChatSleepPanelProps = {
  wakeAt: number | null | undefined
  onSleep: (durationMs: number) => void
}

export const ChatSleepPanel = ({ wakeAt, onSleep }: ChatSleepPanelProps): React.ReactElement => {
  const [draft, setDraft] = useState('')
  const durationMs = parseSleepDuration(draft)
  const invalid = draft.trim().length > 0 && durationMs === null

  return (
    <div className="chat-sleep-panel">
      {typeof wakeAt === 'number' && (
        <p className="chat-sleep-panel__status">{formatWakeIn(wakeAt)}</p>
      )}
      <div className="chat-sleep-panel__presets">
        {presets.map((preset) => (
          <Button
            key={preset}
            theme="secondary"
            size="small"
            label={preset}
            aria-label={`Sleep for ${preset}`}
            callback={() => onSleep(parseSleepDuration(preset) as number)}
          />
        ))}
      </div>
      <div className="chat-sleep-panel__custom">
        <Input
          autoFocus
          aria-invalid={invalid || undefined}
          aria-label="Sleep duration"
          autoComplete="off"
          placeholder="1w 3d 5h 6m"
          spellCheck={false}
          title="Weeks, days, hours and minutes, like 1w 3d 5h 6m"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (durationMs !== null) onSleep(durationMs)
          }}
        />
        <Button
          theme="primary"
          size="small"
          label="Sleep"
          disabled={durationMs === null}
          callback={() => {
            if (durationMs !== null) onSleep(durationMs)
          }}
        />
      </div>
    </div>
  )
}
