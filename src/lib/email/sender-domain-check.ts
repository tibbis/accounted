/**
 * Whether an address's domain may be used as a company From.
 *
 * Core cannot import the email extension, and a deployment may send through
 * Resend or SMTP. The extension registers the check when it loads. Until
 * then the verdict is `unknown`: an explicit company From is refused rather
 * than sent as the instance default (which, on a multi-company host, is
 * another company's address).
 */

export type SenderDomainVerdict = 'verified' | 'unverified' | 'unknown'

export type SenderDomainChecker = (domain: string) => Promise<SenderDomainVerdict>

const unknownChecker: SenderDomainChecker = async () => 'unknown'

let checker: SenderDomainChecker = unknownChecker

export function registerSenderDomainChecker(next: SenderDomainChecker): void {
  checker = next
}

/** Tests only: drop a checker the email extension or a test registered. */
export function resetSenderDomainCheckerForTests(): void {
  checker = unknownChecker
}

export function checkSenderDomain(domain: string): Promise<SenderDomainVerdict> {
  return checker(domain)
}
