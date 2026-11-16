import { createPrivateKey, randomUUID, X509Certificate } from 'node:crypto'
import { chmod, link, readFile, rm, writeFile } from 'node:fs/promises'
import { generate } from 'selfsigned'

export type LocalAccessTls = { key: string; cert: string; fingerprint: string }

const validate = (value: { key: string; cert: string }): LocalAccessTls => {
  const certificate = new X509Certificate(value.cert)
  if (
    !certificate.checkPrivateKey(createPrivateKey(value.key)) ||
    Date.parse(certificate.validTo) <= Date.now() ||
    Date.parse(certificate.validFrom) > Date.now()
  )
    throw new Error('The local network certificate is invalid or expired.')
  return { ...value, fingerprint: certificate.fingerprint256.replaceAll(':', '').toLowerCase() }
}

/** A computer keeps its identity across restarts and DHCP changes. Never silently
 * replace a damaged identity: paired devices must reject an unexpected key. */
export const loadLocalAccessTls = async (path: string): Promise<LocalAccessTls> => {
  try {
    const identity = validate(JSON.parse(await readFile(path, 'utf8')))
    await chmod(path, 0o600)
    return identity
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(
        'Unable to load the computer’s local network certificate. Restore its identity before enabling access.'
      )
  }
  const notBeforeDate = new Date(Date.now() - 5 * 60_000)
  const notAfterDate = new Date()
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10)
  const generated = await generate([{ name: 'commonName', value: 'Sele computer' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: '::1' }
        ]
      }
    ]
  })
  const identity = validate({ key: generated.private, cert: generated.cert })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ key: identity.key, cert: identity.cert }), {
      mode: 0o600,
      flag: 'wx'
    })
    try {
      // Publish only a complete identity, without replacing a concurrent winner.
      await link(temporary, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      return await loadLocalAccessTls(path)
    }
    return identity
  } finally {
    await rm(temporary, { force: true })
  }
}
