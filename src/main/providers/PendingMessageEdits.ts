/** Editing holds the edited message and its successors without stopping earlier messages. */
export class PendingMessageEdits {
  private edits = new Map<
    string,
    { messageId: string; editId: string; precedingIds: Set<string> }
  >()

  has = (chatId: string): boolean => this.edits.has(chatId)

  get = (chatId: string): { messageId: string; editId: string } | undefined =>
    this.edits.get(chatId)

  blocks = (chatId: string, messageId: string | undefined): boolean => {
    const current = this.edits.get(chatId)
    return Boolean(current && (messageId === undefined || !current.precedingIds.has(messageId)))
  }

  begin = (
    chatId: string,
    messageId: string,
    editId: string,
    messages: readonly { id: string }[] = []
  ): void => {
    const current = this.edits.get(chatId)
    if (current && (current.messageId !== messageId || current.editId !== editId)) {
      throw new Error('Another pending message is being edited in this chat.')
    }
    if (current) return
    const index = messages.findIndex((message) => message.id === messageId)
    // Snapshot identities: removing a predecessor must not move the boundary or admit new sends.
    const precedingIds = new Set(messages.slice(0, Math.max(0, index)).map((message) => message.id))
    this.edits.set(chatId, { messageId, editId, precedingIds })
  }

  assert = (chatId: string, messageId: string, editId?: string): void => {
    const current = this.edits.get(chatId)
    if (
      current
        ? current.messageId === messageId
          ? current.editId !== editId
          : editId !== undefined || this.blocks(chatId, messageId)
        : editId !== undefined
    ) {
      throw new Error('This pending message edit is no longer active.')
    }
  }

  release = (chatId: string, messageId: string, editId: string): boolean => {
    const current = this.edits.get(chatId)
    if (current?.messageId !== messageId || current.editId !== editId) return false
    this.edits.delete(chatId)
    return true
  }
}
