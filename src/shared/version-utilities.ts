/**
Version parsing and comparison utilities.
*/

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
Parses a semver-like `major.minor.patch` string into numeric parts.
Returns `null` when the input does not start with three numeric segments.
*/
export function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  const [, majorText = '', minorText = '', patchText = ''] = match;
  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
  };
}

/**
Returns positive if a > b, negative if a < b, 0 if equal.
*/
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  return a.minor === b.minor ? a.patch - b.patch : a.minor - b.minor;
}

/**
Whether a version meets a minimum; `unknown` when either cannot be read.
*/
type VersionRequirement = 'met' | 'unmet' | 'unknown';

/**
Reads whether a detected version meets a minimum version.
*/
export function meetsMinimumVersion(
  version: string | null | undefined,
  minimum: string
): VersionRequirement {
  const parsed = parseVersion(version ?? '');
  const parsedMinimum = parseVersion(minimum);
  if (parsed === null || parsedMinimum === null) return 'unknown';
  return compareVersions(parsed, parsedMinimum) < 0 ? 'unmet' : 'met';
}
