import DOMPurify from 'dompurify'
import './mermaidRendering.css'

export type MermaidColorScheme = 'dark' | 'light'

export type MermaidRenderResult = {
  svg: string
  bindFunctions?: (element: Element) => void
}

let renderIndex = 0
let renderQueue: Promise<void> = Promise.resolve()

const renderNextDiagram = async (
  source: string,
  colorScheme: MermaidColorScheme
): Promise<MermaidRenderResult> => {
  const { default: mermaid } = await import('mermaid')

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: colorScheme === 'dark' ? 'dark' : 'neutral'
  })

  renderIndex += 1
  return mermaid.render(`sele-mermaid-${renderIndex}`, source)
}

// Mermaid keeps global configuration. Queue initialization together with rendering so diagrams
// requested by separate messages cannot swap themes while another render is in progress.
export const renderMermaidDiagram = (
  source: string,
  colorScheme: MermaidColorScheme
): Promise<MermaidRenderResult> => {
  const result = renderQueue.then(() => renderNextDiagram(source, colorScheme))
  renderQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export const hydrateMermaidDiagrams = (container: HTMLElement): void => {
  const diagrams = container.querySelectorAll<HTMLElement>('[data-mermaid-diagram]')
  const colorScheme: MermaidColorScheme =
    document.documentElement.dataset.colorScheme === 'dark' ? 'dark' : 'light'

  diagrams.forEach((diagram) => {
    const source = diagram.querySelector<HTMLElement>('.markdown-mermaid__source')
    if (!source || diagram.dataset.mermaidHydration) return

    diagram.dataset.mermaidHydration = 'rendering'

    void renderMermaidDiagram(source.textContent ?? '', colorScheme)
      .then(({ svg, bindFunctions }) => {
        if (!diagram.isConnected || !container.contains(diagram)) return

        diagram.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { html: true, svg: true, svgFilters: true }
        })
        diagram.removeAttribute('aria-busy')
        diagram.dataset.mermaidHydration = 'rendered'
        diagram.classList.add('markdown-mermaid--rendered')
        bindFunctions?.(diagram)
      })
      .catch((error: unknown) => {
        if (!diagram.isConnected || !container.contains(diagram)) return

        console.error('[mermaid]', 'failed to render diagram', error)
        const errorMessage = document.createElement('div')
        errorMessage.className = 'markdown-mermaid__error'
        errorMessage.setAttribute('role', 'alert')
        errorMessage.textContent = 'Unable to render Mermaid diagram'
        source.hidden = false
        diagram.replaceChildren(errorMessage, source)
        diagram.removeAttribute('aria-busy')
        diagram.dataset.mermaidHydration = 'error'
        diagram.classList.add('markdown-mermaid--error')
      })
  })
}
