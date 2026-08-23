import { FileText, X } from 'lucide-react'
import type { ReactElement } from 'react'
import { getPromptDraftPreview, type PromptDraft } from '../composerDraft'
import { Button, type ButtonDropdownAction } from './Button'
import './PromptDraftsButton.css'

type PromptDraftsButtonProps = {
  drafts: readonly PromptDraft[]
  disabled?: boolean
  onPop: (draft: PromptDraft) => void
  onRemove: (draftId: string) => void
}

export const PromptDraftsButton = ({
  drafts,
  disabled = false,
  onPop,
  onRemove
}: PromptDraftsButtonProps): ReactElement | null => {
  const latestDraft = drafts.at(-1)
  if (!latestDraft) return null

  const dropdownActions: ButtonDropdownAction[] = [...drafts]
    .reverse()
    .map((draft): ButtonDropdownAction => {
      const preview = getPromptDraftPreview(draft.prompt, 80)

      return {
        id: `restore-prompt-draft-${draft.id}`,
        label: preview,
        title: draft.prompt,
        disabled,
        icon: <FileText aria-hidden="true" />,
        callback: () => onPop(draft),
        inlineActions: [
          {
            id: `remove-prompt-draft-${draft.id}`,
            ariaLabel: `Remove draft: ${preview}`,
            title: 'Remove draft',
            disabled,
            icon: <X aria-hidden="true" />,
            callback: () => onRemove(draft.id)
          }
        ]
      }
    })

  const latestPreview = getPromptDraftPreview(latestDraft.prompt)

  return (
    <span className="prompt-drafts">
      <Button
        aria-label={`Restore latest draft: ${latestPreview}`}
        callback={() => onPop(latestDraft)}
        disabled={disabled}
        dropdownActions={dropdownActions}
        dropdownLabel="Drafts"
        dropdownMenuAlign="end"
        dropdownPlacement="top"
        label={latestPreview}
        theme="secondary"
        title={latestDraft.prompt}
      />
    </span>
  )
}
