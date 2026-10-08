import { describe, expect, it } from 'vitest';

import { compareResolutions, evaluateDns, expectedHostnames, parsePublicIp } from './dns.check';

const PUBLIC_IP = '203.0.113.10';

describe('expectedHostnames', () => {
  it('lists the apex, watch and discover names', () => {
    expect(expectedHostnames('example.com')).toEqual([
      'example.com',
      'watch.example.com',
      'discover.example.com',
    ]);
  });
});

describe('parsePublicIp', () => {
  it('accepts an IPv4 address with surrounding whitespace', () => {
    expect(parsePublicIp(' 203.0.113.10\n')).toBe(PUBLIC_IP);
  });

  it.each(['', '<html>blocked</html>', '2001:db8::1', '1.2.3'])('rejects %j', (body) => {
    expect(parsePublicIp(body)).toBeUndefined();
  });
});

describe('compareResolutions', () => {
  it('separates unresolved names from names pointing elsewhere', () => {
    const result = compareResolutions(
      {
        'example.com': [PUBLIC_IP],
        'watch.example.com': [],
        'discover.example.com': ['198.51.100.7'],
      },
      PUBLIC_IP,
    );

    expect(result).toEqual({
      unresolved: ['watch.example.com'],
      mismatched: ['discover.example.com'],
    });
  });

  it('accepts a name with several addresses when one matches', () => {
    expect(compareResolutions({ 'example.com': ['198.51.100.7', PUBLIC_IP] }, PUBLIC_IP)).toEqual({
      unresolved: [],
      mismatched: [],
    });
  });

  it('does not report mismatches when the public IP is unknown', () => {
    expect(compareResolutions({ 'example.com': ['198.51.100.7'] }, undefined)).toEqual({
      unresolved: [],
      mismatched: [],
    });
  });
});

describe('evaluateDns', () => {
  const pointingHere = {
    'example.com': [PUBLIC_IP],
    'watch.example.com': [PUBLIC_IP],
    'discover.example.com': [PUBLIC_IP],
  };

  it('succeeds when every name points to the public IP', () => {
    expect(evaluateDns(pointingHere, PUBLIC_IP).status).toBe('success');
  });

  it('fails when a name does not resolve', () => {
    const result = evaluateDns({ ...pointingHere, 'watch.example.com': [] }, PUBLIC_IP);

    expect(result.status).toBe('error');
    expect(result.message).toContain('watch.example.com');
  });

  it('fails when a name points to another IP', () => {
    const result = evaluateDns({ ...pointingHere, 'example.com': ['198.51.100.7'] }, PUBLIC_IP);

    expect(result.status).toBe('error');
    expect(result.message).toContain('example.com -> 198.51.100.7');
  });

  it('warns when the public IP cannot be determined and everything resolves', () => {
    expect(evaluateDns(pointingHere, undefined).status).toBe('warning');
  });

  it('still fails on unresolved names without a public IP', () => {
    expect(evaluateDns({ ...pointingHere, 'example.com': [] }, undefined).status).toBe('error');
  });
});
