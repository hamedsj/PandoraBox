/**
 * Shared hex-dump renderer used by the HTTP body viewer and the WebSocket
 * frames panel, so binary data looks identical everywhere: 16 bytes per row,
 * `offset  hh hh … hh  |ascii|`. Large payloads are capped with an explicit note.
 */

export interface HexDump {
  text: string
  shownBytes: number
  totalBytes: number
  truncated: boolean
}

const BYTES_PER_ROW = 16

export function hexDump(bytes: Uint8Array, maxBytes = 256 * 1024): HexDump {
  const total = bytes.length
  const shown = Math.min(total, maxBytes)
  const slice = bytes.subarray(0, shown)
  const rows: string[] = []

  for (let i = 0; i < slice.length; i += BYTES_PER_ROW) {
    const chunk = slice.subarray(i, i + BYTES_PER_ROW)
    const offset = i.toString(16).padStart(8, '0')
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(BYTES_PER_ROW * 3 - 1, ' ')
    const ascii = Array.from(chunk)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('')
    rows.push(`${offset}  ${hex}  |${ascii}|`)
  }

  return {
    text: rows.join('\n'),
    shownBytes: shown,
    totalBytes: total,
    truncated: shown < total,
  }
}
