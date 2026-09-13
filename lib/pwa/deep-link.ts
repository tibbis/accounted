/**
 * Relative deep links that switch active company before opening a page.
 * Used by push notifications so a tap lands in the right tenant.
 */

const OPEN_PATH = '/open'

/** True when `next` is a same-origin relative path (no protocol, no //). */
export function isSafeAppPath(next: string): boolean {
  if (!next.startsWith('/')) return false
  if (next.startsWith('//')) return false
  if (next.includes('://')) return false
  if (next.includes('\\')) return false
  return true
}

export function companyDeepLink(path: string, companyId: string): string {
  const next = path.startsWith('/') ? path : `/${path}`
  const params = new URLSearchParams({
    company: companyId,
    next,
  })
  return `${OPEN_PATH}?${params.toString()}`
}

export function parseOpenSearchParams(input: {
  company?: string | string[] | undefined
  next?: string | string[] | undefined
}): { companyId: string | null; next: string } {
  const companyRaw = Array.isArray(input.company) ? input.company[0] : input.company
  const nextRaw = Array.isArray(input.next) ? input.next[0] : input.next
  const companyId =
    typeof companyRaw === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyRaw)
      ? companyRaw
      : null
  const next =
    typeof nextRaw === 'string' && isSafeAppPath(nextRaw) ? nextRaw : '/'
  return { companyId, next }
}
