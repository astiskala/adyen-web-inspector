# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Expanded linting and formatting coverage to include Markdown and other repository text files:
  - Added `markdownlint-cli2` and Markdown lint scripts (`lint:md`, `lint:md:fix`)
  - Updated `lint`, `lint:fix`, `format`, and `format:check` to run repo-wide quality checks
  - Expanded `lint-staged` so pre-commit hooks now auto-fix staged Markdown and run Prettier on staged text/config files
- Updated project documentation (`README`, `CONTRIBUTING`, `AGENTS`, `SECURITY`) to match current check counts, architecture boundaries, and runtime behavior.

### Added

- Chrome Web Store publication prep assets and scripts:
  - Branding source logos under `branding/`
  - Regenerated extension icon set (`16/32/48/128`)
  - Store asset generator and baseline promo assets in `store-assets/`
  - ZIP packaging script for CWS uploads
  - Publish checklist, listing copy template, and privacy policy document
- Chrome Manifest V3 extension scaffold with Vite multi-entry build
- Shared types, constants, utilities, and message definitions
- Content scripts: passive Adyen detector and page-world extractor
- Background service worker with scan orchestrator, header collector, and npm registry client
- 10 check modules covering 40+ best-practice checks:
  - SDK Identity (detected, flavor, import method, bundle type, metadata)
  - SDK Version (detected, latest, major lifecycle, minor gap)
  - Environment (detected, region, key mismatch, HTTPS, iframe)
  - Client Key & Auth (client key type, country code, locale)
  - Integration Flow & Callbacks (flow type, onSubmit, onAdditionalDetails, onError, etc.)
  - Risk Module (RP_UID cookie, device fingerprint iframe, risk enabled)
  - Security — SRI (script integrity, CSS integrity)
  - Security — CSP (present, script-src, frame-src, frame-ancestors, reporting)
  - Security — Headers (Referrer-Policy, X-Content-Type-Options, X-XSS-Protection, HSTS, iframe referrerpolicy)
  - Third-Party Scripts (tag managers, analytics, session replay, ad pixels, SRI)
- Popup UI with health score, issue list, and identity card
- DevTools panel with 5 tabs: Overview, Best Practices, Security, Network, Raw Config
- Client-side PDF export via hidden iframe + `window.print()`
- JSON export of full scan results
- 130+ unit tests across all check modules (94%+ line coverage)
- CI pipeline via GitHub Actions (typecheck, lint, format, depcruise, knip, test, build, e2e)
- Husky + lint-staged + commitlint for Git hygiene
- dependency-cruiser for architecture boundary enforcement
- knip for dead code detection
- Project documentation (README, CONTRIBUTING, AGENTS, SECURITY, CODE_OF_CONDUCT)

### Fixed

- Restored `scripts/generate-store-assets.sh` so `pnpm store-assets:generate` works as documented.
