import type { MetadataRoute } from 'next'
import { isSelfHosted } from '@/lib/env/public-flags'

/**
 * Crawler policy. Self-hosted / personal instances hold live books and must
 * not appear in search or AI-training crawls. Hosted Accounted stays open so
 * public docs and llms.txt discovery keep working.
 */
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
      allow: '/',
    },
  }
}
