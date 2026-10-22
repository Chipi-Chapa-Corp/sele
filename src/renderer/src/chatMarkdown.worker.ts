import { Marked } from 'marked'
import markedFootnote from 'marked-footnote'
import { createChatMarkdownRenderer } from './chatMarkdownRenderer'
import { visualizationExtension } from './visualizationReference'
import { createMarkdownPlan } from './markdownPlan'

self.onmessage = ({ data }) => {
  try {
    const markdown = new Marked({ extensions: [visualizationExtension] }).use(
      markedFootnote({ prefixId: data.footnotePrefix })
    )
    const html = markdown.parse(data.content, {
      async: false,
      gfm: true,
      renderer: createChatMarkdownRenderer(data.interactiveFileLinks)
    })
    self.postMessage({ id: data.id, plan: createMarkdownPlan(html) })
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
}
