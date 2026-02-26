# Chrome Web Store Publish Checklist

Last updated: 2026-02-25

## 0. Account prerequisites

1. Register a Chrome Web Store developer account.
2. Enable 2-Step Verification on the publisher Google account.
3. Complete fee payment and account verification in the dashboard.

## 1. Prepare extension package

Prerequisite for asset generation scripts:

- `rsvg-convert` (from `librsvg`)

1. Regenerate icons from source logos:

```bash
pnpm icons:generate
```

1. Build and run the quality gate:

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

Generate baseline store assets:

```bash
pnpm store-assets:generate
```

Generated files:

- `store-assets/chrome-store-icon-128.png`
- `store-assets/chrome-store-small-promo-440x280.png`
- `store-assets/chrome-store-marquee-promo-1400x560.png` (optional in listing flow)

Still required manually before submission:

- At least one real product screenshot for the listing (`1280x800` or `640x400`)
- Promo video URL (YouTube) if requested by the listing form for your account/region

## 3. Listing content and compliance

1. Fill listing text using `store-assets/listing-copy.md`.
2. Publish the privacy policy from `docs/legal/privacy-policy.md` at a public URL.
3. Complete the Chrome Web Store Privacy practices questionnaire using the extension's actual behavior.
4. Provide clear justifications for sensitive permissions (`webRequest`, `<all_urls>`).

## 4. Pre-submit verification

1. Confirm `public/manifest.json` version matches release intent.
2. Verify extension behavior in unpacked mode from `dist/`.
3. Verify that no debug/test-only code or placeholder text is present.
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
