import { describe, it, expect } from 'vitest'
import {
  buildBusinessOrgCredentials,
  findOrgNumberCredential,
  formatCredentialValue,
} from '../auth-credentials'

describe('findOrgNumberCredential', () => {
  it('matches companyId by name', () => {
    expect(
      findOrgNumberCredential([
        { name: 'userId', title: 'Username' },
        { name: 'companyId', title: 'Company ID' },
      ])?.name,
    ).toBe('companyId')
  })

  it('matches organisationsnummer in description', () => {
    expect(
      findOrgNumberCredential([
        {
          name: 'corporateReference',
          description: 'Organisationsnummer i formatet NNNNNN-NNNN',
        },
      ])?.name,
    ).toBe('corporateReference')
  })
})

describe('formatCredentialValue', () => {
  it('formats Swedish org numbers as NNNNNN-NNNN by default', () => {
    expect(formatCredentialValue({ name: 'companyId' }, '5560125790')).toBe('556012-5790')
    expect(formatCredentialValue({ name: 'companyId' }, '556012-5790')).toBe('556012-5790')
  })

  it('respects a six-plus-four template', () => {
    expect(
      formatCredentialValue(
        { name: 'companyId', template: '^\\d{6}-\\d{4}$' },
        '5560125790',
      ),
    ).toBe('556012-5790')
  })

  it('respects a ten-digit template', () => {
    expect(
      formatCredentialValue(
        { name: 'companyId', template: '^\\d{10}$' },
        '5560125790',
      ),
    ).toBe('5560125790')
  })

  it('returns undefined for non-org input', () => {
    expect(formatCredentialValue({ name: 'companyId' }, 'not-an-org')).toBeUndefined()
  })
})

describe('buildBusinessOrgCredentials', () => {
  const sebLikeMethods = [
    {
      name: 'REDIRECT',
      approach: 'REDIRECT' as const,
      hidden_method: false,
      psu_types: ['business' as const],
      credentials: [
        {
          name: 'companyId',
          title: 'Organisationsnummer',
          template: '^\\d{6}-\\d{4}$',
          required: true,
        },
      ],
    },
  ]

  it('prefills org number on the visible business method when none is pinned', () => {
    expect(
      buildBusinessOrgCredentials(sebLikeMethods, undefined, 'business', '5560125790'),
    ).toEqual({
      authMethod: 'REDIRECT',
      credentials: { companyId: '556012-5790' },
    })
  })

  it('skips prefill for personal PSU', () => {
    expect(
      buildBusinessOrgCredentials(sebLikeMethods, undefined, 'personal', '5560125790'),
    ).toEqual({})
  })

  it('keeps pinned method without org credential and does not switch method', () => {
    const preferred = {
      name: 'BANKID',
      approach: 'DECOUPLED' as const,
      hidden_method: true,
      psu_types: ['business' as const],
    }

    expect(
      buildBusinessOrgCredentials(sebLikeMethods, preferred, 'business', '5560125790'),
    ).toEqual({ authMethod: 'BANKID' })
  })

  it('prefills on pinned method when it exposes an org credential', () => {
    const preferred = {
      name: 'MTA',
      approach: 'REDIRECT' as const,
      hidden_method: false,
      psu_types: ['business' as const],
      credentials: [
        {
          name: 'companyId',
          template: '^\\d{6}-\\d{4}$',
        },
      ],
    }

    expect(
      buildBusinessOrgCredentials([], preferred, 'business', '5560125790'),
    ).toEqual({
      authMethod: 'MTA',
      credentials: { companyId: '556012-5790' },
    })
  })
})
