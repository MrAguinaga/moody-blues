import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const SERVICE_NAMES = [
  'caddy',
  'decypharr',
  'jellyfin',
  'seerr',
  'sonarr',
  'radarr',
  'prowlarr',
  'bazarr',
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface MbHomeLayout {
  root: string;
  stateFile: string;
  envFile: string;
  configDir: string;
  cacheDir: string;
  mntDir: string;
  debridMountDir: string;
  dataDir: string;
  downloadsDir: string;
  mediaDir: string;
  configFor(service: ServiceName): string;
}

export interface ResolveMbHomeOptions {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

export function resolveMbHome(options: ResolveMbHomeOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const fromOption = options.explicit?.trim();
  if (fromOption) {
    return resolve(fromOption);
  }

  const fromEnv = env.MB_HOME?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }

  if (platform === 'linux') {
    return '/opt/moody-blues';
  }
  return join(options.homeDir ?? homedir(), '.moody-blues');
}

export function createLayout(root: string): MbHomeLayout {
  const configDir = join(root, 'config');
  const mntDir = join(root, 'mnt');
  const dataDir = join(root, 'data');

  return {
    root,
    stateFile: join(root, 'moody-blues.json'),
    envFile: join(root, '.env'),
    configDir,
    cacheDir: join(root, 'cache'),
    mntDir,
    debridMountDir: join(mntDir, 'debrid'),
    dataDir,
    downloadsDir: join(dataDir, 'downloads'),
    mediaDir: join(dataDir, 'media'),
    configFor: (service) => join(configDir, service),
  };
}
