import type { SupabaseClient } from '@supabase/supabase-js'
import { CAPABILITY } from '@/lib/entitlements/keys'
import { getCompanyIdsWithCapability } from '@/lib/entitlements/has-capability'
import { getWorklistCounts } from './aggregate'
import type { WorklistCounts } from './types'
import { visibleWorklistTotal } from './visible-total'

export interface MergedWorklistBadge {
  /** Sum of visible Att göra across every membership (what the PWA icon shows). */
  total: number
  /** Per-company breakdown (debug / future UI). */
  byCompany: Array<{ companyId: string; total: number; counts: WorklistCounts }>
}

/**
 * Att göra total across every company the caller belongs to.
 * Inbox documents only count for companies that have CAPABILITY.ai.
 */
export async function getMergedWorklistBadgeTotal(
  supabase: SupabaseClient,
  companyIds: string[],
): Promise<MergedWorklistBadge> {
  const ids = [...new Set(companyIds.filter(Boolean))]
  if (ids.length === 0) return { total: 0, byCompany: [] }

  const [withAi, perCompany] = await Promise.all([
    getCompanyIdsWithCapability(supabase, ids, CAPABILITY.ai),
    Promise.all(
      ids.map(async (companyId) => {
        const counts = await getWorklistCounts(supabase, companyId)
        return { companyId, counts }
      }),
    ),
  ])

  const byCompany = perCompany.map(({ companyId, counts }) => ({
    companyId,
    counts,
    total: visibleWorklistTotal({
      total: counts.total,
      inboxDocumentCount: counts.counts.inbox_document,
      hasAi: withAi.has(companyId),
    }),
  }))

  return {
    total: byCompany.reduce((sum, row) => sum + row.total, 0),
    byCompany,
  }
}

/** Active, non-archived memberships for a user. */
export async function listMemberCompanyIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('company_members')
    .select('company_id, companies!inner(archived_at)')
    .eq('user_id', userId)
    .is('companies.archived_at', null)

  if (error || !data) return []
  return data.map((row) => row.company_id as string)
}
