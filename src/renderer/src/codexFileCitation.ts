import type { TokenizerExtension } from 'marked'

// Emit ordinary link tokens so citations share the file icon and open-file behavior.
// Tokenizing inline also leaves fenced and inline code examples untouched.
export const codexFileCitationExtension: TokenizerExtension = {
  name: 'codexFileCitation',
  level: 'inline',
  start: (source) => source.indexOf(':codex-file-citation{'),
  tokenizer(source) {
    if (this.lexer.state.inLink) return undefined
    const match = /^:codex-file-citation\{((?:[ \t]*[\w-]+="(?:\\.|[^"\\\r\n])*")+[ \t]*)\}/.exec(
      source
    )
    if (!match) return undefined

    const attributes = new Map<string, string>()
    try {
      for (const attribute of match[1].matchAll(/([\w-]+)=("(?:\\.|[^"\\])*")/g)) {
        attributes.set(attribute[1], JSON.parse(attribute[2]))
      }
    } catch {
      return undefined
    }
    const path = attributes.get('path')
    if (
      !path ||
      !/^(?:\/|[a-z]:[\\/])/i.test(path) ||
      Array.from(path).some((character) => character.charCodeAt(0) < 32)
    ) {
      return undefined
    }
    const label = path.replace(/\\/g, '/').split('/').at(-1) || path
    return {
      type: 'link',
      raw: match[0],
      href: encodeURI(path).replace(/[#?:]/g, encodeURIComponent),
      title: null,
      text: label,
      tokens: [{ type: 'escape', raw: label, text: label }]
    }
  }
}
