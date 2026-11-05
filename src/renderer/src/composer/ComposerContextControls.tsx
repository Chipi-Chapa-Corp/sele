import { memo, useMemo } from 'react'
import type { MessageBoxProps } from '../components/MessageBox.types'
import { ActionsButton } from '../components/ActionsButton'
import { ChatGoalButton } from '../components/ChatGoalButton'
import { CwdNotesButton } from '../components/CwdNotesButton'
import { UsageIndicator } from '../components/UsageIndicator'

type Props = { settings: MessageBoxProps; compact: boolean }

// These controls depend on chat settings, not the live draft. Keep their JSX
// and subscriptions out of the textarea's per-keystroke render path.
export const ComposerWorkspaceControls = memo(function ComposerWorkspaceControls({
  settings,
  compact
}: Props) {
  const {
    onSetGoal,
    providerId,
    chatId,
    goalObjective,
    disabled = false,
    operationsDisabled = false,
    providerUpdating = false,
    pending = false,
    showNotesButton = false,
    notesLabel,
    notesContextKey,
    notes = [],
    onNotesChange,
    showActions = false,
    actions = [],
    lastActionId,
    projectCwd,
    showActionLabel = false,
    onActionsChange,
    onLastActionChange,
    onRunAction
  } = settings
  const notesButtonVisible = Boolean(showNotesButton && notesLabel && onNotesChange)
  const actionsButtonVisible = Boolean(
    showActions && onActionsChange && onLastActionChange && onRunAction
  )
  return (
    <>
      {onSetGoal && (
        <ChatGoalButton
          triggerLabel={compact ? 'Goal' : undefined}
          key={`${providerId}:${chatId}`}
          objective={goalObjective}
          disabled={disabled || operationsDisabled || providerUpdating || pending}
          onSetGoal={onSetGoal}
        />
      )}
      {notesButtonVisible && (
        <CwdNotesButton
          triggerLabel={compact ? 'Notes' : undefined}
          key={notesContextKey}
          label={notesLabel!}
          notes={notes}
          onNotesChange={onNotesChange!}
        />
      )}
      {actionsButtonVisible && (
        <ActionsButton
          triggerLabel={compact ? 'Actions' : undefined}
          actions={actions}
          label={notesLabel ?? 'Workspace'}
          lastActionId={lastActionId}
          projectCwd={projectCwd}
          showLabel={showActionLabel}
          onActionsChange={onActionsChange!}
          onLastActionChange={onLastActionChange!}
          onRunAction={onRunAction!}
        />
      )}
    </>
  )
})

export const ComposerUsageControl = memo(function ComposerUsageControl({
  settings,
  compact
}: Props) {
  const {
    showUsageIndicator = true,
    providerId,
    chatId,
    container = null,
    models,
    model,
    accountUsage,
    accountUsageError,
    accountUsageState,
    contextUsage,
    displayUsage,
    disabled = false,
    operationsDisabled = false,
    active = false,
    pending = false,
    onCompact,
    onUsageRefresh,
    onUsageReset,
    onQueueLimitReset
  } = settings
  const selectedModel = useMemo(
    () => models.find((candidate) => candidate.id === model),
    [models, model]
  )
  return (
    <>
      {showUsageIndicator && (
        <UsageIndicator
          triggerLabel={compact ? 'Limits and usage' : undefined}
          queueTriggerLabel={compact ? 'On reset' : undefined}
          providerId={providerId}
          chatId={chatId}
          container={container}
          modelUsageScope={selectedModel?.usageScope}
          modelProviderId={selectedModel?.modelProvider?.id}
          accountUsage={accountUsage}
          accountUsageError={accountUsageError}
          accountUsageState={accountUsageState}
          contextUsage={contextUsage}
          displayUsage={displayUsage}
          compactDisabled={disabled || operationsDisabled || active || pending}
          onCompact={onCompact}
          onUsageRefresh={onUsageRefresh}
          onUsageReset={onUsageReset}
          onQueueLimitReset={onQueueLimitReset}
        />
      )}
    </>
  )
})
