/**
 * Convert Anthropic Messages-shaped chat history (what agent_messages stores
 * and run-turn replays) into AI SDK ModelMessage[] for the OpenAI-compatible
 * streaming path. Keeps storage Anthropic-shaped so Bedrock resume and
 * repairDanglingToolUse stay valid.
 */

export type AnthropicChatMessage = {
  role: 'user' | 'assistant'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
}

export type ModelChatMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: Array<
        | { type: 'text'; text: string }
        | {
            type: 'tool-call'
            toolCallId: string
            toolName: string
            input: Record<string, unknown>
          }
      >
    }
  | {
      role: 'tool'
      content: Array<{
        type: 'tool-result'
        toolCallId: string
        toolName: string
        output: { type: 'text'; value: string }
      }>
    }

function textFromBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content == null ? '' : String(content)
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

function isToolResultBatch(content: unknown): boolean {
  return Array.isArray(content) && content.some((b) => b?.type === 'tool_result')
}

/**
 * Map stored Anthropic history onto OpenAI-compat / AI SDK messages.
 * Tracks tool names so tool_result rows (which only carry tool_use_id) can
 * set toolName on the wire.
 */
export function anthropicHistoryToModelMessages(
  messages: AnthropicChatMessage[],
): ModelChatMessage[] {
  const toolNameById = new Map<string, string>()
  const out: ModelChatMessage[] = []

  for (const m of messages) {
    if (m.role === 'user' && isToolResultBatch(m.content)) {
      const parts: Extract<ModelChatMessage, { role: 'tool' }>['content'] = []
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block?.type !== 'tool_result') continue
        const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
        if (!id) continue
        const raw =
          typeof block.content === 'string'
            ? block.content
            : block.content == null
              ? ''
              : JSON.stringify(block.content)
        parts.push({
          type: 'tool-result',
          toolCallId: id,
          toolName: toolNameById.get(id) ?? 'unknown',
          output: { type: 'text', value: raw },
        })
      }
      if (parts.length > 0) out.push({ role: 'tool', content: parts })
      continue
    }

    if (m.role === 'user') {
      out.push({ role: 'user', content: textFromBlocks(m.content) })
      continue
    }

    // assistant
    const parts: Extract<ModelChatMessage, { role: 'assistant' }>['content'] = []
    if (typeof m.content === 'string') {
      if (m.content.length > 0) parts.push({ type: 'text', text: m.content })
    } else if (Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
          parts.push({ type: 'text', text: block.text })
        } else if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          toolNameById.set(block.id, block.name)
          parts.push({
            type: 'tool-call',
            toolCallId: block.id,
            toolName: block.name,
            input: (block.input as Record<string, unknown>) ?? {},
          })
        }
      }
    }
    if (parts.length > 0) out.push({ role: 'assistant', content: parts })
  }

  return out
}

/** Flatten Anthropic system prompt blocks into one string for BYO endpoints. */
export function flattenSystemBlocks(
  blocks: Array<{ type?: string; text?: string }>,
): string {
  return blocks
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .filter((t) => t.length > 0)
    .join('\n\n')
}
