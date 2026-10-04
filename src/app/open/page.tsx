import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth/require-auth'
import { setActiveCompany, CompanyContextError } from '@/lib/company/context'
import { parseOpenSearchParams } from '@/lib/pwa/deep-link'

/**
 * Push / deep-link entry: switch active company (when given), then hard-navigate
 * to the target path. Lives outside (dashboard) so a wrong-company session can
 * still resolve before the dashboard layout loads tenant data.
 */
export default async function OpenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { companyId, next } = parseOpenSearchParams(params)

  const { user, supabase, error } = await requireAuth()
  if (error || !user) {
    redirect(`/login?next=${encodeURIComponent(`/open?${new URLSearchParams({
      ...(companyId ? { company: companyId } : {}),
      next,
    }).toString()}`)}`)
  }

  if (companyId) {
    try {
      await setActiveCompany(supabase, user.id, companyId)
    } catch (err) {
      if (err instanceof CompanyContextError) {
        redirect('/')
      }
      redirect('/')
    }
  }

  redirect(next)
}
