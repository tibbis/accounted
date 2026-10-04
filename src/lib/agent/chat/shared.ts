/**
 * Shared chat-loop helpers used by both the Anthropic Messages path and the
 * openai-compatible (Gemini / BYO) path.
 */

import type { StagedOperationResult } from '@/lib/agent/tools/types'

export type StreamEvent =
  | { kind: 'text_delta'; delta: string }
  | { kind: 'reasoning_delta'; delta: string }
  | { kind: 'tool_use'; tool_use_id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; tool_use_id: string; result: unknown }
  | {
      kind: 'staged_operation'
      tool_use_id: string
      tool_name: string
      params: Record<string, unknown>
      staged: StagedOperationResult
    }
  | {
      kind: 'memory_captured'
      tool_use_id: string
      action: 'remembered' | 'forgotten'
      memory_id: string
      memory_kind?: 'fact' | 'preference' | 'pattern' | 'correction'
      content?: string
    }
  | {
      kind: 'stream_restart'
      assistant_text: string
    }
  | { kind: 'turn_complete'; assistant_text: string }
  | { kind: 'error'; message: string }

export const MAX_TOOL_RESULT_CHARS = 40_000

export function boundToolResultText(raw: string): string {
  if (raw.length <= MAX_TOOL_RESULT_CHARS) return raw
  const head = raw.slice(0, MAX_TOOL_RESULT_CHARS)
  return `${head}\n\n[avkortat: resultatet var ${raw.length} tecken, visar de första ${MAX_TOOL_RESULT_CHARS}. Be om en smalare sökning (limit, datumintervall, specifikt dokument-id eller fält) för att se mer.]`
}

export function wrapToolResult(toolUseId: string, raw: string): string {
  const safe = raw.replaceAll('</tool_output>', '</tool_​output>') // ZWSP injected
  return `<tool_output id="${toolUseId}">\n${safe}\n</tool_output>`
}

export function friendlyModelError(err: unknown): string {
  const status = (err as { status?: number } | null)?.status
  const name = (err as { name?: string } | null)?.name ?? ''
  const raw = err instanceof Error ? err.message : ''
  const text = `${name} ${raw}`.toLowerCase()
  if (
    status === 429 ||
    text.includes('throttl') ||
    text.includes('too many') ||
    text.includes('rate limit') ||
    text.includes('rate exceeded')
  ) {
    return 'Anna är upptagen just nu. Vänta en liten stund och försök igen.'
  }
  if (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('etimedout') ||
    text.includes('econnreset') ||
    text.includes('network') ||
    text.includes('socket') ||
    text.includes('abort')
  ) {
    return 'Anslutningen till assistenten bröts. Försök igen.'
  }
  if (typeof status === 'number' && status >= 500) {
    return 'Assistenttjänsten har ett tillfälligt fel. Försök igen om en stund.'
  }
  return 'Något gick fel hos assistenten. Försök igen om en stund.'
}

export function isTransientStreamError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  if (status === 429) return true
  if (typeof status === 'number' && status >= 500) return true
  if (typeof status === 'number' && status >= 400) return false

  const name = (err as { name?: string } | null)?.name ?? ''
  const raw = err instanceof Error ? err.message : ''
  let cause = ''
  try {
    const c = (err as { cause?: unknown } | null)?.cause
    cause = c instanceof Error ? `${c.name} ${c.message}` : c != null ? String(c) : ''
  } catch {
    cause = ''
  }
  const text = `${name} ${raw} ${cause}`.toLowerCase()
  return (
    text.includes('unexpected event order') ||
    text.includes('request ended without sending any chunks') ||
    text.includes('throttl') ||
    text.includes('rate limit') ||
    text.includes('rate exceeded') ||
    text.includes('too many') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('etimedout') ||
    text.includes('econnreset') ||
    text.includes('network') ||
    text.includes('socket') ||
    text.includes('abort')
  )
}
