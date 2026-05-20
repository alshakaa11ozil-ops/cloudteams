// =============================================================================
// src/components/editor/EditorToolbar.tsx
//
// PURPOSE: Fixed formatting toolbar pinned directly above the editor area.
//          Provides visual buttons for every TipTap formatting command.
//
// WHY A FIXED TOOLBAR (not just a bubble menu):
//   A bubble menu only appears when text is selected. New users who want to
//   start a heading or create a list have nothing to click — the editor looks
//   like a plain textarea. A fixed toolbar communicates "this is a rich editor"
//   at first glance, which matters for the demo committee's first impression.
//
// HOW ACTIVE STATE WORKS:
//   TipTap's editor.isActive('bold') returns true when the cursor is inside
//   bold text. We bind each button's styling to its active state. When the user
//   places their cursor inside a heading, the H1 button gets highlighted.
//   This is reactive — TipTap's editor instance notifies React on every
//   cursor position change via the useEditor hook.
//
// WHY DISABLED WHEN readOnly:
//   Viewer-role users should see the toolbar (so they know it's a rich editor)
//   but not be able to click anything. We use pointer-events-none + opacity
//   for a visual signal that formatting is locked.
// =============================================================================

import { Editor, useEditorState } from '@tiptap/react'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code,
  Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare,
  Quote, Minus, Undo2, Redo2, CodeSquare, Sparkles
} from 'lucide-react'

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

interface EditorToolbarProps {
  editor: Editor | null
  readOnly?: boolean
  onAskAI?: () => void  // Callback to open the Ask AI popover
}

// ---------------------------------------------------------------------------
// HELPER: ToolbarButton
// ---------------------------------------------------------------------------
// WHY A SUB-COMPONENT:
//   Every button shares the same styling logic: active state, disabled state,
//   hover effects, and onClick handler. Extracting it prevents 16x code duplication.
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  icon: React.ReactNode
  title: string
  isActive: boolean
  onClick: () => void
  disabled: boolean
}

function ToolbarButton({ icon, title, isActive, onClick, disabled }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`
        p-1.5 rounded transition-colors duration-150
        ${isActive
          ? 'bg-indigo-500/30 text-indigo-300'
          : 'text-slate-400 hover:text-white hover:bg-slate-700'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {icon}
    </button>
  )
}

// ---------------------------------------------------------------------------
// HELPER: Divider
// ---------------------------------------------------------------------------
// WHY DIVIDERS: Groups related buttons visually (text formatting | headings |
// lists | blocks | undo/redo). Helps users find what they need faster.
// ---------------------------------------------------------------------------

function Divider() {
  return <div className="w-px h-5 bg-slate-600 mx-1" />
}

// ---------------------------------------------------------------------------
// COMPONENT: EditorToolbar
// ---------------------------------------------------------------------------

export default function EditorToolbar({ editor, readOnly = false, onAskAI }: EditorToolbarProps) {
  // ── State Subscriptions ──────────────────────────────────────────────────
  // WHY useEditorState:
  //   In TipTap v2.4+, useEditorState prevents the entire toolbar component
  //   from re-rendering on every keystroke. It only re-renders when the
  //   specific values returned by the selector change.
  const editorState = useEditorState({
    // Type cast to any because the typings might not like null depending on version
    editor: editor as any,
    selector: (ctx) => {
      if (!ctx.editor) return null
      return {
        isBold: ctx.editor.isActive('bold'),
        isItalic: ctx.editor.isActive('italic'),
        isUnderline: ctx.editor.isActive('underline'),
        isStrike: ctx.editor.isActive('strike'),
        isCode: ctx.editor.isActive('code'),
        isHeading1: ctx.editor.isActive('heading', { level: 1 }),
        isHeading2: ctx.editor.isActive('heading', { level: 2 }),
        isHeading3: ctx.editor.isActive('heading', { level: 3 }),
        isBulletList: ctx.editor.isActive('bulletList'),
        isOrderedList: ctx.editor.isActive('orderedList'),
        isTaskList: ctx.editor.isActive('taskList'),
        isBlockquote: ctx.editor.isActive('blockquote'),
        isCodeBlock: ctx.editor.isActive('codeBlock'),
        canUndo: ctx.editor.can().undo(),
        canRedo: ctx.editor.can().redo(),
      }
    }
  })

  if (!editor || !editorState) return null

  if (readOnly) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-amber-500/30">
        <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <span className="font-medium text-amber-400 text-sm">Read-Only</span>
        <span className="text-slate-400 text-sm">— document locked by another user</span>
      </div>
    )
  }

  const disabled = readOnly
  const iconSize = 16

  return (
    <div className="flex items-center gap-0.5 px-4 py-1.5 bg-slate-800 border-b border-slate-700 flex-wrap">

      {/* ── Text formatting group ───────────────────────────────────────── */}
      <ToolbarButton
        icon={<Bold size={iconSize} />}
        title="Bold (Ctrl+B)"
        isActive={editorState.isBold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<Italic size={iconSize} />}
        title="Italic (Ctrl+I)"
        isActive={editorState.isItalic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<UnderlineIcon size={iconSize} />}
        title="Underline (Ctrl+U)"
        isActive={editorState.isUnderline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<Strikethrough size={iconSize} />}
        title="Strikethrough"
        isActive={editorState.isStrike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<Code size={iconSize} />}
        title="Inline Code"
        isActive={editorState.isCode}
        onClick={() => editor.chain().focus().toggleCode().run()}
        disabled={disabled}
      />

      <Divider />

      {/* ── Headings group ──────────────────────────────────────────────── */}
      <ToolbarButton
        icon={<Heading1 size={iconSize} />}
        title="Heading 1"
        isActive={editorState.isHeading1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<Heading2 size={iconSize} />}
        title="Heading 2"
        isActive={editorState.isHeading2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<Heading3 size={iconSize} />}
        title="Heading 3"
        isActive={editorState.isHeading3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        disabled={disabled}
      />

      <Divider />

      {/* ── Lists group ─────────────────────────────────────────────────── */}
      <ToolbarButton
        icon={<List size={iconSize} />}
        title="Bullet List"
        isActive={editorState.isBulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<ListOrdered size={iconSize} />}
        title="Ordered List"
        isActive={editorState.isOrderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<CheckSquare size={iconSize} />}
        title="Task List"
        isActive={editorState.isTaskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        disabled={disabled}
      />

      <Divider />

      {/* ── Block elements group ────────────────────────────────────────── */}
      <ToolbarButton
        icon={<Quote size={iconSize} />}
        title="Blockquote"
        isActive={editorState.isBlockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<CodeSquare size={iconSize} />}
        title="Code Block"
        isActive={editorState.isCodeBlock}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        disabled={disabled}
      />
      <ToolbarButton
        icon={<Minus size={iconSize} />}
        title="Horizontal Rule"
        isActive={false}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        disabled={disabled}
      />

      <Divider />

      {/* ── Undo / Redo ─────────────────────────────────────────────────── */}
      {/*
        WHY UNDO/REDO IN THE TOOLBAR:
          With Yjs Collaboration, Ctrl+Z uses the Yjs UndoManager (which tracks
          only the current user's operations — it won't undo a teammate's work).
          Having visual buttons makes undo/redo discoverable for non-keyboard users.
      */}
      <ToolbarButton
        icon={<Undo2 size={iconSize} />}
        title="Undo (Ctrl+Z)"
        isActive={false}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={disabled || !editorState.canUndo}
      />
      <ToolbarButton
        icon={<Redo2 size={iconSize} />}
        title="Redo (Ctrl+Shift+Z)"
        isActive={false}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={disabled || !editorState.canRedo}
      />
      {/* ── Ask AI ────────────────────────────────────────────────────── */}
      {/*
        WHY AI IN THE TOOLBAR (not just a bubble menu):
          TipTap v3 doesn't provide a React BubbleMenu component.
          Having the AI button always visible in the toolbar makes it
          more discoverable. The user selects text, then clicks the
          sparkle button — clean and obvious.
      */}
      {onAskAI && !readOnly && (
        <>
          <Divider />
          <button
            type="button"
            title="✨ Ask AI to transform selected text"
            onClick={onAskAI}
            className="
              flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold
              text-amber-400 hover:bg-amber-500/15 hover:text-amber-300
              transition-colors cursor-pointer
            "
          >
            <Sparkles size={14} />
            <span>Ask AI</span>
          </button>
        </>
      )}

    </div>
  )
}
