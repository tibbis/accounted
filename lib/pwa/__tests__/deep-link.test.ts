import { describe, it, expect } from 'vitest'
import { companyDeepLink, isSafeAppPath, parseOpenSearchParams } from '../deep-link'

describe('isSafeAppPath', () => {
  it('accepts relative app paths', () => {
    expect(isSafeAppPath('/bookkeeping')).toBe(true)
    expect(isSafeAppPath('/invoices/abc')).toBe(true)
  })

  it('rejects open redirects', () => {
    expect(isSafeAppPath('https://evil.example')).toBe(false)
    expect(isSafeAppPath('//evil.example')).toBe(false)
    expect(isSafeAppPath('\\evil')).toBe(false)
    expect(isSafeAppPath('bookkeeping')).toBe(false)
  })
})

describe('companyDeepLink', () => {
  it('routes through /open with company and next', () => {
    const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    expect(companyDeepLink('/deadlines', companyId)).toBe(
      `/open?company=${companyId}&next=%2Fdeadlines`,
    )
  })
})

describe('parseOpenSearchParams', () => {
  it('parses a valid company UUID and safe next', () => {
    const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    expect(
      parseOpenSearchParams({ company: companyId, next: '/periods' }),
    ).toEqual({ companyId, next: '/periods' })
  })

  it('drops invalid company and unsafe next', () => {
    expect(
      parseOpenSearchParams({ company: 'not-a-uuid', next: 'https://evil' }),
    ).toEqual({ companyId: null, next: '/' })
  })
})
