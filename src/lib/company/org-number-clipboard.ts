/**
 * 10-digit organisationsnummer for bank AIS fields (SEB comma-list, paste).
 * Enskild firma is skipped: that stored number is a personnummer.
 */

export interface OrgNumberCompany {
  org_number: string | null
  entity_type: string | null
}

export function companyIdDigits(company: OrgNumberCompany): string | null {
  const digits = (company.org_number ?? '').replace(/\D/g, '')
  return digits.length === 10 ? digits : null
}

/** Unique 10-digit AB identifiers, connecting company first, then siblings. */
export function companyIdPrefillList(
  company: OrgNumberCompany,
  siblings: readonly OrgNumberCompany[] = [],
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

/** Comma-separated 10-digit numbers for the bank page, or null when there are none. */
export function companyIdClipboardValue(
  company: OrgNumberCompany,
  siblings: readonly OrgNumberCompany[] = [],
): string | null {
  const ids = companyIdPrefillList(company, siblings)
  return ids.length > 0 ? ids.join(',') : null
}

/** Copy the org-number list before leaving for the bank. Returns false if the browser refused. */
export async function writeCompanyIdClipboard(value: string | null): Promise<boolean> {
  if (!value) return false
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}
