import { Resend } from 'resend'
import { normalizeDomainName } from '@/lib/email/domain-name'
import type { SenderDomainVerdict } from '@/lib/email/sender-domain-check'

/**
 * Live Resend view of which domains this instance may send as.
 *
 * The platform From domain (RESEND_FROM_EMAIL) is accepted without a lookup:
 * Resend already delivers as that address. Every other domain must be
 * `verified` (or `temporary_failure`, which Resend still sends on while it
 * rechecks DNS) in THIS Resend account. A domain verified in some other
 * account, or only published in DNS, is not enough.
 */

const CACHE_MS = 60_000
const PAGE_LIMIT = 100
const MAX_PAGES = 20

type ListedDomain = {
  id?: string
  name?: string
  status?: string
  capabilities?: { sending?: string } | null
}

let cache: { at: number; statuses: Map<string, string> } | null = null

/** Tests only: forget the domain list so the next check calls Resend again. */
export function resetVerifiedSendingDomainsForTests(): void {
  cache = null
}

function platformSenderDomain(): string | null {
  const from = process.env.RESEND_FROM_EMAIL
  if (!from) return null
  return normalizeDomainName(from)
}

function acceptsStatus(status: string | undefined, sending: string | undefined): boolean {
  if (sending === 'disabled') return false
  return status === 'verified' || status === 'temporary_failure'
}

async function loadStatuses(): Promise<Map<string, string> | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.statuses
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null

  const resend = new Resend(apiKey)
  const statuses = new Map<string, string>()
  let after: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await resend.domains.list({
      limit: PAGE_LIMIT,
      ...(after ? { after } : {}),
    })
    if (response.error || !response.data) return null

    const rows = response.data.data as ListedDomain[]
    for (const row of rows) {
      const name = row.name ? normalizeDomainName(row.name) : null
      if (!name) continue
      if (acceptsStatus(row.status, row.capabilities?.sending)) statuses.set(name, 'verified')
    }

    if (!response.data.has_more) break
    const lastId = rows[rows.length - 1]?.id
    if (!lastId || lastId === after) break
    after = lastId
  }

  cache = { at: Date.now(), statuses }
  return statuses
}

/**
 * `verified` when Resend will accept mail from `domain`, `unverified` when
 * the account's domain list does not, `unknown` when the list could not be
 * read. Callers must not send on `unknown`: a failed lookup is not evidence
 * the domain is ours.
 */
export async function resendSenderDomainVerdict(domain: string): Promise<SenderDomainVerdict> {
  const normalized = normalizeDomainName(domain)
  if (!normalized) return 'unverified'
  if (normalized === platformSenderDomain()) return 'verified'

  try {
    const statuses = await loadStatuses()
    if (!statuses) return 'unknown'
    return statuses.get(normalized) === 'verified' ? 'verified' : 'unverified'
  } catch {
    return 'unknown'
  }
}
