import { useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import Editor from '@monaco-editor/react'
import { Pencil, Eye } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  onSave: () => void
  placeholder?: string
  height?: number
}

export function NoteEditor({ value, onChange, onSave, placeholder = 'Click to add a note…', height = 200 }: Props) {
  const [editing, setEditing] = useState(false)
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  const handleMount = (_editor: unknown, monaco: unknown) => {
    // Cmd/Ctrl+S to save
    // @ts-expect-error monaco types
    _editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current()
      setEditing(false)
    })
  }

  if (editing) {
    return (
      <div className="relative border border-zinc-700 rounded-lg overflow-hidden">
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <button
            onClick={() => { onSave(); setEditing(false) }}
            className="p-1 rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 transition-colors"
            title="Preview (Cmd+S to save)"
          >
            <Eye size={13} />
          </button>
        </div>
        <Editor
          height={`${height}px`}
          defaultLanguage="markdown"
          value={value}
          onChange={(v) => onChange(v ?? '')}
          onMount={handleMount}
          theme="vs-dark"
          options={{
            wordWrap: 'on',
            lineNumbers: 'off',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            padding: { top: 8, bottom: 8 },
            overviewRulerLanes: 0,
            renderLineHighlight: 'none',
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
          }}
        />
      </div>
    )
  }

  return (
    <div
      className="relative group cursor-pointer"
      onClick={() => setEditing(true)}
    >
      {value ? (
        <div className="relative">
          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true) }}
              className="p-1 rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              <Pencil size={12} />
            </button>
          </div>
          <div className="prose prose-sm prose-invert max-w-none p-3 rounded-lg border border-zinc-700/50 hover:border-zinc-600 transition-colors bg-zinc-800/30 [&_pre]:bg-zinc-800 [&_code]:text-xs [&_a]:text-blue-400">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {value}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="text-zinc-600 text-sm italic p-3 rounded-lg border border-dashed border-zinc-700/50 hover:border-zinc-600 hover:text-zinc-500 transition-colors">
          {placeholder}
        </div>
      )}
    </div>
  )
}
