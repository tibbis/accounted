import { describe, it, expect } from 'vitest'
import {
  createInvoiceOverduePayload,
  createInvoiceDuePayload,
  createTaxDeadlinePayload,
  withCompanyDeepLink,
} from '../payload-builders'

describe('invoice notification payloads', () => {
  // sv-SE grouping uses a non-breaking space: build expectations via the same
  // formatter instead of typing literals with a plain space.
  it('labels SEK amounts with kr', () => {
    const payload = createInvoiceDuePayload('1042', 'Acme AB', 12500, 'SEK', '2026-08-01', 'inv-1')
    expect(payload.body).toContain(`${(12500).toLocaleString('sv-SE')} kr`)
  })

  it('labels non-SEK amounts with their ISO code instead of kr', () => {
    const payload = createInvoiceOverduePayload('1043', 'Odin Aero GmbH', 9800, 'EUR', '2026-07-01', 'inv-2')
    expect(payload.body).toContain(`${(9800).toLocaleString('sv-SE')} EUR`)
    expect(payload.body).not.toContain('kr (')
  })

  it('falls back to kr when currency is missing on legacy rows', () => {
    const payload = createInvoiceDuePayload('1044', 'Acme AB', 100, '', '2026-08-01', 'inv-3')
    expect(payload.body).toContain('100 kr')
  })
})

describe('withCompanyDeepLink', () => {
  const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  it('prefixes the body with the company name and scopes tag + url', () => {
    const base = createTaxDeadlinePayload('Moms', '2026-09-20', 7, 'dl-1')
    const payload = withCompanyDeepLink(base, { companyId, companyName: 'TADH Consulting AB' })

    expect(payload.body).toContain('· TADH Consulting AB')
    expect(payload.tag).toBe(`tax-deadline-dl-1:${companyId}`)
    expect(payload.data?.companyId).toBe(companyId)
    expect(payload.data?.url).toContain('/open?')
    expect(payload.data?.url).toContain(`company=${companyId}`)
    expect(payload.data?.url).toContain('next=%2Fdeadlines')
  })
})
