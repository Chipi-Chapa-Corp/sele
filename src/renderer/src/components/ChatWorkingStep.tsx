import { Spinner } from './Spinner'
import { ChevronRight } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import 'react-diff-view/style/index.css'
import type { ProviderWorkingStep } from '../../../shared/provider'
import { getWorkingStepItemSegments } from '../chatDetailWindow'
import { useWorkingToolMotion } from '../motion/useWorkingToolMotion'
import { type AppChatProgressSettings } from '../settings'
import {
  getWorkingStepDefaultOpen,
  getWorkingStepDisclosureKey,
  resolveWorkingStepOpen
} from '../workingStepDisclosure'
import './ChatDetailItem.css'
import type { ChatDetailItemProps } from './ChatDetailItem.types'
import { ToolItem, isWorkingItemPayloadLoaded } from './ChatToolActivity'
import './UnifiedDiff.css'
import { WorkingElapsedTime } from './WorkingElapsedTime'
import { WorkingStepActions } from './WorkingStepActions'
import { WorkingStepContent } from './WorkingStepContent'
import {
  getActiveToolIds,
  groupWorkingItems,
  partitionGeneratedImageItems,
  workingItemPageSize
} from './workingStepPresentation'

export const WorkingStep: React.FC<
  Omit<ChatDetailItemProps, 'item' | 'progressSettings'> & {
    continueDisabled: boolean
    item: ProviderWorkingStep
    onContinue?: () => Promise<void> | void
    onLoad?: (startIndex?: number) => Promise<void> | void
    onLoadItem?: (itemId: string) => Promise<void> | void
    onLoadToolPage?: (workingItemId: string, startIndex: number) => Promise<void> | void
    onRetry?: () => Promise<void> | void
    progressSettings: AppChatProgressSettings
    retryDisabled: boolean
  }
> = ({
  authenticationRequired = true,
  availableRateLimitResets = 0,
  rateLimitResetOptions,
  container,
  continueDisabled,
  continuedStoppedTurn = false,
  followingWorkingStepHasNext = false,
  followingWorkingStepStatus,
  hasNextWorkingStep = false,
  item,
  cwd,
  onContinue,
  onLoad,
  onLoadItem,
  onLoadToolPage,
  onDisclosureToggle,
  onOpenFileLink,
  onRetry,
  onManageAccounts,
  onReauthenticate,
  onUsageRefresh,
  onUsageReset,
  projectCwd,
  progressPolicy = 'regular',
  progressDisclosureTarget,
  progressSettings,
  rateLimitResetDisabled = false,
  retryDisabled
}) => {
  const [continueClicked, setContinueClicked] = useState(false)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [openAfterLoad, setOpenAfterLoad] = useState(false)
  const [rateLimitResetMessage, setRateLimitResetMessage] = useState<string | null>(null)
  const unloaded = item.itemsLoaded === false
  const linkedToFollowingStep = continuedStoppedTurn || continueClicked
  const failureMessage = item.status === 'failed' ? item.failureMessage?.trim() : null
  const authenticationFailed =
    authenticationRequired && item.status === 'failed' && item.failureReason === 'authentication'
  const itemSegments = getWorkingStepItemSegments(item, workingItemPageSize)
  const renderedSegments = itemSegments.map((segment) => {
    const { generatedImages, remaining } = partitionGeneratedImageItems(segment.items)
    return {
      ...segment,
      blocks: groupWorkingItems(
        remaining.filter(
          (workingItem) =>
            workingItem.type !== 'message' ||
            !isWorkingItemPayloadLoaded(workingItem) ||
            (Boolean(workingItem.content.trim()) && workingItem.content.trim() !== failureMessage)
        )
      ),
      generatedImages
    }
  })
  const generatedImages = renderedSegments.flatMap((segment) => segment.generatedImages)
  const blockCount = renderedSegments.reduce((count, segment) => count + segment.blocks.length, 0)
  const lastWorkingItem = item.items.at(-1)
  const activeToolIds = useMemo(() => getActiveToolIds(item), [item])
  const active = item.status === 'working'
  const itemCount = Math.max(item.itemCount ?? item.items.length, item.items.length)
  const hasHiddenItems =
    renderedSegments.some((segment, segmentIndex) => {
      const previousSegment = renderedSegments[segmentIndex - 1]
      const previousEndIndex = previousSegment
        ? previousSegment.startIndex + previousSegment.items.length
        : 0
      return segment.startIndex > previousEndIndex
    }) ||
    (renderedSegments.at(-1)?.startIndex ?? 0) + (renderedSegments.at(-1)?.items.length ?? 0) <
      itemCount
  const preserveOpenDuringContinuedWork =
    continueClicked && followingWorkingStepStatus === 'working' && !followingWorkingStepHasNext
  const collapseWithFollowingStep =
    linkedToFollowingStep && followingWorkingStepStatus != null && !preserveOpenDuringContinuedWork
  const autoCollapseStatus = collapseWithFollowingStep ? followingWorkingStepStatus : item.status
  const autoCollapseHasNextWorkingStep = collapseWithFollowingStep
    ? followingWorkingStepHasNext
    : linkedToFollowingStep
      ? false
      : hasNextWorkingStep
  const defaultOpen = getWorkingStepDefaultOpen(
    progressDisclosureTarget?.status ?? autoCollapseStatus,
    progressDisclosureTarget?.progressPolicy ?? progressPolicy,
    progressSettings,
    progressDisclosureTarget?.hasNextWorkingStep ?? autoCollapseHasNextWorkingStep
  )
  const disclosureKey = getWorkingStepDisclosureKey(
    progressDisclosureTarget?.status ?? autoCollapseStatus,
    progressDisclosureTarget?.progressPolicy ?? progressPolicy,
    progressSettings,
    progressDisclosureTarget?.hasNextWorkingStep ?? autoCollapseHasNextWorkingStep
  )
  const [openState, setOpenState] = useState({ key: disclosureKey, open: defaultOpen })
  const preferredOpen = resolveWorkingStepOpen(openState, disclosureKey, defaultOpen)
  const open = openAfterLoad ? true : preferredOpen
  const workingContentRef = useRef<HTMLDivElement>(null)
  useWorkingToolMotion(workingContentRef, item, itemSegments, open && active && !unloaded)
  const label =
    item.status === 'queued'
      ? 'Queued'
      : item.status === 'stopped'
        ? 'Stopped'
        : item.status === 'failed'
          ? item.failureReason === 'rateLimit'
            ? 'Usage limit reached'
            : 'Failed'
          : item.status === 'worked'
            ? progressDisclosureTarget?.status === 'working'
              ? 'Work so far'
              : 'Worked'
            : 'Working'
  const failureText =
    item.status === 'failed'
      ? failureMessage ||
        (item.failureReason === 'rateLimit'
          ? 'The provider’s rate or usage limit has been reached.'
          : 'The provider did not supply a failure reason.')
      : null
  const heading = (
    <span className="chat-detail__working-label">
      {active && (
        <Spinner className="app-loading-spinner chat-detail__working-spinner" aria-hidden="true" />
      )}
      <span>
        {label}
        {item.status === 'worked' && <WorkingElapsedTime item={item} />}
      </span>
    </span>
  )
  const failureLabel = failureText ? (
    <div className="chat-detail__failure-label" role="status">
      {failureText}
      {authenticationFailed && <div>Sign in again to continue this conversation.</div>}
    </div>
  ) : null
  const renderedGeneratedImages = generatedImages.map((imageItem) => (
    <ToolItem
      item={imageItem}
      activeToolIds={activeToolIds}
      key={imageItem.id}
      projectCwd={projectCwd}
    />
  ))
  const rateLimitResetActions =
    item.status === 'failed' &&
    item.failureReason === 'rateLimit' &&
    availableRateLimitResets > 0 &&
    onUsageReset &&
    onContinue
      ? { onContinue, onReset: onUsageReset }
      : null
  const hasStoppedOrFailed = item.status === 'stopped' || item.status === 'failed'
  const turnActions =
    !linkedToFollowingStep &&
    ((hasStoppedOrFailed && (onRetry || onContinue)) ||
      (authenticationFailed && (onReauthenticate || onManageAccounts)) ||
      rateLimitResetActions) ? (
      <WorkingStepActions
        authenticationFailed={authenticationFailed}
        onReauthenticate={onReauthenticate}
        onManageAccounts={onManageAccounts}
        hasStoppedOrFailed={hasStoppedOrFailed}
        onRetry={onRetry}
        item={item}
        retryDisabled={retryDisabled}
        onContinue={onContinue}
        continueDisabled={continueDisabled}
        setContinueClicked={setContinueClicked}
        rateLimitResetActions={rateLimitResetActions}
        availableRateLimitResets={availableRateLimitResets}
        rateLimitResetOptions={rateLimitResetOptions}
        rateLimitResetDisabled={rateLimitResetDisabled}
        setRateLimitResetMessage={setRateLimitResetMessage}
        onUsageRefresh={onUsageRefresh}
        rateLimitResetMessage={rateLimitResetMessage}
      />
    ) : null

  const loadPage = async (startIndex: number): Promise<void> => {
    if (!onLoad || loadState === 'loading') return
    setLoadState('loading')
    try {
      await onLoad(startIndex)
      setLoadState('idle')
    } catch (error) {
      console.error('[caught:ChatDetailItem:loadPage]', error)
      setLoadState('error')
    }
  }

  const staticWorkingStep = (
    <>
      <div
        className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
      >
        <div className="chat-detail__working-heading">{heading}</div>
      </div>
      {renderedGeneratedImages}
      {failureLabel}
      {turnActions}
    </>
  )

  if (unloaded && itemCount === 0) return staticWorkingStep

  if (unloaded) {
    const handleLoad = async (): Promise<void> => {
      if (loadState === 'loading') return

      onDisclosureToggle?.()
      setOpenAfterLoad(true)
      await loadPage(Math.max(0, itemCount - workingItemPageSize))
    }

    return (
      <>
        <div
          className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
        >
          <button
            className="chat-detail__working-load"
            type="button"
            aria-label={
              loadState === 'error' ? `Retry loading ${label} section` : `Load ${label} section`
            }
            disabled={!onLoad || loadState === 'loading'}
            onClick={handleLoad}
          >
            {heading}
            {loadState === 'loading' ? (
              <Spinner
                className="app-loading-spinner chat-detail__working-spinner"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
            )}
          </button>
          {loadState === 'error' && (
            <span className="chat-detail__working-load-error" role="status">
              Unable to load. Select the section to retry.
            </span>
          )}
        </div>
        {failureLabel}
        {turnActions}
      </>
    )
  }

  if (!active && blockCount === 0 && !hasHiddenItems) {
    if (item.status !== 'stopped' && renderedGeneratedImages.length > 0) {
      return (
        <>
          {renderedGeneratedImages}
          {failureLabel}
          {turnActions}
        </>
      )
    }

    return staticWorkingStep
  }

  return (
    <>
      <details
        className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
        open={open}
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open
          if (openAfterLoad) {
            setOpenAfterLoad(false)
            setOpenState({ key: disclosureKey, open: nextOpen })
            return
          }
          if (nextOpen !== open) setOpenState({ key: disclosureKey, open: nextOpen })
        }}
      >
        <summary
          onClick={(event) => {
            // Commit the disclosure and its contents together. Waiting for the
            // browser's queued toggle event can leave an opened section empty.
            event.preventDefault()
            setOpenAfterLoad(false)
            setOpenState({ key: disclosureKey, open: !open })
            onDisclosureToggle?.()
          }}
        >
          {heading}
          <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
        </summary>
        {open && (
          <WorkingStepContent
            workingContentRef={workingContentRef}
            renderedSegments={renderedSegments}
            onLoad={onLoad}
            loadState={loadState}
            loadPage={loadPage}
            activeToolIds={activeToolIds}
            active={active}
            lastWorkingItem={lastWorkingItem}
            onLoadItem={onLoadItem}
            onLoadToolPage={onLoadToolPage}
            onDisclosureToggle={onDisclosureToggle}
            projectCwd={projectCwd}
            container={container}
            cwd={cwd}
            onOpenFileLink={onOpenFileLink}
            itemCount={itemCount}
          />
        )}
      </details>
      {renderedGeneratedImages}
      {failureLabel}
      {turnActions}
    </>
  )
}
