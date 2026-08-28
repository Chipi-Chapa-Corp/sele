import { useEffect, useRef, useState } from 'react'
import { Check, Link } from 'lucide-react'
import { appApi } from '../appApi'
import { Button } from './Button'

export const SettingsSkillPathAction = ({ path }: { path: string }): React.ReactElement => {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    },
    []
  )

  const handleCopy = async (): Promise<void> => {
    await appApi.writeClipboardText(path)
    setCopied(true)

    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copiedTimerRef.current = null
    }, 1_000)
  }

  return (
    <span className="settings-dialog__skill-path-action">
      <Button
        aria-label={copied ? `Copied skill path: ${path}` : `Copy skill path: ${path}`}
        callback={handleCopy}
        icon={copied ? <Check aria-hidden="true" /> : <Link aria-hidden="true" />}
        size="small"
        theme="transparent"
        title={path}
      />
    </span>
  )
}
