import { Component, type ErrorInfo, type ReactNode } from 'react'
import './RendererErrorBoundary.css'

type RendererErrorBoundaryProps = {
  children: ReactNode
}

type RendererErrorBoundaryState = {
  failed: boolean
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RendererErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Sele renderer failed while rendering.', error, errorInfo)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <main className="renderer-error" role="alert" aria-labelledby="renderer-error-title">
        <section className="renderer-error__panel">
          <span className="renderer-error__label">Renderer error</span>
          <h1 id="renderer-error-title">Sele hit a problem</h1>
          <p>The interface could not finish rendering. Reload it to continue.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Sele
          </button>
        </section>
      </main>
    )
  }
}
