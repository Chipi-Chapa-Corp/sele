import { Marked } from 'marked'
import markedFootnote from 'marked-footnote'
import { createChatMarkdownRenderer } from './chatMarkdownRenderer'
import { visualizationExtension } from './visualizationReference'
import { createMarkdownPlan } from './markdownPlan'
import { getRecentChatReferences } from './chatRecents'

self.onmessage = ({ data }) => {
  try {
    if (data.kind === 'references') {
      self.postMessage({
        id: data.id,
        references: getRecentChatReferences(data.items, data.messageLimit)
      })
      return
    }
    const markdown = new Marked({ extensions: data.baseUrl ? [] : [visualizationExtension] }).use(
      markedFootnote({ prefixId: data.footnotePrefix })
    )
    const html = markdown.parse(data.content, {
      async: false,
      gfm: true,
      renderer: createChatMarkdownRenderer(data.interactiveFileLinks, data.baseUrl)
    })
    self.postMessage({ id: data.id, plan: createMarkdownPlan(html) })
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
}
