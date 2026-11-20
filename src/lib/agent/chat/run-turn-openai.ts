import type { SupabaseClient } from '@supabase/supabase-js'
import { getAiService, type AiTier } from '@/lib/ai'
import {
  anthropicHistoryToModelMessages,
  flattenSystemBlocks,
} from '@/lib/ai/anthropic-history'
import type { AgentIntent } from '@/lib/agent/intents/types'
import { agentToolRegistry } from '@/lib/agent/tools/registry'
import type { AgentActorContext, AgentTool } from '@/lib/agent/tools/types'
import { createLogger } from '@/lib/logger'
import {
  agentTurnMetadata,
  recordToolFailure,
  recordToolOutcome,
  friendlyModelError,
  isTransientStreamError,
  type StreamEvent,
} from './shared'

const log = createLogger('agent.chat.run-turn-openai')

const MAX_TOOL_ITERATIONS = 12
const STREAM_RETRY_BACKOFF_MS = 750
const MAX_TOKENS_DEFAULT = 5400
const MAX_TOKENS_HEAVY = 12_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContentBlock = any

export interface OpenAICompatibleTurnArgs {
  supabase: SupabaseClient
  userId: string
  companyId: string
  intent: AgentIntent
  conversationId: string
  persist: boolean
  systemBlocks: Array<{ type?: string; text?: string }>
  promptHash: string
  atomsLoaded: string[]
  tools: AgentTool[]
  /** Anthropic-shaped history + new user message (already assembled). */
  messages: { role: 'user' | 'assistant'; content: ContentBlock }[]
  memoryIds: string[]
  emit: (event: StreamEvent) => boolean
  bumpMemoryAccess: (ids: string[]) => Promise<void>
  persistMessage: (
    role: 'user' | 'assistant' | 'tool',
    content: unknown,
    hidden?: boolean,
  ) => Promise<void>
  stampAgentMetadata: (
    operationId: string,
    meta: {
      conversation_id: string
      intent_id: string
      model: string
      prompt_hash: string
      atoms_loaded: string[]
    },
  ) => Promise<void>
}

function chatTier(intent: AgentIntent): AiTier {
  // Deep-thinking intents map to the heavy BYO model; everyone else uses assistant.
  return intent.thinking ? 'heavy' : 'assistant'
}

function maxTokensFor(intent: AgentIntent): number {
  if (!intent.thinking) return MAX_TOKENS_DEFAULT
  return intent.thinking.effort === 'xhigh' || intent.thinking.effort === 'max'
    ? MAX_TOKENS_HEAVY
    : MAX_TOKENS_DEFAULT
}

/**
 * Streaming chat loop for openai-compatible backends (Gemini / BYO).
 * Same StreamEvents, Anthropic-shaped persistence, and manual tool dispatch
 * as the Anthropic path; one model round at a time via streamAgentRound.
 */
export async function runOpenAICompatibleChatLoop(args: OpenAICompatibleTurnArgs): Promise<void> {
  const {
    supabase,
    userId,
    companyId,
    intent,
    conversationId,
    persist,
    tools,
    messages,
    emit,
  } = args

  const actor: AgentActorContext = {
    type: 'agent_chat',
    id: conversationId,
    label: 'In-app chat',
  }

  const service = getAiService()
  const tier = chatTier(intent)
  const maxTokens = maxTokensFor(intent)
  const system = flattenSystemBlocks(args.systemBlocks)
  const toolSchemas = tools.map((t) => ({
    name: t.name,
    description: t.description,
    jsonSchema: t.inputSchema as Record<string, unknown>,
  }))

  let assistantText = ''
  let iterations = 0
  let lastStopReason: string | null = null
  let streamRetryUsed = false
  let model = service.modelFor(tier)

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++

    let round
    let eagerToolIds = new Set<string>()
    for (;;) {
      const assistantTextBefore = assistantText
      eagerToolIds = new Set<string>()
      try {
        round = await service.streamAgentRound({
          tier,
          system,
          messages: anthropicHistoryToModelMessages(messages),
          tools: toolSchemas,
          maxTokens,
          onTextDelta: (delta) => {
            assistantText += delta
            emit({ kind: 'text_delta', delta })
          },
          onReasoningDelta: (delta) => {
            emit({ kind: 'reasoning_delta', delta })
          },
          onToolUseStart: ({ id, name }) => {
            eagerToolIds.add(id)
            emit({ kind: 'tool_use', tool_use_id: id, name, input: {} })
          },
        })
        model = round.model
        break
      } catch (err) {
        if (!streamRetryUsed && isTransientStreamError(err)) {
          streamRetryUsed = true
          log.warn('openai-compatible stream failed transiently, retrying once', {
            conversationId,
            companyId,
            model,
            iterations,
            errMessage: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
          })
          assistantText = assistantTextBefore
          emit({ kind: 'stream_restart', assistant_text: assistantText })
          await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_BACKOFF_MS))
          continue
        }
        log.error('openai-compatible stream failed', err, {
          conversationId,
          companyId,
          model,
          iterations,
          retried: streamRetryUsed,
        })
        emit({ kind: 'error', message: friendlyModelError(err) })
        throw err
      }
    }

    lastStopReason = round.stopReason
    const assistantContent: ContentBlock[] = []
    if (round.text.trim().length > 0) {
      assistantContent.push({ type: 'text', text: round.text })
    }
    for (const tu of round.toolUses) {
      assistantContent.push({
        type: 'tool_use',
        id: tu.id,
        name: tu.name,
        input: tu.input,
      })
    }

    if (persist && assistantContent.length > 0) {
      await args.persistMessage('assistant', assistantContent)
    }
    if (assistantContent.length > 0) {
      messages.push({ role: 'assistant', content: assistantContent })
    }

    if (round.toolUses.length === 0 || round.stopReason !== 'tool_use') {
      break
    }

    const toolResultBlocks: ContentBlock[] = []
    for (const tu of round.toolUses) {
      if (!eagerToolIds.has(tu.id)) {
        emit({
          kind: 'tool_use',
          tool_use_id: tu.id,
          name: tu.name,
          input: tu.input,
        })
      }

      const tool = await agentToolRegistry.get(tu.name)
      if (!tool) {
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          is_error: true,
          content: `Verktyget ${tu.name} är inte registrerat.`,
        })
        continue
      }

      try {
        const result = await tool.execute(
          tu.input,
          companyId,
          userId,
          supabase,
          actor,
        )

        toolResultBlocks.push(await recordToolOutcome(
          emit, tu.id, tu.name, tu.input, result,
          (operationId) => args.stampAgentMetadata(operationId, agentTurnMetadata({
            conversationId, intentId: intent.id, model,
            promptHash: args.promptHash, atomsLoaded: args.atomsLoaded,
          })),
        ))
      } catch (err) {
        toolResultBlocks.push(recordToolFailure(emit, tu.id, err))
      }
    }

    messages.push({ role: 'user', content: toolResultBlocks })
    if (persist) {
      await args.persistMessage('tool', toolResultBlocks)
    }
  }

  if (iterations >= MAX_TOOL_ITERATIONS) {
    emit({
      kind: 'error',
      message: `Avbröt efter ${MAX_TOOL_ITERATIONS} verktygsanrop: sannolikt en loop. Försök igen.`,
    })
  }

  if (persist) {
    const preview = assistantText.replace(/\s+/g, ' ').trim().slice(0, 200)
    await supabase
      .from('agent_conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: preview.length > 0 ? preview : null,
      })
      .eq('id', conversationId)

    try {
      await args.bumpMemoryAccess(args.memoryIds)
    } catch {
      // best-effort
    }
  }

  if (lastStopReason === 'max_tokens' && assistantText.trim().length === 0) {
    log.error('model hit max_tokens with no visible text', {
      conversationId,
      companyId,
      model,
      iterations,
      maxTokens,
    })
    emit({
      kind: 'error',
      message: 'Assistenten fick slut på utrymme innan svaret blev klart. Försök igen.',
    })
    return
  }

  emit({ kind: 'turn_complete', assistant_text: assistantText })
}
