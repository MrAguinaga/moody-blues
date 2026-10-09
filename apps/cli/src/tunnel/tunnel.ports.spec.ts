import { createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { isPortFree, probePort } from './tunnel.service';

let server: Server | undefined;

function listen(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket) => socket.end());
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server?.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function close(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server = undefined;
  });
}

afterEach(close);

describe('local port helpers', () => {
  it('sees a port held by a listener as busy and accepting connections', async () => {
    const port = await listen();

    expect(await isPortFree(port)).toBe(false);
    expect(await probePort(port)).toBe(true);
  });

  it('sees a released port as free and refusing connections', async () => {
    const port = await listen();
    await close();

    expect(await isPortFree(port)).toBe(true);
    expect(await probePort(port)).toBe(false);
  });
});
