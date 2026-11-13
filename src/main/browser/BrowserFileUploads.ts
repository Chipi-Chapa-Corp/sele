import type { BrowserCdpCommand } from './BrowserInput'

type FileNode = { nodeId?: number; backendNodeId?: number }
type Chooser = {
  signal: AbortSignal
  subscribe(callback: (params: Record<string, unknown>) => void): () => void
  open(): Promise<void>
}

/** Detached inputs (for example Meta's logo picker) are exposed by the chooser
 * event, not DOM.querySelector. Intercept only this explicit upload operation.
 */
export async function uploadBrowserFiles(
  cdp: BrowserCdpCommand,
  input: FileNode | undefined,
  paths: string[],
  chooser?: Chooser
): Promise<void> {
  const setFiles = async (node: FileNode): Promise<void> => {
    const { node: element } = await cdp<{
      node: { nodeName: string; attributes?: string[] }
    }>('DOM.describeNode', node)
    const attrs = new Map<string, string>()
    for (let i = 0; i < (element.attributes?.length ?? 0); i += 2)
      attrs.set(element.attributes![i], element.attributes![i + 1])
    if (element.nodeName.toLowerCase() !== 'input' || attrs.get('type')?.toLowerCase() !== 'file')
      throw new Error('Upload target must be an input[type=file] element')
    if (attrs.has('disabled')) throw new Error('File input is disabled')
    if (paths.length > 1 && !attrs.has('multiple'))
      throw new Error('This file input does not accept multiple files')
    if (chooser?.signal.aborted) throw new Error('Browser session closed')
    await cdp('DOM.setFileInputFiles', { ...node, files: paths })
  }
  if (input) return setFiles(input)
  if (!chooser) throw new Error('Provide a file input or file chooser button')
  if (chooser.signal.aborted) throw new Error('Browser session closed')
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe = (): void => {}
  let abort = (): void => {}
  const selected = new Promise<FileNode>((resolve, reject) => {
    abort = () => reject(new Error('Browser session closed during file selection'))
    chooser.signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(
      () => reject(new Error('The selected button did not open a file chooser')),
      8000
    )
    unsubscribe = chooser.subscribe((params) => {
      if (
        typeof params.backendNodeId !== 'number' ||
        !Number.isSafeInteger(params.backendNodeId) ||
        params.backendNodeId <= 0
      )
        reject(new Error('File chooser did not identify an HTML file input'))
      else resolve({ backendNodeId: params.backendNodeId })
    })
  })
  // A close can arrive while the triggering click is still pending.
  void selected.catch(() => {})
  try {
    await cdp('Page.setInterceptFileChooserDialog', { enabled: true })
    await chooser.open()
    await setFiles(await selected)
  } finally {
    if (timer) clearTimeout(timer)
    chooser.signal.removeEventListener('abort', abort)
    unsubscribe()
    await cdp('Page.setInterceptFileChooserDialog', { enabled: false })
  }
}
