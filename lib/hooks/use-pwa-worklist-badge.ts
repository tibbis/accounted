'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import { useCompany } from '@/contexts/CompanyContext'
import { useUiState } from '@/lib/hooks/use-ui-state'
import { syncAppBadge } from '@/lib/pwa/app-badge'
import { isPwaWorklistBadgeEnabled } from '@/lib/ui-state/client'

interface MergedBadgeResponse {
  total: number
}

async function fetchMergedBadge(): Promise<MergedBadgeResponse> {
  const res = await fetch('/api/worklist/counts?scope=all')
  if (!res.ok) throw new Error('worklist counts failed')
  const json = (await res.json()) as { data: MergedBadgeResponse }
  return json.data
}

/**
 * Mirrors Att göra on the home-screen PWA icon, summed across every company
 * the user belongs to (not only the active one).
 */
export function usePwaWorklistBadge() {
  const { company, companies } = useCompany()
  const { uiState, loaded } = useUiState()
  const membershipKey = companies.map((c) => c.company.id).sort().join(',')
  const enabled = isPwaWorklistBadgeEnabled(uiState)

  const { data } = useSWR<MergedBadgeResponse>(
    company?.id && enabled ? ['pwa-worklist-badge-all', membershipKey] : null,
    fetchMergedBadge,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: true,
    },
  )

  useEffect(() => {
    if (loaded && !enabled) {
      void syncAppBadge(0)
      return
    }
    if (!company?.id) {
      void syncAppBadge(0)
      return
    }
    if (!data) return
    void syncAppBadge(data.total)
  }, [company?.id, data, enabled, loaded])
}
