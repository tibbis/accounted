/**
 * Push Notifications Extension
 *
 * Converts system events into instant push notifications.
 * Also provides cron-based scheduling for time-dependent checks
 * (tax deadlines, invoice due/overdue).
 *
 * Event handlers follow the gate pattern:
 *   check extension setting -> build payload -> send via unified pipeline
 */

import type { Extension, ExtensionContext } from '@/lib/extensions/types'
import type { EventPayload } from '@/lib/events/types'
import { pushNotificationsApiRoutes } from './api-routes'
import { sendNotificationToUser } from './notification-sender'
import {
  createPeriodLockedPayload,
  createYearClosedPayload,
  createInvoiceSentPayload,
  createReceiptExtractedPayload,
  createReceiptMatchedPayload,
  withCompanyDeepLink,
} from './payload-builders'
import { listCompanyMemberUserIds, loadCompanyNames } from './company-targets'
import { invoiceNumberDisplay } from '@/lib/invoices/display'
import type { NotificationPayload } from './notification-sender'
import type { NotificationType } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'

async function notifyCompany(
  supabase: SupabaseClient,
  companyId: string,
  basePayload: NotificationPayload,
  type: NotificationType,
  referenceId: string,
  log: { info: (msg: string) => void } | Console,
  successMessage: string,
): Promise<void> {
  const [members, names] = await Promise.all([
    listCompanyMemberUserIds(supabase, companyId),
    loadCompanyNames(supabase, [companyId]),
  ])
  if (members.length === 0) return

  const payload = withCompanyDeepLink(basePayload, {
    companyId,
    companyName: names.get(companyId) ?? null,
  })

  let sent = false
  for (const userId of members) {
    const result = await sendNotificationToUser(supabase, userId, payload, type, referenceId)
    if (result.sent) sent = true
  }
  if (sent) log.info(successMessage)
}

// ============================================================
// Settings
// ============================================================

export interface PushNotificationSettings {
  periodLockedEnabled: boolean
  periodYearClosedEnabled: boolean
  invoiceSentEnabled: boolean
  receiptExtractedEnabled: boolean
  receiptMatchedEnabled: boolean
  missingUnderlagEnabled: boolean
}

const DEFAULT_SETTINGS: PushNotificationSettings = {
  periodLockedEnabled: true,
  periodYearClosedEnabled: true,
  invoiceSentEnabled: false,
  receiptExtractedEnabled: true,
  receiptMatchedEnabled: true,
  missingUnderlagEnabled: true,
}

/** Get settings via ExtensionContext (preferred in event handlers) */
async function getSettingsViaCtx(ctx: ExtensionContext): Promise<PushNotificationSettings> {
  const stored = await ctx.settings.get<Partial<PushNotificationSettings>>()
  return { ...DEFAULT_SETTINGS, ...(stored || {}) }
}

/**
 * Get settings for external callers (settings routes, event handlers).
 *
 * Returns null when the settings row exists but CANNOT BE READ: consent
 * polarity requires every caller to treat that as "do not notify" (and the
 * settings routes to surface an error) instead of falling back to the
 * defaults, which are mostly enabled. A genuinely absent row (maybeSingle
 * with no error) means the user never touched the toggles: defaults apply.
 */
export async function getSettings(userId: string): Promise<PushNotificationSettings | null> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notification_settings')
    .select(
      'period_locked_enabled, period_year_closed_enabled, invoice_sent_enabled, receipt_extracted_enabled, receipt_matched_enabled, missing_underlag_enabled'
    )
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return null
  if (!data) return { ...DEFAULT_SETTINGS }
  return {
    periodLockedEnabled: data.period_locked_enabled ?? DEFAULT_SETTINGS.periodLockedEnabled,
    periodYearClosedEnabled: data.period_year_closed_enabled ?? DEFAULT_SETTINGS.periodYearClosedEnabled,
    invoiceSentEnabled: data.invoice_sent_enabled ?? DEFAULT_SETTINGS.invoiceSentEnabled,
    receiptExtractedEnabled: data.receipt_extracted_enabled ?? DEFAULT_SETTINGS.receiptExtractedEnabled,
    receiptMatchedEnabled: data.receipt_matched_enabled ?? DEFAULT_SETTINGS.receiptMatchedEnabled,
    missingUnderlagEnabled: data.missing_underlag_enabled ?? DEFAULT_SETTINGS.missingUnderlagEnabled,
  }
}

export async function saveSettings(
  userId: string,
  partial: Partial<PushNotificationSettings>
): Promise<PushNotificationSettings | null> {
  const current = await getSettings(userId)
  // Unreadable current settings: merging the partial into defaults would
  // silently overwrite the user's stored opt-outs. Refuse the save.
  if (!current) return null
  const merged = { ...current, ...partial }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  await supabase
    .from('notification_settings')
    .upsert(
      {
        user_id: userId,
        period_locked_enabled: merged.periodLockedEnabled,
        period_year_closed_enabled: merged.periodYearClosedEnabled,
        invoice_sent_enabled: merged.invoiceSentEnabled,
        receipt_extracted_enabled: merged.receiptExtractedEnabled,
        receipt_matched_enabled: merged.receiptMatchedEnabled,
        missing_underlag_enabled: merged.missingUnderlagEnabled,
      },
      { onConflict: 'user_id' }
    )

  return merged
}

// ============================================================
// Event Handlers
// ============================================================

async function handlePeriodLocked(
  payload: EventPayload<'period.locked'>,
  ctx?: ExtensionContext
): Promise<void> {
  const { period, userId, companyId } = payload

  // getSettings() returns null when the row is unreadable: do not notify.
  const settings = ctx ? await getSettingsViaCtx(ctx) : await getSettings(userId)
  if (!settings?.periodLockedEnabled) return

  const supabase = ctx?.supabase ?? await (await import('@/lib/supabase/server')).createClient()
  await notifyCompany(
    supabase,
    companyId,
    createPeriodLockedPayload(period.name, period.id),
    'period_locked',
    period.id,
    ctx?.log ?? console,
    `Period locked notification sent for ${period.name}`,
  )
}

async function handleYearClosed(
  payload: EventPayload<'period.year_closed'>,
  ctx?: ExtensionContext
): Promise<void> {
  const { period, userId, companyId } = payload

  const settings = ctx ? await getSettingsViaCtx(ctx) : await getSettings(userId)
  if (!settings?.periodYearClosedEnabled) return

  const supabase = ctx?.supabase ?? await (await import('@/lib/supabase/server')).createClient()
  await notifyCompany(
    supabase,
    companyId,
    createYearClosedPayload(period.name, period.id),
    'period_year_closed',
    period.id,
    ctx?.log ?? console,
    `Year closed notification sent for ${period.name}`,
  )
}

async function handleInvoiceSent(
  payload: EventPayload<'invoice.sent'>,
  ctx?: ExtensionContext
): Promise<void> {
  const { invoice, userId, companyId } = payload

  const settings = ctx ? await getSettingsViaCtx(ctx) : await getSettings(userId)
  if (!settings?.invoiceSentEnabled) return

  const supabase = ctx?.supabase ?? await (await import('@/lib/supabase/server')).createClient()
  await notifyCompany(
    supabase,
    companyId,
    createInvoiceSentPayload(invoiceNumberDisplay(invoice.invoice_number), invoice.id),
    'invoice_sent',
    invoice.id,
    ctx?.log ?? console,
    `Invoice sent notification for #${invoice.invoice_number}`,
  )
}

async function handleReceiptExtracted(
  payload: EventPayload<'receipt.extracted'>,
  ctx?: ExtensionContext
): Promise<void> {
  const { receipt, userId, companyId } = payload

  const settings = ctx ? await getSettingsViaCtx(ctx) : await getSettings(userId)
  if (!settings?.receiptExtractedEnabled) return

  const supabase = ctx?.supabase ?? await (await import('@/lib/supabase/server')).createClient()
  await notifyCompany(
    supabase,
    companyId,
    createReceiptExtractedPayload(receipt.merchant_name, receipt.id),
    'receipt_extracted',
    receipt.id,
    ctx?.log ?? console,
    `Receipt extracted notification for ${receipt.id}`,
  )
}

async function handleReceiptMatched(
  payload: EventPayload<'receipt.matched'>,
  ctx?: ExtensionContext
): Promise<void> {
  const { receipt, transaction, userId, companyId } = payload

  const settings = ctx ? await getSettingsViaCtx(ctx) : await getSettings(userId)
  if (!settings?.receiptMatchedEnabled) return

  const supabase = ctx?.supabase ?? await (await import('@/lib/supabase/server')).createClient()
  await notifyCompany(
    supabase,
    companyId,
    createReceiptMatchedPayload(receipt.id, transaction.id),
    'receipt_matched',
    receipt.id,
    ctx?.log ?? console,
    `Receipt matched notification for ${receipt.id}`,
  )
}

// ============================================================
// Extension Object
// ============================================================

export const pushNotificationsExtension: Extension = {
  id: 'push-notifications',
  name: 'Push-notiser',
  version: '1.0.0',
  sector: 'general',
  apiRoutes: pushNotificationsApiRoutes,
  eventHandlers: [
    { eventType: 'period.locked', handler: handlePeriodLocked },
    { eventType: 'period.year_closed', handler: handleYearClosed },
    { eventType: 'invoice.sent', handler: handleInvoiceSent },
    { eventType: 'receipt.extracted', handler: handleReceiptExtracted },
    { eventType: 'receipt.matched', handler: handleReceiptMatched },
  ],
  settingsPanel: {
    label: 'Push-notiser',
    path: '/settings/account',
  },
  async onInstall(ctx) {
    await ctx.settings.set('settings', DEFAULT_SETTINGS)
  },
}
