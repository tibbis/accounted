'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import {
  SettingsGroup,
  SettingsRow,
  SettingsSelect,
} from '@/components/settings/SettingsRows'
import { createClient } from '@/lib/supabase/client'
import type { EmailDigestFrequency } from '@/types'

/**
 * Per-user opt-in for the "nytt att bokfora" email digest
 * (notification_settings.email_digest_enabled + email_digest_frequency;
 * consumed by the bookkeeping-digest cron). Lives on the core account tab
 * so the digest stays reachable even when the push-notifications
 * extension is off.
 */
export function EmailDigestToggle() {
  const t = useTranslations('settings')
  const { toast } = useToast()
  const supabase = createClient()
  const [enabled, setEnabled] = useState(false)
  const [frequency, setFrequency] = useState<EmailDigestFrequency>('weekly')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data } = await supabase
          .from('notification_settings')
          .select('email_digest_enabled, email_digest_frequency')
          .eq('user_id', user.id)
          .maybeSingle()
        if (active) {
          setEnabled(data?.email_digest_enabled === true)
          setFrequency(data?.email_digest_frequency === 'daily' ? 'daily' : 'weekly')
        }
      } catch (err) {
        // Leave the default (off); a failed read must not block the page.
        console.error('Could not read email digest setting:', err)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function persist(nextEnabled: boolean, nextFrequency: EmailDigestFrequency) {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      // Upsert on user_id: most users have no notification_settings row
      // until they touch a notification preference for the first time.
      const { error } = await supabase
        .from('notification_settings')
        .upsert(
          {
            user_id: user.id,
            email_digest_enabled: nextEnabled,
            email_digest_frequency: nextFrequency,
          },
          { onConflict: 'user_id' },
        )
      if (error) throw new Error(error.message)
      return true
    } catch (err) {
      console.error('Could not save email digest setting:', err)
      toast({ title: t('digest_save_failed'), variant: 'destructive' })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleEnabledChange(next: boolean) {
    const previous = enabled
    setEnabled(next)
    const ok = await persist(next, frequency)
    if (!ok) {
      setEnabled(previous)
      return
    }
    toast({
      title: next
        ? frequency === 'weekly'
          ? t('digest_enabled_weekly_toast')
          : t('digest_enabled_toast')
        : t('digest_disabled_toast'),
    })
  }

  async function handleFrequencyChange(next: EmailDigestFrequency) {
    const previous = frequency
    setFrequency(next)
    const ok = await persist(enabled, next)
    if (!ok) {
      setFrequency(previous)
      return
    }
    toast({
      title:
        next === 'weekly'
          ? t('digest_frequency_weekly_toast')
          : t('digest_frequency_daily_toast'),
    })
  }

  return (
    <SettingsGroup label={t('digest_group')}>
      <SettingsRow label={t('digest_label')} help={t('digest_description')}>
        <Switch
          id="email-digest"
          checked={enabled}
          onCheckedChange={(value) => void handleEnabledChange(value)}
          disabled={loading || saving}
        />
        <label htmlFor="email-digest" className="cursor-pointer text-sm">
          {t('digest_switch_label')}
        </label>
      </SettingsRow>
      {enabled ? (
        <SettingsRow label={t('digest_frequency_label')} help={t('digest_frequency_help')}>
          <SettingsSelect
            id="email-digest-frequency"
            aria-label={t('digest_frequency_label')}
            value={frequency}
            disabled={loading || saving}
            onChange={(event) => {
              const next = event.target.value === 'daily' ? 'daily' : 'weekly'
              void handleFrequencyChange(next)
            }}
          >
            <option value="weekly">{t('digest_frequency_weekly')}</option>
            <option value="daily">{t('digest_frequency_daily')}</option>
          </SettingsSelect>
        </SettingsRow>
      ) : null}
    </SettingsGroup>
  )
}
