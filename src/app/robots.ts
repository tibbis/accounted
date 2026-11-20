import type { MetadataRoute } from 'next'
import { isSelfHosted } from '@/lib/env/public-flags'

/**
 * The paths a crawler may fetch on the hosted product: the anonymous
 * agent-discovery surfaces. A self-hosted install holds live books and
 * disallows every path.
 */
const ROBOTS_ALLOWED_PATHS = [
  '/llms.txt',
  '/llms-full.txt',
  '/docs',
  '/api/v1/openapi.json',
  '/.well-known/',
] as const

export default function robots(): MetadataRoute.Robots {
  if (isSelfHosted()) {
    return {
      rules: {
        userAgent: '*',
        disallow: '/',
      },
    }
  }

  return {
    rules: {
      userAgent: '*',
      allow: [...ROBOTS_ALLOWED_PATHS],
      disallow: '/',
    },
  }
}
