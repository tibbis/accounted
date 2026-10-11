-- Per-user cadence for the "nytt att bokföra" email digest.
--
-- The digest cron stays daily (bank sync still lands overnight). Users who
-- pick weekly only receive mail on Mondays (Europe/Stockholm), covering the
-- previous seven days. Default daily keeps every existing opt-in unchanged.

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS email_digest_frequency text NOT NULL DEFAULT 'daily';

ALTER TABLE public.notification_settings
  DROP CONSTRAINT IF EXISTS notification_settings_email_digest_frequency_check;

ALTER TABLE public.notification_settings
  ADD CONSTRAINT notification_settings_email_digest_frequency_check
  CHECK (email_digest_frequency IN ('daily', 'weekly')) NOT VALID;

ALTER TABLE public.notification_settings
  VALIDATE CONSTRAINT notification_settings_email_digest_frequency_check;

COMMENT ON COLUMN public.notification_settings.email_digest_frequency IS
  'Cadence for the opted-in bookkeeping digest email: daily (last 24h) or weekly (Mondays, last 7 days, Europe/Stockholm).';

NOTIFY pgrst, 'reload schema';
