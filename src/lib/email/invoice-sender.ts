import type { SupabaseClient } from '@supabase/supabase-js'
import { CAPABILITY } from '@/lib/entitlements/keys'
import { hasCapability } from '@/lib/entitlements/has-capability'
import type { CompanySendingDomain } from '@/types'
import { isReservedSenderDomain, isValidHostname } from '@/lib/email/domain-name'
import { EMAIL_PATTERN } from '@/lib/invoices/email-recipients'
import { checkSenderDomain } from '@/lib/email/sender-domain-check'

/**
 * Sender identity for invoice email: the From header's display name and
 * address. Only used when a company has opted in to its own sending domain;
 * otherwise invoice mail keeps the platform sender.
 */
export interface InvoiceSenderIdentity {
  name: string
  address: string
}

type SenderRow = Pick<
  CompanySendingDomain,
  'domain' | 'status' | 'enabled' | 'sender_local_part' | 'sender_name'
>

/** `<local>@<domain>`; pure, so the address shape is unit-testable. */
export function buildSenderAddress(localPart: string, domain: string): string {
  return `${localPart}@${domain}`
}

/** Hostname of a mailbox, or null when the address has no usable domain. */
export function senderDomainOf(address: string): string | null {
  const trimmed = address.trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at < 1) return null
  const domain = trimmed.slice(at + 1)
  return isValidHostname(domain) ? domain : null
}

export interface InvoiceFromSettings {
  invoice_email_from_address?: string | null
  invoice_email_from_name?: string | null
  company_name?: string | null
}

/**
 * The company's explicit From, or undefined when the column is empty or not
 * a mailbox. The display name is the stored name, then the company name,
 * then the address itself so a configured address is never dropped for lack
 * of a name (dropping it would send as the instance default).
 */
export function invoiceSenderFromSettings(
  settings: InvoiceFromSettings | null | undefined,
  companyName?: string | null,
): InvoiceSenderIdentity | undefined {
  const address = settings?.invoice_email_from_address?.trim().toLowerCase() ?? ''
  if (!address || !EMAIL_PATTERN.test(address) || !senderDomainOf(address)) return undefined
  const explicit = settings?.invoice_email_from_name?.replace(/[\r\n<>]/g, '').trim() ?? ''
  const fallback = (companyName ?? settings?.company_name ?? '').replace(/[\r\n<>]/g, '').trim()
  const name = explicit || fallback || address
  return { name, address }
}

/**
 * An explicit company From whose domain is not verified (or could not be
 * checked). Callers must fail the send. Falling through to the instance
 * default would deliver as whatever RESEND_FROM_EMAIL is, which on a
 * multi-company host is another company's identity.
 */
export class InvoiceSenderDomainError extends Error {
  readonly code = 'INVOICE_SENDER_DOMAIN_UNVERIFIED' as const
  readonly domain: string
  readonly address: string
  readonly reason: 'unverified' | 'unknown'

  constructor(address: string, domain: string, reason: 'unverified' | 'unknown') {
    super(
      reason === 'unknown'
        ? `Could not confirm that ${domain} is verified for sending.`
        : `The sending domain ${domain} is not verified.`,
    )
    this.name = 'InvoiceSenderDomainError'
    this.domain = domain
    this.address = address
    this.reason = reason
  }
}

export function invoiceSenderDomainMessages(error: InvoiceSenderDomainError): {
  messageSv: string
  messageEn: string
} {
  if (error.reason === 'unknown') {
    return {
      messageSv: `Avsändardomänen ${error.domain} kunde inte kontrolleras hos e-postleverantören. Ingen e-post skickades.`,
      messageEn: `The sending domain ${error.domain} could not be checked with the email provider. No email was sent.`,
    }
  }
  return {
    messageSv: `Avsändardomänen ${error.domain} är inte verifierad för utskick. Ingen e-post skickades, och inte från någon annan avsändare.`,
    messageEn: `The sending domain ${error.domain} is not verified for sending. No email was sent, and not from another sender.`,
  }
}

/**
 * Pure mapping from a sending-domain row to the From identity, or undefined
 * when the row must not change the sender (unverified, paused, or missing).
 * Falls back to the company name when no explicit sender name is stored.
 */
export function senderFromRow(
  row: SenderRow | null | undefined,
  companyName: string | null | undefined,
): InvoiceSenderIdentity | undefined {
  if (!row || row.status !== 'verified' || !row.enabled) return undefined
  // Last line of defense at send time: never send as a platform domain, and
  // never trust a row whose domain is not a plain hostname, whatever the DB
  // says (the claim/verify paths and the tenant guard trigger enforce this
  // earlier; a tampered row must still not reach the From header).
  const domain = row.domain.toLowerCase()
  if (!isValidHostname(domain) || isReservedSenderDomain(domain)) return undefined
  const name = (row.sender_name ?? companyName ?? '').trim()
  if (!name) return undefined
  return { name, address: buildSenderAddress(row.sender_local_part, row.domain) }
}

/**
 * Resolve the From identity for a company's invoice email.
 *
 * Returns undefined in every case where the platform sender should be used:
 * no sending-domain row, not verified, paused, no capability grant (the
 * opt-in can lapse), or any read error. Never throws: a sender lookup
 * failure must never stop an invoice from going out.
 *
 * Order matters for cost: most companies have no row, so the table read
 * happens first and the two entitlement queries only run for opted-in
 * companies.
 */
async function assertConfiguredDomain(sender: InvoiceSenderIdentity): Promise<InvoiceSenderIdentity> {
  const domain = senderDomainOf(sender.address)
  if (!domain) {
    throw new InvoiceSenderDomainError(sender.address, sender.address, 'unverified')
  }
  const verdict = await checkSenderDomain(domain)
  if (verdict !== 'verified') {
    throw new InvoiceSenderDomainError(sender.address, domain, verdict === 'unknown' ? 'unknown' : 'unverified')
  }
  return sender
}

export async function resolveInvoiceSender(
  supabase: SupabaseClient,
  companyId: string,
  companyName: string | null | undefined,
): Promise<InvoiceSenderIdentity | undefined> {
  try {
    // The company's own From wins over a claimed sending domain and over the
    // instance default. A read error falls through: the column may not exist
    // yet on a database that has not applied the migration, and that case
    // must keep today's default sender. A present address that is not
    // verified throws, so it cannot be replaced by another company's address.
    const { data: settings, error: settingsError } = await supabase
      .from('company_settings')
      .select('invoice_email_from_address, invoice_email_from_name')
      .eq('company_id', companyId)
      .maybeSingle()
    if (!settingsError) {
      const configured = invoiceSenderFromSettings(
        settings as InvoiceFromSettings | null,
        companyName,
      )
      if (configured) return await assertConfiguredDomain(configured)
    }

    const { data, error } = await supabase
      .from('company_sending_domains')
      .select('domain, status, enabled, sender_local_part, sender_name')
      .eq('company_id', companyId)
      .eq('status', 'verified')
      .eq('enabled', true)
      .maybeSingle()
    if (error || !data) return undefined

    const sender = senderFromRow(data as SenderRow, companyName)
    if (!sender) return undefined

    const entitled = await hasCapability(supabase, companyId, CAPABILITY.custom_sender_domain)
    return entitled ? sender : undefined
  } catch (err) {
    if (err instanceof InvoiceSenderDomainError) throw err
    return undefined
  }
}

/**
 * resolveInvoiceSender, as a result. InvoiceSenderDomainError is the only
 * failure: every other lookup problem still means "use the instance default".
 */
export async function takeInvoiceSender(
  supabase: SupabaseClient,
  companyId: string,
  companyName: string | null | undefined,
): Promise<
  | { ok: true; from: InvoiceSenderIdentity | undefined }
  | { ok: false; error: InvoiceSenderDomainError }
> {
  try {
    return { ok: true, from: await resolveInvoiceSender(supabase, companyId, companyName) }
  } catch (err) {
    if (err instanceof InvoiceSenderDomainError) return { ok: false, error: err }
    throw err
  }
}
