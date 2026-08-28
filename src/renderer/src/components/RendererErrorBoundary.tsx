import { Component, type ErrorInfo, type ReactNode } from 'react'
import './RendererErrorBoundary.css'

type RendererErrorBoundaryProps = {
  children: ReactNode
}

type RendererErrorBoundaryState = {
  details: string | null
}

const getRendererErrorDetails = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack?.trim() || error.message || error.name
  }

  try {
    return String(error) || 'Unknown renderer error.'
  } catch {
    return 'Unknown renderer error.'
  }
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { details: null }

  static getDerivedStateFromError(error: unknown): RendererErrorBoundaryState {
    return { details: getRendererErrorDetails(error) }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Sele renderer failed while rendering.', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.details === null) return this.props.children

    return (
      <main className="renderer-error" role="alert" aria-labelledby="renderer-error-title">
        <section className="renderer-error__panel">
          <h1 id="renderer-error-title">Sele hit a problem</h1>
          <p>The interface could not finish rendering.</p>
          <pre className="renderer-error__details">{this.state.details}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Sele
          </button>
        </section>
      </main>
    )
  }
}
