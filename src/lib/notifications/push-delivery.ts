/**
 * Read-side check: did web-push already accept this notice for this user?
 *
 * notification_log is the only durable record. PWA rows are written only
 * after web-push returns 2xx (extensions/general/push-notifications/
 * notification-sender). Email paths (digest, kvittens) use the same table
 * under different notification_type values, so a digest claim is never a
 * push hit.
 *
 * Fail closed on a read error: an unreadable log cannot prove the push did
 * NOT land, and failing open would re-mail someone who already got the PWA.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationType } from '@/types'

const PWA_TYPES: readonly NotificationType[] = [
  'tax_deadline',
  'invoice_due',
  'invoice_overdue',
  'period_locked',
  'period_year_closed',
  'receipt_extracted',
  'receipt_matched',
  'invoice_sent',
  'missing_underlag',
]

/** Inbox arrivals the digest also reports. Bank txs have no PWA twin. */
export const DIGEST_INBOX_PWA_TYPES: readonly NotificationType[] = [
  'receipt_extracted',
  'receipt_matched',
]

export async function wasPushSuccessfullySent(
  supabase: SupabaseClient,
  input: {
    userId: string
    types: readonly NotificationType[]
    sinceIso: string
    /** Match company_id, or reference_id (missing_underlag stores the company there). */
    companyId?: string
    referenceId?: string
  }
): Promise<boolean> {
  const types = input.types.filter((t) => PWA_TYPES.includes(t))
  if (types.length === 0) return false

  const base = () =>
    supabase
      .from('notification_log')
      .select('id')
      .eq('user_id', input.userId)
      .in('notification_type', [...types])
      .eq('delivery_status', 'sent')
      .gte('sent_at', input.sinceIso)
      .limit(1)

  if (input.referenceId) {
    const { data, error } = await base().eq('reference_id', input.referenceId).maybeSingle()
    if (error) return true
    if (data) return true
  }

  if (input.companyId) {
    const byCompany = await base().eq('company_id', input.companyId).maybeSingle()
    if (byCompany.error) return true
    if (byCompany.data) return true
    const byRef = await base().eq('reference_id', input.companyId).maybeSingle()
    if (byRef.error) return true
    if (byRef.data) return true
  }

  if (!input.referenceId && !input.companyId) {
    const { data, error } = await base().maybeSingle()
    if (error) return true
    return !!data
  }

  return false
}
