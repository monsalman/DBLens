import React, { useState } from 'react'
import { Pencil, Check, X, Database } from 'lucide-react'
import type { CommentUpdateRequest } from './dictionaryHelper'

interface ColumnCommentEditorProps {
  schema: string
  table: string
  column?: string
  initialComment: string
  onSave: (req: CommentUpdateRequest) => Promise<boolean>
  disabled?: boolean
  placeholder?: string
}

export const ColumnCommentEditor: React.FC<ColumnCommentEditorProps> = ({
  schema,
  table,
  column,
  initialComment,
  onSave,
  disabled = false,
  placeholder = '+ Add description...',
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [commentText, setCommentText] = useState(initialComment || '')
  const [syncToDB, setSyncToDB] = useState(true)
  const [saving, setSaving] = useState(false)

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCommentText(initialComment || '')
    setIsEditing(true)
  }

  const handleCancel = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setCommentText(initialComment || '')
    setIsEditing(false)
  }

  const handleSave = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setSaving(true)
    const success = await onSave({
      schema,
      table,
      column,
      comment: commentText.trim(),
      syncToDB,
    })
    setSaving(false)
    if (success) {
      setIsEditing(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      handleCancel()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md text-xs" onClick={(e) => e.stopPropagation()}>
        <textarea
          autoFocus
          rows={2}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe purpose, business rules, or valid values..."
          className="w-full px-2 py-1.5 bg-[var(--bg)] text-[var(--fg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-blue-500 font-sans resize-y"
        />

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={syncToDB}
              onChange={(e) => setSyncToDB(e.target.checked)}
              className="rounded border-[var(--border)] text-blue-600 focus:ring-0"
            />
            <Database className="w-3 h-3" />
            <span>Sync comment to database DDL</span>
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="px-2 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors flex items-center gap-1 text-[11px]"
            >
              <X className="w-3 h-3" />
              <span>Cancel</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || disabled}
              className="px-2.5 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors flex items-center gap-1 text-[11px] disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  const hasComment = Boolean(initialComment && initialComment.trim())

  return (
    <div
      onClick={handleStartEdit}
      className="group relative flex items-start justify-between gap-2 cursor-pointer py-0.5 px-1 -mx-1 rounded hover:bg-[var(--hover)] transition-colors min-h-[20px]"
      title="Click to edit documentation"
    >
      <div className="flex-1 text-xs break-words">
        {hasComment ? (
          <span className="text-[var(--fg)] leading-relaxed font-sans">{initialComment}</span>
        ) : (
          <span className="text-[var(--muted)] opacity-60 hover:opacity-100 italic transition-opacity">
            {placeholder}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={handleStartEdit}
        className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-blue-500 transition-opacity p-0.5 shrink-0"
        title="Edit comment"
      >
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  )
}
