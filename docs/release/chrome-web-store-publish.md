# Chrome Web Store Publish Checklist

Last updated: 2026-02-26

## 0. Account prerequisites

1. Register a Chrome Web Store developer account.
2. Enable 2-Step Verification on the publisher Google account.
3. Complete fee payment and account verification in the dashboard.

## 1. Prepare extension package

Prerequisites:

- `zip` (used by `scripts/package-chrome.sh`)
- `rsvg-convert` (from `librsvg`) if regenerating icons

1. Regenerate extension icons from source branding (optional but recommended for a visual release):

```bash
pnpm icons:generate
```

1. Run the quality gate and build:

```bash
pnpm validate
pnpm build
```

1. Create the upload ZIP:

```bash
pnpm package:chrome
```

Upload artifact:

- `release/adyen-web-inspector-v<version>.zip`

## 2. Prepare listing assets

Current repository assets live in `store-assets/`:

- `chrome-store-icon-128.png`
- `chrome-store-small-promo-440x280.png`
- `chrome-store-marquee-promo-1400x560.png`
- `screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png`
- listing copy template: `listing-copy.md`

Before submission, verify screenshot dimensions and replace any placeholder imagery with current product UI captures.

## 3. Listing content and compliance

1. Fill listing text using `store-assets/listing-copy.md`.
2. Publish the privacy policy from `docs/legal/privacy-policy.md` at a public URL.
3. Complete the Chrome Web Store Privacy practices questionnaire using the extension's actual behavior.
4. Provide clear justifications for sensitive permissions (`webRequest`, `<all_urls>`).

## 4. Pre-submit verification

1. Confirm `public/manifest.json` version matches release intent.
2. Verify extension behavior in unpacked mode from `dist/`.
3. Verify no debug/test-only code or placeholder text is present.
4. Confirm trademark/branding usage is acceptable for store publication.

## 5. Submit

1. Upload `release/adyen-web-inspector-v<version>.zip` in the Chrome Web Store Developer Dashboard.
2. Upload listing assets and screenshots.
3. Complete privacy practices and store metadata.
4. Submit for review.

## References

- [developer.chrome.com/docs/webstore/register](https://developer.chrome.com/docs/webstore/register)
- [developer.chrome.com/docs/webstore/prepare](https://developer.chrome.com/docs/webstore/prepare)
- [developer.chrome.com/docs/webstore/listing](https://developer.chrome.com/docs/webstore/listing)
- [developer.chrome.com/docs/webstore/cws-dashboard-privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
