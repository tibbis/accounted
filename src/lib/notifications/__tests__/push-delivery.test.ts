import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { wasPushSuccessfullySent } from '../push-delivery'

function makeClient(opts: { rows?: unknown; error?: { message: string } | null }) {
  const calls: Array<Record<string, unknown>> = []
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      calls.push({ col, val })
      return builder
    },
    in: () => builder,
    gte: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: opts.rows ?? null, error: opts.error ?? null }),
  })
  return {
    calls,
    supabase: { from: () => builder } as unknown as SupabaseClient,
  }
}

describe('wasPushSuccessfullySent', () => {
  it('is true when a sent PWA row exists for the company', async () => {
    const { supabase } = makeClient({ rows: { id: 'n1' } })
    await expect(
      wasPushSuccessfullySent(supabase, {
        userId: 'u1',
        types: ['receipt_extracted'],
        sinceIso: '2026-09-14T00:00:00Z',
        companyId: 'c1',
      })
    ).resolves.toBe(true)
  })

  it('is false when nothing landed', async () => {
    const { supabase } = makeClient({ rows: null })
    await expect(
      wasPushSuccessfullySent(supabase, {
        userId: 'u1',
        types: ['receipt_extracted'],
        sinceIso: '2026-09-14T00:00:00Z',
        companyId: 'c1',
      })
    ).resolves.toBe(false)
  })

  it('fails closed when the log cannot be read', async () => {
    const { supabase } = makeClient({ error: { message: 'timeout' } })
    await expect(
      wasPushSuccessfullySent(supabase, {
        userId: 'u1',
        types: ['receipt_extracted'],
        sinceIso: '2026-09-14T00:00:00Z',
        companyId: 'c1',
      })
    ).resolves.toBe(true)
  })

  it('ignores email-only types so a digest claim cannot look like a PWA', async () => {
    const { supabase } = makeClient({ rows: { id: 'digest' } })
    await expect(
      wasPushSuccessfullySent(supabase, {
        userId: 'u1',
        types: ['bookkeeping_digest'],
        sinceIso: '2026-09-14T00:00:00Z',
        companyId: 'c1',
      })
    ).resolves.toBe(false)
  })
})
