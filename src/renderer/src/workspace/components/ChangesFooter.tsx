import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ChangesFooterContent } from './ChangesFooterContent'

type ChangesFooterProps = WorkspaceController['changesFooter']

export function ChangesFooter(props: ChangesFooterProps): ReactElement | null {
  if (!props.visible) return null
  return <ChangesFooterContent {...props} />
}
