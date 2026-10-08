import { createLayout, readState, resolveMbHome } from '@moody-blues/provisioner';

import type { CheckContext } from './checks.types';

export function loadCheckContext(home?: string): CheckContext {
  const layout = createLayout(resolveMbHome({ explicit: home }));

  try {
    const config = readState(layout.stateFile);
    return config
      ? { mode: config.mode, domain: config.domain, home: layout.root }
      : { home: layout.root };
  } catch {
    return { home: layout.root };
  }
}
