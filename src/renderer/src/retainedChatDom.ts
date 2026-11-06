// Track the small DOM changes made by progressive/streaming content. Navigation
// must not query every element in a large outgoing transcript during render.
const liveContent =
  'iframe, video:not(.chat-detail__markdown-video > video), audio, canvas, [data-visualization], .mcp-app'

export function indexRetainedChatDom(host: HTMLElement) {
  const nodes = new Set(host.querySelectorAll('*'))
  const live = new Set(host.querySelectorAll(liveContent))
  const visit = (node: Node, added: boolean): void => {
    if (!(node instanceof Element)) return
    const present = added && host.contains(node)
    const change = (element: Element): void => {
      if (present) nodes.add(element)
      else if (!host.contains(element)) nodes.delete(element)
    }
    change(node)
    node.querySelectorAll('*').forEach(change)
    if (added) {
      if (node.matches(liveContent)) live.add(node)
      node.querySelectorAll(liveContent).forEach((element) => live.add(element))
    } else {
      for (const element of live)
        if (element === node || node.contains(element)) live.delete(element)
    }
  }
  const update = (records: MutationRecord[]): void => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        const element = record.target
        if (element.matches(liveContent)) live.add(element)
        else live.delete(element)
        // A video's thumbnail status also depends on its parent's class.
        for (const video of element.querySelectorAll('video')) {
          if (video.matches(liveContent)) live.add(video)
          else live.delete(video)
        }
      }
      record.removedNodes.forEach((node) => visit(node, false))
      record.addedNodes.forEach((node) => visit(node, true))
    }
  }
  const observer = new MutationObserver(update)
  observer.observe(host, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-visualization']
  })
  return {
    read() {
      update(observer.takeRecords())
      for (const element of live) if (!host.contains(element)) live.delete(element)
      return { nodes: nodes.size, live: live.size > 0 }
    },
    dispose() {
      observer.disconnect()
    }
  }
}
