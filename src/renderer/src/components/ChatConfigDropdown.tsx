import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'motion/react'
import { Check, ChevronDown, ChevronRight, Save, Settings2 } from 'lucide-react'
import { MenuPageTransition } from '../motion/MenuPageTransition'
import { useFeedbackMotion } from '../motion/useFeedbackMotion'
import { toCssRem } from '../cssUnits'
import type { DropdownOption } from './Dropdown'
import { ChatConfigSectionHeader } from './ChatConfigSectionHeader'
import { Input } from './Input'
import { MenuSurface } from './MenuSurface'
import type { ProviderId } from '../../../shared/provider'
import type { MessageBoxSelection } from '../messageBoxPreferences'
import { selectionsEqual } from '../chatModelPreferences'
import { readChatPresets, saveChatPreset } from '../chatPresets'
import type { AppChatDropdownSelectionAction } from '../settings'

export type SelectorIconItem = {
  icon: ReactNode
  key: string
  title?: string
}
type ChatConfigSectionId = 'model' | 'reasoning' | 'questions' | 'access' | 'speed'

export type ChatConfigOptionGroup = {
  id: string
  label?: string
  options: readonly DropdownOption<string>[]
  selectedValue: string
  onChange: (value: string) => void
}

export type ChatConfigSection = {
  disabled?: boolean
  id: ChatConfigSectionId
  icon: ReactNode
  label: string
  groups: readonly ChatConfigOptionGroup[]
}

type ChatConfigDropdownProps = {
  id: string
  modelsError?: string | null
  modelLabel: string
  providerIcon: ReactNode
  reasoningLabel?: string | null
  sections: readonly ChatConfigSection[]
  statusIcons: readonly SelectorIconItem[]
  title: string
  presetsEnabled: boolean
  selectionAction?: AppChatDropdownSelectionAction
  providerId: ProviderId
  selection: MessageBoxSelection
  getPresetDetails: (selection: MessageBoxSelection) => ChatConfigPresetDetails
  onPresetChange: (selection: MessageBoxSelection) => void
}

export type ChatConfigPresetDetails = {
  modelLabel: string
  reasoningLabel?: string | null
  speedLabel?: string | null
  statusIcons: readonly SelectorIconItem[]
  disabled?: boolean
  title: string
  selected: boolean
}

type ChatConfigMenuStyle = CSSProperties & {
  '--chat-config-menu-max-height': string
}

const getChatConfigMenuStyle = (
  buttonRect: DOMRect,
  presetsEnabled: boolean
): ChatConfigMenuStyle => {
  const viewportInset = 9.6
  const menuOffset = 4.8
  const maxMenuHeight = 608
  const menuWidth = Math.min(presetsEnabled ? 400 : 288, window.innerWidth - viewportInset * 2)
  const maxLeft = Math.max(viewportInset, window.innerWidth - menuWidth - viewportInset)
  const spaceAbove = Math.max(0, buttonRect.top - menuOffset - viewportInset)
  const spaceBelow = Math.max(
    0,
    window.innerHeight - buttonRect.bottom - menuOffset - viewportInset
  )
  const openUp = spaceAbove >= spaceBelow
  const availableHeight = Math.min(maxMenuHeight, openUp ? spaceAbove : spaceBelow)

  const menuStyle: ChatConfigMenuStyle = {
    '--chat-config-menu-max-height': toCssRem(availableHeight),
    left: toCssRem(Math.min(Math.max(viewportInset, buttonRect.left), maxLeft)),
    minWidth: toCssRem(buttonRect.width),
    width: toCssRem(menuWidth)
  }

  if (openUp) {
    menuStyle.bottom = toCssRem(window.innerHeight - buttonRect.top + menuOffset)
  } else {
    menuStyle.top = toCssRem(buttonRect.bottom + menuOffset)
  }

  return menuStyle
}

export const ChatConfigDropdown: React.FC<ChatConfigDropdownProps> = ({
  id,
  modelsError,
  modelLabel,
  providerIcon,
  reasoningLabel,
  sections,
  statusIcons,
  title,
  presetsEnabled,
  selectionAction = 'back',
  providerId,
  selection,
  getPresetDetails,
  onPresetChange
}) => {
  const reactId = useId().replace(/:/g, '')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const modelSearchInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<ChatConfigSectionId | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [configuring, setConfiguring] = useState(false)
  const [presets, setPresets] = useState<MessageBoxSelection[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  useFeedbackMotion(labelRef, `${modelLabel}:${reasoningLabel}`)
  const menuId = `${id}-${reactId}-menu`
  const menuOpen = open && sections.length > 0
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? null
  const showingPresets = presetsEnabled && presets.length > 0 && !configuring
  const currentPresetSaved = presets.some((preset) => selectionsEqual(preset, selection))
  const normalizedModelSearchQuery = modelSearchQuery.trim().toLocaleLowerCase()
  const visibleSectionGroups =
    activeSection?.id === 'model' && normalizedModelSearchQuery
      ? activeSection.groups
          .map((group) => ({
            ...group,
            options: group.options.filter((option) =>
              [option.label, option.menuLabel, option.value, option.description]
                .filter((searchableValue): searchableValue is string => Boolean(searchableValue))
                .some((searchableValue) =>
                  searchableValue.toLocaleLowerCase().includes(normalizedModelSearchQuery)
                )
            )
          }))
          .filter((group) => group.options.length > 0)
      : (activeSection?.groups ?? [])

  const closeMenu = useCallback((): void => {
    setOpen(false)
    setMenuStyle(null)
    setActiveSectionId(null)
    setModelSearchQuery('')
    setConfiguring(false)
    setSaveError(null)
  }, [])

  const focusFirstMenuButton = useCallback((): void => {
    window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true })
    })
  }, [])

  const focusModelSearchInput = useCallback((): void => {
    window.requestAnimationFrame(() => modelSearchInputRef.current?.focus({ preventScroll: true }))
  }, [])

  const updateMenuPosition = useCallback((): void => {
    const buttonRect = buttonRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    setMenuStyle(getChatConfigMenuStyle(buttonRect, presetsEnabled))
  }, [presetsEnabled])

  const openMenu = useCallback((): void => {
    if (sections.length === 0) return

    updateMenuPosition()
    if (presetsEnabled) setPresets(readChatPresets(providerId))
    setConfiguring(false)
    setActiveSectionId(null)
    setOpen(true)
    focusFirstMenuButton()
  }, [focusFirstMenuButton, sections.length, updateMenuPosition, presetsEnabled, providerId])

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return

      closeMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    const handleScroll = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return

      updateMenuPosition()
    }

    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [closeMenu, menuOpen, updateMenuPosition])

  useEffect(() => {
    if (!open || sections.length > 0) return

    const frame = window.requestAnimationFrame(closeMenu)
    return () => window.cancelAnimationFrame(frame)
  }, [closeMenu, open, sections.length])

  const handleTriggerClick = (): void => {
    if (menuOpen) {
      closeMenu()
      return
    }

    openMenu()
  }

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowUp') {
      if (event.key !== 'ArrowDown') return
    }

    event.preventDefault()
    openMenu()
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      buttonRef.current?.focus({ preventScroll: true })
      return
    }

    if (
      (event.key === 'ArrowLeft' || event.key === 'Backspace') &&
      (activeSection || (presetsEnabled && configuring)) &&
      event.target !== modelSearchInputRef.current
    ) {
      event.preventDefault()
      setActiveSectionId(null)
      setModelSearchQuery('')
      if (!activeSection) setConfiguring(false)
      focusFirstMenuButton()
    }
  }

  const renderSectionRoot = (): ReactNode => (
    <div className="message-box__chat-config-section">
      <div className="message-box__chat-config-option-groups">
        {sections.map((section) => (
          <button
            className="message-box__chat-config-section-button"
            disabled={section.disabled}
            data-chat-config-section={section.id}
            aria-label={`${section.id.charAt(0).toUpperCase() + section.id.slice(1)}: ${section.label}`}
            key={section.id}
            type="button"
            onClick={() => {
              setActiveSectionId(section.id)
              if (section.id === 'model') {
                focusModelSearchInput()
              } else {
                focusFirstMenuButton()
              }
            }}
          >
            <span className="message-box__chat-config-section-icon" aria-hidden="true">
              {section.icon}
            </span>
            <span className="message-box__chat-config-section-label">{section.label}</span>
            <ChevronRight className="message-box__chat-config-section-chevron" aria-hidden="true" />
          </button>
        ))}
      </div>
      {presetsEnabled && (
        <div className="message-box__chat-config-footer">
          <div className="message-box__chat-config-separator" role="presentation" />
          <button
            className="message-box__chat-config-section-button"
            type="button"
            disabled={getPresetDetails(selection).disabled || currentPresetSaved}
            onClick={() => {
              try {
                setPresets(saveChatPreset(providerId, selection))
                setSaveError(null)
                setConfiguring(false)
                focusFirstMenuButton()
              } catch (error) {
                console.error('Unable to save chat preset.', error)
                setSaveError('Unable to save preset. Try again.')
              }
            }}
          >
            <Save className="message-box__chat-config-section-icon" aria-hidden="true" />
            <span className="message-box__chat-config-section-label">
              {currentPresetSaved ? 'Preset saved' : 'Save preset'}
            </span>
          </button>
          {saveError && (
            <div className="message-box__chat-config-error" role="alert">
              {saveError}
            </div>
          )}
          {presets.length > 0 && (
            <ChatConfigSectionHeader
              onBack={() => {
                setConfiguring(false)
                focusFirstMenuButton()
              }}
            />
          )}
        </div>
      )}
    </div>
  )

  const renderPresets = (): ReactNode => (
    <div className="message-box__chat-config-section">
      <div className="message-box__chat-config-option-groups">
        {presets.map((preset, index) => {
          const details = getPresetDetails(preset)
          return (
            <button
              className={[
                'message-box__chat-config-option',
                'message-box__chat-config-preset',
                details.selected ? 'message-box__chat-config-option--selected' : null
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              key={index}
              disabled={details.disabled}
              aria-pressed={details.selected}
              title={details.title}
              onClick={() => {
                onPresetChange(preset)
                closeMenu()
                buttonRef.current?.focus({ preventScroll: true })
              }}
            >
              <span className="message-box__chat-config-value">
                {details.statusIcons.map((item) => (
                  <span
                    className="message-box__chat-config-status-icon"
                    key={item.key}
                    title={item.title}
                    aria-label={item.title}
                  >
                    {item.icon}
                  </span>
                ))}
                <span className="message-box__chat-config-provider-icon" aria-hidden="true">
                  {providerIcon}
                </span>
                <span className="message-box__chat-config-label">
                  {[details.modelLabel, details.reasoningLabel, details.speedLabel]
                    .filter(Boolean)
                    .map((label, partIndex) => (
                      <span className="message-box__chat-config-preset-part" key={partIndex}>
                        {partIndex > 0 && (
                          <span className="message-box__chat-config-dot" aria-hidden="true" />
                        )}
                        <span className="message-box__chat-config-label-part">{label}</span>
                      </span>
                    ))}
                </span>
              </span>
              {details.selected && (
                <Check className="message-box__chat-config-check" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>
      <div className="message-box__chat-config-footer">
        <div className="message-box__chat-config-separator" role="presentation" />
        <button
          className="message-box__chat-config-section-button"
          type="button"
          onClick={() => {
            setConfiguring(true)
            focusFirstMenuButton()
          }}
        >
          <Settings2 className="message-box__chat-config-section-icon" aria-hidden="true" />
          <span className="message-box__chat-config-section-label">Configure</span>
          <ChevronRight className="message-box__chat-config-section-chevron" aria-hidden="true" />
        </button>
      </div>
    </div>
  )

  const renderSectionOptions = (section: ChatConfigSection): ReactNode => (
    <div className="message-box__chat-config-section">
      <div className="message-box__chat-config-option-groups">
        {visibleSectionGroups.map((group, groupIndex) => (
          <div
            className="message-box__chat-config-option-group"
            key={group.id}
            role="group"
            aria-label={group.label}
          >
            {groupIndex > 0 && (
              <div className="message-box__chat-config-separator" role="presentation" />
            )}
            {group.options.map((option) => {
              const selected = option.value === group.selectedValue

              return (
                <button
                  className={[
                    'message-box__chat-config-option',
                    option.icon ? 'message-box__chat-config-option--has-icon' : null,
                    option.description ? 'message-box__chat-config-option--has-description' : null,
                    selected ? 'message-box__chat-config-option--selected' : null
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={option.disabled}
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  title={option.description}
                  onClick={() => {
                    group.onChange(option.value)
                    if (selectionAction === 'close') {
                      closeMenu()
                      buttonRef.current?.focus({ preventScroll: true })
                    } else if (selectionAction === 'back') {
                      setActiveSectionId(null)
                      setModelSearchQuery('')
                      setConfiguring(true)
                      focusFirstMenuButton()
                    }
                  }}
                >
                  {option.description ? (
                    <span className="message-box__chat-config-option-copy">
                      <span className="message-box__chat-config-option-row">
                        {option.icon && (
                          <span className="message-box__chat-config-option-icon" aria-hidden="true">
                            {option.icon}
                          </span>
                        )}
                        <span className="message-box__chat-config-option-label">
                          {option.menuLabel ?? option.label}
                        </span>
                        {selected && (
                          <Check className="message-box__chat-config-check" aria-hidden="true" />
                        )}
                      </span>
                      <span className="message-box__chat-config-option-description">
                        {option.description}
                      </span>
                    </span>
                  ) : (
                    <>
                      {option.icon && (
                        <span className="message-box__chat-config-option-icon" aria-hidden="true">
                          {option.icon}
                        </span>
                      )}
                      <span className="message-box__chat-config-option-copy">
                        <span className="message-box__chat-config-option-label">
                          {option.menuLabel ?? option.label}
                        </span>
                      </span>
                      {selected && (
                        <Check className="message-box__chat-config-check" aria-hidden="true" />
                      )}
                    </>
                  )}
                </button>
              )
            })}
          </div>
        ))}
        {section.id === 'model' && visibleSectionGroups.length === 0 && (
          <div className="message-box__chat-config-empty" role="status">
            No models found
          </div>
        )}
      </div>
      <div className="message-box__chat-config-footer">
        {section.id === 'model' && (
          <div className="message-box__chat-config-search">
            <Input
              ref={modelSearchInputRef}
              type="search"
              aria-label="Search models"
              autoComplete="off"
              placeholder="Search models"
              value={modelSearchQuery}
              onChange={(event) => setModelSearchQuery(event.target.value)}
            />
          </div>
        )}
        <ChatConfigSectionHeader
          modelError={section.id === 'model' ? modelsError : null}
          onBack={() => {
            setActiveSectionId(null)
            setModelSearchQuery('')
            focusFirstMenuButton()
          }}
        />
      </div>
    </div>
  )

  const menu = menuOpen ? (
    <div
      ref={menuRef}
      className="message-box__chat-config-menu-root"
      style={menuStyle ?? undefined}
      onKeyDown={handleMenuKeyDown}
    >
      <MenuSurface
        className="message-box__chat-config-menu"
        id={menuId}
        role="dialog"
        aria-label="Chat settings"
      >
        <MenuPageTransition page={activeSection?.id ?? (showingPresets ? 'presets' : 'root')}>
          {activeSection
            ? renderSectionOptions(activeSection)
            : showingPresets
              ? renderPresets()
              : renderSectionRoot()}
        </MenuPageTransition>
      </MenuSurface>
    </div>
  ) : null

  return (
    <span className="message-box__chat-config">
      <button
        ref={buttonRef}
        className="message-box__chat-config-trigger"
        id={id}
        type="button"
        aria-controls={menuOpen ? menuId : undefined}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        disabled={sections.length === 0}
        title={title}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="message-box__chat-config-value">
          {statusIcons.length > 0 && (
            <span className="message-box__chat-config-status-icons">
              {statusIcons.map((item) => (
                <span
                  className="message-box__chat-config-status-icon"
                  key={item.key}
                  title={item.title}
                  aria-label={item.title}
                >
                  {item.icon}
                </span>
              ))}
            </span>
          )}
          <span className="message-box__chat-config-provider-icon" aria-hidden="true">
            {providerIcon}
          </span>
          <span ref={labelRef} className="message-box__chat-config-label">
            <span className="message-box__chat-config-label-part">{modelLabel}</span>
            {reasoningLabel && (
              <>
                <span className="message-box__chat-config-dot" aria-hidden="true" />
                <span className="message-box__chat-config-label-part">{reasoningLabel}</span>
              </>
            )}
          </span>
        </span>
        <ChevronDown className="message-box__chat-config-trigger-chevron" aria-hidden="true" />
      </button>
      {createPortal(<AnimatePresence>{menu}</AnimatePresence>, document.body)}
    </span>
  )
}
