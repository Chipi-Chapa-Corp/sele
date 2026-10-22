type SyntaxNode = {
  type: string
  value?: unknown
  children?: readonly SyntaxNode[]
}

// Include a per-node allowance as well as text: punctuation-heavy highlighting
// can create many objects from a short source. This is a retention budget, not
// an exact JavaScript heap measurement.
export const getSyntaxTreeCacheSize = (nodes: readonly SyntaxNode[]): number => {
  let size = 0
  const pending = [...nodes]
  while (pending.length) {
    const node = pending.pop()!
    size += 128 + (typeof node.value === 'string' ? node.value.length : 0)
    if (node.children) {
      for (const child of node.children) pending.push(child)
    }
  }
  return size
}
