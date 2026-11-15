import { lazy, Suspense, type ComponentProps } from 'react'
import { File, Folder } from 'lucide-react'
import type * as Symbols from './SymbolIcons'

// The complete file/folder catalog is useful once a file tree is shown, but
// parsing it must not delay the first Android workspace frame.
const ResolvedFileIcon = lazy(() =>
  import('./SymbolIcons.tsx').then((module) => ({ default: module.FileIcon }))
)
const ResolvedFolderIcon = lazy(() =>
  import('./SymbolIcons.tsx').then((module) => ({ default: module.FolderIcon }))
)
export function FileIcon(props: ComponentProps<typeof Symbols.FileIcon>) {
  return (
    <Suspense
      fallback={<File className={props.className} style={props.style} aria-hidden="true" />}
    >
      <ResolvedFileIcon {...props} />
    </Suspense>
  )
}
export function FolderIcon(props: ComponentProps<typeof Symbols.FolderIcon>) {
  return (
    <Suspense
      fallback={<Folder className={props.className} style={props.style} aria-hidden="true" />}
    >
      <ResolvedFolderIcon {...props} />
    </Suspense>
  )
}
