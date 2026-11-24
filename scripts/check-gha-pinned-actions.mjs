import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOWS_DIR = resolve('.github/workflows');
const ACTIONS_DIR = resolve('.github/actions');
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DOCKER_DIGEST_PATTERN = /@sha256:[a-f0-9]{64}$/;
/**
A `uses:` key, including the first key of a list item (`- uses:`).
*/
const USES_PATTERN = /^\s*(?:-\s+)?uses:\s*([^#]+?)(?:\s+#.*)?$/;

function isWorkflowYamlPath(filePath) {
  return filePath.endsWith('.yml') || filePath.endsWith('.yaml');
}

function isWorkflowFilePath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  return ['.github/workflows/', '.github/actions/'].some(
    (directory) => normalized.startsWith(directory) || normalized.includes(`/${directory}`)
  );
}

/**
Composite action metadata files under .github/actions, which can reference other actions.
*/
function collectActionFiles() {
  if (!existsSync(ACTIONS_DIR)) return [];
  return readdirSync(ACTIONS_DIR, { recursive: true })
    .map(String)
    .filter((path) => /(?:^|[/\\])action\.ya?ml$/.test(path))
    .map((path) => resolve(ACTIONS_DIR, path));
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

  return [
    ...readdirSync(WORKFLOWS_DIR)
      .filter((fileName) => isWorkflowYamlPath(fileName))
      .map((fileName) => resolve(WORKFLOWS_DIR, fileName)),
    ...collectActionFiles(),
  ];
}

function isLocalAction(ref) {
  return ref.startsWith('./');
}

function validateActionReference(filePath, lineNumber, ref) {
  if (ref.startsWith('docker://')) {
    return DOCKER_DIGEST_PATTERN.test(ref)
      ? null
      : `${filePath}:${lineNumber} uses "${ref}" without a pinned sha256 image digest`;
  }

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
      const match = USES_PATTERN.exec(line);
      if (match === null) {
        continue;
      }

      const ref = normalizeValue(match[1] ?? '');
      if (isLocalAction(ref)) {
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
