import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

const [tag, artifact, caskPath = 'Casks/sele.rb'] = process.argv.slice(2)
const match = /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))(?:-macos-arm64)?$/.exec(tag ?? '')
if (!match || !artifact) {
  throw new Error('Usage: node scripts/update-homebrew-cask.mjs vX.Y.Z path/to/dmg [cask]')
}
const version = match[1]
const downloadTag = tag.endsWith('-macos-arm64') ? 'v#{version}-macos-arm64' : 'v#{version}'
const cask = await readFile(caskPath, 'utf8')
const current = /^ {2}version "(\d+\.\d+\.\d+)"$/m.exec(cask)?.[1]
if (!current || !/^ {2}sha256 "[a-f0-9]{64}"$/m.test(cask)) {
  throw new Error('Expected a versioned cask with a SHA-256 checksum')
}
// A rerun of an older release must never downgrade the tap.
const previousParts = current.split('.').map(Number)
const nextParts = version.split('.').map(Number)
const difference = nextParts.map((part, index) => part - previousParts[index]).find(Boolean)
if (difference < 0) {
  console.log(`Keeping newer Homebrew version ${current}; release is ${version}`)
} else {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(artifact)) hash.update(chunk)
  const checksum = hash.digest('hex')
  await writeFile(
    caskPath,
    cask
      .replace(/^ {2}version ".*"$/m, `  version "${version}"`)
      .replace(/^ {2}sha256 ".*"$/m, `  sha256 "${checksum}"`)
      .replace(
        /releases\/download\/v#\{version\}(?:-macos-arm64)?\//,
        `releases/download/${downloadTag}/`
      )
  )
  console.log(`Homebrew cask updated to ${version} (${checksum})`)
}
