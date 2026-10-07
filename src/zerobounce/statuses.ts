/**
 * ZeroBounce status / sub-status reference and plain-English verdicts.
 * Source: https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-status-codes
 */

export type Verdict = 'SAFE' | 'RISKY' | 'UNVERIFIED' | 'WILL BOUNCE' | 'DO NOT SEND';

export const STATUS_INFO: Record<string, { verdict: Verdict; meaning: string }> = {
  valid: {
    verdict: 'SAFE',
    meaning: 'The mailbox exists and accepts mail.',
  },
  'catch-all': {
    verdict: 'RISKY',
    meaning: "The domain accepts mail for any address, so this mailbox can't be confirmed.",
  },
  unknown: {
    verdict: 'UNVERIFIED',
    meaning: "ZeroBounce couldn't get a clear answer from the mail server. No credit is charged; try again later.",
  },
  invalid: {
    verdict: 'WILL BOUNCE',
    meaning: 'The address is not deliverable.',
  },
  spamtrap: {
    verdict: 'DO NOT SEND',
    meaning: 'Believed to be a spam trap. Mailing it can damage your sender reputation.',
  },
  abuse: {
    verdict: 'DO NOT SEND',
    meaning: 'Belongs to someone known to report email as spam/abuse.',
  },
  do_not_mail: {
    verdict: 'DO NOT SEND',
    meaning: "The address exists but shouldn't be mailed (see the sub-status for why).",
  },
};

export const SUB_STATUS_INFO: Record<string, string> = {
  // valid
  alias_address: 'An alias that forwards to another mailbox.',
  leading_period_removed: 'A leading period was removed from a Gmail address.',
  alternate: 'A secondary/alternate address for the same person.',
  gold: 'A high-engagement contact.',
  accept_all: "The domain is on ZeroBounce's vetted accept-all list, so it is treated as valid.",
  role_based_accept_all: 'A role-based address on an accept-all domain.',
  ai_agent_mailbox: 'A mailbox operated by an AI agent.',
  allowed: 'Matched one of your allow filters.',
  // invalid
  mailbox_not_found: "The mailbox doesn't exist.",
  does_not_accept_mail: "The domain only sends mail and doesn't receive it.",
  failed_syntax_check: "The address isn't formatted correctly.",
  possible_typo: 'Looks like a misspelling of a popular domain.',
  no_dns_entries: 'The domain has missing or incomplete DNS records.',
  mailbox_quota_exceeded: 'The mailbox is full.',
  unroutable_ip_address: "The domain points to an IP address that can't receive mail.",
  // unknown
  antispam_system: "The mail server's anti-spam system blocked verification.",
  exception_occurred: 'An error occurred during verification.',
  failed_smtp_connection: "Couldn't connect to the mail server.",
  forcible_disconnect: 'The mail server disconnected during verification.',
  greylisted: 'The mail server temporarily deferred the check (greylisting).',
  mail_server_did_not_respond: "The mail server didn't respond.",
  mail_server_temporary_error: 'The mail server returned a temporary error.',
  timeout_exceeded: 'Verification timed out.',
  // do_not_mail
  role_based: 'A role/group address such as sales@ or info@.',
  disposable: 'A temporary/disposable address.',
  toxic: 'Known for abuse, spam or bot activity.',
  role_based_catch_all: 'A role-based address on a catch-all domain.',
  global_suppression: 'On a global suppression list (people known to complain or bounce).',
  possible_trap: 'Contains keywords that suggest a spam trap.',
  mx_forward: 'The domain forwards mail through an MX forwarding service (often used like a disposable).',
  blocked: 'Matched one of your block filters.',
};

export function describeStatus(status: string | undefined, subStatus?: string | null) {
  const key = (status || '').toLowerCase();
  const info = STATUS_INFO[key] ?? { verdict: 'UNVERIFIED' as Verdict, meaning: `Unrecognised status "${status}".` };
  const sub = (subStatus || '').toLowerCase();
  return {
    verdict: info.verdict,
    meaning: info.meaning,
    subStatusMeaning: sub ? SUB_STATUS_INFO[sub] ?? `Sub-status "${sub}".` : undefined,
  };
}

/**
 * Test addresses that return a fixed result without using credits.
 * Source: https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-sandbox-mode
 */
export const SANDBOX_EMAILS = [
  'valid@example.com',
  'invalid@example.com',
  'catch_all@example.com',
  'unknown@example.com',
  'spamtrap@example.com',
  'abuse@example.com',
  'donotmail@example.com',
  'disposable@example.com',
  'toxic@example.com',
  'role_based@example.com',
  'possible_typo@example.com',
] as const;
