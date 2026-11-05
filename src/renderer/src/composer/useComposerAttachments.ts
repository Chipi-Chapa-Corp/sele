import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useRef, useState } from 'react'
import type { AppSelectedAttachment } from '../../../shared/app'
import { appApi } from '../appApi'
import { hasLinkedChatDrag, linkedChatDragType, parseLinkedChatDrag } from '../linkedChats'
import { maxSelectedAttachmentCount } from './composerLimits'

const getComposerDragKind = (dataTransfer: DataTransfer): 'files' | 'chat' | null => {
  const types = Array.from(dataTransfer.types)
  if (types.includes('Files')) return 'files'
  return hasLinkedChatDrag(types) ? 'chat' : null
}

import type { MessageBoxProps } from '../components/MessageBox.types'
import type { useComposerDraftState } from './useComposerDraftState'
import type { useComposerLinkedChats } from './useComposerLinkedChats'

type ComposerAttachmentsDependencies = {
  options: Pick<MessageBoxProps, 'onOpenAttachment'>
  draft: Pick<
    ReturnType<typeof useComposerDraftState>,
    'selectedAttachments' | 'setSelectedAttachments' | 'setSelectedSkills' | 'setSelectedApps'
  >
  linked: Pick<ReturnType<typeof useComposerLinkedChats>, 'handleLinkChat'>
  setAttachmentSelectionError: Dispatch<SetStateAction<string | null>>
  editSessionIdRef: RefObject<string | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function useComposerAttachments({
  options,
  draft,
  linked,
  setAttachmentSelectionError,
  editSessionIdRef,
  textareaRef
}: ComposerAttachmentsDependencies) {
  const { onOpenAttachment } = options
  const { selectedAttachments, setSelectedAttachments, setSelectedSkills, setSelectedApps } = draft
  const { handleLinkChat } = linked

  const [openedImage, setOpenedImage] = useState<Extract<
    AppSelectedAttachment,
    { kind: 'image' }
  > | null>(null)

  const [attachmentSelectionPending, setAttachmentSelectionPending] = useState(false)

  const [attachmentDragActive, setAttachmentDragActive] = useState(false)

  const [attachmentDragKind, setAttachmentDragKind] = useState<'files' | 'chat'>('files')

  const attachmentDragDepthRef = useRef(0)

  const handleSelectAttachments = async (): Promise<void> => {
    if (attachmentSelectionPending) return
    if (selectedAttachments.length >= maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Attach up to ${maxSelectedAttachmentCount} files per message.`)
      return
    }

    setAttachmentSelectionPending(true)
    setAttachmentSelectionError(null)

    try {
      const selectionEditId = editSessionIdRef.current
      const attachments = await appApi.selectMessageAttachments()
      if (selectionEditId !== editSessionIdRef.current) return
      if (attachments.length === 0) return

      setSelectedAttachments((currentAttachments) => {
        const existingPaths = new Set(currentAttachments.map((attachment) => attachment.path))
        const nextAttachments = [
          ...currentAttachments,
          ...attachments.filter((attachment) => !existingPaths.has(attachment.path))
        ]

        if (nextAttachments.length > maxSelectedAttachmentCount) {
          setAttachmentSelectionError(
            `Attach up to ${maxSelectedAttachmentCount} files per message.`
          )
        }

        return nextAttachments.slice(0, maxSelectedAttachmentCount)
      })
      textareaRef.current?.focus({ preventScroll: true })
    } catch (selectionError) {
      console.error('Unable to attach selected files.', selectionError)
      setAttachmentSelectionError(
        selectionError instanceof Error ? selectionError.message : 'Unable to attach files.'
      )
    } finally {
      setAttachmentSelectionPending(false)
    }
  }

  const handleAttachmentDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
    const kind = getComposerDragKind(event.dataTransfer)
    if (!kind) return

    event.preventDefault()
    attachmentDragDepthRef.current += 1
    setAttachmentDragKind(kind)
    if (kind === 'chat' || !attachmentSelectionPending) {
      setAttachmentDragActive(true)
    }
  }

  const handleAttachmentDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    const kind = getComposerDragKind(event.dataTransfer)
    if (!kind) return

    event.preventDefault()
    event.dataTransfer.dropEffect = kind === 'files' && attachmentSelectionPending ? 'none' : 'copy'
  }

  const handleAttachmentDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!getComposerDragKind(event.dataTransfer)) return

    event.preventDefault()
    attachmentDragDepthRef.current = Math.max(0, attachmentDragDepthRef.current - 1)
    if (attachmentDragDepthRef.current === 0) setAttachmentDragActive(false)
  }

  const handleAttachmentDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    const kind = getComposerDragKind(event.dataTransfer)
    if (!kind) return

    event.preventDefault()
    attachmentDragDepthRef.current = 0
    setAttachmentDragActive(false)

    if (kind === 'chat') {
      const reference = parseLinkedChatDrag(event.dataTransfer.getData(linkedChatDragType))
      if (reference) handleLinkChat(reference)
      return
    }

    if (attachmentSelectionPending) return

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    if (selectedAttachments.length >= maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Attach up to ${maxSelectedAttachmentCount} files per message.`)
      return
    }
    if (files.length > maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Drop up to ${maxSelectedAttachmentCount} files at a time.`)
      return
    }

    setAttachmentSelectionPending(true)
    setAttachmentSelectionError(null)

    try {
      const selectionEditId = editSessionIdRef.current
      const attachments = await appApi.getDroppedMessageAttachments(files)
      if (selectionEditId !== editSessionIdRef.current) return
      setSelectedAttachments((currentAttachments) => {
        const existingPaths = new Set(currentAttachments.map((attachment) => attachment.path))
        const nextAttachments = [
          ...currentAttachments,
          ...attachments.filter((attachment) => !existingPaths.has(attachment.path))
        ]

        if (nextAttachments.length > maxSelectedAttachmentCount) {
          setAttachmentSelectionError(
            `Attach up to ${maxSelectedAttachmentCount} files per message.`
          )
        }

        return nextAttachments.slice(0, maxSelectedAttachmentCount)
      })
      textareaRef.current?.focus({ preventScroll: true })
    } catch (dropError) {
      console.error('Unable to attach dropped files.', dropError)
      setAttachmentSelectionError(
        dropError instanceof Error ? dropError.message : 'Unable to attach dropped files.'
      )
    } finally {
      setAttachmentSelectionPending(false)
    }
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const hasImage = Array.from(event.clipboardData.items).some(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    )
    if (!hasImage) return

    event.preventDefault()
    if (attachmentSelectionPending) return
    if (selectedAttachments.length >= maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Attach up to ${maxSelectedAttachmentCount} files per message.`)
      return
    }

    setAttachmentSelectionPending(true)
    setAttachmentSelectionError(null)

    try {
      const selectionEditId = editSessionIdRef.current
      const image = await appApi.getClipboardImage()
      if (selectionEditId !== editSessionIdRef.current) return
      if (!image) throw new Error('Unable to read the pasted image.')

      setSelectedAttachments((currentAttachments) => {
        if (currentAttachments.length >= maxSelectedAttachmentCount) {
          setAttachmentSelectionError(
            `Attach up to ${maxSelectedAttachmentCount} files per message.`
          )
          return currentAttachments
        }
        return [...currentAttachments, image]
      })
    } catch (pasteError) {
      console.error('Unable to paste an image attachment.', pasteError)
      setAttachmentSelectionError(
        pasteError instanceof Error ? pasteError.message : 'Unable to paste this image.'
      )
    } finally {
      setAttachmentSelectionPending(false)
    }
  }

  const handleRemoveAttachment = (path: string): void => {
    setSelectedAttachments((attachments) =>
      attachments.filter((attachment) => attachment.path !== path)
    )
    setAttachmentSelectionError(null)
    textareaRef.current?.focus({ preventScroll: true })
  }

  const handleRemoveSkill = (path: string): void => {
    setSelectedSkills((skills) => skills.filter((skill) => skill.path !== path))
    textareaRef.current?.focus({ preventScroll: true })
  }

  const handleRemoveApp = (id: string): void => {
    setSelectedApps((apps) => apps.filter((app) => app.id !== id))
    textareaRef.current?.focus({ preventScroll: true })
  }

  const handleOpenAttachment = (attachment: AppSelectedAttachment): void => {
    if (attachment.kind === 'image') {
      setOpenedImage(attachment)
      return
    }

    onOpenAttachment?.(attachment)
  }
  return {
    openedImage,
    setOpenedImage,
    attachmentSelectionPending,
    attachmentDragActive,
    attachmentDragKind,
    handleSelectAttachments,
    handleAttachmentDragEnter,
    handleAttachmentDragOver,
    handleAttachmentDragLeave,
    handleAttachmentDrop,
    handlePaste,
    handleRemoveAttachment,
    handleRemoveSkill,
    handleRemoveApp,
    handleOpenAttachment
  }
}
