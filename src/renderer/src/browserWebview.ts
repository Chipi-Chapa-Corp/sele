/** Electron exposes the element before its guest finishes attaching. */
export const isExpectedWebviewUnavailableError = (error: unknown): boolean =>
  error instanceof Error &&
  /webview.*(?:not attached|dom-ready)|object has been destroyed|webcontents (?:was|is) destroyed|render frame was disposed/i.test(
    error.message
  )
