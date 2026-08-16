// CodeMirror 6 language support for PandoraBox.
//
// Ports the former Monaco Monarch grammar (see git history: lib/httpLanguage.ts)
// to a CodeMirror StreamLanguage. A StreamLanguage is the closest analog to a
// Monarch tokenizer: a small state machine that walks the text line by line and
// tags spans. We keep the exact same token vocabulary (http.method, cookie.name,
// …) so the color palette below matches the old editor 1:1.
//
// Highlighting is DOM-native here — CodeMirror colors real text nodes, so the
// editor inherits the page font, native selection, and theme instead of the
// canvas-rendered look Monaco had.

import { StreamLanguage, HighlightStyle, LanguageSupport, syntaxHighlighting, type StringStream } from '@codemirror/language'
import { Tag, tags as t } from '@lezer/highlight'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { yaml } from '@codemirror/lang-yaml'
import { markdown } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'

// ── Custom highlight tags ─────────────────────────────────────────────────────
// One Tag per token type. Tags are theme-independent handles; the actual colors
// live in the HighlightStyles further down (one per light/dark mode).
const T = {
  method: Tag.define(),
  url: Tag.define(),
  version: Tag.define(),
  status: Tag.define(),
  statusText: Tag.define(),
  headerName: Tag.define(),
  headerColon: Tag.define(),
  headerValue: Tag.define(),
  jsonKey: Tag.define(),
  string: Tag.define(),
  number: Tag.define(),
  keyword: Tag.define(),
  delimiter: Tag.define(),
  formKey: Tag.define(),
  formEq: Tag.define(),
  formValue: Tag.define(),
  formSep: Tag.define(),
  cookieName: Tag.define(),
  cookieEq: Tag.define(),
  cookieValue: Tag.define(),
  cookieSep: Tag.define(),
  gqlKeyword: Tag.define(),
  gqlName: Tag.define(),
  gqlVariable: Tag.define(),
  gqlDirective: Tag.define(),
  gqlOperator: Tag.define(),
  tag: Tag.define(),
  metatag: Tag.define(),
  attrName: Tag.define(),
  attrValue: Tag.define(),
  comment: Tag.define(),
  escape: Tag.define(),
} as const

// Maps the string a stream token function returns to its Tag, so the parser can
// stay readable (`return 'method'`) instead of juggling Tag objects.
const tokenTable: Record<string, Tag> = {
  method: T.method,
  url: T.url,
  version: T.version,
  status: T.status,
  statusText: T.statusText,
  headerName: T.headerName,
  headerColon: T.headerColon,
  headerValue: T.headerValue,
  jsonKey: T.jsonKey,
  string: T.string,
  number: T.number,
  keyword: T.keyword,
  delimiter: T.delimiter,
  formKey: T.formKey,
  formEq: T.formEq,
  formValue: T.formValue,
  formSep: T.formSep,
  cookieName: T.cookieName,
  cookieEq: T.cookieEq,
  cookieValue: T.cookieValue,
  cookieSep: T.cookieSep,
  gqlKeyword: T.gqlKeyword,
  gqlName: T.gqlName,
  gqlVariable: T.gqlVariable,
  gqlDirective: T.gqlDirective,
  gqlOperator: T.gqlOperator,
  tag: T.tag,
  metatag: T.metatag,
  attrName: T.attrName,
  attrValue: T.attrValue,
  comment: T.comment,
  escape: T.escape,
}

// ── HTTP request/response stream parser ───────────────────────────────────────
// `mode` is the current state-machine node; `stack` supports JSON nesting the
// same way Monaco's @push/@pop did.
type HttpMode =
  | 'root'
  | 'afterVersion'
  | 'afterMethod'
  | 'afterUrl'
  | 'headers'
  | 'cookieValue'
  | 'cookieValPart'
  | 'body'
  | 'form'
  | 'textBody'
  | 'jsonObject'
  | 'jsonArray'
  | 'xml'
  | 'xmlAttrs'
  | 'xmlComment'
  | 'graphql'

interface HttpState {
  mode: HttpMode
  stack: HttpMode[]
}

const METHOD_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|PROPFIND|PROPPATCH|MKCOL|COPY|MOVE|LOCK|UNLOCK)\b/

function httpToken(stream: StringStream, state: HttpState): string | null {
  const sol = stream.sol()

  switch (state.mode) {
    case 'root': {
      if (sol && stream.match(/^HTTP\/\S+/)) {
        state.mode = 'afterVersion'
        return 'version'
      }
      if (sol && stream.match(METHOD_RE)) {
        state.mode = 'afterMethod'
        return 'method'
      }
      // Unrecognised first line — treat the rest as a header block.
      stream.skipToEnd()
      state.mode = 'headers'
      return null
    }

    case 'afterVersion': {
      if (stream.match(/^[ \t]+/)) return null
      if (stream.match(/^\d{3}/)) return 'status'
      if (stream.match(/^[^\r\n]+/)) {
        state.mode = 'headers'
        return 'statusText'
      }
      state.mode = 'headers'
      stream.skipToEnd()
      return null
    }

    case 'afterMethod': {
      if (stream.match(/^[ \t]+/)) return null
      // Path/URL up to the space before HTTP/…
      if (stream.match(/^\S+(?=[ \t]+HTTP\/)/)) {
        state.mode = 'afterUrl'
        return 'url'
      }
      if (stream.match(/^\S+$/)) {
        state.mode = 'headers'
        return 'url'
      }
      stream.skipToEnd()
      state.mode = 'headers'
      return null
    }

    case 'afterUrl': {
      if (stream.match(/^[ \t]+/)) return null
      if (stream.match(/^HTTP\/\S+/)) {
        state.mode = 'headers'
        return 'version'
      }
      stream.skipToEnd()
      state.mode = 'headers'
      return null
    }

    case 'headers': {
      // A whitespace-only (but non-empty) line separates headers from body.
      // Truly empty lines never reach token() — see blankLine() below.
      if (sol && stream.match(/^[ \t]+$/)) {
        state.mode = 'body'
        return null
      }
      // Header name + colon at the start of a line. Cookie/Set-Cookie switch
      // to a mode that tokenizes the value as name=value pairs.
      if (sol) {
        const m = stream.match(/^([\w-]+)(\s*:\s*)/) as RegExpMatchArray | null
        if (m) {
          const name = m[1].toLowerCase()
          if (name === 'cookie' || name === 'set-cookie') {
            state.mode = 'cookieValue'
          }
          return 'headerName'
        }
      }
      // Rest of a header line (value / folded continuation).
      if (stream.match(/^.+$/)) return 'headerValue'
      stream.next()
      return null
    }

    case 'cookieValue': {
      if (stream.match(/^[^=;\s][^=;]*(?==)/)) return 'cookieName'
      if (stream.match(/^=/)) {
        state.mode = 'cookieValPart'
        return 'cookieEq'
      }
      if (stream.match(/^[^;\n\r]+(?=;)/)) return 'cookieValue'
      if (stream.match(/^;[ \t]*/)) return 'cookieSep'
      if (stream.match(/^[^;\n\r]+/)) {
        state.mode = 'headers'
        return 'cookieValue'
      }
      stream.skipToEnd()
      state.mode = 'headers'
      return null
    }

    case 'cookieValPart': {
      if (stream.match(/^[^;\n\r]+(?=;)/)) {
        state.mode = 'cookieValue'
        return 'cookieValue'
      }
      if (stream.match(/^[^;\n\r]+/)) {
        state.mode = 'headers'
        return 'cookieValue'
      }
      stream.skipToEnd()
      state.mode = 'headers'
      return null
    }

    case 'body': {
      if (sol && stream.match(/^\s*(query|mutation|subscription|fragment)\b/)) {
        state.mode = 'graphql'
        return 'gqlKeyword'
      }
      if (sol && stream.match(/^\s*(?=\{)/)) {
        stream.match(/^\{/)
        state.mode = 'jsonObject'
        return 'delimiter'
      }
      if (sol && stream.match(/^\s*(?=\[)/)) {
        stream.match(/^\[/)
        state.mode = 'jsonArray'
        return 'delimiter'
      }
      if (sol && stream.match(/^\s*(?=<)/)) {
        state.mode = 'xml'
        return null
      }
      if (sol && stream.match(/^\s*(?=[^\s=&]+=)/)) {
        state.mode = 'form'
        return null
      }
      // Opaque text body — no misleading coloring.
      stream.skipToEnd()
      state.mode = 'textBody'
      return null
    }

    case 'form': {
      if (stream.match(/^[^=&\n\r\s][^=&\n\r]*(?==)/)) return 'formKey'
      if (stream.match(/^=/)) return 'formEq'
      if (stream.match(/^[^&\n\r]+/)) return 'formValue'
      if (stream.match(/^&/)) return 'formSep'
      if (stream.match(/^\s+/)) return null
      stream.next()
      return null
    }

    case 'textBody': {
      stream.skipToEnd()
      return null
    }

    case 'jsonObject':
    case 'jsonArray': {
      if (stream.match(/^\{/)) {
        state.stack.push(state.mode)
        state.mode = 'jsonObject'
        return 'delimiter'
      }
      if (stream.match(/^\[/)) {
        state.stack.push(state.mode)
        state.mode = 'jsonArray'
        return 'delimiter'
      }
      if (stream.match(/^\}/) || stream.match(/^\]/)) {
        state.mode = state.stack.pop() ?? 'textBody'
        return 'delimiter'
      }
      // JSON key: string immediately followed by ':'
      if (stream.match(/^"(?:[^"\\]|\\.)*"(?=\s*:)/)) return 'jsonKey'
      if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string'
      if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number'
      if (stream.match(/^\b(?:true|false|null)\b/)) return 'keyword'
      if (stream.match(/^[:,]/)) return 'delimiter'
      if (stream.match(/^\s+/)) return null
      stream.next()
      return null
    }

    case 'xml': {
      if (stream.match(/^<!--/)) {
        state.mode = 'xmlComment'
        return 'comment'
      }
      if (stream.match(/^<[?!][^>]*>/)) return 'metatag'
      if (stream.match(/^<\/[\w:.-]+>/)) return 'tag'
      if (stream.match(/^<[\w:.-]+/)) {
        state.mode = 'xmlAttrs'
        return 'tag'
      }
      if (stream.match(/^&[\w#]+;/)) return 'escape'
      if (stream.match(/^[^<&]+/)) return null
      stream.next()
      return null
    }

    case 'xmlAttrs': {
      if (stream.match(/^\/?>/)) {
        state.mode = 'xml'
        return 'tag'
      }
      if (stream.match(/^[\w:.-]+(?=\s*=)/)) return 'attrName'
      if (stream.match(/^=/)) return 'delimiter'
      if (stream.match(/^"[^"]*"/) || stream.match(/^'[^']*'/)) return 'attrValue'
      if (stream.match(/^\s+/)) return null
      stream.next()
      return null
    }

    case 'xmlComment': {
      if (stream.match(/^-->/)) {
        state.mode = 'xml'
        return 'comment'
      }
      stream.next()
      return 'comment'
    }

    case 'graphql': {
      if (stream.match(/^\b(query|mutation|subscription|fragment|on|schema|type|interface|union|enum|input|extend|directive)\b/)) return 'gqlKeyword'
      if (stream.match(/^\$[_A-Za-z][_0-9A-Za-z]*/)) return 'gqlVariable'
      if (stream.match(/^@[_A-Za-z][_0-9A-Za-z]*/)) return 'gqlDirective'
      if (stream.match(/^[!:=|&]/)) return 'gqlOperator'
      if (stream.match(/^[{}()[\],]/)) return 'delimiter'
      if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string'
      if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number'
      if (stream.match(/^\b(true|false|null)\b/)) return 'keyword'
      if (stream.match(/^#.*$/)) return 'comment'
      if (stream.match(/^[_A-Za-z][_0-9A-Za-z]*/)) return 'gqlName'
      if (stream.match(/^\s+/)) return null
      stream.next()
      return null
    }
  }

  stream.next()
  return null
}

const httpStreamLanguage = StreamLanguage.define<HttpState>({
  name: 'http-request',
  startState: () => ({ mode: 'root', stack: [] }),
  token: httpToken,
  // The stack array must be cloned per state or nested-JSON push/pop corrupts
  // sibling positions during CodeMirror's incremental re-parse.
  copyState: (s) => ({ mode: s.mode, stack: s.stack.slice() }),
  // Empty lines are skipped by token(); the header/body separator is one, so we
  // flip headers → body here.
  blankLine: (state) => {
    if (state.mode === 'headers') state.mode = 'body'
  },
  tokenTable,
})

// Standalone GraphQL parser (used when a body is pure GraphQL).
const graphqlStreamLanguage = StreamLanguage.define<HttpState>({
  name: 'graphql',
  startState: () => ({ mode: 'graphql', stack: [] }),
  token: (stream, state) => httpToken(stream, state),
  copyState: (s) => ({ mode: s.mode, stack: s.stack.slice() }),
  tokenTable,
})

// ── Highlight styles (colors ported verbatim from the old Monaco theme) ───────
function styleFor(mode: 'dark' | 'light'): HighlightStyle {
  const c =
    mode === 'dark'
      ? {
          method: '#7ee787', url: '#79c0ff', version: '#8b949e', status: '#ffa657', statusText: '#cdd9e5',
          headerName: '#ffa657', headerColon: '#6e7681', headerValue: '#cdd9e5', jsonKey: '#79c0ff',
          string: '#a5d6ff', number: '#f0883e', keyword: '#d2a8ff', delimiter: '#8b949e',
          formKey: '#ffa657', formEq: '#8b949e', formValue: '#a5d6ff', formSep: '#8b949e',
          cookieName: '#56d3c2', cookieEq: '#8b949e', cookieValue: '#a5d6ff', cookieSep: '#8b949e',
          gqlKeyword: '#ff7b72', gqlName: '#c9d1d9', gqlVariable: '#ffa657', gqlDirective: '#d2a8ff', gqlOperator: '#79c0ff',
          tag: '#7ee787', metatag: '#8b949e', attrName: '#ffa657', attrValue: '#a5d6ff', comment: '#8b949e', escape: '#d2a8ff',
        }
      : {
          method: '#116329', url: '#0550ae', version: '#6e7781', status: '#953800', statusText: '#1f2328',
          headerName: '#953800', headerColon: '#6e7781', headerValue: '#1f2328', jsonKey: '#0550ae',
          string: '#0a3069', number: '#953800', keyword: '#7a3e9d', delimiter: '#6e7781',
          formKey: '#953800', formEq: '#6e7781', formValue: '#0a3069', formSep: '#6e7781',
          cookieName: '#1a7f8e', cookieEq: '#6e7781', cookieValue: '#0a3069', cookieSep: '#6e7781',
          gqlKeyword: '#cf222e', gqlName: '#1f2328', gqlVariable: '#953800', gqlDirective: '#8250df', gqlOperator: '#0550ae',
          tag: '#116329', metatag: '#6e7781', attrName: '#953800', attrValue: '#0a3069', comment: '#6e7781', escape: '#7a3e9d',
        }

  return HighlightStyle.define([
    { tag: T.method, color: c.method, fontWeight: 'bold' },
    { tag: T.url, color: c.url },
    { tag: T.version, color: c.version },
    { tag: T.status, color: c.status, fontWeight: 'bold' },
    { tag: T.statusText, color: c.statusText },
    { tag: T.headerName, color: c.headerName },
    { tag: T.headerColon, color: c.headerColon },
    { tag: T.headerValue, color: c.headerValue },
    { tag: T.jsonKey, color: c.jsonKey },
    { tag: T.string, color: c.string },
    { tag: T.number, color: c.number },
    { tag: T.keyword, color: c.keyword },
    { tag: T.delimiter, color: c.delimiter },
    { tag: T.formKey, color: c.formKey },
    { tag: T.formEq, color: c.formEq },
    { tag: T.formValue, color: c.formValue },
    { tag: T.formSep, color: c.formSep },
    { tag: T.cookieName, color: c.cookieName },
    { tag: T.cookieEq, color: c.cookieEq },
    { tag: T.cookieValue, color: c.cookieValue },
    { tag: T.cookieSep, color: c.cookieSep },
    { tag: T.gqlKeyword, color: c.gqlKeyword, fontWeight: 'bold' },
    { tag: T.gqlName, color: c.gqlName },
    { tag: T.gqlVariable, color: c.gqlVariable },
    { tag: T.gqlDirective, color: c.gqlDirective },
    { tag: T.gqlOperator, color: c.gqlOperator },
    { tag: T.tag, color: c.tag },
    { tag: T.metatag, color: c.metatag },
    { tag: T.attrName, color: c.attrName },
    { tag: T.attrValue, color: c.attrValue },
    { tag: T.comment, color: c.comment, fontStyle: 'italic' },
    { tag: T.escape, color: c.escape },

    // ── Standard lezer tags — used by the lang-* packages (JSON, CSS, JS/TS,
    //    HTML, YAML, Python, Markdown). Mapped onto the same palette so every
    //    known body type is colored consistently with the HTTP view. ──────────
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword], color: c.gqlKeyword, fontWeight: 'bold' },
    { tag: [t.bool, t.null, t.atom, t.self], color: c.keyword },
    { tag: [t.string, t.special(t.string), t.docString], color: c.string },
    { tag: t.escape, color: c.escape },
    { tag: [t.number, t.integer, t.float], color: c.number },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: c.jsonKey },
    { tag: [t.function(t.variableName), t.function(t.definition(t.variableName)), t.macroName], color: c.keyword },
    { tag: [t.typeName, t.className, t.namespace], color: c.attrName },
    { tag: [t.constant(t.variableName), t.standard(t.variableName), t.labelName], color: c.status },
    { tag: t.variableName, color: c.headerValue },
    { tag: [t.comment, t.lineComment, t.blockComment], color: c.comment, fontStyle: 'italic' },
    { tag: [t.tagName, t.angleBracket], color: c.tag },
    { tag: t.attributeName, color: c.attrName },
    { tag: t.attributeValue, color: c.attrValue },
    { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.updateOperator], color: c.gqlOperator },
    { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.squareBracket, t.paren], color: c.delimiter },
    { tag: t.meta, color: c.version },
    { tag: [t.link, t.url], color: c.url, textDecoration: 'underline' },
    { tag: t.heading, color: c.url, fontWeight: 'bold' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: [t.list, t.quote], color: c.headerValue },
    { tag: t.invalid, color: mode === 'dark' ? '#ff7b72' : '#cf222e' },
  ])
}

const darkHighlight = styleFor('dark')
const lightHighlight = styleFor('light')

/** Highlight extension for the custom HTTP/GraphQL tags, matching the app mode. */
export function pandoraHighlight(mode: 'dark' | 'light'): Extension {
  return syntaxHighlighting(mode === 'dark' ? darkHighlight : lightHighlight)
}

/**
 * Resolve a CodeViewer `language` string to the CodeMirror language extension.
 * Unknown/plaintext languages get no highlighting (fast + neutral). The custom
 * HTTP highlight style is applied separately via {@link pandoraHighlight}.
 */
export function languageExtension(language: string): Extension | null {
  switch (language) {
    case 'http-request':
      return new LanguageSupport(httpStreamLanguage)
    case 'graphql':
      return new LanguageSupport(graphqlStreamLanguage)
    case 'json':
      return json()
    case 'python':
      return python()
    case 'html':
    case 'xml':
      return html()
    case 'javascript':
    case 'typescript':
      return javascript({ typescript: language === 'typescript' })
    case 'css':
    case 'scss':
      return css()
    case 'yaml':
    case 'yml':
      return yaml()
    case 'markdown':
    case 'md':
      return markdown()
    default:
      return null
  }
}
