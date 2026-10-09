import { MIN_SECRET_LENGTH, REDACTED } from './doctor.constants';

const SENSITIVE_JSON_PAIR =
  /("[^"\n]*(?:key|token|secret|password|cookie)[^"\n]*"\s*:\s*)(?:"(?:[^"\\]|\\.)*"|\[[^\]]*\])/gi;
const BEARER_CREDENTIAL = /\b(Bearer\s+)[^\s"',;]+/gi;
const QUOTED_TOKEN = /(\bToken=")[^"]*(")/g;

export function collectSecrets(values: readonly (string | undefined)[]): string[] {
  const unique = new Set(
    values.filter(
      (value): value is string => value !== undefined && value.length >= MIN_SECRET_LENGTH,
    ),
  );
  return [...unique].sort((a, b) => b.length - a.length);
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  const withoutKnown = secrets
    .filter((secret) => secret.length >= MIN_SECRET_LENGTH)
    .reduce((current, secret) => current.split(secret).join(REDACTED), text);

  return withoutKnown
    .replace(SENSITIVE_JSON_PAIR, `$1"${REDACTED}"`)
    .replace(BEARER_CREDENTIAL, `$1${REDACTED}`)
    .replace(QUOTED_TOKEN, `$1${REDACTED}$2`);
}
