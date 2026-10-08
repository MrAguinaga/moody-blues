import {
  createLayout,
  type MbHomeLayout,
  type MoodyBluesConfig,
  readEnv,
  readState,
  resolveMbHome,
} from '@moody-blues/provisioner';

export interface Installation {
  layout: MbHomeLayout;
  config: MoodyBluesConfig;
  env: Record<string, string>;
}

export interface LoadInstallationOptions {
  home?: string;
}

export function loadInstallation(options: LoadInstallationOptions = {}): Installation {
  const layout = createLayout(resolveMbHome({ explicit: options.home }));

  const config = readState(layout.stateFile);
  if (!config) {
    throw new Error('Moody Blues is not set up yet. Run "moody-blues setup" first.');
  }

  const env = readEnv(layout.envFile);
  if (!env.MB_HOME) {
    throw new Error(
      `The environment file ${layout.envFile} is missing or incomplete. Run "moody-blues setup" again.`,
    );
  }

  return { layout, config, env };
}
