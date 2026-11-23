const revisionPrefix =
  'Please replace my earlier instruction with this revision.\n\nEarlier instruction (quoted):\n'
const legacyRevisionPrefix =
  'Please replace my earlier instruction with this revision.\n\nEarlier instruction:\n'
const revisionHeading = '\n\nRevised instruction:'

/** Decodes correction messages saved by older Sele versions. */
export const parseCodexSteeringRevision = (text: string): string | null => {
  let headingStart: number
  if (text.startsWith(revisionPrefix)) {
    // JSON quoting keeps the earlier instruction on one line, even if it contains headings.
    headingStart = text.indexOf('\n', revisionPrefix.length)
    if (text[revisionPrefix.length] !== '"' || text[headingStart - 1] !== '"') return null
  } else if (text.startsWith(legacyRevisionPrefix)) {
    headingStart = text.indexOf(revisionHeading, legacyRevisionPrefix.length)
  } else {
    return null
  }
  if (headingStart < 0 || !text.startsWith(revisionHeading, headingStart)) return null

  const revisedStart = headingStart + revisionHeading.length
  const revised = text.slice(revisedStart)
  if (revised !== '' && !revised.startsWith('\n')) return null

  return revised.trim()
}
