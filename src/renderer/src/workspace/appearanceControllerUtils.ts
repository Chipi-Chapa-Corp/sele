import type {
  ProviderApprovalMode,
  ProviderApprovalModeOption,
  ProviderModel,
  ProviderReasoningEffort,
  ProviderSandboxMode,
  ProviderSandboxModeOption
} from '../../../shared/provider'

import {
  fallbackDefaultApprovalMode,
  fallbackDefaultSandboxMode,
  fallbackInitialModel,
  fallbackInitialReasoningEffort
} from './controllerTypes'

export const approvalTypeLabels = {
  command: 'Command approval',
  fileChange: 'File change approval'
} as const

export const getDefaultModel = (models: ProviderModel[]): ProviderModel =>
  models.find((nextModel) => nextModel.isDefault) ?? models[0] ?? fallbackInitialModel

export const getDefaultReasoningEffort = (
  model: ProviderModel | undefined
): ProviderReasoningEffort =>
  model?.defaultReasoningEffort ||
  model?.supportedReasoningEfforts.find((option) => option.isDefault)?.id ||
  model?.supportedReasoningEfforts[0]?.id ||
  fallbackInitialReasoningEffort

export const modelHasReasoningEffortOptions = (model: ProviderModel | undefined): boolean =>
  Boolean(model?.supportedReasoningEfforts.length)

export const modelHasServiceTierOptions = (model: ProviderModel | undefined): boolean =>
  Boolean(model?.supportedServiceTiers?.length)

export const getDefaultApprovalMode = (
  approvalModes: ProviderApprovalModeOption[]
): ProviderApprovalMode =>
  approvalModes.find((mode) => mode.isDefault)?.id ??
  approvalModes[0]?.id ??
  fallbackDefaultApprovalMode

export const getDefaultSandboxMode = (
  sandboxModes: ProviderSandboxModeOption[]
): ProviderSandboxMode =>
  sandboxModes.find((mode) => mode.isDefault)?.id ??
  sandboxModes[0]?.id ??
  fallbackDefaultSandboxMode
