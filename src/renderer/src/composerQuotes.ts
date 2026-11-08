export type ComposerQuote = {
  id: string
  content: string
  comment: string
}

export const noComposerQuotes: ComposerQuote[] = []

export const buildQuotedPrompt = (quotes: readonly ComposerQuote[], message: string): string =>
  [
    ...quotes.map(({ content, comment }) =>
      [
        content
          .trim()
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n'),
        comment.trim()
      ].join('\n\n')
    ),
    message.trim()
  ]
    .filter(Boolean)
    .join('\n\n')
