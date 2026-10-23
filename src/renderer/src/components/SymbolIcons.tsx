import type { ComponentProps } from 'react'
import {
  DefaultFileIcon,
  DefaultFolderIcon,
  FileIcon as LibraryFileIcon,
  FolderIcon as LibraryFolderIcon
} from '@react-symbols/icons/utils'

// @react-symbols/icons resolves icons with plain-object lookups, so names such as
// `constructor` resolve to Object.prototype members. React then renders `Object` as a
// component, which returns its props object and crashes the renderer (React error #31).
const isInheritedKey = (key: string): boolean => key in Object.prototype

const resolvesToInheritedIcon = (fileName: string): boolean => {
  const name = fileName.toLowerCase()
  return isInheritedKey(name) || isInheritedKey(name.slice(name.lastIndexOf('.') + 1))
}

export function FileIcon(props: ComponentProps<typeof LibraryFileIcon>): React.JSX.Element {
  if (!resolvesToInheritedIcon(props.fileName)) return <LibraryFileIcon {...props} />
  const {
    fileName: _fileName,
    autoAssign: _autoAssign,
    editFileNameData: _names,
    editFileExtensionData: _extensions,
    ...rest
  } = props
  return <DefaultFileIcon {...rest} />
}

export function FolderIcon(props: ComponentProps<typeof LibraryFolderIcon>): React.JSX.Element {
  if (!isInheritedKey(props.folderName)) return <LibraryFolderIcon {...props} />
  const { folderName: _folderName, editFolderNameData: _names, ...rest } = props
  return <DefaultFolderIcon {...rest} />
}
