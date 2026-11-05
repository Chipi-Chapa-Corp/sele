import type { ProviderApprovalMode, ProviderSandboxMode } from '../../../shared/provider'
import { type DropdownOption } from '../components/Dropdown'
import { approvalModeIcons, formatOptionLabel, sandboxModeIcons } from './configPresentation'

type ComposerAccessOptionsDependencies = {
  sandboxMode: ProviderSandboxMode
  showReviewSelector: boolean
  approvalMode: ProviderApprovalMode
  approvalModes: import('../../../shared/provider').ProviderApprovalModeOption[]
  sandboxModes: import('../../../shared/provider').ProviderSandboxModeOption[]
}

export function useComposerAccessOptions({
  sandboxMode,
  showReviewSelector,
  approvalMode,
  approvalModes,
  sandboxModes
}: ComposerAccessOptionsDependencies) {
  const fullAccessSelected = sandboxMode === 'danger-full-access'

  const reviewSelectorVisible = showReviewSelector && !fullAccessSelected

  const effectiveApprovalMode = fullAccessSelected ? 'never' : approvalMode

  const selectedApprovalMode = approvalModes.find((mode) => mode.id === effectiveApprovalMode)

  const approvalModeOptions = approvalModes.map(
    (mode): DropdownOption<ProviderApprovalMode> => ({
      value: mode.id,
      label: mode.label,
      menuLabel: mode.isDefault ? `${mode.label} (default)` : mode.label,
      description: mode.description || undefined,
      icon: approvalModeIcons[mode.id]
    })
  )

  const displayedApprovalModeOptions = approvalModeOptions.some(
    (option) => option.value === effectiveApprovalMode
  )
    ? approvalModeOptions
    : [
        ...approvalModeOptions,
        {
          value: effectiveApprovalMode,
          label: formatOptionLabel(effectiveApprovalMode),
          icon: approvalModeIcons[effectiveApprovalMode]
        }
      ]

  const selectedSandboxMode = sandboxModes.find((mode) => mode.id === sandboxMode)

  const sandboxModeOptions = sandboxModes.map(
    (mode): DropdownOption<ProviderSandboxMode> => ({
      value: mode.id,
      label: mode.label,
      menuLabel: mode.isDefault ? `${mode.label} (default)` : mode.label,
      description: mode.description || undefined,
      icon: sandboxModeIcons[mode.id]
    })
  )

  const displayedSandboxModeOptions = sandboxModeOptions.some(
    (option) => option.value === sandboxMode
  )
    ? sandboxModeOptions
    : [
        ...sandboxModeOptions,
        {
          value: sandboxMode,
          label: formatOptionLabel(sandboxMode),
          icon: sandboxModeIcons[sandboxMode]
        }
      ]

  const selectedApprovalModeTitle = selectedApprovalMode?.description
    ? `${selectedApprovalMode.label}: ${selectedApprovalMode.description}`
    : (selectedApprovalMode?.label ?? formatOptionLabel(effectiveApprovalMode))

  // Provider updates temporarily block model selection; other chat settings stay editable.
  const approvalSelectorDisabled = fullAccessSelected

  const selectedSandboxModeLabel = selectedSandboxMode?.label ?? formatOptionLabel(sandboxMode)
  return {
    fullAccessSelected,
    reviewSelectorVisible,
    effectiveApprovalMode,
    selectedApprovalMode,
    approvalModeOptions,
    displayedApprovalModeOptions,
    sandboxModeOptions,
    displayedSandboxModeOptions,
    selectedApprovalModeTitle,
    approvalSelectorDisabled,
    selectedSandboxModeLabel
  }
}
