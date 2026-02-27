import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOWS_DIR = resolve('.github/workflows');
const SHA_PATTERN = /^[a-f0-9]{40}$/;

function isWorkflowYamlPath(filePath) {
  return filePath.endsWith('.yml') || filePath.endsWith('.yaml');
}

function isWorkflowFilePath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  return normalized.startsWith('.github/workflows/') || normalized.includes('/.github/workflows/');
}

function normalizeValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function collectWorkflowFilesFromArgs() {
  const args = process.argv.slice(2);
  const workflowArgFiles = args.filter((filePath) => {
    const normalized = filePath.replaceAll('\\', '/');
    return isWorkflowFilePath(normalized) && isWorkflowYamlPath(normalized);
  });

  if (workflowArgFiles.length > 0) {
    return workflowArgFiles.map((filePath) => resolve(filePath));
  }

  return readdirSync(WORKFLOWS_DIR)
    .filter((fileName) => isWorkflowYamlPath(fileName))
    .map((fileName) => resolve(WORKFLOWS_DIR, fileName));
}

function isExternalAction(ref) {
  return !ref.startsWith('./') && !ref.startsWith('docker://');
}

function validateActionReference(filePath, lineNumber, ref) {
  if (!ref.includes('@')) {
    return `${filePath}:${lineNumber} uses "${ref}" without a pinned commit SHA`;
  }

  const atIndex = ref.lastIndexOf('@');
  const revision = ref.slice(atIndex + 1);
  if (!SHA_PATTERN.test(revision)) {
    return `${filePath}:${lineNumber} uses "${ref}" without a 40-char commit SHA`;
  }

  return null;
}

function main() {
  const failures = [];
  const workflowFiles = collectWorkflowFilesFromArgs();

  for (const filePath of workflowFiles) {
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const match = /^\s*uses:\s*([^#]+?)(?:\s+#.*)?$/.exec(line);
      if (match === null) {
        continue;
      }

      const ref = normalizeValue(match[1] ?? '');
      if (!isExternalAction(ref)) {
        continue;
      }

      const failure = validateActionReference(filePath, index + 1, ref);
      if (failure !== null) {
        failures.push(failure);
      }
    }
  }

  if (failures.length > 0) {
    console.error('GitHub Actions references must be pinned to full commit SHAs:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
}

main();
