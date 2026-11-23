'use client'

/**
 * RIISHE composer — ChatGPT-style input in BEAN's identity.
 *
 * Real upload support exists (POST /api/riishe/documents, capability-based
 * processing), so the attachment button is real: picker + drag & drop, up to
 * 3 files per message, with honest per-file status chips. Enter sends,
 * Shift+Enter inserts a newline; while the model streams the same button
 * becomes Stop (an AbortController cancels the SSE read client-side).
 */
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { FileText, Paperclip, Square, X, ArrowUp, Laptop, Download, Clock } from 'lucide-react'
import type { RiisheChat } from './use-riishe-chat'
import { MAX_FILES } from './use-riishe-chat'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const CAPABILITY_HINT =
  'Documents, data, code, images, audio/video and archives — processed by capability'

export function RiisheComposer({ chat }: { chat: RiisheChat }) {
  const typingMaxRows = 8
  // The file input is composer-local DOM: the ref lives with the node.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onDeviceSend = () => void chat.sendOnDevice()
  return (
    <div className="border-t border-[rgba(212,175,55,0.1)] bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/95 to-transparent px-4 pb-4 pt-3 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {/* ON-DEVICE LANE: size-confirmation dialog + live download progress. */}
        {chat.onDeviceNeedsDownload !== null ? (
          <div className="mb-2 rounded-lg border border-[rgba(212,175,55,0.35)] bg-[rgba(212,175,55,0.06)] p-3 text-xs text-white/75">
            <div className="mb-1 font-semibold text-[#f0c75e]">Download the on-device chat model?</div>
            <p className="leading-relaxed">
              Approx. size: <span className="text-[#f0c75e]">{formatBytes(chat.onDeviceNeedsDownload)}</span>{' '}
              (compact chat model, Apache-2.0 license, runs on this device's GPU). The model runs entirely in this
              browser afterward — nothing is uploaded — and the download happens once into the browser cache.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => void chat.confirmOnDeviceDownload()}
                className="h-7 bg-[#d4af37] text-black hover:bg-[#e6c25a]"
              >
                <Download className="h-3.5 w-3.5" /> Download and enable
              </Button>
              <Button size="sm" variant="outline" onClick={chat.cancelOnDeviceDownload} className="h-7 border-white/20 text-white/70">
                Not now
              </Button>
            </div>
          </div>
        ) : null}
        {chat.onDevicePreparing && chat.onDeviceProgress ? (
          <div className="mb-2 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/70">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-white/80">Preparing the on-device model…</span>
              <span className="text-white/45">{chat.onDeviceProgress.progress !== null ? `${Math.round(chat.onDeviceProgress.progress * 100)}%` : ''}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#d4af37] transition-all"
                style={{ width: `${Math.round((chat.onDeviceProgress.progress ?? 0) * 100)}%` }}
              />
            </div>
            <div className="mt-1 truncate text-[10px] text-white/40">{chat.onDeviceProgress.note}</div>
          </div>
        ) : null}
        {/* Attachments */}
        {chat.files.length > 0 || chat.uploadingCount > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {chat.files.map((d) => (
              <span
                key={d.id}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                  d.status === 'ready'
                    ? 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] text-[#f0c75e]'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                )}
                title={d.note ?? (d.status === 'ready' ? 'Ready — content will be analyzed with the message' : '')}
              >
                <FileText className="h-3 w-3" />
                {d.name}
                <span className="text-white/35">{formatBytes(d.size)}</span>
                {d.status === 'ready' && typeof d.characters === 'number' ? (
                  <span className="text-white/35">· {d.characters.toLocaleString()} chars</span>
                ) : null}
                {d.truncated ? <span className="text-amber-300">· truncated</span> : null}
                {d.status === 'unsupported' ? (
                  <span>· can&apos;t analyze{d.note ? `: ${d.note.slice(0, 60)}` : ''}</span>
                ) : null}
                <button
                  onClick={() => chat.removeFile(d.id)}
                  className="ml-0.5 text-white/40 hover:text-white/80"
                  aria-label={`Remove ${d.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {chat.uploadingCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-[11px] text-white/50">
                uploading {chat.uploadingCount} file{chat.uploadingCount > 1 ? 's' : ''}…
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Input shell */}
        <div
          className={cn(
            'rounded-2xl border bg-[#121214]/90 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.9)] backdrop-blur transition-colors',
            chat.dragOver
              ? 'border-[rgba(212,175,55,0.6)] bg-[rgba(212,175,55,0.06)]'
              : 'border-[rgba(212,175,55,0.2)] focus-within:border-[rgba(212,175,55,0.45)]',
          )}
          onDragOver={(e) => {
            e.preventDefault()
            chat.setDragOver(true)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) chat.setDragOver(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            chat.setDragOver(false)
            if (e.dataTransfer?.files?.length) void chat.uploadFiles(e.dataTransfer.files)
          }}
        >
          <Textarea
            value={chat.input}
            onChange={(e) => chat.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                // ON-DEVICE LANE: when active, Enter generates in this browser.
                if (chat.onDeviceMode && chat.onDeviceReady) void chat.sendOnDevice()
                else void chat.send()
              }
            }}
            placeholder={chat.onDeviceMode && chat.onDeviceReady ? 'Message RIISHE (on-device, private)…' : 'Message RIISHE…'}
            rows={Math.min(typingMaxRows, Math.max(1, chat.input.split('\n').length))}
            maxLength={12000}
            disabled={chat.streaming}
            className="max-h-48 min-h-[52px] resize-none border-0 bg-transparent px-4 pt-3.5 text-[14.5px] text-white/90 shadow-none focus-visible:ring-0"
            aria-label="Message RIISHE"
          />
          <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
            <div className="flex items-center gap-2">
              {/* ON-DEVICE LANE toggle (Tier A): appears only when the
                  measured device capability supports it. */}
              {chat.onDeviceAvailable ? (
                <button
                  onClick={() => {
                    if (chat.onDeviceMode) chat.disableOnDevice()
                    else void chat.enableOnDevice()
                  }}
                  disabled={chat.streaming || chat.onDevicePreparing}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] transition-colors disabled:opacity-40',
                    chat.onDeviceMode && chat.onDeviceReady
                      ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.14)] text-[#f0c75e]'
                      : 'border-white/10 text-white/50 hover:bg-white/10 hover:text-white/85',
                  )}
                  title={
                    chat.onDeviceReady
                      ? 'On-device chat: runs in this browser (private, unsaved). Click to switch off.'
                      : 'On-device chat: download the browser model (its size is shown before any download).'
                  }
                  aria-pressed={chat.onDeviceMode && chat.onDeviceReady}
                >
                  <Laptop className="h-3.5 w-3.5" />
                  On-device{chat.onDeviceMode && chat.onDeviceReady ? ' · private' : ''}
                </button>
              ) : null}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={chat.uploadingCount > 0 || chat.files.length >= MAX_FILES}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-white/50 transition-colors hover:bg-white/10 hover:text-white/85 disabled:opacity-40"
                title={`Attach files — up to ${MAX_FILES}. ${CAPABILITY_HINT}.`}
                aria-label="Attach files"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void chat.uploadFiles(e.target.files)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              />
              {/* TIER D: persistent background turn (durable queue; the answer
                  lands in the conversation even if this tab closes). */}
              <button
                onClick={() => void chat.runInBackground()}
                disabled={chat.streaming || !chat.input.trim() || (chat.onDeviceMode && chat.onDeviceReady)}
                className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 px-2.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white/85 disabled:opacity-40"
                title="Run as a persistent background job (the answer is appended to this conversation even if you close this tab)"
                aria-label="Run as background job"
              >
                <Clock className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-[11px]">Background</span>
              </button>
              <span className="hidden text-[10px] text-white/25 sm:block">
                {chat.input.length > 10000 ? `${chat.input.length.toLocaleString()} / 12,000` : 'Enter to send · Shift+Enter for a new line'}
              </span>
            </div>
            {chat.streaming ? (
              <Button
                onClick={chat.stopGeneration}
                className="h-9 w-9 rounded-full border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.12)] p-0 text-[#f0c75e] hover:bg-[rgba(212,175,55,0.25)]"
                variant="outline"
                aria-label="Stop generating"
                title="Stop generating"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (chat.onDeviceMode && chat.onDeviceReady) onDeviceSend()
                  else void chat.send()
                }}
                disabled={!chat.input.trim()}
                className="h-9 w-9 rounded-full bg-[#d4af37] p-0 text-black hover:bg-[#e6c25a] disabled:bg-white/10 disabled:text-white/30"
                aria-label="Send message"
                title="Send message"
              >
                <ArrowUp className="h-4.5 w-4.5" />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-white/25">
          RIISHE can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  )
}
