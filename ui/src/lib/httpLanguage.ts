import type Monaco from 'monaco-editor'

let registered = false

export function registerHttpLanguage(monaco: typeof Monaco): void {
  if (registered) return
  registered = true

  monaco.languages.register({ id: 'http-request' })

  monaco.languages.setMonarchTokensProvider('http-request', {
    defaultToken: '',
    tokenizer: {
      // ── Request line ────────────────────────────────────────────────────────
      root: [
        // Response status line
        [/^HTTP\/\S+/, { token: 'http.version', next: '@after_http_version' }],
        [
          /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|PROPFIND|PROPPATCH|MKCOL|COPY|MOVE|LOCK|UNLOCK)\b/,
          { token: 'http.method', next: '@after_method' },
        ],
        // Unrecognised first line — treat as header block
        [/.*$/, { token: '', next: '@headers' }],
      ],

      after_http_version: [
        [/[ \t]+/, ''],
        [/\d{3}/, { token: 'http.status' }],
        [/[ \t]+/, ''],
        [/[^\r\n]+/, { token: 'http.status.text', next: '@headers' }],
        [/$/, { token: '', next: '@headers' }],
      ],

      after_method: [
        [/[ \t]+/, ''],
        // Path/URL — everything up to the whitespace before HTTP/
        [/\S+(?=[ \t]+HTTP\/)/, { token: 'http.url', next: '@after_url' }],
        // No HTTP version on the line
        [/\S+$/, { token: 'http.url', next: '@headers' }],
      ],

      after_url: [
        [/[ \t]+/, ''],
        [/HTTP\/\S+/, { token: 'http.version', next: '@headers' }],
        [/$/, { token: '', next: '@headers' }],
      ],

      // ── Headers ─────────────────────────────────────────────────────────────
      headers: [
        // Blank line → body
        [/^[ \t]*$/, { token: '', next: '@body' }],
        // Cookie / Set-Cookie — special value tokenization
        [/^(Cookie|Set-Cookie)(\s*:\s*)/, [
          { token: 'http.header.name' },
          { token: 'http.header.colon', next: '@cookie_value' },
        ]],
        // Generic header-name: colon  value
        [/^([\w\-]+)(\s*:\s*)/, ['http.header.name', 'http.header.colon']],
        // Rest of header line (value, or folded continuation)
        [/.+$/, 'http.header.value'],
      ],

      // ── Cookie value: name=value; name2=value2 ───────────────────────────────
      cookie_value: [
        // Cookie/attribute name (must be followed by '=')
        [/[^=;\s][^=;]*(?==)/, 'cookie.name'],
        // '=' separator — switch to value part (values may contain '=' e.g. base64)
        [/=/, { token: 'cookie.eq', next: '@cookie_val_part' }],
        // Bare flag without '=' (e.g. Secure, HttpOnly) before ';'
        [/[^;\n\r]+(?=;)/, 'cookie.value'],
        // Bare flag at end of line
        [/[^;\n\r]+/, { token: 'cookie.value', next: '@headers' }],
        [/;[ \t]*/, 'cookie.sep'],
        [/$/, { token: '', next: '@headers' }],
      ],

      // ── Cookie value part (after '=', allows '=' inside value) ───────────────
      cookie_val_part: [
        // Value up to ';' — can contain '=' (base64 padding etc.)
        [/[^;\n\r]+(?=;)/, { token: 'cookie.value', next: '@cookie_value' }],
        // Value at end of line
        [/[^;\n\r]+/, { token: 'cookie.value', next: '@headers' }],
        [/$/, { token: '', next: '@headers' }],
      ],

      // ── Body — auto-detects JSON / XML / form-urlencoded ────────────────────
      body: [
        // JSON object
        [/^\s*\{/, { token: 'delimiter.curly', next: '@json_object' }],
        // JSON array
        [/^\s*\[/, { token: 'delimiter.square', next: '@json_array' }],
        // XML / HTML (lookahead — don't consume the '<')
        [/^\s*(?=<)/, { token: '', next: '@xml' }],
        // Form URL-encoded: key=value&key2=value2
        // Match a key (non-empty, stops at =, &, newline, whitespace-only lines)
        [/[^=&\n\r\s][^=&\n\r]*(?==)/, 'form.key'],
        [/=/, 'form.eq'],
        [/[^&\n\r]+/, 'form.value'],
        [/&/, 'form.sep'],
        [/\s+/, ''],
      ],

      // ── JSON ────────────────────────────────────────────────────────────────
      json_object: [
        [/\{/, { token: 'delimiter.curly', next: '@push' }],
        [/\}/, { token: 'delimiter.curly', next: '@pop' }],
        [/\[/, { token: 'delimiter.square', next: '@json_array' }],
        // JSON key: string immediately followed by ':'
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'json.key'],
        [/:/, 'delimiter'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/[,]/, 'delimiter'],
        [/\s+/, ''],
      ],

      json_array: [
        [/\[/, { token: 'delimiter.square', next: '@push' }],
        [/\]/, { token: 'delimiter.square', next: '@pop' }],
        [/\{/, { token: 'delimiter.curly', next: '@json_object' }],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/[,]/, 'delimiter'],
        [/\s+/, ''],
      ],

      // ── XML / HTML ───────────────────────────────────────────────────────────
      xml: [
        [/<!--/, { token: 'comment', next: '@xml_comment' }],
        [/<[?!][^>]*>/, 'metatag'],
        [/<\/[\w:.\-]+>/, 'tag'],
        [/<[\w:.\-]+/, { token: 'tag', next: '@xml_attrs' }],
        [/&[\w#]+;/, 'string.escape'],
        [/[^<&]+/, ''],
      ],

      xml_attrs: [
        [/>/, { token: 'tag', next: '@pop' }],
        [/\/>/, { token: 'tag', next: '@pop' }],
        [/[\w:.\-]+(?=\s*=)/, 'attribute.name'],
        [/=/, 'delimiter'],
        [/"[^"]*"/, 'attribute.value'],
        [/'[^']*'/, 'attribute.value'],
        [/\s+/, ''],
      ],

      xml_comment: [
        [/-->/, { token: 'comment', next: '@pop' }],
        [/./, 'comment'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage)
}

export function httpTokenRules(mode: 'dark' | 'light'): Monaco.editor.ITokenThemeRule[] {
  if (mode === 'dark') {
    return [
      { token: 'http.method',         foreground: '7ee787', fontStyle: 'bold' },
      { token: 'http.url',            foreground: '79c0ff' },
      { token: 'http.version',        foreground: '8b949e' },
      { token: 'http.status',         foreground: 'ffa657', fontStyle: 'bold' },
      { token: 'http.status.text',    foreground: 'cdd9e5' },
      { token: 'http.header.name',    foreground: 'ffa657' },
      { token: 'http.header.colon',   foreground: '6e7681' },
      { token: 'http.header.value',   foreground: 'cdd9e5' },
      { token: 'json.key',            foreground: '79c0ff' },
      { token: 'string',              foreground: 'a5d6ff' },
      { token: 'number',              foreground: 'f0883e' },
      { token: 'keyword',             foreground: 'd2a8ff' },
      { token: 'delimiter',           foreground: '8b949e' },
      { token: 'delimiter.curly',     foreground: 'cdd9e5' },
      { token: 'delimiter.square',    foreground: 'cdd9e5' },
      { token: 'form.key',            foreground: 'ffa657' },
      { token: 'form.eq',             foreground: '8b949e' },
      { token: 'form.value',          foreground: 'a5d6ff' },
      { token: 'form.sep',            foreground: '8b949e' },
      { token: 'cookie.name',         foreground: '56d3c2' },
      { token: 'cookie.eq',           foreground: '8b949e' },
      { token: 'cookie.value',        foreground: 'a5d6ff' },
      { token: 'cookie.sep',          foreground: '8b949e' },
      { token: 'tag',                 foreground: '7ee787' },
      { token: 'metatag',             foreground: '8b949e' },
      { token: 'attribute.name',      foreground: 'ffa657' },
      { token: 'attribute.value',     foreground: 'a5d6ff' },
      { token: 'comment',             foreground: '8b949e', fontStyle: 'italic' },
      { token: 'string.escape',       foreground: 'd2a8ff' },
    ]
  }
  return [
    { token: 'http.method',         foreground: '116329', fontStyle: 'bold' },
    { token: 'http.url',            foreground: '0550ae' },
    { token: 'http.version',        foreground: '6e7781' },
    { token: 'http.status',         foreground: '953800', fontStyle: 'bold' },
    { token: 'http.status.text',    foreground: '1f2328' },
    { token: 'http.header.name',    foreground: '953800' },
    { token: 'http.header.colon',   foreground: '6e7781' },
    { token: 'http.header.value',   foreground: '1f2328' },
    { token: 'json.key',            foreground: '0550ae' },
    { token: 'string',              foreground: '0a3069' },
    { token: 'number',              foreground: '953800' },
    { token: 'keyword',             foreground: '7a3e9d' },
    { token: 'delimiter',           foreground: '6e7781' },
    { token: 'delimiter.curly',     foreground: '1f2328' },
    { token: 'delimiter.square',    foreground: '1f2328' },
    { token: 'form.key',            foreground: '953800' },
    { token: 'form.eq',             foreground: '6e7781' },
    { token: 'form.value',          foreground: '0a3069' },
    { token: 'form.sep',            foreground: '6e7781' },
    { token: 'cookie.name',         foreground: '1a7f8e' },
    { token: 'cookie.eq',           foreground: '6e7781' },
    { token: 'cookie.value',        foreground: '0a3069' },
    { token: 'cookie.sep',          foreground: '6e7781' },
    { token: 'tag',                 foreground: '116329' },
    { token: 'metatag',             foreground: '6e7781' },
    { token: 'attribute.name',      foreground: '953800' },
    { token: 'attribute.value',     foreground: '0a3069' },
    { token: 'comment',             foreground: '6e7781', fontStyle: 'italic' },
    { token: 'string.escape',       foreground: '7a3e9d' },
  ]
}
