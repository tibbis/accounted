-- Per-company From identity for customer invoice mail.
--
-- RESEND_FROM_EMAIL (or SMTP_FROM_EMAIL) is one address for the whole
-- instance. On a multi-company self-host that address belongs to one company,
-- so every other company sent invoice, reminder and payment-confirmation mail
-- as that company. These columns are the explicit From for THIS company.
-- NULL keeps the instance default, and the application uses the company name
-- as the display name. An address whose domain is not verified with the email
-- provider is refused: the send does not fall back to another company's identity.

ALTER TABLE public.company_settings
  ADD COLUMN invoice_email_from_address text,
  ADD COLUMN invoice_email_from_name text,
  ADD CONSTRAINT company_settings_invoice_email_from_address_format
    CHECK (
      invoice_email_from_address IS NULL
      OR (
        length(invoice_email_from_address) <= 254
        AND invoice_email_from_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),
  ADD CONSTRAINT company_settings_invoice_email_from_name_format
    CHECK (
      invoice_email_from_name IS NULL
      OR (
        length(invoice_email_from_name) BETWEEN 1 AND 120
        AND invoice_email_from_name !~ '[[:cntrl:]<>]'
      )
    );

COMMENT ON COLUMN public.company_settings.invoice_email_from_address IS
  'From address for invoice, reminder and payment-confirmation email. NULL uses the instance default sender. The domain must be verified with the email provider.';

COMMENT ON COLUMN public.company_settings.invoice_email_from_name IS
  'Display name on invoice email. NULL uses the company name.';

NOTIFY pgrst, 'reload schema';
