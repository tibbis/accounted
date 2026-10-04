import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/entitlements/has-capability', () => ({
  getCompanyIdsWithCapability: vi.fn(),
}))

vi.mock('../aggregate', () => ({
  getWorklistCounts: vi.fn(),
}))

import { getCompanyIdsWithCapability } from '@/lib/entitlements/has-capability'
import { getWorklistCounts } from '../aggregate'
import { getMergedWorklistBadgeTotal } from '../merged-badge'
import type { WorklistCounts } from '../types'

function counts(partial: {
  total: number
  inbox_document?: number
}): WorklistCounts {
  return {
    total: partial.total,
    counts: {
      inbox_document: partial.inbox_document ?? 0,
    } as WorklistCounts['counts'],
  }
}

describe('getMergedWorklistBadgeTotal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sums visible totals across memberships and gates inbox on AI', async () => {
    vi.mocked(getCompanyIdsWithCapability).mockResolvedValue(new Set(['a']))
    vi.mocked(getWorklistCounts)
      .mockResolvedValueOnce(counts({ total: 5, inbox_document: 2 }))
      .mockResolvedValueOnce(counts({ total: 4, inbox_document: 3 }))

    const result = await getMergedWorklistBadgeTotal({} as never, ['a', 'b'])

    // Company a has AI: 5 visible. Company b no AI: 4 - 3 inbox = 1.
    expect(result.total).toBe(6)
    expect(result.byCompany).toHaveLength(2)
  })

  it('returns zero for an empty membership list', async () => {
    const result = await getMergedWorklistBadgeTotal({} as never, [])
    expect(result).toEqual({ total: 0, byCompany: [] })
    expect(getWorklistCounts).not.toHaveBeenCalled()
  })
})
