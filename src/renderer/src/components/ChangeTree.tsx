import type { CSSProperties } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { FileIcon as SymbolsFileIcon, FolderIcon as SymbolsFolderIcon } from './SymbolIcons'
import {
  getChangedFileDisplayPath,
  getChangedFileDisplayPreviousPath,
  type ChangeTreeNode,
  type TreeFile
} from '../changeTree'

const getTreeRowStyle = (depth: number): CSSProperties =>
  ({ '--change-tree-depth': depth }) as CSSProperties

export const renderTreeNode = <TFile extends TreeFile>(
  node: ChangeTreeNode<TFile>,
  depth: number,
  options: {
    isCollapsed: (folderPath: string) => boolean
    /** Children of an expanded folder; file tree folders load theirs from the index. */
    getChildren: (folderPath: string, children: ChangeTreeNode<TFile>[]) => ChangeTreeNode<TFile>[]
    onToggleFolder: (folderPath: string) => void
    onOpenFile: (file: TFile) => void
  }
): React.ReactElement => {
  if (node.type === 'folder') {
    const collapsed = options.isCollapsed(node.path)
    const children = collapsed ? [] : options.getChildren(node.path, node.children)

    return (
      <li
        className="changes-sidebar__tree-item changes-sidebar__tree-item--folder"
        key={node.path}
        role="treeitem"
        aria-expanded={!collapsed}
      >
        <button
          className="changes-sidebar__tree-row changes-sidebar__tree-row--folder"
          type="button"
          title={node.path}
          style={getTreeRowStyle(depth)}
          onClick={() => options.onToggleFolder(node.path)}
        >
          <span className="changes-sidebar__tree-chevron" aria-hidden="true">
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </span>
          <span className="changes-sidebar__tree-icon" aria-hidden="true">
            <SymbolsFolderIcon folderName={node.name} />
          </span>
          <span className="changes-sidebar__tree-name">{node.name}</span>
        </button>
        {children.length > 0 && (
          <ul className="changes-sidebar__tree-group" role="group">
            {children.map((childNode) => renderTreeNode(childNode, depth + 1, options))}
          </ul>
        )}
      </li>
    )
  }

  const previousDisplayPath = getChangedFileDisplayPreviousPath(node.file)
  const displayPath = getChangedFileDisplayPath(node.file)
  const fileTitle = previousDisplayPath ? `${previousDisplayPath} -> ${displayPath}` : displayPath
  const changeKind = node.file.kind ?? null
  const fileItemClassName = [
    'changes-sidebar__tree-item',
    'changes-sidebar__tree-item--file',
    changeKind ? 'changes-sidebar__tree-item--changed' : null,
    changeKind ? `changes-sidebar__tree-item--${changeKind}` : null
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li className={fileItemClassName} key={node.file.path} role="treeitem">
      <button
        className="changes-sidebar__tree-row changes-sidebar__tree-row--file"
        type="button"
        aria-label={`Open ${displayPath}`}
        title={fileTitle}
        style={getTreeRowStyle(depth)}
        onClick={() => options.onOpenFile(node.file)}
      >
        <span className="changes-sidebar__tree-spacer" aria-hidden="true" />
        <span className="changes-sidebar__tree-icon" aria-hidden="true">
          <SymbolsFileIcon fileName={node.name} autoAssign />
        </span>
        <span className="changes-sidebar__tree-name" title={fileTitle}>
          {node.name}
        </span>
      </button>
    </li>
  )
}
