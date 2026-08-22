/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { WebviewTag } from 'electron'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<WebviewTag>, WebviewTag> & {
        partition?: string
        src?: string
      }
    }
  }
}
