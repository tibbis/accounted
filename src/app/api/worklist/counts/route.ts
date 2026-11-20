import { NextResponse } from 'next/server'
import { withRouteContext } from '@/lib/api/with-route-context'
import {
  getMergedWorklistBadgeTotal,
  getWorklistCounts,
  listMemberCompanyIds,
} from '@/lib/worklist'

/**
 * GET /api/worklist/counts: pending-work counts.
 *
 * Default: active company (sidebar / Att göra section).
 * `?scope=all`: sum across every membership (PWA home-screen badge).
 *
 * Response: { data: { counts, total, overdueInvoices } }. The per-person rows
 * (documents_to_sign) are counted for the caller.
 */
export const GET = withRouteContext('worklist.counts', async (request, ctx) => {
  const { supabase, companyId, user } = ctx
  const scope = new URL(request.url).searchParams.get('scope')

  if (scope === 'all') {
    const companyIds = await listMemberCompanyIds(supabase, user.id)
    const data = await getMergedWorklistBadgeTotal(supabase, companyIds)
    return NextResponse.json({ data })
  }

  const data = await getWorklistCounts(supabase, companyId, { userId: user.id })
  return NextResponse.json({ data })
})
