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
  const dark = colorScheme === 'dark'
  const fontFamily = getComputedStyle(document.documentElement).fontFamily
  const textColor = dark ? '#eee7df' : '#332c26'
  const borderColor = dark ? '#655142' : '#c5b4a5'
  const lineColor = dark ? '#998878' : '#938273'
  const nodeColor = dark ? '#2b2520' : '#fffcf8'
  const surfaceColor = dark ? '#1c1a18' : '#f7f5f1'

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    fontFamily,
    themeVariables: {
      darkMode: dark,
      background: surfaceColor,
      fontFamily,
      fontSize: '14px',
      primaryColor: nodeColor,
      primaryTextColor: textColor,
      primaryBorderColor: borderColor,
      secondaryColor: dark ? '#24302c' : '#eaf0ec',
      secondaryTextColor: textColor,
      secondaryBorderColor: dark ? '#50685c' : '#acbfb2',
      tertiaryColor: dark ? '#292833' : '#efedf4',
      tertiaryTextColor: textColor,
      tertiaryBorderColor: dark ? '#625d77' : '#bdb5d0',
      lineColor,
      textColor,
      mainBkg: nodeColor,
      nodeBorder: borderColor,
      clusterBkg: dark ? '#211e1b' : '#f0ece5',
      clusterBorder: dark ? '#494036' : '#d8cfc3',
      defaultLinkColor: lineColor,
      edgeLabelBackground: surfaceColor,
      titleColor: textColor,
      actorBkg: nodeColor,
      actorBorder: borderColor,
      actorTextColor: textColor,
      actorLineColor: lineColor,
      signalColor: lineColor,
      signalTextColor: textColor,
      labelBoxBkgColor: surfaceColor,
      labelBoxBorderColor: borderColor,
      labelTextColor: textColor,
      noteBkgColor: dark ? '#332b21' : '#f5ecdc',
      noteBorderColor: dark ? '#796143' : '#cdb68e',
      noteTextColor: textColor
    },
    themeCSS: `
      .node rect, rect.actor { rx: 8px; ry: 8px; }
      .nodeLabel, .actor { font-weight: 500; }
      .cluster rect { rx: 12px; ry: 12px; stroke-dasharray: 4 4; }
      .cluster-label { font-weight: 600; }
      .flowchart-link { stroke-width: 1.5px; }
      .edgeLabel { font-size: 12px; }
      .edgeLabel p { padding: 2px 6px; border-radius: 4px; }
    `,
    flowchart: { padding: 18, nodeSpacing: 40, rankSpacing: 56, curve: 'basis' }
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
    (error: unknown) => {
      console.error('[mermaidRendering:renderMermaidDiagram] Render queue rejected', error)
    }
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
          USE_PROFILES: { html: true, svg: true, svgFilters: true },
          // Mermaid uses XHTML inside foreignObject for node, edge and cluster labels.
          // Allow both the SVG container and its HTML namespace transition so the
          // second sanitization preserves labels while still filtering their contents.
          ADD_TAGS: ['foreignObject'],
          HTML_INTEGRATION_POINTS: { foreignobject: true }
        })
        diagram.removeAttribute('aria-busy')
        diagram.dataset.mermaidHydration = 'rendered'
        diagram.classList.add('markdown-mermaid--rendered')
        bindFunctions?.(diagram)
      })
      .catch((error: unknown) => {
        console.error('[mermaid]', 'failed to render diagram', error)
        if (!diagram.isConnected || !container.contains(diagram)) return

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
