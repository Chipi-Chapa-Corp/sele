import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useRef, useState } from 'react'
import type { AppSelectedAttachment, AppSelectedImage } from '../../../shared/app'
import { appApi } from '../appApi'
import { hasLinkedChatDrag, linkedChatDragType, parseLinkedChatDrag } from '../linkedChats'
import { readPastedImage } from './pastedImage'
import { maxSelectedAttachmentCount } from './composerLimits'
import type { AnnotationTool } from './imageAnnotations'

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
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool | null>(null)

  const images = selectedAttachments.filter((attachment) => attachment.kind === 'image')
  const openedImageIndex = openedImage ? images.indexOf(openedImage) : -1
  const annotationStartNumber =
    images.reduce((highest, image) => Math.max(highest, image.annotationNumber ?? 0), 0) + 1

  const navigateImage = (direction: number): void => {
    if (openedImageIndex < 0 || images.length < 2) return
    setOpenedImage(images[(openedImageIndex + direction + images.length) % images.length])
  }

  const [attachmentSelectionPending, setAttachmentSelectionPending] = useState(false)

  const [attachmentDragActive, setAttachmentDragActive] = useState(false)

  const [attachmentDragKind, setAttachmentDragKind] = useState<'files' | 'chat'>('files')

  const attachmentDragDepthRef = useRef(0)

  const attachmentLimitError = `Attach up to ${maxSelectedAttachmentCount} files per message.`

  const attachmentLimitReached = (): boolean => {
    if (selectedAttachments.length < maxSelectedAttachmentCount) return false
    setAttachmentSelectionError(attachmentLimitError)
    return true
  }

  const appendAttachments = (attachments: AppSelectedAttachment[]): void => {
    setSelectedAttachments((currentAttachments) => {
      const existingPaths = new Set(currentAttachments.map((attachment) => attachment.path))
      const nextAttachments = [
        ...currentAttachments,
        ...attachments.filter((attachment) => !existingPaths.has(attachment.path))
      ]

      if (nextAttachments.length > maxSelectedAttachmentCount) {
        setAttachmentSelectionError(attachmentLimitError)
      }

      return nextAttachments.slice(0, maxSelectedAttachmentCount)
    })
    textareaRef.current?.focus({ preventScroll: true })
  }

  const loadAttachments = async <Loaded>(
    load: () => Promise<Loaded>,
    apply: (loaded: Loaded) => void,
    logMessage: string,
    fallbackError: string
  ): Promise<void> => {
    setAttachmentSelectionPending(true)
    setAttachmentSelectionError(null)

    try {
      const selectionEditId = editSessionIdRef.current
      const loaded = await load()
      if (selectionEditId === editSessionIdRef.current) apply(loaded)
    } catch (error) {
      console.error(logMessage, error)
      setAttachmentSelectionError(error instanceof Error ? error.message : fallbackError)
    } finally {
      setAttachmentSelectionPending(false)
    }
  }

  const handleSelectAttachments = async (): Promise<void> => {
    if (attachmentSelectionPending || attachmentLimitReached()) return

    await loadAttachments(
      () => appApi.selectMessageAttachments(),
      (attachments) => {
        if (attachments.length > 0) appendAttachments(attachments)
      },
      'Unable to attach selected files.',
      'Unable to attach files.'
    )
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
    if (files.length === 0 || attachmentLimitReached()) return
    if (files.length > maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Drop up to ${maxSelectedAttachmentCount} files at a time.`)
      return
    }

    await loadAttachments(
      () => appApi.getDroppedMessageAttachments(files),
      appendAttachments,
      'Unable to attach dropped files.',
      'Unable to attach dropped files.'
    )
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const imageItem = Array.from(event.clipboardData.items).find(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    )
    if (!imageItem) return
    // Capture the paste event's file before any asynchronous work or clipboard change.
    const file = imageItem.getAsFile()

    event.preventDefault()
    if (attachmentSelectionPending || attachmentLimitReached()) return

    await loadAttachments(
      () => (file ? readPastedImage(file) : appApi.getClipboardImage()),
      (image) => {
        if (!image) throw new Error('Unable to read the pasted image.')

        setSelectedAttachments((currentAttachments) => {
          if (currentAttachments.length >= maxSelectedAttachmentCount) {
            setAttachmentSelectionError(attachmentLimitError)
            return currentAttachments
          }
          return [...currentAttachments, image]
        })
      },
      'Unable to paste an image attachment.',
      'Unable to paste this image.'
    )
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

  const handleSaveOpenedImage = (image: AppSelectedImage): void => {
    setSelectedAttachments((attachments) =>
      attachments.map((attachment) => (attachment === openedImage ? image : attachment))
    )
  }
  return {
    openedImage,
    setOpenedImage,
    annotationTool,
    setAnnotationTool,
    openedImagePosition: openedImageIndex + 1,
    imageCount: images.length,
    annotationStartNumber,
    handlePreviousImage: images.length > 1 ? () => navigateImage(-1) : undefined,
    handleNextImage: images.length > 1 ? () => navigateImage(1) : undefined,
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
    handleOpenAttachment,
    handleSaveOpenedImage
  }
}
