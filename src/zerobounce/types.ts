/**
 * ZeroBounce response types.
 *
 * ZeroBounce's types are loose (numbers sometimes arrive as strings, booleans as
 * "true"/"True", new fields appear over time), so these interfaces only list the
 * fields we read, and every response keeps an index signature for anything else.
 */

export type Loose = Record<string, unknown>;

export interface ValidateResult extends Loose {
  address: string;
  status: string;
  sub_status: string;
  free_email?: boolean | string;
  did_you_mean?: string | null;
  account?: string | null;
  domain?: string | null;
  domain_age_days?: string | number | null;
  smtp_provider?: string | null;
  mx_found?: boolean | string;
  mx_record?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  gender?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  zipcode?: string | null;
  processed_at?: string;
  active_in_days?: string | number | null;
  active_first_seen?: string | null;
  domain_website_exists?: boolean | string | null;
  domain_registrant_company_name?: string | null;
}

export interface BatchResult {
  email_batch: ValidateResult[];
  errors: Array<{ error: string; email_address: string }>;
}

export interface ApiUsage extends Loose {
  total?: number;
  start_date?: string;
  end_date?: string;
}

export interface ActivityResult extends Loose {
  found: boolean;
  active_first_seen?: string | null;
  active_in_days?: string | number | null;
}

export interface ScoreResult extends Loose {
  email: string;
  score: number | string;
}

export interface GuessFormatResult extends Loose {
  email?: string;
  email_confidence?: string;
  domain?: string;
  company_name?: string;
  format?: string;
  confidence?: string;
  did_you_mean?: string;
  failure_reason?: string;
  other_domain_formats?: Array<{ format: string; confidence: string }>;
}

export interface FilterRule {
  rule: 'allow' | 'block' | string;
  target: 'email' | 'domain' | 'mx' | 'tld' | string;
  value: string;
}

export interface FileSubmitResult extends Loose {
  success?: boolean | string;
  message?: string;
  file_name?: string;
  file_id?: string;
}

export interface FileStatusResult extends Loose {
  success?: boolean | string;
  file_id?: string;
  file_name?: string;
  upload_date?: string;
  file_status?: string;
  file_phase_2_status?: string;
  complete_percentage?: string;
  error_reason?: string | null;
  return_url?: string | null;
}

export interface ListEvaluatorResult extends Loose {
  file_id?: string;
  status?: string;
  progress?: number | string;
  invalid_percentage?: number | string;
  catch_all_percentage?: number | string;
  activity_data_percentage?: number | string;
  abuse?: number | string;
  do_not_mail?: number | string;
  spam_trap?: number | string;
  total_risky_percentage?: number | string;
  error_message?: string | null;
}
