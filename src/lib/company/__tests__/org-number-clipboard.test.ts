import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  companyIdClipboardValue,
  writeCompanyIdClipboard,
} from '../org-number-clipboard'

describe('writeCompanyIdClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes the value and returns true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(writeCompanyIdClipboard('5594951609,5593757171')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('5594951609,5593757171')
  })

  it('returns false when empty or the browser refuses', async () => {
    await expect(writeCompanyIdClipboard(null)).resolves.toBe(false)
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    await expect(writeCompanyIdClipboard('5594951609')).resolves.toBe(false)
  })
})

describe('companyIdClipboardValue', () => {
  it('joins AB numbers with no spaces', () => {
    expect(
      companyIdClipboardValue(
        { org_number: '559495-1609', entity_type: 'aktiebolag' },
        [{ org_number: '5593757171', entity_type: 'aktiebolag' }],
      ),
    ).toBe('5594951609,5593757171')
  })
})
