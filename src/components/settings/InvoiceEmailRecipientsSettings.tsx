'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useSaveSettings } from '@/components/settings/use-save-settings'
import {
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsTextarea,
} from '@/components/settings/SettingsRows'
import {
  EMAIL_PATTERN,
  MAX_INVOICE_EMAIL_COPY_RECIPIENTS,
  parseInvoiceRecipientText,
} from '@/lib/invoices/email-recipients'
import { useCompany } from '@/contexts/CompanyContext'
import type { CompanySettings } from '@/types'

interface InvoiceEmailRecipientsSettingsProps {
  settings: CompanySettings
  onUpdate: (updates: Partial<CompanySettings>) => void
}

function listText(addresses: readonly string[]): string {
  return addresses.join('\n')
}

export function InvoiceEmailRecipientsSettings({
  settings,
  onUpdate,
}: InvoiceEmailRecipientsSettingsProps) {
  const t = useTranslations('settings_invoice_email_recipients')
  const { toast } = useToast()
  const saveSettings = useSaveSettings()
  const { role } = useCompany()
  // What is shown is exactly what is sent: no implicit fallback address.
  const serverFrom = settings.invoice_email_from_address ?? ''
  const serverFromName = settings.invoice_email_from_name ?? ''
  const serverReplyTo = settings.invoice_email_reply_to ?? ''
  const serverCcText = listText(settings.invoice_email_cc_addresses ?? [])
  const serverBccText = listText(settings.invoice_email_bcc_addresses ?? [])
  const [fromAddress, setFromAddress] = useState(serverFrom)
  const [fromName, setFromName] = useState(serverFromName)
  const [replyTo, setReplyTo] = useState(serverReplyTo)
  const [ccText, setCcText] = useState(serverCcText)
  const [bccText, setBccText] = useState(serverBccText)
  const [isSaving, setIsSaving] = useState(false)
  const previousServerText = useRef({
    from: serverFrom,
    fromName: serverFromName,
    replyTo: serverReplyTo,
    cc: serverCcText,
    bcc: serverBccText,
  })

  useEffect(() => {
    const previous = previousServerText.current
    setFromAddress((current) => current === previous.from ? serverFrom : current)
    setFromName((current) => current === previous.fromName ? serverFromName : current)
    setReplyTo((current) => current === previous.replyTo ? serverReplyTo : current)
    setCcText((current) => current === previous.cc ? serverCcText : current)
    setBccText((current) => current === previous.bcc ? serverBccText : current)
    previousServerText.current = {
      from: serverFrom,
      fromName: serverFromName,
      replyTo: serverReplyTo,
      cc: serverCcText,
      bcc: serverBccText,
    }
  }, [serverBccText, serverCcText, serverFrom, serverFromName, serverReplyTo])

  if (role !== 'owner' && role !== 'admin') return null

  async function save() {
    try {
    const from = fromAddress.trim()
    const name = fromName.trim()
    const replyToAddress = replyTo.trim()
    const cc = parseInvoiceRecipientText(ccText)
    const bcc = parseInvoiceRecipientText(bccText)
    const invalid = [from, replyToAddress, ...cc, ...bcc].find(
      (address) => address !== '' && !EMAIL_PATTERN.test(address),
    )
    if (name.length > 120 || /[\r\n<>]/.test(name)) {
      toast({
        title: t('invalid_name_title'),
        description: t('invalid_name_description'),
        variant: 'destructive',
      })
      return
    }

    if (invalid) {
      toast({
        title: t('invalid_title'),
        description: t('invalid_description', { address: invalid }),
        variant: 'destructive',
      })
      return
    }
    if (cc.length + bcc.length > MAX_INVOICE_EMAIL_COPY_RECIPIENTS) {
      toast({
        title: t('too_many_title'),
        description: t('too_many_description', { count: MAX_INVOICE_EMAIL_COPY_RECIPIENTS }),
        variant: 'destructive',
      })
      return
    }

    const updates = {
      invoice_email_from_address: from || null,
      invoice_email_from_name: name || null,
      invoice_email_reply_to: replyToAddress || null,
      invoice_email_cc_addresses: cc,
      invoice_email_bcc_addresses: bcc,
    }

    setIsSaving(true)
    const saved = await saveSettings(updates, { failedTitle: t('save_failed_title') })
    setIsSaving(false)
    if (!saved) return

      onUpdate(updates)
      setFromAddress(from)
      setFromName(name)
      setReplyTo(replyToAddress)
      setCcText(listText(cc))
      setBccText(listText(bcc))
      toast({ title: t('saved_title'), description: t('saved_description') })
    } catch (error) {
      toast({
        title: t('save_failed_title'),
        description: error instanceof Error ? getUserErrorMessage(error) : t('save_failed'),
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SettingsGroup label={t('heading')} help={t('description')}>
      <SettingsRow
        label={t('from_label')}
        htmlFor="invoice-email-from"
        help={t('from_hint')}
      >
        <SettingsInput
          id="invoice-email-from"
          type="email"
          autoComplete="off"
          value={fromAddress}
          onChange={(event) => setFromAddress(event.target.value)}
          placeholder={t('from_placeholder')}
        />
      </SettingsRow>
      <SettingsRow
        label={t('from_name_label')}
        htmlFor="invoice-email-from-name"
        help={t('from_name_hint')}
      >
        <SettingsInput
          id="invoice-email-from-name"
          type="text"
          autoComplete="off"
          value={fromName}
          onChange={(event) => setFromName(event.target.value)}
          placeholder={settings.company_name ?? t('from_name_placeholder')}
          maxLength={120}
        />
      </SettingsRow>
      <SettingsRow
        label={t('reply_to_label')}
        htmlFor="invoice-email-reply-to"
        help={t('reply_to_hint')}
      >
        <SettingsInput
          id="invoice-email-reply-to"
          type="email"
          autoComplete="off"
          value={replyTo}
          onChange={(event) => setReplyTo(event.target.value)}
          placeholder={t('reply_to_placeholder')}
        />
      </SettingsRow>
      <SettingsRow
        label={t('cc_label')}
        htmlFor="invoice-email-cc"
        help={t('cc_hint')}
        align="baseline"
      >
        <SettingsTextarea
          id="invoice-email-cc"
          value={ccText}
          onChange={(event) => setCcText(event.target.value)}
          placeholder={t('cc_placeholder')}
          rows={3}
        />
      </SettingsRow>
      <SettingsRow
        label={t('bcc_label')}
        htmlFor="invoice-email-bcc"
        help={t('bcc_hint')}
        align="baseline"
      >
        <SettingsTextarea
          id="invoice-email-bcc"
          value={bccText}
          onChange={(event) => setBccText(event.target.value)}
          placeholder={t('bcc_placeholder')}
          rows={3}
        />
      </SettingsRow>

      <div className="flex justify-end px-1 pt-4">
        <Button type="button" onClick={save} disabled={isSaving}>
          {isSaving ? t('saving') : t('save')}
        </Button>
      </div>
    </SettingsGroup>
  )
}
