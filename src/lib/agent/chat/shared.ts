/**
 * Shared chat-loop helpers used by both the Anthropic Messages path and the
 * openai-compatible (Gemini / BYO) path.
 */

import { isStagedOperation, type StagedOperationResult } from '@/lib/agent/tools/types'

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

export function agentTurnMetadata(input: {
  conversationId: string
  intentId: string
  model: string
  promptHash: string
  atomsLoaded: readonly string[]
}) {
  return {
    conversation_id: input.conversationId,
    intent_id: input.intentId,
    model: input.model,
    prompt_hash: input.promptHash,
    atoms_loaded: [...input.atomsLoaded],
  }
}

export async function emitStagedOperation(
  emit: (event: StreamEvent) => void,
  toolUseId: string,
  toolName: string,
  params: Record<string, unknown>,
  result: unknown,
  stamp: (operationId: string) => Promise<void>,
): Promise<void> {
  if (!isStagedOperation(result) || !result.operation_id) return
  await stamp(result.operation_id)
  emit({
    kind: 'staged_operation',
    tool_use_id: toolUseId,
    tool_name: toolName,
    params,
    staged: result,
  })
}

export async function recordToolOutcome(
  emit: (event: StreamEvent) => void,
  toolUseId: string,
  toolName: string,
  params: Record<string, unknown>,
  result: unknown,
  stamp: (operationId: string) => Promise<void>,
): Promise<{ type: 'tool_result'; tool_use_id: string; content: string }> {
  await emitStagedOperation(emit, toolUseId, toolName, params, result, stamp)
  emitCapturedMemory(emit, toolName, toolUseId, result)
  return { type: 'tool_result', tool_use_id: toolUseId, content: emitToolResult(emit, toolUseId, result) }
}

export function recordToolFailure(
  emit: (event: StreamEvent) => void,
  toolUseId: string,
  err: unknown,
): { type: 'tool_result'; tool_use_id: string; is_error: true; content: string } {
  const message = err instanceof Error ? err.message : 'Unknown tool error'
  emit({ kind: 'tool_result', tool_use_id: toolUseId, result: { error: message } })
  return { type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: message }
}

export function emitToolResult(
  emit: (event: StreamEvent) => void,
  toolUseId: string,
  result: unknown,
): string {
  emit({ kind: 'tool_result', tool_use_id: toolUseId, result })
  return wrapToolResult(toolUseId, boundToolResultText(JSON.stringify(result)))
}

export function emitCapturedMemory(
  emit: (event: StreamEvent) => void,
  toolName: string,
  toolUseId: string,
  result: unknown,
): void {
  if (toolName === 'gnubok_remember_fact') {
    const remembered = result as { id?: unknown; kind?: unknown; content?: unknown }
    if (typeof remembered?.id !== 'string') return
    emit({
      kind: 'memory_captured',
      tool_use_id: toolUseId,
      action: 'remembered',
      memory_id: remembered.id,
      memory_kind:
        typeof remembered.kind === 'string' &&
        ['fact', 'preference', 'pattern', 'correction'].includes(remembered.kind)
          ? (remembered.kind as 'fact' | 'preference' | 'pattern' | 'correction')
          : undefined,
      content: typeof remembered.content === 'string' ? remembered.content : undefined,
    })
    return
  }
  if (toolName !== 'gnubok_forget_fact') return
  const forgotten = result as { id?: unknown }
  if (typeof forgotten?.id !== 'string') return
  emit({
    kind: 'memory_captured',
    tool_use_id: toolUseId,
    action: 'forgotten',
    memory_id: forgotten.id,
  })
}

export function wrapToolResult(toolUseId: string, raw: string): string {
  const safe = raw.replaceAll('</tool_output>', '</tool_​output>') // ZWSP injected
  return `<tool_output id="${toolUseId}">\n${safe}\n</tool_output>`
}

export function isProviderOverload(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  if (status === 529 || status === 503) return true
  if (typeof status === 'number') return false
  const raw = err instanceof Error ? err.message : ''
  return raw.toLowerCase().includes('overloaded')
}

export function friendlyModelError(err: unknown): string {
  const status = (err as { status?: number } | null)?.status
  const name = (err as { name?: string } | null)?.name ?? ''
  const raw = err instanceof Error ? err.message : ''
  const text = `${name} ${raw}`.toLowerCase()
  if (isProviderOverload(err)) {
    return 'Assistenten är överbelastad just nu, försök igen om en minut.'
  }
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
    text.includes('overloaded') ||
    text.includes('api_error') ||
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
