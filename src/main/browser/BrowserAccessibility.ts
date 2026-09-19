import type { BrowserCdpCommand, BrowserPoint } from './BrowserInput'

type AxValue = { value?: unknown }
type AxNode = {
  nodeId: string
  ignored?: boolean
  role?: AxValue
  name?: AxValue
  value?: AxValue
  properties?: { name: string; value: AxValue }[]
  backendDOMNodeId?: number
  childIds?: string[]
}
export type BrowserTreeOptions = {
  filter?: 'all' | 'interactive'
  depth?: number
  ref?: string
  maxLength?: number
}
const interactiveRoles = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'menuitem',
  'tab',
  'option'
])

const isExpectedReleasedObjectAbsence = (error: unknown): boolean =>
  error instanceof Error &&
  /cannot find object with given id|invalid remote object id/i.test(error.message)

/** References belong to a document, not a CSS selector that could silently target a new element. */
export class BrowserAccessibility {
  private refs = new Map<string, number>()
  private reverse = new Map<number, string>()
  constructor(
    private cdp: BrowserCdpCommand,
    private nextRef: () => string
  ) {}

  clear(): void {
    this.refs.clear()
    this.reverse.clear()
  }

  private backend(ref: string): number {
    const id = this.refs.get(ref)
    if (!id) throw new Error('Stale or unknown element reference; call read_page or find again')
    return id
  }

  async read(options: BrowserTreeOptions = {}, query?: string): Promise<string> {
    const rootBackend = options.ref ? this.backend(options.ref) : undefined
    const { nodes } = await this.cdp<{ nodes: AxNode[] }>('Accessibility.getFullAXTree')
    const index = new Map(nodes.map((node) => [node.nodeId, node]))
    const root = rootBackend
      ? nodes.find((node) => node.backendDOMNodeId === rootBackend)
      : nodes[0]
    if (!root) throw new Error('Element is no longer on this page; read the page again')
    const lines: string[] = []
    const visited = new Set<string>()
    const walk = (node: AxNode, depth: number): void => {
      if (visited.has(node.nodeId) || depth > (options.depth ?? 15)) return
      visited.add(node.nodeId)
      const role = String(node.role?.value ?? '')
      const name = String(node.name?.value ?? '')
      const value = node.value?.value
      const properties = (node.properties ?? [])
        .filter((p) =>
          ['checked', 'selected', 'disabled', 'expanded', 'required', 'focused'].includes(p.name)
        )
        .map((p) => `${p.name}=${JSON.stringify(p.value.value)}`)
        .join(' ')
      const label = `${role} ${JSON.stringify(name)}${value === undefined ? '' : ` value=${JSON.stringify(value)}`}${properties ? ` ${properties}` : ''}`
      const include =
        !node.ignored &&
        (options.filter !== 'interactive' || interactiveRoles.has(role)) &&
        (!query || label.toLowerCase().includes(query.toLowerCase()))
      if (include) {
        let ref = ''
        if (node.backendDOMNodeId) {
          ref = this.reverse.get(node.backendDOMNodeId) ?? this.nextRef()
          this.reverse.set(node.backendDOMNodeId, ref)
          this.refs.set(ref, node.backendDOMNodeId)
        }
        lines.push(`${query ? '' : '  '.repeat(depth)}${ref ? `[${ref}] ` : ''}${label}`)
      }
      for (const child of node.childIds ?? []) {
        const childNode = index.get(child)
        if (childNode) walk(childNode, depth + (node.ignored ? 0 : 1))
      }
    }
    walk(root, 0)
    const text = (query ? lines.slice(0, 20) : lines).join('\n') || 'No matching elements.'
    const limit = options.maxLength ?? 50000
    return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text
  }

  async withElement<T>(ref: string, declaration: string, args: unknown[] = []): Promise<T> {
    const { object } = await this.cdp<{ object: { objectId?: string } }>('DOM.resolveNode', {
      backendNodeId: this.backend(ref)
    })
    if (!object.objectId) throw new Error('Element is no longer available; read the page again')
    try {
      const result = await this.cdp<{
        result: { value: T }
        exceptionDetails?: { text: string; exception?: { description?: string } }
      }>('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: declaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
        userGesture: true
      })
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
        )
      return result.result.value
    } finally {
      await this.cdp('Runtime.releaseObject', { objectId: object.objectId }).catch((error) => {
        if (!isExpectedReleasedObjectAbsence(error)) {
          console.error('[caught:BrowserAccessibility:withElement]', error)
        }
      })
    }
  }

  async point(ref: string): Promise<BrowserPoint> {
    await this.cdp('DOM.scrollIntoViewIfNeeded', { backendNodeId: this.backend(ref) })
    const { quads } = await this.cdp<{ quads: number[][] }>('DOM.getContentQuads', {
      backendNodeId: this.backend(ref)
    })
    const quad = quads.find((q) => q.length === 8 && Math.abs((q[2] - q[0]) * (q[5] - q[1])) > 1)
    if (!quad) throw new Error('Element has no visible click target')
    return [
      (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
      (quad[1] + quad[3] + quad[5] + quad[7]) / 4
    ]
  }

  async fill(ref: string, value: string | number | boolean): Promise<void> {
    await this.withElement(
      ref,
      `function(value) {
      if (!this.isConnected) throw new Error('Element is no longer on this page');
      if (this.disabled || this.readOnly) throw new Error('Element is disabled or read-only');
      this.focus();
      if (this instanceof HTMLInputElement && ['checkbox', 'radio'].includes(this.type)) {
        if (typeof value !== 'boolean') throw new Error('Checkbox and radio inputs require a boolean');
        if (this.checked !== value) this.click();
      } else if (this instanceof HTMLSelectElement) {
        const option = Array.from(this.options).find(o => o.value === String(value) || o.text === String(value));
        if (!option) throw new Error('Select option not found');
        this.value = option.value;
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
        const prototype = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(this, String(value));
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (this.isContentEditable) {
        const range = document.createRange(); range.selectNodeContents(this);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        document.execCommand('insertText', false, String(value));
      } else throw new Error('Element is not a supported form input');
    }`,
      [value]
    )
  }
}
