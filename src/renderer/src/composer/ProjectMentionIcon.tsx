import { Folder } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppProject, AppProjectIcon } from '../../../shared/app'
import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence'
import { appApi } from '../appApi'
import { renderProjectGlyph } from '../projectPresentation'
export const ProjectMentionIcon = ({ project }: { project: AppProject }): React.JSX.Element => {
  const [image, setImage] = useState<AppProjectIcon | null>(null)
  const usesImage = project.icon === 'image' || project.icon == null
  useEffect(() => {
    if (!usesImage) return
    let cancelled = false
    void appApi.getProjectIcon({ cwd: project.cwd }).then(
      (icon) => {
        if (!cancelled) setImage(icon)
      },
      (error: unknown) => {
        if (!isExpectedFileAbsenceError(error)) {
          console.error(`Unable to load the project icon for ${project.cwd}.`, error)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [project.cwd, usesImage])

  if (usesImage && image?.cwd === project.cwd && image.dataUrl) {
    return <img src={image.dataUrl} alt="" />
  }
  if (project.icon && project.icon !== 'image') return renderProjectGlyph(project.icon)
  return <Folder aria-hidden="true" />
}
