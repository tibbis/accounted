import {
  formatOrgNumberDisplay,
  stripOrgNumberFormatting,
} from '@/lib/invariants/org-number'
/** Minimal auth-method shape from Enable Banking ASPSP metadata. */
export interface AuthMethodShape {
  name: string
  approach?: 'REDIRECT' | 'DECOUPLED' | 'EMBEDDED'
  hidden_method?: boolean
  psu_types?: ('personal' | 'business')[]
}

export interface AuthMethodCredential {
  name: string
  title?: string
  description?: string
  required?: boolean
  template?: string
}

export interface AuthMethodWithCredentials extends AuthMethodShape {
  credentials?: AuthMethodCredential[]
}

const ORG_CREDENTIAL_NAME =
  /^(companyId|corporateId|organisationId|orgNumber|organisationNumber|companyRegistrationNumber)$/i

const ORG_CREDENTIAL_TEXT =
  /organisationsnummer|organisations-nummer|org\.?\s*nr|company id|y-tunnus|business identity/i

export function isAuthMethodApplicableToPsu(
  method: AuthMethodShape,
  psuType: 'personal' | 'business',
): boolean {
  return !method.psu_types?.length || method.psu_types.includes(psuType)
}

export function findOrgNumberCredential(
  credentials: AuthMethodCredential[] | undefined,
): AuthMethodCredential | undefined {
  if (!credentials?.length) return undefined
  return credentials.find((credential) => {
    if (ORG_CREDENTIAL_NAME.test(credential.name)) return true
    const hay = `${credential.title ?? ''} ${credential.description ?? ''}`.toLowerCase()
    return ORG_CREDENTIAL_TEXT.test(hay)
  })
}

function matchesCredentialTemplate(value: string, template: string): boolean {
  try {
    return new RegExp(template).test(value)
  } catch {
    return false
  }
}

/**
 * Format a stored org number for an Enable Banking credential field. Uses the
 * credential's template regex when present; otherwise Swedish display format.
 */
export function formatCredentialValue(
  credential: AuthMethodCredential,
  orgNumberRaw: string,
): string | undefined {
  const cleaned = stripOrgNumberFormatting(orgNumberRaw)
  const ten = /^\d{12}$/.test(cleaned) ? cleaned.substring(2) : cleaned
  if (!/^\d{10}$/.test(ten)) return undefined

  const display = formatOrgNumberDisplay(ten)
  const template = credential.template
  if (!template) return display

  const candidates = [
    display,
    ten,
    `${ten.substring(0, 7)}-${ten.substring(7, 8)}`,
    `${ten.substring(0, 7)}-${ten.substring(7)}`,
  ]

  for (const candidate of candidates) {
    if (matchesCredentialTemplate(candidate, template)) return candidate
  }

  return display
}

export interface ConnectAuthCredentialResult {
  authMethod?: string
  credentials?: Record<string, string>
}

/**
 * Resolve auth_method + org-number credentials for POST /auth. Enable Banking
 * requires auth_method when credentials are sent; credentials_autosubmit:false
 * pre-fills the bank form without submitting it.
 */
export function buildBusinessOrgCredentials(
  authMethods: AuthMethodWithCredentials[] | undefined,
  preferredMethod: AuthMethodWithCredentials | undefined,
  psuType: 'personal' | 'business',
  orgNumber: string | null | undefined,
): ConnectAuthCredentialResult {
  if (psuType !== 'business' || !orgNumber?.trim()) {
    return { authMethod: preferredMethod?.name }
  }

  if (preferredMethod) {
    const credential = findOrgNumberCredential(preferredMethod.credentials)
    if (credential) {
      const value = formatCredentialValue(credential, orgNumber)
      if (value) {
        return {
          authMethod: preferredMethod.name,
          credentials: { [credential.name]: value },
        }
      }
    }
    return { authMethod: preferredMethod.name }
  }

  const defaultMethod = authMethods?.find(
    (method) =>
      isAuthMethodApplicableToPsu(method, psuType) &&
      method.hidden_method !== true &&
      findOrgNumberCredential(method.credentials),
  )
  if (!defaultMethod) return {}

  const credential = findOrgNumberCredential(defaultMethod.credentials)
  if (!credential) return {}

  const value = formatCredentialValue(credential, orgNumber)
  if (!value) return {}

  return {
    authMethod: defaultMethod.name,
    credentials: { [credential.name]: value },
  }
}
