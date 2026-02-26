---
name: add-check
description: Scaffold a new best-practice check module for the Adyen Web Inspector. Use when asked to add a check, rule, or best-practice validation.
---

# Add Check Skill

## Adding a Check

When creating a new check, follow these steps exactly:

### 1. Register the Check ID

Add a new entry to the `CheckId` union in `src/shared/types.ts` under the appropriate comment section.

### 2. Create the check module

Create `src/background/checks/<kebab-name>.ts`:

```typescript
/**
 * Category N — <Category> checks.
 */

import type { Check, CheckResult, ScanPayload } from '../../shared/types.js';
import { pass, fail, warn, info, skip, notice } from '../../shared/utils.js';

const CATEGORY = '<category>' as const;

const myCheck: Check = {
  id: '<check-id>',
  category: CATEGORY,
  run(payload: ScanPayload): CheckResult {
    // ... logic ...
    return pass({
      id: '<check-id>',
      category: CATEGORY,
      title: 'One-sentence plain-language finding.',
    });
  },
};

export const MY_CHECKS: Check[] = [myCheck];
```

**Rules:**

- Individual check objects are NOT exported — only the barrel array is exported
- Use `pass/fail/warn/info/skip/notice` factories from `../../shared/utils.js`
- `notice` = "cannot verify" state (distinct from `info`)
- Category choices: `sdk-identity` | `version-lifecycle` | `environment` | `auth` | `callbacks` | `risk` | `security` | `third-party`

### 3. Register in the check index

Add to `src/background/checks/index.ts`:

```typescript
import { MY_CHECKS } from './my-check.js';
// ...
export const ALL_CHECKS: Check[] = [
  // ... existing ...
  ...MY_CHECKS,
];
```

### 4. Write tests

Create `tests/unit/checks/<kebab-name>.test.ts` using the fixture factory:

```typescript
import { describe, it, expect } from 'vitest';
import { MY_CHECKS } from '../../../src/background/checks/my-check.js';
import { makeAdyenPayload } from '../../fixtures/makeScanPayload.js';

const [myCheck] = MY_CHECKS;

describe('my-check', () => {
  it('passes when ...', () => {
    const payload = makeAdyenPayload({
      /* overrides */
    });
    const result = myCheck.run(payload);
    expect(result.severity).toBe('pass');
    expect(result.id).toBe('<check-id>');
  });

  it('fails when ...', () => {
    const payload = makeAdyenPayload({
      /* overrides */
    });
    const result = myCheck.run(payload);
    expect(result.severity).toBe('fail');
  });
});
```

### 5. Verify

Run `pnpm validate` — all checks must pass before the work is complete.
