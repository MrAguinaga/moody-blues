import type { MoodyBluesConfig, UserSecrets } from '@moody-blues/provisioner';

export interface SetupValues {
  mode?: string;
  domain?: string;
  acmeEmail?: string;
  acmeStaging?: boolean;
  transcoding?: string;
  rdApiToken?: string;
  adminUsername?: string;
  adminPassword?: string;
  opensubtitlesUsername?: string;
  opensubtitlesPassword?: string;
}

export interface SetupSources {
  answers?: SetupValues;
  flags: SetupValues;
  envFile: SetupValues;
  previous: SetupValues;
  previousConfig?: MoodyBluesConfig;
  ignoredKeys: string[];
}

export interface SetupInput {
  config: MoodyBluesConfig;
  secrets: UserSecrets;
}

export interface SetupIssue {
  key: string;
  problem: 'missing' | 'invalid';
  message: string;
}

export type SetupResolution =
  | { complete: true; input: SetupInput; ignoredKeys: string[] }
  | { complete: false; issues: SetupIssue[]; draft: SetupValues; ignoredKeys: string[] };

export interface SetupResolverDeps {
  detectStorage(): Promise<boolean>;
}
