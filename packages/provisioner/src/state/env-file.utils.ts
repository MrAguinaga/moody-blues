import { ENV_KEY_ORDER } from './env-keys.constants';

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNQUOTED_SAFE_PATTERN = /^[A-Za-z0-9_@%+=:,./-]*$/;
const DOUBLE_QUOTE_ESCAPES: Record<string, string> = { n: '\n', '"': '"', '\\': '\\' };

function parseDoubleQuoted(raw: string, lineNumber: number): string {
  let value = '';
  for (let index = 1; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      return value;
    }
    if (char === '\\' && index + 1 < raw.length) {
      const next = raw[index + 1];
      value += DOUBLE_QUOTE_ESCAPES[next] ?? `\\${next}`;
      index++;
    } else {
      value += char;
    }
  }
  throw new Error(`Unterminated double quote on line ${lineNumber}`);
}

function parseValue(raw: string, lineNumber: number): string {
  if (raw.startsWith('"')) {
    return parseDoubleQuoted(raw, lineNumber);
  }
  if (raw.startsWith("'")) {
    const end = raw.indexOf("'", 1);
    if (end === -1) {
      throw new Error(`Unterminated single quote on line ${lineNumber}`);
    }
    return raw.slice(1, end);
  }
  const commentStart = raw.search(/\s#/);
  return (commentStart === -1 ? raw : raw.slice(0, commentStart)).trim();
}

export function parseEnvFile(text: string): Record<string, string> {
  const record: Record<string, string> = {};
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const lineNumber = index + 1;
    const assignment = line.replace(/^export\s+/, '');
    const separator = assignment.indexOf('=');
    const key = separator === -1 ? '' : assignment.slice(0, separator).trim();
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`Invalid assignment on line ${lineNumber}`);
    }
    record[key] = parseValue(assignment.slice(separator + 1).trim(), lineNumber);
  });

  return record;
}

function quoteValue(value: string): string {
  if (UNQUOTED_SAFE_PATTERN.test(value)) {
    return value;
  }
  if (!value.includes("'") && !value.includes('\n')) {
    return `'${value}'`;
  }
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

export function serializeEnvFile(record: Record<string, string>): string {
  const known = ENV_KEY_ORDER.filter((key) => key in record);
  const unknown = Object.keys(record)
    .filter((key) => !ENV_KEY_ORDER.includes(key))
    .sort();

  return [...known, ...unknown].map((key) => `${key}=${quoteValue(record[key])}`).join('\n') + '\n';
}
