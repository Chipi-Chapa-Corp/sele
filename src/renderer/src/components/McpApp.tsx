import { createContext, lazy, Suspense, useContext, type ReactNode } from 'react'
import type { McpAppScope as AppScope } from '../../../shared/mcpApps'

const Scope = createContext<AppScope | undefined>(undefined)
export const McpAppScope = ({ value, children }: { value?: AppScope; children: ReactNode }) => (
  <Scope value={value}>{children}</Scope>
)
// Ordinary transcripts do not need the bridge, transports or protocol schemas.
const Content = lazy(() =>
  import('./McpAppContent').then(({ McpAppContent }) => ({ default: McpAppContent }))
)
export function McpApp({ callId }: { callId: string }): React.ReactElement | null {
  const scope = useContext(Scope)
  return scope ? (
    <Suspense fallback={null}>
      <Content
        key={`${scope.providerId}:${scope.chatId}:${callId}`}
        callId={callId}
        scope={scope}
      />
    </Suspense>
  ) : null
}
