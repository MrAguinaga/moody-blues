const UNIT_EXPONENTS: Record<string, number> = { B: 0, K: 1, M: 2, G: 3, T: 4, P: 5, E: 6 };

// Mirrors the rclone size syntax, which rejects decimal style units such as "2GB":
// a multiplier letter may only be followed by "i" or "iB". A bare number is refused
// because rclone reads it as kibibytes, not bytes.
export function parseSizeBytes(size: string): number {
  const match = /^(\d+(?:\.\d+)?)(?:([bB])|([kKmMgGtTpPeE])(?:i|i[bB])?)$/.exec(size);
  if (!match) {
    throw new Error(`Invalid size "${size}": expected a value such as 512M, 2G or 2GiB`);
  }
  const unit = (match[2] ?? match[3])!.toUpperCase();
  return Math.floor(Number(match[1]) * 1024 ** UNIT_EXPONENTS[unit]!);
}
