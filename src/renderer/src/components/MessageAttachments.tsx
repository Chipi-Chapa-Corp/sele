import { Blocks, Globe2, Image as ImageIcon, ImageOff, MessagesSquare, Package } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ProviderMessageAttachment } from '../../../shared/provider'
import { chatMediaId } from '../chatMedia'
import { type ChatMessageResource } from '../chatMessageResources'
import { useLocalMedia } from '../useLocalMedia'
import './ChatDetailItem.css'
import { useChatMedia } from './ChatMediaGallery'
import { ImageLightbox } from './ImageLightbox'
import { useLinkedChatOpener } from './LinkedChatOpener'
import { ReviewCommentsButton } from './ReviewCommentsButton'
import { FileIcon as SymbolsFileIcon } from './SymbolIcons'

export const GeneratedImageThumbnail: React.FC<{
  path?: string | null
  initialDataUrl?: string | null
  name?: string
  mediaId: string
}> = ({ path, initialDataUrl, name = 'Generated image', mediaId }) => {
  const { open: openGallery } = useChatMedia()
  const loaded = useLocalMedia(path ? { path } : null)
  const [open, setOpen] = useState(false)
  // A selected attachment already has decoded preview pixels. Keep displaying
  // them while its durable file loads, including when confirmation drops dataUrl.
  const preview = useRef({ path, url: initialDataUrl })
  useLayoutEffect(() => {
    if (loaded?.url) preview.current = { path, url: undefined }
    else if (preview.current.path !== path) preview.current = { path, url: initialDataUrl }
    else if (initialDataUrl) preview.current.url = initialDataUrl
  }, [path, initialDataUrl, loaded?.url])
  const imageUrl =
    loaded?.url ?? initialDataUrl ?? (preview.current.path === path ? preview.current.url : null)
  const failed = !imageUrl && (path ? Boolean(loaded?.error) : !initialDataUrl)

  if (failed) {
    return (
      <span
        className="chat-detail__generated-image-error"
        title={`${path ?? name} unavailable`}
        aria-label={`${name} unavailable`}
      >
        <ImageOff aria-hidden="true" />
      </span>
    )
  }

  if (!imageUrl) {
    return (
      <span className="chat-detail__generated-image-loading" aria-label="Loading image">
        <ImageIcon aria-hidden="true" />
      </span>
    )
  }

  return (
    <>
      <button
        className="chat-detail__generated-image-thumbnail"
        type="button"
        title={`Open ${name}`}
        aria-label={`Open ${name}`}
        onClick={() => {
          if (openGallery)
            openGallery({ id: mediaId, mediaType: 'image', name, path, url: imageUrl })
          else setOpen(true)
        }}
      >
        <img src={imageUrl} alt={name} />
      </button>
      {open && (
        <ImageLightbox imageUrl={imageUrl} name={name} path={path} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

export const MessageAttachments: React.FC<{
  attachments: ProviderMessageAttachment[]
  onOpenFileLink:
    | ((path: string, displayPath: string, line?: number, endLine?: number) => void)
    | undefined
  projectCwd: string | null | undefined
  resources: ChatMessageResource[]
}> = ({ attachments, onOpenFileLink, projectCwd, resources }) => {
  const { scope } = useChatMedia()
  const openLinkedChat = useLinkedChatOpener()
  const imageAttachments = attachments.filter((attachment) => attachment.kind === 'image')
  const otherAttachments = attachments.filter((attachment) => attachment.kind !== 'image')

  return (
    <div className="chat-detail__message-attachments">
      {imageAttachments.length > 0 && (
        <div
          className="chat-detail__message-attachment-group chat-detail__message-attachment-group--images"
          role="list"
          aria-label="Message images"
        >
          {imageAttachments.map((attachment, index) => (
            <div
              className="chat-detail__message-attachment"
              key={`${attachment.kind}:${attachment.path ?? attachment.name}:${index}`}
              role="listitem"
            >
              <GeneratedImageThumbnail
                mediaId={chatMediaId(scope, 'attachment', index)}
                path={attachment.path}
                initialDataUrl={attachment.dataUrl}
                name={attachment.name}
              />
            </div>
          ))}
        </div>
      )}
      {(resources.length > 0 || otherAttachments.length > 0) && (
        <div
          className="chat-detail__message-attachment-group chat-detail__message-attachment-group--other"
          role="list"
          aria-label="Other message attachments"
        >
          {resources.map((resource, index) =>
            resource.kind === 'linkedChat' ? (
              <div
                className="chat-detail__message-attachment"
                key={`linked-chat:${resource.providerId}:${resource.chatId}:${index}`}
                role="listitem"
              >
                <button
                  type="button"
                  className="chat-detail__message-attachment-link chat-detail__message-attachment-resource"
                  disabled={!openLinkedChat}
                  title={`Linked chat: ${resource.name}`}
                  aria-label={`Open linked chat ${resource.name}`}
                  onClick={() => openLinkedChat?.(resource)}
                >
                  <span className="chat-detail__message-attachment-icon" aria-hidden="true">
                    <MessagesSquare />
                  </span>
                  <span className="chat-detail__message-attachment-label">{resource.name}</span>
                </button>
              </div>
            ) : (
              <div
                className="chat-detail__message-attachment"
                key={`${resource.kind}:${
                  resource.kind === 'app'
                    ? resource.id
                    : resource.kind === 'browserContext'
                      ? 'browser-context'
                      : resource.name
                }:${index}`}
                role="listitem"
              >
                <span
                  className="chat-detail__message-attachment-link chat-detail__message-attachment-resource"
                  title={
                    resource.kind === 'browserContext'
                      ? 'Browser context'
                      : `${resource.kind === 'skill' ? 'Skill' : 'App'}: ${resource.name}`
                  }
                >
                  <span className="chat-detail__message-attachment-icon" aria-hidden="true">
                    {resource.kind === 'skill' ? (
                      <Package />
                    ) : resource.kind === 'app' ? (
                      <Blocks />
                    ) : (
                      <Globe2 />
                    )}
                  </span>
                  <span className="chat-detail__message-attachment-label">
                    {resource.kind === 'browserContext'
                      ? 'Browser context'
                      : resource.kind === 'app'
                        ? `$${resource.name}`
                        : resource.name}
                  </span>
                </span>
              </div>
            )
          )}
          {otherAttachments.map((attachment, index) =>
            attachment.kind === 'review' ? (
              <div
                className="chat-detail__message-attachment"
                key={`${attachment.kind}:${attachment.id}:${index}`}
                role="listitem"
              >
                <ReviewCommentsButton
                  className="chat-detail__message-attachment-link chat-detail__message-attachment-review"
                  comments={attachment.comments}
                  onOpenFileLink={onOpenFileLink}
                  projectCwd={projectCwd}
                />
              </div>
            ) : (
              <div
                className="chat-detail__message-attachment"
                key={`${attachment.kind}:${attachment.path ?? attachment.name}:${index}`}
                role="listitem"
              >
                <button
                  className="chat-detail__message-attachment-link chat-detail__message-attachment-file"
                  type="button"
                  disabled={!attachment.path || !onOpenFileLink}
                  title={attachment.path ?? attachment.name}
                  onClick={() => {
                    if (attachment.path) onOpenFileLink?.(attachment.path, attachment.name)
                  }}
                >
                  <span className="chat-detail__message-attachment-icon" aria-hidden="true">
                    <SymbolsFileIcon fileName={attachment.name} autoAssign />
                  </span>
                  <span className="chat-detail__message-attachment-label">{attachment.name}</span>
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
