-- The fork still sends the opt-in "nytt att bokföra" digest. Upstream
-- retired it in 20261012100400 (dropped notification_settings.email_digest_enabled,
-- the dedup index, and the notification_type). This puts that column and the
-- type back on top of the newest type list (20261031224300).

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS email_digest_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.notification_settings.email_digest_enabled IS
  'Opt-in for the "nytt att bokföra" email digest (new bank transactions and inbox documents).';

ALTER TABLE public.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_notification_type_check;
ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_notification_type_check
  CHECK (notification_type IN (
    'tax_deadline',
    'invoice_due',
    'invoice_overdue',
    'period_locked',
    'period_year_closed',
    'invoice_sent',
    'receipt_extracted',
    'receipt_matched',
    'missing_underlag',
    'skv_kvittens',
    'skv_connection_expired',
    'payment_failed',
    'bookkeeping_digest'
  )) NOT VALID;
ALTER TABLE public.notification_log
  VALIDATE CONSTRAINT notification_log_notification_type_check;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_log_bookkeeping_digest_dedup
  ON public.notification_log (user_id, reference_id)
  WHERE notification_type = 'bookkeeping_digest';

NOTIFY pgrst, 'reload schema';
