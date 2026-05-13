// =============================================================================
// src/components/editor/AskAIPopover.tsx
//
// PURPOSE: The "Ask AI" popover that appears when the user clicks the AI
//          button in the bubble menu. Shows 6 preset options + a custom prompt
//          input. Calls the backend endpoint and replaces the selected text.
//
// HOW THE AI FLOW WORKS:
//   1. User selects text → bubble menu appears → clicks "✨ Ask AI"
//   2. This popover renders with the 6 preset options
//   3. User picks an option (or types a custom prompt)
//   4. We call POST /api/ai/editor-assist { text, instruction, teamId }
//   5. Backend calls Gemini → returns the rewritten text
//   6. We call editor.chain().focus().insertContentAt(selection, result).run()
//   7. BECAUSE the insertion goes through TipTap → Yjs CRDT → Hocuspocus,
//      the AI text appears on ALL connected users' screens simultaneously.
//      This is the "wow" moment of the demo.
//
// WHY insertContentAt (not setContent):
//   setContent() replaces the ENTIRE document — catastrophic in collab editing.
//   insertContentAt(range, text) replaces only the selected range.
//   The replacement is a proper Yjs operation that syncs to all clients.
//
// WHY IMMEDIATE REPLACE (not a preview modal):
//   - Maximizes the "CRDT magic" — other users see AI text land in real-time
//   - Ctrl+Z immediately undoes it if the user doesn't like the result
//   - Fewer clicks = faster workflow for the demo
// =============================================================================

import { useState } from 'react'
import { Editor } from '@tiptap/react'
import {
  Sparkles, Briefcase, AlignLeft, CheckCheck,
  ArrowDownRight, ArrowUpRight, Wand2, Loader2, X, List
} from 'lucide-react'
import axios from 'axios'

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

interface AskAIPopoverProps {
  editor: Editor
  teamId: string          // From URL params — needed for the API call
  onClose: () => void     // Close the popover after action
}

type InstructionKey =
  | 'make_professional'
  | 'summarize'
  | 'fix_grammar'
  | 'make_shorter'
  | 'make_longer'
  | 'make_bullet_points'
  | 'custom'

interface PresetOption {
  key: InstructionKey
  label: string
  icon: React.ReactNode
}

// ---------------------------------------------------------------------------
// PRESETS
// ---------------------------------------------------------------------------
// WHY THESE SPECIFIC 6:
//   - Make professional: Most-used for business docs (meeting notes, proposals)
//   - Summarize: Condenses verbose text quickly
//   - Fix grammar: Non-native English speakers love this
//   - Make shorter: Removes filler — useful for executive summaries
//   - Make longer: Expands bullet points into full paragraphs
//   - Custom: Power users can type any instruction
// ---------------------------------------------------------------------------

const PRESETS: PresetOption[] = [
  { key: 'make_professional', label: 'Make professional', icon: <Briefcase size={14} /> },
  { key: 'summarize',         label: 'Summarize',         icon: <AlignLeft size={14} /> },
  { key: 'fix_grammar',       label: 'Fix grammar',       icon: <CheckCheck size={14} /> },
  { key: 'make_shorter',      label: 'Make shorter',      icon: <ArrowDownRight size={14} /> },
  { key: 'make_longer',       label: 'Make longer',       icon: <ArrowUpRight size={14} /> },
  { key: 'make_bullet_points',label: 'Make bullet points',icon: <List size={14} /> },
]

// ---------------------------------------------------------------------------
// COMPONENT: AskAIPopover
// ---------------------------------------------------------------------------

export default function AskAIPopover({ editor, teamId, onClose }: AskAIPopoverProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')

  // ── Get the currently selected text ─────────────────────────────────────
  const { from, to } = editor.state.selection
  const selectedText = editor.state.doc.textBetween(from, to, ' ')

  // ── Call the AI endpoint ────────────────────────────────────────────────
  const handleAI = async (instruction: InstructionKey, prompt?: string) => {
    if (!selectedText.trim()) {
      setError('No text selected')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const token = localStorage.getItem('cloudteams_token')
      const response = await axios.post(
        `${import.meta.env.VITE_API_URL}/ai/editor-assist`,
        {
          text: selectedText,
          instruction,
          teamId,
          ...(instruction === 'custom' ? { customPrompt: prompt } : {}),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )

      const { result } = response.data

      // ── Replace the selected text with AI output ────────────────────────
      // WHY chain().focus():
      //   chain() batches multiple commands into a single transaction.
      //   focus() ensures the editor regains focus after the popover is closed.
      //
      // WHY insertContentAt({ from, to }, result):
      //   This replaces only the range [from, to] — the user's selection.
      //   It goes through the Yjs CRDT, so ALL connected clients see the
      //   replacement appear simultaneously. This is the "wow" moment.
      //
      // WHY NOT deleteRange + insertContent:
      //   insertContentAt with a range does both atomically. Doing it in
      //   two steps would create a flicker where the text disappears and
      //   then reappears with the new content.
      editor.chain().focus().insertContentAt({ from, to }, result).run()

      onClose()

    } catch (err: any) {
      const message = err.response?.data?.error || err.message || 'AI request failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  // --------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl w-64 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <div className="flex items-center gap-1.5 text-indigo-400 text-xs font-semibold">
          <Sparkles size={13} />
          <span>Ask AI</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="flex items-center justify-center gap-2 px-3 py-4 text-indigo-400">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-xs font-medium">Rewriting with AI...</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-500/10 border-b border-slate-700">
          {error}
        </div>
      )}

      {/* Selected text preview */}
      {!loading && !error && selectedText && (
        <div className="px-3 py-2 bg-slate-900 border-b border-slate-700">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Target Text</p>
          <p className="text-xs text-slate-300 italic line-clamp-2 break-words">
            "{selectedText}"
          </p>
        </div>
      )}

      {/* Preset buttons */}
      {!loading && (
        <div className="py-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => handleAI(preset.key)}
              className="
                w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300
                hover:bg-slate-700 hover:text-white transition-colors text-left
              "
            >
              <span className="text-slate-500">{preset.icon}</span>
              {preset.label}
            </button>
          ))}

          {/* Custom prompt toggle */}
          {!showCustom ? (
            <button
              onClick={() => setShowCustom(true)}
              className="
                w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300
                hover:bg-slate-700 hover:text-white transition-colors text-left
                border-t border-slate-700
              "
            >
              <span className="text-slate-500"><Wand2 size={14} /></span>
              Custom prompt...
            </button>
          ) : (
            <div className="px-3 py-2 border-t border-slate-700">
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customPrompt.trim()) {
                    handleAI('custom', customPrompt)
                  }
                }}
                placeholder="Type your instruction..."
                className="
                  w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5
                  text-xs text-slate-200 placeholder:text-slate-500
                  focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500
                "
                autoFocus
              />
              <button
                onClick={() => customPrompt.trim() && handleAI('custom', customPrompt)}
                disabled={!customPrompt.trim()}
                className="
                  mt-1.5 w-full py-1.5 rounded text-xs font-medium
                  bg-indigo-600 text-white hover:bg-indigo-500
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors
                "
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      {/* Footer hint */}
      {!loading && (
        <div className="px-3 py-1.5 border-t border-slate-700 text-[10px] text-slate-500">
          Selected {selectedText.length} chars · Ctrl+Z to undo
        </div>
      )}
    </div>
  )
}
