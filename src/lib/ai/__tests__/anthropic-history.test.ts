import { describe, it, expect } from 'vitest'
import {
  anthropicHistoryToModelMessages,
  flattenSystemBlocks,
} from '../anthropic-history'

describe('anthropicHistoryToModelMessages', () => {
  it('maps plain user/assistant text turns', () => {
    expect(
      anthropicHistoryToModelMessages([
        { role: 'user', content: 'Hej' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hallå' }] },
      ]),
    ).toEqual([
      { role: 'user', content: 'Hej' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hallå' }] },
    ])
  })

  it('maps tool_use + tool_result batches onto assistant/tool messages', () => {
    const out = anthropicHistoryToModelMessages([
      { role: 'user', content: 'Visa resultat' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Kollar…' },
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'gnubok_get_income_statement',
            input: { year: 2025 },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: '{"net":-100}',
          },
        ],
      },
    ])

    expect(out).toEqual([
      { role: 'user', content: 'Visa resultat' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Kollar…' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'gnubok_get_income_statement',
            input: { year: 2025 },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'gnubok_get_income_statement',
            output: { type: 'text', value: '{"net":-100}' },
          },
        ],
      },
    ])
  })
})

describe('flattenSystemBlocks', () => {
  it('joins Anthropic text blocks with blank lines', () => {
    expect(
      flattenSystemBlocks([
        { type: 'text', text: 'Block 1' },
        { type: 'text', text: 'Block 2' },
      ]),
    ).toBe('Block 1\n\nBlock 2')
  })
})
