const UNIT_EXPONENTS: Record<string, number> = { '': 0, K: 1, M: 2, G: 3, T: 4 };

export function parseSizeBytes(size: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT]?)(?:I?B)?$/i.exec(size.trim());
  if (!match) {
    throw new Error(`Invalid size "${size}"`);
  }
  const exponent = UNIT_EXPONENTS[match[2]!.toUpperCase()]!;
  return Math.floor(Number(match[1]) * 1024 ** exponent);
}
