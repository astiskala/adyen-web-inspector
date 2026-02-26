/**
 * Version parsing and comparison utilities.
 */

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parses a semver-like `major.minor.patch` string into numeric parts.
 * Returns `null` when the input does not start with three numeric segments.
 */
export function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  const [, majorText, minorText, patchText] = match;
  if (majorText === undefined || minorText === undefined || patchText === undefined) {
    return null;
  }
  return {
    major: Number.parseInt(majorText, 10),
    minor: Number.parseInt(minorText, 10),
    patch: Number.parseInt(patchText, 10),
  };
}

/** Returns positive if a > b, negative if a < b, 0 if equal. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
