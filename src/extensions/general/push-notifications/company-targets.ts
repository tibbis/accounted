import type { SupabaseClient } from '@supabase/supabase-js'

/** Every member of a company (for fan-out of company-scoped pushes). */
export async function listCompanyMemberUserIds(
  supabase: SupabaseClient,
  companyId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId)

  if (error || !data) return []
  return [...new Set(data.map((row) => row.user_id as string).filter(Boolean))]
}

export async function loadCompanyNames(
  supabase: SupabaseClient,
  companyIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(companyIds.filter(Boolean))]
  const out = new Map<string, string>()
  if (ids.length === 0) return out

  const [{ data: companies }, { data: settings }] = await Promise.all([
    supabase.from('companies').select('id, name').in('id', ids),
    supabase.from('company_settings').select('company_id, company_name').in('company_id', ids),
  ])

  for (const row of companies ?? []) {
    if (row.id && row.name) out.set(row.id as string, row.name as string)
  }
  for (const row of settings ?? []) {
    const id = row.company_id as string | null
    const display = (row.company_name as string | null)?.trim()
    if (id && display) out.set(id, display)
  }
  return out
}
