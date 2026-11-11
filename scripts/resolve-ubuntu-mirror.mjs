import { get } from 'node:https'
import { isIP } from 'node:net'
import { fileURLToPath } from 'node:url'

const mirrors = new Set(['archive.ubuntu.com', 'security.ubuntu.com', 'ports.ubuntu.com'])
const providers = [
  { hostname: 'dns.google', address: '8.8.8.8', path: '/resolve' },
  { hostname: 'cloudflare-dns.com', address: '1.1.1.1', path: '/dns-query' }
]

function query(provider, hostname) {
  return new Promise((resolve, reject) => {
    const request = get(
      {
        hostname: provider.hostname,
        servername: provider.hostname,
        path: `${provider.path}?name=${encodeURIComponent(hostname)}&type=A`,
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(15_000),
        // Connect to the provider's published IP while retaining its hostname
        // for TLS verification. This lookup works even when worker DNS is broken.
        lookup: (_name, options, callback) => {
          if (options.all) callback(null, [{ address: provider.address, family: 4 }])
          else callback(null, provider.address, 4)
        }
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`DNS provider returned ${response.statusCode}`))
          return
        }
        let body = ''
        response.on('data', (chunk) => {
          body += chunk
          if (body.length > 65_536) request.destroy(new Error('DNS response is too large'))
        })
        response.on('error', reject)
        response.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    request.on('error', reject)
  })
}

export async function resolveUbuntuMirror(hostname, { queryDns = query } = {}) {
  if (!mirrors.has(hostname))
    throw new Error('Only Ubuntu package mirror names may use this fallback')
  for (const provider of providers) {
    try {
      const response = await queryDns(provider, hostname)
      if (response.Status !== 0) continue
      const answer = response.Answer?.find((record) => record.type === 1 && isIP(record.data) === 4)
      if (answer) return answer.data
    } catch {
      // Try the independent HTTPS resolver; neither path disables TLS verification.
    }
  }
  throw new Error(`Unable to resolve Ubuntu mirror ${hostname} over HTTPS`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await resolveUbuntuMirror(process.argv[2]))
}
