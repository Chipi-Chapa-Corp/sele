import '../monacoEnvironment'
import * as monaco from 'monaco-editor'
import { getConfiguredLanguage } from '../unifiedDiffRendering'
import { appApi } from '../appApi'

const monacoLanguageAliases: Record<string, string> = {
  bash: 'shell',
  c: 'cpp',
  jsx: 'javascript',
  makefile: 'plaintext',
  markup: 'html',
  plain: 'plaintext',
  tsx: 'typescript'
}

export const getMonacoLanguage = (path: string): string => {
  const language = getConfiguredLanguage(path)
  return language ? (monacoLanguageAliases[language] ?? language) : 'plaintext'
}

monaco.editor.defineTheme('sele-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '777772' },
    { token: 'delimiter', foreground: '666661' },
    { token: 'number', foreground: 'A03C38' },
    { token: 'regexp', foreground: 'A75022' },
    { token: 'string', foreground: '39744B' },
    { token: 'keyword', foreground: '7D438E' },
    { token: 'type', foreground: '76552F' },
    { token: 'type.identifier', foreground: '76552F' },
    { token: 'function', foreground: '76552F' },
    { token: 'operator', foreground: '8C5A24' },
    { token: 'variable', foreground: '8C5A24' }
  ],
  colors: {
    'editor.background': '#f7f7f5',
    'editor.foreground': '#111110',
    'editor.lineHighlightBackground': '#7a563812',
    'editor.lineHighlightBorder': '#00000000',
    'editorCursor.foreground': '#111110',
    'editorGutter.background': '#f7f7f5',
    'editorLineNumber.foreground': '#858580',
    'editorLineNumber.activeForeground': '#272725',
    'editorIndentGuide.background1': '#1b1b181f',
    'editorIndentGuide.activeBackground1': '#1b1b181f',
    'editorWhitespace.foreground': '#1b1b182e',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#1b1b182e',
    'scrollbarSlider.hoverBackground': '#1b1b1840',
    'scrollbarSlider.activeBackground': '#7a56385c',
    'diffEditor.insertedLineBackground': '#2f8f5b24',
    'diffEditor.insertedTextBackground': '#2f8f5b52',
    'diffEditor.removedLineBackground': '#b9473f24',
    'diffEditor.removedTextBackground': '#b9473f52',
    'diffEditorGutter.insertedLineBackground': '#2f8f5b66',
    'diffEditorGutter.removedLineBackground': '#b9473f66'
  }
})

monaco.editor.defineTheme('sele-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '898984' },
    { token: 'delimiter', foreground: 'B4B4AF' },
    { token: 'number', foreground: 'EE8580' },
    { token: 'regexp', foreground: 'E99B65' },
    { token: 'string', foreground: '8FC89D' },
    { token: 'keyword', foreground: 'D49AE2' },
    { token: 'type', foreground: 'D8AC7E' },
    { token: 'type.identifier', foreground: 'D8AC7E' },
    { token: 'function', foreground: 'D8AC7E' },
    { token: 'operator', foreground: 'DDB278' },
    { token: 'variable', foreground: 'DDB278' }
  ],
  colors: {
    'editor.background': '#181818',
    'editor.foreground': '#f8f8f8',
    'editor.lineHighlightBackground': '#7a56381f',
    'editor.lineHighlightBorder': '#00000000',
    'editorCursor.foreground': '#f8f8f8',
    'editorGutter.background': '#181818',
    'editorLineNumber.foreground': '#7f7f7f',
    'editorLineNumber.activeForeground': '#f8f8f8',
    'editorIndentGuide.background1': '#ffffff1a',
    'editorIndentGuide.activeBackground1': '#ffffff1a',
    'editorWhitespace.foreground': '#ffffff24',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#ffffff24',
    'scrollbarSlider.hoverBackground': '#ffffff38',
    'scrollbarSlider.activeBackground': '#7a563870',
    'diffEditor.insertedLineBackground': '#68c58e24',
    'diffEditor.insertedTextBackground': '#68c58e52',
    'diffEditor.removedLineBackground': '#f0837924',
    'diffEditor.removedTextBackground': '#f0837952',
    'diffEditorGutter.insertedLineBackground': '#68c58e66',
    'diffEditorGutter.removedLineBackground': '#f0837966'
  }
})

export const getMonacoTheme = (): 'sele-light' | 'sele-dark' =>
  document.documentElement.dataset.colorScheme === 'dark' ? 'sele-dark' : 'sele-light'

type EditorClipboardData = {
  isFromEmptySelection: boolean
  multicursorText: string[] | null
  text: string
}

let lastEditorClipboardData: EditorClipboardData | null = null

const getEditorClipboardData = (
  editor: monaco.editor.IStandaloneCodeEditor
): EditorClipboardData | null => {
  const model = editor.getModel()
  const selections = editor.getSelections()
  if (!model || !selections?.length) return null

  const emptySelectionClipboard = editor.getOption(
    monaco.editor.EditorOption.emptySelectionClipboard
  )
  const sortedSelections = [...selections].sort(monaco.Range.compareRangesUsingStarts)
  const hasNonEmptySelection = sortedSelections.some((selection) => !selection.isEmpty())
  if (!hasNonEmptySelection && !emptySelectionClipboard) return null

  const copiedText: string[] = []
  let previousLineNumber = 0

  for (const selection of sortedSelections) {
    if (selection.isEmpty()) {
      if (emptySelectionClipboard && selection.startLineNumber !== previousLineNumber) {
        const lineNumber = selection.startLineNumber
        const lineRange = new monaco.Range(
          lineNumber,
          model.getLineMinColumn(lineNumber),
          lineNumber,
          model.getLineMaxColumn(lineNumber)
        )
        copiedText.push(model.getValueInRange(lineRange) + model.getEOL())
      }
    } else {
      copiedText.push(model.getValueInRange(selection))
    }

    previousLineNumber = selection.startLineNumber
  }

  if (copiedText.length === 0) return null

  return {
    isFromEmptySelection:
      emptySelectionClipboard && selections.length === 1 && selections[0].isEmpty(),
    multicursorText: copiedText.length > 1 ? copiedText : null,
    text: copiedText.length === 1 ? copiedText[0] : copiedText.join(model.getEOL())
  }
}

export const copyEditorSelection = async (
  editor: monaco.editor.IStandaloneCodeEditor
): Promise<boolean> => {
  const clipboardData = getEditorClipboardData(editor)
  if (!clipboardData) return false

  await appApi.writeClipboardText(clipboardData.text)
  lastEditorClipboardData = clipboardData
  return true
}

export const pasteIntoEditor = async (
  editor: monaco.editor.IStandaloneCodeEditor
): Promise<void> => {
  const text = await appApi.readClipboardText()
  if (!text) return

  const metadata = lastEditorClipboardData?.text === text ? lastEditorClipboardData : null
  editor.trigger('keyboard', 'paste', {
    mode: null,
    multicursorText: metadata?.multicursorText ?? null,
    pasteOnNewLine: metadata?.isFromEmptySelection ?? false,
    text
  })
}
