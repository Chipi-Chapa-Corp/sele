import {
  Code2,
  Database,
  Folder,
  GitBranch,
  Globe2,
  Package,
  Server,
  Smartphone
} from 'lucide-react'
import type { ElementType, ReactElement } from 'react'
import { appProjectGlyphIds, type AppProject, type AppProjectGlyph } from '../../shared/app'

const projectGlyphComponents = {
  folder: Folder,
  code: Code2,
  git: GitBranch,
  package: Package,
  database: Database,
  web: Globe2,
  mobile: Smartphone,
  server: Server
} satisfies Record<AppProjectGlyph, ElementType>

export const projectGlyphLabels = {
  folder: 'Folder',
  code: 'Code project',
  git: 'Git repository',
  package: 'Package',
  database: 'Database',
  web: 'Web project',
  mobile: 'Mobile app',
  server: 'Backend service'
} satisfies Record<AppProjectGlyph, string>

export const renderProjectGlyph = (glyph: AppProjectGlyph): ReactElement => {
  const Icon = projectGlyphComponents[glyph]
  return <Icon aria-hidden="true" />
}

export const formatProjectLabel = (label: string): string =>
  label.replaceAll('-', ' ').replace(/(^|\s)\S/g, (wordStart) => wordStart.toLocaleUpperCase())

export const getProjectFolderName = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

export const getDefaultProjectName = (cwd: string): string =>
  formatProjectLabel(getProjectFolderName(cwd))

export const getProjectDisplayName = (project: Pick<AppProject, 'cwd' | 'name'>): string =>
  project.name.trim() || getDefaultProjectName(project.cwd)

export const projectGlyphOptions = appProjectGlyphIds.map((glyph) => ({
  value: glyph,
  label: projectGlyphLabels[glyph],
  icon: renderProjectGlyph(glyph)
}))
