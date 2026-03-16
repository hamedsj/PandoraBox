import type { DecodedBody } from '@/lib/httpBodies'

export interface BodyPresentation {
  text: string
  language: string
  label: string
  formatted: boolean
}

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const RAW_HTML_TAGS = new Set(['script', 'style', 'pre', 'textarea'])

export function presentBody(body: DecodedBody): BodyPresentation {
  if (body.isBinary) {
    return {
      text: body.text,
      language: 'plaintext',
      label: 'Hex',
      formatted: false,
    }
  }

  const contentType = body.contentType.toLowerCase()
  const source = body.text || ''
  const trimmed = source.trim()

  if (!trimmed) {
    return {
      text: '',
      language: 'plaintext',
      label: 'Text',
      formatted: false,
    }
  }

  if (isJsonType(contentType) || looksLikeJson(trimmed)) {
    const formatted = formatJson(trimmed)
    if (formatted) {
      return {
        text: formatted,
        language: 'json',
        label: 'JSON',
        formatted: formatted !== source,
      }
    }
  }

  if (isHtmlType(contentType) || looksLikeHtml(trimmed)) {
    const formatted = formatHtml(trimmed)
    return {
      text: formatted ?? source,
      language: 'html',
      label: 'HTML',
      formatted: Boolean(formatted && formatted !== source),
    }
  }

  if (isXmlType(contentType) || looksLikeXml(trimmed)) {
    const formatted = formatXml(trimmed)
    if (formatted) {
      return {
        text: formatted,
        language: 'xml',
        label: contentType.includes('svg') ? 'SVG' : 'XML',
        formatted: formatted !== source,
      }
    }
  }

  if (contentType.includes('x-www-form-urlencoded')) {
    const formatted = formatFormUrlEncoded(trimmed)
    return {
      text: formatted,
      language: 'plaintext',
      label: 'Form',
      formatted: formatted !== source,
    }
  }

  if (contentType.includes('javascript') || contentType.includes('ecmascript')) {
    return {
      text: source,
      language: 'javascript',
      label: 'JavaScript',
      formatted: false,
    }
  }

  if (contentType.includes('typescript')) {
    return {
      text: source,
      language: 'typescript',
      label: 'TypeScript',
      formatted: false,
    }
  }

  if (contentType.includes('css') || contentType.includes('scss')) {
    return {
      text: source,
      language: 'css',
      label: 'CSS',
      formatted: false,
    }
  }

  if (contentType.includes('yaml') || contentType.includes('yml')) {
    return {
      text: source,
      language: 'yaml',
      label: 'YAML',
      formatted: false,
    }
  }

  return {
    text: source,
    language: 'plaintext',
    label: 'Text',
    formatted: false,
  }
}

function isJsonType(contentType: string): boolean {
  return contentType.includes('json') || contentType.includes('+json')
}

function isHtmlType(contentType: string): boolean {
  return contentType.includes('text/html') || contentType.includes('application/xhtml')
}

function isXmlType(contentType: string): boolean {
  return contentType.includes('xml') || contentType.includes('+xml') || contentType.includes('svg')
}

function looksLikeJson(value: string): boolean {
  return (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  )
}

function looksLikeHtml(value: string): boolean {
  return /^<!doctype html/i.test(value) || /<html[\s>]/i.test(value) || /<body[\s>]/i.test(value)
}

function looksLikeXml(value: string): boolean {
  return /^<\?xml/i.test(value) || /^<svg[\s>]/i.test(value) || /^<([a-zA-Z_][\w:.-]*)(\s|>)/.test(value)
}

function formatJson(value: string): string | null {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return null
  }
}

function formatFormUrlEncoded(value: string): string {
  const params = new URLSearchParams(value)
  const pairs = Array.from(params.entries())
  if (pairs.length === 0) return value
  return pairs.map(([key, item]) => `${key} = ${item}`).join('\n')
}

function formatHtml(value: string): string | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(value, 'text/html')
    const output: string[] = []

    if (doc.doctype) {
      output.push(`<!DOCTYPE ${doc.doctype.name}>`)
    }

    if (doc.documentElement) {
      output.push(...formatNode(doc.documentElement, 0, 'html'))
    } else {
      output.push(...Array.from(doc.childNodes).flatMap((node) => formatNode(node, 0, 'html')))
    }

    return output.join('\n').trim()
  } catch {
    return null
  }
}

function formatXml(value: string): string | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(value, 'application/xml')
    if (doc.querySelector('parsererror')) return null

    const output: string[] = []
    output.push(...Array.from(doc.childNodes).flatMap((node) => formatNode(node, 0, 'xml')))
    return output.join('\n').trim()
  } catch {
    return null
  }
}

function formatNode(node: ChildNode, level: number, mode: 'html' | 'xml'): string[] {
  if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
    const doctype = node as DocumentType
    return [`<!DOCTYPE ${doctype.name}>`]
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return formatTextNode(node as Text, level)
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    return [`${indent(level)}<!--${node.textContent ?? ''}-->`]
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return []
  }

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  const attrs = Array.from(element.attributes)
    .map((attr) => `${attr.name}="${attr.value}"`)
    .join(' ')
  const open = attrs ? `<${tag} ${attrs}>` : `<${tag}>`
  const close = `</${tag}>`

  if (mode === 'html' && VOID_HTML_TAGS.has(tag)) {
    return [`${indent(level)}${open}`]
  }

  const childNodes = Array.from(element.childNodes).filter((child) => {
    if (child.nodeType !== Node.TEXT_NODE) return true
    return Boolean((child.textContent ?? '').trim())
  })

  if (childNodes.length === 0) {
    if (mode === 'xml') {
      const selfClosing = attrs ? `<${tag} ${attrs} />` : `<${tag} />`
      return [`${indent(level)}${selfClosing}`]
    }
    return [`${indent(level)}${open}${close}`]
  }

  if (RAW_HTML_TAGS.has(tag)) {
    const raw = element.textContent ?? ''
    return [
      `${indent(level)}${open}`,
      ...raw.split('\n').map((line) => `${indent(level + 1)}${line}`),
      `${indent(level)}${close}`,
    ]
  }

  if (childNodes.length === 1 && childNodes[0].nodeType === Node.TEXT_NODE) {
    const text = (childNodes[0].textContent ?? '').replace(/\s+/g, ' ').trim()
    return [`${indent(level)}${open}${text}${close}`]
  }

  return [
    `${indent(level)}${open}`,
    ...childNodes.flatMap((child) => formatNode(child, level + 1, mode)),
    `${indent(level)}${close}`,
  ]
}

function formatTextNode(node: Text, level: number): string[] {
  const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return []
  return [`${indent(level)}${text}`]
}

function indent(level: number): string {
  return '  '.repeat(level)
}
