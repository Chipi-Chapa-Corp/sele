import type { ProviderMessage, ProviderModelId } from '../../shared/provider'

// Claude may omit the context option and report a dated snapshot of the selected model.
// Preserve the family and version so a genuinely different model still gets a label.
const canonicalModelId = (id: string): string =>
  id.startsWith('claude-') ? id.replace(/\[[^\]]+\]$/, '').replace(/-\d{8}$/, '') : id

export const getMessageModelLabel = (
  message: Pick<ProviderMessage, 'model'>,
  selectedModelId: ProviderModelId | undefined,
  modelLabelsById?: ReadonlyMap<ProviderModelId, string>,
  resolvedModelIdsById?: ReadonlyMap<ProviderModelId, ProviderModelId>
): string | null => {
  const messageModel = message.model?.trim()
  const selectedModel = selectedModelId?.trim()
  if (!messageModel || !selectedModel) return null
  const resolvedSelected = resolvedModelIdsById?.get(selectedModel) ?? selectedModel
  if (canonicalModelId(messageModel) === canonicalModelId(resolvedSelected)) return null
  if (messageModel === selectedModel) return null

  return modelLabelsById?.get(messageModel) ?? messageModel.replace(/-/g, ' ')
}
