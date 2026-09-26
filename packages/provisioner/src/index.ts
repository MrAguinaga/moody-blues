/**
 * @moody-blues/provisioner
 * Headless API pre-seeding and provisioning engine.
 */

import pkg from '../package.json' with { type: 'json' };

export const PROVISIONER_VERSION: string = pkg.version;

export interface ProvisionerConfig {
  domain: string;
  isLocalhost: boolean;
  realDebridToken?: string;
}

export function createProvisioner(config: ProvisionerConfig) {
  return {
    config,
    version: PROVISIONER_VERSION,
  };
}
