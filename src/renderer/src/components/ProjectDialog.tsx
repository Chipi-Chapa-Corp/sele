import { Check, ImagePlus, Plus, X } from 'lucide-react'
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  AppAddProjectOptions,
  AppProject,
  AppProjectGlyph,
  AppProjectIcon,
  AppProjectIconKind
} from '../../../shared/app'
import { appApi } from '../appApi'
import {
  getDefaultProjectName,
  projectGlyphLabels,
  projectGlyphOptions,
  renderProjectGlyph
} from '../projectPresentation'
import { Button } from './Button'
import { Dropdown, type DropdownOption } from './Dropdown'
import { Input } from './Input'
import './ProjectDialog.css'

type ProjectDialogProps = {
  defaultPath?: string | null
  projects: AppProject[]
  onClose: () => void
  onSaved: (project: AppProject, image: AppProjectIcon | null) => void
}

type ProjectIconValue = AppProjectGlyph | 'image'

const getProjectForCwd = (projects: AppProject[], cwd: string): AppProject | null =>
  projects.find((project) => project.cwd === cwd) ?? null

export const ProjectDialog = ({
  defaultPath = null,
  projects,
  onClose,
  onSaved
}: ProjectDialogProps): ReactElement => {
  const nameInputRef = useRef<HTMLInputElement>(null)
  const iconExplicitlySelectedRef = useRef(false)
  const mainFolderSequenceRef = useRef(0)
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const [additionalCwds, setAdditionalCwds] = useState<string[]>([])
  const [icon, setIcon] = useState<AppProjectIconKind>('folder')
  const [projectImage, setProjectImage] = useState<AppProjectIcon | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const updateFromMainFolder = async (folder: string): Promise<void> => {
    const sequence = ++mainFolderSequenceRef.current
    const existingProject = getProjectForCwd(projects, folder)
    const keepExplicitIcon = iconExplicitlySelectedRef.current
    if (!keepExplicitIcon) {
      iconExplicitlySelectedRef.current = false
      setProjectImage(null)
      setIcon(existingProject?.icon === 'image' ? 'folder' : (existingProject?.icon ?? 'folder'))
    }
    setCwd(folder)
    setName(
      (currentName) => currentName.trim() || existingProject?.name || getDefaultProjectName(folder)
    )
    setAdditionalCwds((currentCwds) =>
      currentCwds.length > 0
        ? currentCwds.filter((path) => path !== folder)
        : (existingProject?.additionalCwds ?? [])
    )
    setError(null)

    if (keepExplicitIcon) return

    const nextIcon = existingProject?.icon ?? null
    const image = await appApi.getProjectIcon({ cwd: folder }).catch(() => null)
    if (sequence !== mainFolderSequenceRef.current || iconExplicitlySelectedRef.current) return
    setProjectImage(image)
    setIcon(nextIcon ?? (image ? 'image' : 'folder'))
  }

  const handleSelectMainFolder = async (): Promise<void> => {
    const folder = await appApi.selectFolder({ defaultPath: cwd || defaultPath }).catch(() => null)
    if (folder) await updateFromMainFolder(folder)
  }

  const handleAddFolder = async (): Promise<void> => {
    const folder = await appApi.selectFolder({ defaultPath: cwd || defaultPath }).catch(() => null)
    if (!folder || folder === cwd) return

    setAdditionalCwds((currentCwds) =>
      currentCwds.includes(folder) ? currentCwds : [...currentCwds, folder]
    )
    setError(null)
  }

  const handleSelectImage = async (): Promise<void> => {
    const image = await appApi
      .selectProjectIcon({ cwd: cwd || null, persist: false })
      .catch(() => null)
    if (!image) return

    iconExplicitlySelectedRef.current = true
    setProjectImage(image)
    setIcon('image')
    setError(null)
  }

  const handleIconChange = (value: ProjectIconValue): void => {
    iconExplicitlySelectedRef.current = true
    setIcon(value)
    setError(null)
  }

  const handleSave = async (): Promise<void> => {
    if (saving) return
    const normalizedName = name.trim()
    if (!normalizedName) {
      setError('Name is required.')
      return
    }
    if (!cwd) {
      setError('Main folder is required.')
      return
    }
    if (icon === 'image' && !projectImage) {
      setError('Choose a project image or another icon.')
      return
    }

    const options = {
      cwd,
      name: normalizedName,
      icon,
      ...(icon === 'image' && projectImage?.selectionId
        ? { iconSelectionId: projectImage.selectionId }
        : {}),
      additionalCwds
    } satisfies AppAddProjectOptions

    setSaving(true)
    setError(null)
    try {
      const project = await appApi.addProject(options)
      onSaved(project, icon === 'image' ? projectImage : null)
    } catch (saveError) {
      setError(
        saveError instanceof Error && saveError.message
          ? saveError.message
          : 'Unable to save the project.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void handleSave()
  }

  const iconOptions: DropdownOption<ProjectIconValue>[] = [
    ...(projectImage
      ? [
          {
            value: 'image' as const,
            label: 'Project image',
            icon: <img className="project-dialog__icon-image" src={projectImage.dataUrl} alt="" />
          }
        ]
      : []),
    ...projectGlyphOptions
  ]
  const iconTitle = icon === 'image' ? 'Project image' : projectGlyphLabels[icon as AppProjectGlyph]

  const dialog = (
    <div
      className="project-dialog-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <form
        className="project-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        onSubmit={handleSubmit}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || saving) return
          event.preventDefault()
          onClose()
        }}
      >
        <div className="project-dialog__body">
          <div className="project-dialog__field">
            <div className="project-dialog__label-row">
              <label htmlFor="project-dialog-name">Name</label>
              <Button
                theme="transparent"
                size="small"
                aria-label="Close project window"
                title="Close"
                disabled={saving}
                callback={onClose}
                icon={<X aria-hidden="true" />}
              />
            </div>
            <div className="project-dialog__name-row">
              <Dropdown<ProjectIconValue>
                className="project-dialog__icon-picker"
                aria-label="Project icon"
                menuAlign="start"
                menuActions={[
                  {
                    id: 'choose-project-image',
                    label: 'Choose image…',
                    icon: <ImagePlus aria-hidden="true" />,
                    callback: handleSelectImage
                  }
                ]}
                options={iconOptions}
                title={`Icon: ${iconTitle}`}
                value={icon}
                valueContent={
                  icon === 'image' && projectImage ? (
                    <img className="project-dialog__icon-image" src={projectImage.dataUrl} alt="" />
                  ) : (
                    renderProjectGlyph(icon as AppProjectGlyph)
                  )
                }
                onChange={handleIconChange}
              />
              <Input
                id="project-dialog-name"
                ref={nameInputRef}
                value={name}
                maxLength={80}
                placeholder="Project name"
                disabled={saving}
                onChange={(event) => {
                  setName(event.currentTarget.value)
                  setError(null)
                }}
              />
            </div>
          </div>

          <div className="project-dialog__field">
            <span>Main folder</span>
            <Input
              className="project-dialog__folder-input"
              value={cwd}
              readOnly
              placeholder="Choose a folder"
              title={cwd || 'Choose a folder'}
              aria-label="Choose main folder"
              disabled={saving}
              onClick={() => void handleSelectMainFolder()}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                void handleSelectMainFolder()
              }}
            />
          </div>

          <div className="project-dialog__field">
            <span>Additional folders</span>
            {additionalCwds.length > 0 && (
              <div className="project-dialog__folder-list">
                {additionalCwds.map((folder) => (
                  <div className="project-dialog__additional-folder" key={folder}>
                    <span title={folder}>{folder}</span>
                    <Button
                      theme="transparent"
                      size="small"
                      aria-label={`Remove ${folder}`}
                      title="Remove folder"
                      disabled={saving}
                      callback={() =>
                        setAdditionalCwds((currentCwds) =>
                          currentCwds.filter((currentCwd) => currentCwd !== folder)
                        )
                      }
                      icon={<X aria-hidden="true" />}
                    />
                  </div>
                ))}
              </div>
            )}
            <button
              className="project-dialog__add-folder"
              type="button"
              disabled={saving}
              onClick={() => void handleAddFolder()}
            >
              <Plus aria-hidden="true" />
              <span>Add additional folder…</span>
            </button>
          </div>

          {error && (
            <p className="project-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="project-dialog__footer">
          <Button theme="secondary" label="Cancel" disabled={saving} callback={onClose} />
          <Button
            theme="primary"
            label={saving ? 'Saving' : 'Add project'}
            disabled={saving}
            callback={() => void handleSave()}
            icon={<Check aria-hidden="true" />}
          />
        </footer>
      </form>
    </div>
  )

  return createPortal(dialog, document.body)
}
