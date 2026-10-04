import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentIntent } from '@/lib/agent/intents/types'
import type { AgentTool } from '@/lib/agent/tools/types'

const streamAgentRound = vi.fn()
const modelFor = vi.fn(() => 'gemini-3.8-flash')

vi.mock('@/lib/ai', () => ({
  getAiService: () => ({ streamAgentRound, modelFor }),
}))

vi.mock('@/lib/agent/tools/registry', () => ({
  agentToolRegistry: {
    get: (name: string) => (name === 'gnubok_ping' ? pingTool : undefined),
  },
}))

import { runOpenAICompatibleChatLoop } from '../run-turn-openai'

const pingTool: AgentTool = {
  name: 'gnubok_ping',
  description: 'ping',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  execute: vi.fn(async () => ({ ok: true })),
}

const intent = {
  id: 'general.help',
  buttonLabel: 'Hjälp',
  sheetTitle: 'Hjälp',
  atoms: {
    mode: 'declarative' as const,
    horizontal: [],
    includeCompanyVertical: false,
    includeCompanyModifiers: false,
  },
  tools: ['gnubok_ping'],
  model: 'gemini-3.8-flash',
  capture: async () => ({}),
  promptTemplate: () => 'Hej',
} satisfies AgentIntent

beforeEach(() => {
  vi.clearAllMocks()
  modelFor.mockReturnValue('gemini-3.8-flash')
})

describe('runOpenAICompatibleChatLoop', () => {
  it('streams text and completes without tools', async () => {
    streamAgentRound.mockImplementation(async (req: { onTextDelta: (d: string) => void }) => {
      req.onTextDelta('Hej')
      req.onTextDelta(' där')
      return {
        text: 'Hej där',
        toolUses: [],
        stopReason: 'end',
        model: 'gemini-3.8-flash',
      }
    })

    const events: Array<{ kind: string }> = []
    const persistMessage = vi.fn()
    const supabase = {
      from: () => ({
        update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }),
    }

    await runOpenAICompatibleChatLoop({
      supabase: supabase as never,
      userId: 'u1',
      companyId: 'c1',
      intent,
      conversationId: 'conv-1',
      persist: true,
      systemBlocks: [{ type: 'text', text: 'System' }],
      promptHash: 'sha256:x',
      atomsLoaded: [],
      tools: [],
      messages: [{ role: 'user', content: 'Hej' }],
      memoryIds: [],
      emit: (e) => {
        events.push(e)
        return true
      },
      bumpMemoryAccess: vi.fn(),
      persistMessage,
      stampAgentMetadata: vi.fn(),
    })

    expect(events.map((e) => e.kind)).toEqual([
      'text_delta',
      'text_delta',
      'turn_complete',
    ])
    expect(persistMessage).toHaveBeenCalledWith(
      'assistant',
      [{ type: 'text', text: 'Hej där' }],
    )
  })

  it('dispatches a tool then answers on the next round', async () => {
    streamAgentRound
      .mockImplementationOnce(async (req: { onToolUseStart?: (t: { id: string; name: string }) => void }) => {
        req.onToolUseStart?.({ id: 'call-1', name: 'gnubok_ping' })
        return {
          text: '',
          toolUses: [{ id: 'call-1', name: 'gnubok_ping', input: {} }],
          stopReason: 'tool_use',
          model: 'gemini-3.8-flash',
        }
      })
      .mockImplementationOnce(async (req: { onTextDelta: (d: string) => void }) => {
        req.onTextDelta('Klart')
        return {
          text: 'Klart',
          toolUses: [],
          stopReason: 'end',
          model: 'gemini-3.8-flash',
        }
      })

    const events: Array<{ kind: string; name?: string }> = []
    const persistMessage = vi.fn()

    await runOpenAICompatibleChatLoop({
      supabase: {
        from: () => ({
          update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }),
      } as never,
      userId: 'u1',
      companyId: 'c1',
      intent,
      conversationId: 'conv-1',
      persist: true,
      systemBlocks: [{ type: 'text', text: 'System' }],
      promptHash: 'sha256:x',
      atomsLoaded: [],
      tools: [pingTool],
      messages: [{ role: 'user', content: 'Pinga' }],
      memoryIds: [],
      emit: (e) => {
        events.push(e as { kind: string; name?: string })
        return true
      },
      bumpMemoryAccess: vi.fn(),
      persistMessage,
      stampAgentMetadata: vi.fn(),
    })

    expect(pingTool.execute).toHaveBeenCalled()
    expect(events.map((e) => e.kind)).toContain('tool_use')
    expect(events.map((e) => e.kind)).toContain('tool_result')
    expect(events.at(-1)?.kind).toBe('turn_complete')
    expect(streamAgentRound).toHaveBeenCalledTimes(2)
  })
})
