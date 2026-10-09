import { maskSecrets, normalizeSecrets, REDACTED } from '../utils/redact.utils';

const SENSITIVE_JSON_PAIR =
  /("[^"\n]*(?:key|token|secret|password|cookie)[^"\n]*"\s*:\s*)(?:"(?:[^"\\]|\\.)*"|\[[^\]]*\])/gi;
const BEARER_CREDENTIAL = /\b(Bearer\s+)[^\s"',;]+/gi;
const QUOTED_TOKEN = /(\bToken=")[^"]*(")/g;

export function collectSecrets(values: readonly (string | undefined)[]): string[] {
  return normalizeSecrets(values);
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  return maskSecrets(text, secrets)
    .replace(SENSITIVE_JSON_PAIR, `$1"${REDACTED}"`)
    .replace(BEARER_CREDENTIAL, `$1${REDACTED}`)
    .replace(QUOTED_TOKEN, `$1${REDACTED}$2`);
}
