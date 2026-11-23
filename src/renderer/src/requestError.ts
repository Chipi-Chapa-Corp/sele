export type RequestErrorPresentation = {
  label: string | null
  summary: string
}

export const chatOpenElsewhereMessage = 'Another Codex session has write access to this chat.'
const activeWriterErrorPattern = /\bthread\s+\S+\s+already has an active writer\b/i

export const getRequestErrorPresentation = (message: string): RequestErrorPresentation => {
  if (message === chatOpenElsewhereMessage || activeWriterErrorPattern.test(message)) {
    return {
      label: null,
      summary: chatOpenElsewhereMessage
    }
  }

  return {
    label: 'Request failed',
    summary: message
  }
}
