import { describe, expect, it } from 'vitest';

import type { HardwareAccel } from '../docker';
import { evaluateTranscoding } from './transcoding.check';

const VAAPI: HardwareAccel = { kind: 'vaapi', renderGid: 105 };
const NVIDIA: HardwareAccel = { kind: 'nvidia' };

describe('evaluateTranscoding', () => {
  it('reports the detected VAAPI device without a mode', () => {
    const result = evaluateTranscoding({ hardware: VAAPI });

    expect(result).toMatchObject({ id: 'transcoding', name: 'Transcoding', status: 'success' });
    expect(result.message).toBe('GPU detected: VAAPI (/dev/dri/renderD128)');
  });

  it('succeeds without a mode and without a GPU', () => {
    const result = evaluateTranscoding({});

    expect(result.status).toBe('success');
    expect(result.message).toBe('No GPU detected (/dev/dri/renderD128 or nvidia-smi)');
  });

  it.each([undefined, NVIDIA])('succeeds in off mode with hardware %j', (hardware) => {
    const result = evaluateTranscoding({ mode: 'off', hardware });

    expect(result.status).toBe('success');
    expect(result.message).toContain('Direct Play only, nothing is transcoded.');
  });

  it('succeeds in cpu mode with a GPU and suggests hardware', () => {
    const result = evaluateTranscoding({ mode: 'cpu', hardware: VAAPI });

    expect(result.status).toBe('success');
    expect(result.suggestion).toContain('"hardware"');
  });

  it('warns in cpu mode without a GPU and suggests off', () => {
    const result = evaluateTranscoding({ mode: 'cpu' });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('the CPU may saturate');
    expect(result.suggestion).toContain('"off"');
  });

  it.each([
    [VAAPI, 'VAAPI (/dev/dri/renderD128)'],
    [NVIDIA, 'NVIDIA (nvidia-smi)'],
  ])('succeeds in hardware mode with %j', (hardware, label) => {
    const result = evaluateTranscoding({ mode: 'hardware', hardware });

    expect(result.status).toBe('success');
    expect(result.message).toContain(label);
  });

  it('fails in hardware mode without a GPU', () => {
    const result = evaluateTranscoding({ mode: 'hardware' });

    expect(result.status).toBe('error');
    expect(result.message).toBe(
      'Hardware transcoding is selected but no GPU was found (/dev/dri/renderD128 or nvidia-smi)',
    );
    expect(result.suggestion).toBe('Choose "cpu" or "off", or install the GPU drivers.');
  });
});
