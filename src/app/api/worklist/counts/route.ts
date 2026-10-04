import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { withRouteContext } from '@/lib/api/with-route-context'
import {
  getMergedWorklistBadgeTotal,
  getWorklistCounts,
  listMemberCompanyIds,
} from '@/lib/worklist'

ensureInitialized()

/**
 * GET /api/worklist/counts: pending-work counts.
 *
 * Default: active company (sidebar / Att göra section).
 * `?scope=all`: sum across every membership (PWA home-screen badge).
 */
export const GET = withRouteContext('worklist.counts', async (request, ctx) => {
  const { supabase, companyId, user } = ctx
  const scope = new URL(request.url).searchParams.get('scope')

  if (scope === 'all') {
    const companyIds = await listMemberCompanyIds(supabase, user.id)
    const data = await getMergedWorklistBadgeTotal(supabase, companyIds)
    return NextResponse.json({ data })
  }

  const data = await getWorklistCounts(supabase, companyId)
  return NextResponse.json({ data })
})
