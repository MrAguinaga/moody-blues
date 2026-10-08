import type { SetupValues } from './setup.types';

export type QuestionKey =
  | 'mode'
  | 'domain'
  | 'acmeEmail'
  | 'rdApiToken'
  | 'adminUsername'
  | 'adminPassword'
  | 'opensubtitlesUsername'
  | 'opensubtitlesPassword'
  | 'transcoding';

export type QuestionKind = 'select' | 'text' | 'secret' | 'password';

export interface QuestionOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SetupQuestion {
  key: QuestionKey;
  kind: QuestionKind;
  label: string;
  optional: boolean;
  hint?: string;
  options?: QuestionOption[];
  validate?: (value: string) => string | undefined;
}

const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const MODE_OPTIONS: QuestionOption[] = [
  { value: 'local', label: 'Local', hint: 'this machine only, no public domain' },
  { value: 'remote', label: 'Remote', hint: 'public domain with automatic HTTPS' },
];

export const TRANSCODING_OPTIONS: QuestionOption[] = [
  { value: 'off', label: 'Off', hint: 'direct play only, lowest CPU usage (recommended)' },
  { value: 'cpu', label: 'CPU', hint: 'software transcoding' },
  { value: 'hardware', label: 'Hardware', hint: 'GPU acceleration (VAAPI or NVIDIA)' },
];

const QUESTIONS: (SetupQuestion & { applies: (known: SetupValues) => boolean })[] = [
  {
    key: 'mode',
    kind: 'select',
    label: 'Deployment mode',
    optional: false,
    options: MODE_OPTIONS,
    applies: (known) => known.mode === undefined,
  },
  {
    key: 'domain',
    kind: 'text',
    label: 'Public domain (for example example.com)',
    optional: false,
    validate: (value) => (DOMAIN_PATTERN.test(value) ? undefined : 'Enter a valid domain name'),
    applies: (known) => known.mode === 'remote' && known.domain === undefined,
  },
  {
    key: 'acmeEmail',
    kind: 'text',
    label: 'Email for HTTPS certificate notices',
    optional: true,
    hint: 'optional',
    validate: (value) => (EMAIL_PATTERN.test(value) ? undefined : 'Enter a valid email address'),
    applies: (known) => known.mode === 'remote' && known.acmeEmail === undefined,
  },
  {
    key: 'rdApiToken',
    kind: 'secret',
    label: 'Real-Debrid API token',
    optional: false,
    applies: (known) => known.rdApiToken === undefined,
  },
  {
    key: 'adminUsername',
    kind: 'text',
    label: 'Admin username',
    optional: false,
    applies: (known) => known.adminUsername === undefined,
  },
  {
    key: 'adminPassword',
    kind: 'password',
    label: 'Admin password',
    optional: false,
    applies: (known) => known.adminPassword === undefined,
  },
  {
    key: 'opensubtitlesUsername',
    kind: 'text',
    label: 'OpenSubtitles username',
    optional: true,
    hint: 'optional, press Enter to skip',
    applies: (known) => known.opensubtitlesUsername === undefined,
  },
  {
    key: 'opensubtitlesPassword',
    kind: 'secret',
    label: 'OpenSubtitles password',
    optional: false,
    applies: (known) =>
      known.opensubtitlesUsername !== undefined && known.opensubtitlesPassword === undefined,
  },
  {
    key: 'transcoding',
    kind: 'select',
    label: 'Video transcoding',
    optional: false,
    options: TRANSCODING_OPTIONS,
    applies: (known) => known.transcoding === undefined,
  },
];

export function nextSetupQuestion(
  known: SetupValues,
  answered: ReadonlySet<QuestionKey>,
): SetupQuestion | undefined {
  return QUESTIONS.find(({ key, applies }) => !answered.has(key) && applies(known));
}
