import type { AuthMethod, AuthMethodCredential } from './api-client'

/**
 * Credentials we can fill in for the PSU before Enable Banking's hosted page
 * asks for them.
 *
 * Handelsbanken (business) asks for "Företags-ID" on that page: the
 * organisationsnummer as 10 digits, no hyphen, and the page shows no format
 * hint and rejects "556809-8239". The company's org number is already in
 * the ledger, so it is sent prefilled (the page still shows it, autosubmit
 * is off). The signer's personnummer is never known here and is left to the
 * person.
 *
 * SEB (business) asks for one or more 10-digit organisationsnummer or 14-digit
 * SEB identifiers, comma-separated with no spaces. One AIS session covers
 * every company the signer represents, so every 10-digit AB number the user
 * belongs to is sent: the connecting company first, then the rest. A template
 * that only accepts a single number (Handelsbanken) still gets that one.
 *
 * Sole traders get nothing prefilled: their companyId is a personnummer,
 * and the format differs per bank (Nordea business wants all 12 digits,
 * Handelsbanken 10). A prefilled field is locked on Enable Banking's page,
 * so a wrong guess cannot be corrected and blocks the connection; the person
 * types it in the format that bank asks for.
 *
 * Generic on the declared credential, not the bank: any method declaring a
 * `companyId` credential gets the value, and only when it matches the
 * method's own template (or the page's documented comma-list), so a value
 * the page would reject is never sent.
 */

/** The credential name Enable Banking uses for the company identifier. */
const COMPANY_ID_CREDENTIAL = 'companyId'

export interface PrefillCompany {
  org_number: string | null
  entity_type: string | null
}

/**
 * The 10-digit organisationsnummer Swedish banks call företags-ID. Null when
 * the stored number is not 10 digits.
 */
export function companyIdDigits(company: PrefillCompany): string | null {
  const digits = (company.org_number ?? '').replace(/\D/g, '')
  return digits.length === 10 ? digits : null
}

/** Whether the method asks the PSU for a company identifier at all. */
export function wantsCompanyId(method: AuthMethod | undefined): boolean {
  return !!method?.credentials?.some((c) => c.name === COMPANY_ID_CREDENTIAL)
}

function matchesTemplate(credential: AuthMethodCredential, value: string): boolean {
  if (!credential.template) return true
  try {
    return new RegExp(credential.template).test(value)
  } catch {
    // A template we cannot parse is no reason to withhold the value the
    // page will validate itself.
    return true
  }
}

/**
 * SEB's hosted page (and any method whose template or description says so)
 * accepts several identifiers in one field, comma-separated, no spaces.
 */
export function allowsCommaSeparatedCompanyIds(credential: AuthMethodCredential): boolean {
  if ((credential.template ?? '').includes(',')) return true
  const hay = `${credential.description ?? ''} ${credential.title ?? ''}`
  return /separated by comma|comma[ -]?separated|one or more/i.test(hay)
}

/**
 * Unique 10-digit AB identifiers, connecting company first, then siblings.
 * Enskild firma is skipped: that number is a personnummer, never a companyId list.
 */
export function companyIdPrefillList(
  company: PrefillCompany,
  siblings: readonly PrefillCompany[] = [],
): string[] {
  if (company.entity_type === 'enskild_firma') return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of [company, ...siblings]) {
    if (row.entity_type === 'enskild_firma') continue
    const digits = companyIdDigits(row)
    if (!digits || seen.has(digits)) continue
    seen.add(digits)
    out.push(digits)
  }
  return out
}

/**
 * The credentials to send on POST /auth, or undefined when there is nothing
 * to prefill (no method metadata, no companyId credential, a sole trader,
 * or no usable number).
 */
export function buildPrefilledCredentials(
  method: AuthMethod | undefined,
  company: PrefillCompany,
  siblings: readonly PrefillCompany[] = [],
): Record<string, string> | undefined {
  const credential = method?.credentials?.find((c) => c.name === COMPANY_ID_CREDENTIAL)
  if (!credential) return undefined
  const ids = companyIdPrefillList(company, siblings)
  if (ids.length === 0) return undefined
  const joined = ids.join(',')
  if (ids.length > 1 && allowsCommaSeparatedCompanyIds(credential)) {
    return { [COMPANY_ID_CREDENTIAL]: joined }
  }
  const value = ids[0]
  if (!matchesTemplate(credential, value)) return undefined
  return { [COMPANY_ID_CREDENTIAL]: value }
}
