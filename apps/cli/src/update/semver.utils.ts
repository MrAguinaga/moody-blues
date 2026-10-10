const SEMVER_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
const NUMERIC_PATTERN = /^\d+$/;

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function parseSemver(text: string): Semver | undefined {
  const match = SEMVER_PATTERN.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

export function normalizeVersion(text: string): string | undefined {
  const parsed = parseSemver(text);
  if (!parsed) {
    return undefined;
  }
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease.length > 0 ? `${core}-${parsed.prerelease.join('.')}` : core;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = NUMERIC_PATTERN.test(left);
  const rightNumeric = NUMERIC_PATTERN.test(right);

  if (leftNumeric && rightNumeric) {
    return Math.sign(Number(left) - Number(right));
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return Math.sign(right.length - left.length);
  }
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const result = comparePrereleaseIdentifier(left[index] as string, right[index] as string);
    if (result !== 0) {
      return result;
    }
  }
  return Math.sign(left.length - right.length);
}

export function compareSemver(left: Semver, right: Semver): number {
  return (
    Math.sign(left.major - right.major) ||
    Math.sign(left.minor - right.minor) ||
    Math.sign(left.patch - right.patch) ||
    comparePrerelease(left.prerelease, right.prerelease)
  );
}
