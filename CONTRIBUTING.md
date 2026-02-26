# Contributing to Adyen Web Inspector

Thank you for your interest in contributing! This guide will help you get set up and explain the conventions used in this project.

---

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9
- **Chrome** (or Chromium) for manual testing and E2E tests

## Setup

```bash
git clone <your-fork-or-origin-url>
cd adyen-web-inspector
pnpm install
```

This will also install Git hooks via Husky.

---

## Development Workflow

### 1. Create a branch

```bash
git checkout -b feat/your-feature
```

### 2. Develop

```bash
pnpm dev    # Vite watch mode → dist/
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions` (Developer mode on).

### 3. Validate before committing

```bash
pnpm validate
```

This runs (in order): `typecheck` → `lint` → `format:check` → `depcruise` → `knip` → `test`.
`lint` includes TypeScript linting and Markdown linting.

### 4. Commit

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint.

```text
feat: add new check for locale validation
fix: correct CSP frame-src domain matching
test: add missing environment mismatch cases
docs: update README with export instructions
chore: bump vitest to 3.1
refactor: extract score calculation into shared utility
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `ci`, `build`, `revert`.

The subject must be lower-case and the header must not exceed 100 characters.

### 5. Push & open a PR

CI will run all validation steps automatically.

---

## Code Style

This project uses [gts](https://github.com/google/gts) (Google TypeScript Style) which configures ESLint and Prettier.

Key conventions:

- **TypeScript strict mode** — `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`.
- **Prefer `globalThis`** over `window` for globals.
- **Use `node:` prefix** for Node.js built-in imports (e.g. `import {resolve} from 'node:path'`).
- **CSS Modules** — access styles via a helper: `const s = (key: string) => styles[key] ?? ''` to satisfy `noPropertyAccessFromIndexSignature`.
- **No nested ternaries** — use `if`/`else` or extract helper functions.
- **`String#replaceAll()`** over regex-based `String#replace()`.
- **`element.remove()`** over `parent.removeChild(element)`.
- **Preact** — use `jsxImportSource: preact`, no manual `import {h}` needed.

### Pre-commit Hook

Husky + lint-staged automatically run:

- `eslint --fix` + `prettier --write` on staged `.ts` / `.tsx` files
- `markdownlint-cli2 --fix` + `prettier --write` on staged `.md` files
- `prettier --write` on staged `.css`, `.html`, `.json`, `.yaml`, and `.yml` files

---

## Architecture Rules

Module boundaries are enforced by [dependency-cruiser](https://github.com/sverweij/dependency-cruiser):

- `popup/` cannot import from `background/` or `devtools/`
- `devtools/` cannot import from `background/` or `content/`
- `devtools/` may only import from `popup/components/` within `popup/`
- `content/` cannot import from `background/`, `popup/`, or `devtools/`
- `shared/` cannot import from any other layer
- Check modules (`background/checks/`) may only import from `shared/` and `background/checks/`

Run `pnpm depcruise` to verify.

---

## Writing a Check

Every check is a **pure function** — synchronous, no side effects, independently testable.

### 1. Create the check

Add or extend a file in `src/background/checks/`. Each check implements:

```typescript
interface Check {
  id: string;
  category: CheckCategory;
  run(payload: ScanPayload): CheckResult;
}
```

Use the check registry helper (`createRegistry`) and the runner context helpers (`pass`, `fail`, `warn`, `notice`, `skip`, `info`):

```typescript
export const SECURITY_CHECKS = createRegistry('security')
  .add('my-check', (_payload, { pass, fail }) => {
    if (/* condition */) {
      return fail('Explain the issue', 'Optional detail', 'How to fix', 'https://docs...');
    }
    return pass('All good.');
  })
  .getChecks();
```

### 2. Register the check

Add it to the module's exported array (e.g. `SECURITY_CHECKS` or `CSP_CHECKS`) and ensure it's included in `src/background/checks/index.ts` → `ALL_CHECKS`.

### 3. Write tests

Create or update a test file in `tests/unit/checks/`. Use the fixture factories from `tests/fixtures/makeScanPayload.ts`:

```typescript
import { makeScanPayload, makeAdyenPayload, makePageExtract } from '../../fixtures/makeScanPayload';

it('fails when ...', () => {
  const payload = makeScanPayload({ ... });
  expect(myCheck.run(payload).severity).toBe('fail');
});
```

**Coverage target:** 95% lines/functions/statements and 90% branches on `src/background/checks/**`, enforced in CI.

### 4. Update the check catalog

Add the check to `docs/architecture/check-catalog.md`.
`tests/unit/docs/check-catalog.test.ts` enforces this catalog against `ALL_CHECKS` and will fail if docs drift.

---

## Testing

### Unit tests

```bash
pnpm test              # Run once
pnpm test:watch        # Watch mode
pnpm test:coverage     # With V8 coverage report
```

Tests live in `tests/unit/` and use [Vitest](https://vitest.dev) with a `jsdom` environment.

### E2E tests

```bash
pnpm test:e2e          # Playwright + Chromium
```

E2E tests load the built extension (`dist/`) into a Chromium persistent context and verify popup/panel rendering against fixture pages.

### Dead code

```bash
pnpm knip
```

[knip](https://knip.dev) detects unused exports, unreferenced files, and redundant dependencies.

---

## CI

GitHub Actions runs the full validation pipeline on every push and PR:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm format:check`
5. `pnpm depcruise`
6. `pnpm knip`
7. `pnpm test:coverage`
8. `pnpm build`
9. `pnpm test:e2e`
10. Upload `dist/` as artifact

---

## Reporting Issues

Please open a GitHub issue with:

- Steps to reproduce
- Expected vs actual behaviour
- Chrome version and OS
- Extension version (from `public/manifest.json`)

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
