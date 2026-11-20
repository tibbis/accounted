import { describe, it, expect } from 'vitest'
import { getPool } from './setup'
import { seedCompany } from './fixtures'

// pg-real coverage for migration 20261119170000: the per-company invoice
// From address and display name, and their format CHECKs.

describe('company_settings invoice from identity', () => {
  it('accepts null and a plain address with a display name', async () => {
    const { companyId, userId } = await seedCompany()
    await getPool().query(
      `INSERT INTO public.company_settings (user_id, company_id, invoice_email_from_address, invoice_email_from_name)
       VALUES ($1, $2, NULL, NULL)`,
      [userId, companyId],
    )
    await getPool().query(
      `UPDATE public.company_settings
       SET invoice_email_from_address = 'invoices@helle.cc', invoice_email_from_name = 'TADH Consulting AB'
       WHERE company_id = $1`,
      [companyId],
    )
    const { rows } = await getPool().query(
      `SELECT invoice_email_from_address, invoice_email_from_name
       FROM public.company_settings WHERE company_id = $1`,
      [companyId],
    )
    expect(rows[0].invoice_email_from_address).toBe('invoices@helle.cc')
    expect(rows[0].invoice_email_from_name).toBe('TADH Consulting AB')
  })

  it('rejects a from address that is not an email address', async () => {
    const { companyId, userId } = await seedCompany()
    await expect(
      getPool().query(
        `INSERT INTO public.company_settings (user_id, company_id, invoice_email_from_address)
         VALUES ($1, $2, 'inte en adress')`,
        [userId, companyId],
      ),
    ).rejects.toThrow(/company_settings_invoice_email_from_address_format/)
  })

  it('rejects a display name with a line break', async () => {
    const { companyId, userId } = await seedCompany()
    await expect(
      getPool().query(
        `INSERT INTO public.company_settings (user_id, company_id, invoice_email_from_name)
         VALUES ($1, $2, E'TADH\\nConsulting')`,
        [userId, companyId],
      ),
    ).rejects.toThrow(/company_settings_invoice_email_from_name_format/)
  })
})
