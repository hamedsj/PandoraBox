// ─── Types ────────────────────────────────────────────────────────────────────

export interface Interaction {
  protocol: string        // 'dns', 'http', 'smtp', 'ldap', 'ftp', 'smb', etc.
  'unique-id': string
  'full-id': string
  'q-type'?: string       // DNS query type: A, AAAA, MX, TXT, NS, PTR, CNAME...
  'raw-request'?: string
  'raw-response'?: string
  'smtp-from'?: string
  'remote-address': string
  timestamp: string       // ISO 8601
}

export interface InteractshSession {
  server: string
  correlationId: string   // 20 letters-only chars (matching interactsh-web default)
  secretKey: string
  currentUrl: string      // {corrId}{nonce}.{server} — what to show/use for testing
  _privateKey: CryptoKey  // RSA-OAEP private key — in-memory only, not serializable
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Correlation ID: letters only (a-z), matching interactsh-web's generateRandomString(n, true)
function randomLetters(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

// Nonce: letters + digits, 13 chars (interactsh-web uses mixed)
function randomNonce(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const buf = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Generate a test URL: corrId(20) + nonce(13) + server
// The server extracts corrId as the first 20 chars of the subdomain.
// The nonce makes each URL unique for tracking individual payloads.
export function generateTestUrl(correlationId: string, server: string): string {
  return `${correlationId}${randomNonce(13)}.${server}`
}

// ─── Session creation ─────────────────────────────────────────────────────────

export async function createSession(server: string): Promise<{ session: InteractshSession; publicKeyB64: string }> {
  // Generate RSA-2048 key pair with SHA-256 (matches interactsh-web node-rsa OAEP SHA-256)
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,       // extractable — needed to export the public key
    ['decrypt'],
  )

  // Export public key as DER-encoded SPKI, wrap in PEM, then base64-encode the whole PEM.
  // The interactsh server does: base64.Decode(field) → pem.Decode() → x509.ParsePKIXPublicKey
  // So the field must be base64(PEM string), matching interactsh-web's btoa(pub) where pub is pkcs8-public-pem.
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const derB64 = btoa(String.fromCharCode(...new Uint8Array(spki)))
  const pemBody = derB64.match(/.{1,64}/g)?.join('\n') ?? derB64
  const pem = `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----\n`
  const publicKeyB64 = btoa(pem)

  // Correlation ID must be letters-only (a-z), 20 chars — matches interactsh-web default
  const correlationId = randomLetters(20)
  const secretKey = crypto.randomUUID()

  // The URL shown to users MUST include a 13-char nonce suffix.
  // The server requires the full subdomain to be corrId(20)+nonce(13)=33 chars minimum
  // to record an interaction. The 20-char bare domain only serves the info page.
  const currentUrl = generateTestUrl(correlationId, server)

  const session: InteractshSession = {
    server,
    correlationId,
    secretKey,
    currentUrl,
    _privateKey: keyPair.privateKey,
  }

  return { session, publicKeyB64 }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export async function register(session: InteractshSession, publicKeyB64: string): Promise<void> {
  const resp = await fetch(`https://${session.server}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'public-key': publicKeyB64,
      'secret-key': session.secretKey,
      'correlation-id': session.correlationId,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Registration failed (${resp.status}): ${text}`)
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────

interface PollResponse {
  data?: string[]
  aes_key?: string
  extra?: string[]
  tlddata?: string[]
}

export async function poll(session: InteractshSession): Promise<Interaction[]> {
  const url = `https://${session.server}/poll?id=${session.correlationId}&secret=${encodeURIComponent(session.secretKey)}`
  const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) })
  if (!resp.ok) throw new Error(`Poll failed: ${resp.status}`)

  const data = await resp.json() as PollResponse
  const interactions: Interaction[] = []

  // Decrypt AES-encrypted interactions
  if (data.data?.length && data.aes_key) {
    let aesKey: CryptoKey | null = null
    try {
      const encAesKey = b64ToBytes(data.aes_key)
      const aesKeyBytes = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        session._privateKey,
        encAesKey,
      )
      aesKey = await crypto.subtle.importKey(
        'raw', new Uint8Array(aesKeyBytes), { name: 'AES-CTR' }, false, ['decrypt'],
      )
    } catch (e) {
      console.error('[interactsh] RSA decrypt failed:', e)
    }

    if (aesKey) {
      for (const enc of data.data) {
        try {
          const encBytes = b64ToBytes(enc)
          const iv = encBytes.slice(0, 16)
          const ciphertext = encBytes.slice(16)
          const dec = await crypto.subtle.decrypt(
            { name: 'AES-CTR', counter: iv, length: 128 },
            aesKey,
            ciphertext,
          )
          const text = new TextDecoder().decode(dec)
          const parsed = JSON.parse(text) as Interaction
          interactions.push(parsed)
        } catch (e) {
          console.error('[interactsh] AES decrypt/parse failed:', e)
        }
      }
    }
  }

  // Extra unencrypted interactions
  for (const item of data.extra ?? []) {
    try {
      const parsed = JSON.parse(item) as Interaction
      interactions.push(parsed)
    } catch { /* skip */ }
  }
  for (const item of data.tlddata ?? []) {
    try {
      const parsed = JSON.parse(item) as Interaction
      interactions.push(parsed)
    } catch { /* skip */ }
  }

  return interactions
}

// ─── Deregistration ───────────────────────────────────────────────────────────

export async function deregister(session: InteractshSession): Promise<void> {
  await fetch(`https://${session.server}/deregister`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'correlation-id': session.correlationId,
      'secret-key': session.secretKey,
    }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => { /* best effort */ })
}

// ─── Public server list ───────────────────────────────────────────────────────

export const PUBLIC_SERVERS = [
  'oast.pro',
  'oast.live',
  'oast.site',
  'oast.online',
  'oast.fun',
  'oast.me',
] as const

export type PublicServer = typeof PUBLIC_SERVERS[number]
