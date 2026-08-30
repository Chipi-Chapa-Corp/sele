export type RequestErrorPresentation = {
  label: string | null
  summary: string
}

const chatOpenElsewhereMessage =
  'This chat is opened in another application. Please close it to proceed in Sele'
const activeWriterErrorPattern = /\bthread\s+\S+\s+already has an active writer\b/i

export const getRequestErrorPresentation = (message: string): RequestErrorPresentation => {
  if (activeWriterErrorPattern.test(message)) {
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
