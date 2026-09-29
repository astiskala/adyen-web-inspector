/**
 * Finding projection — how every view presents a scan result: issue rows
 * grouped by impact with remediation and documentation resolved, successful
 * and skipped checks, captured network, raw configuration, and implementation
 * attributes. The popup, DevTools panel, PDF, and JSON reports render these
 * rows in projection order; none of them sorts or rewords issues itself.
 */

import { readAdyenEndpoint } from './adyen-endpoint.js';
import { getImpactLevel, IMPACT_LABELS, isIssue, ISSUE_IMPACT_ORDER } from './results.js';
import type {
  AdyenEnvironment,
  AdyenRegion,
  CapturedRequest,
  CheckCategory,
  CheckId,
  CheckImpact,
  CheckoutConfig,
  CheckResult,
  ImplementationAttributes,
  IntegrationFlavor,
  IntegrationFlow,
  ScanResult,
  Severity,
  StandardCompliance,
} from './types.js';

const ADYEN_WEB_BEST_PRACTICES_DOC = 'https://docs.adyen.com/online-payments/web-best-practices/';
const ISSUE_SEVERITY_ORDER: readonly Severity[] = ['fail', 'warn', 'notice'];

const BEST_PRACTICE_CATEGORIES: ReadonlySet<CheckCategory> = new Set([
  'sdk-identity',
  'version-lifecycle',
  'environment',
  'auth',
  'callbacks',
  'risk',
]);
const SECURITY_CATEGORIES: ReadonlySet<CheckCategory> = new Set(['security', 'third-party']);

/** Display values of the implementation attributes, shared by the popup, panel, and reports. */
interface ImplementationSummary {
  readonly sdkVersion: string;
  readonly environment: AdyenEnvironment | 'unknown';
  /** Null for test, which uses a global endpoint rather than a live region. */
  readonly region: AdyenRegion | null;
  readonly flow: IntegrationFlow;
  readonly flavor: IntegrationFlavor;
  readonly importMethod: ImplementationAttributes['importMethod'];
}

/** One issue as every view renders it. */
export interface IssueRow {
  readonly id: CheckId;
  readonly category: CheckCategory;
  readonly severity: Severity;
  readonly title: string;
  /** Label of the issue's impact group. */
  readonly impact: string;
  readonly impactLevel: CheckImpact;
  readonly detail: string | null;
  /** Reader-friendly remediation; a severity-based default when the check has none. */
  readonly remediation: string;
  /** The check's documentation, else the Adyen Web best practices. */
  readonly docsUrl: string;
}

/** Issues of one impact, sorted by severity then title. */
export interface IssueGroup {
  readonly impact: CheckImpact;
  readonly label: string;
  readonly issues: readonly IssueRow[];
}

interface ExportCategorySection {
  readonly issues: readonly IssueRow[];
  readonly successfulChecks: readonly CheckResult[];
}

interface ExportSkippedCheck {
  readonly id: CheckId;
  readonly category: CheckCategory;
  readonly title: string;
  readonly detail: string | null;
  readonly reason: string;
}

interface ExportNetworkData {
  readonly capturedRequests: readonly CapturedRequest[];
}

interface ExportRawConfigData {
  /** Options captured from AdyenCheckout and component calls. */
  readonly checkoutConfig: CheckoutConfig | null;
  /** True when AdyenCheckout's options were captured whole. */
  readonly checkoutConfigComplete: boolean;
  readonly componentConfig: CheckoutConfig | null;
  readonly inferredCheckoutConfig: CheckoutConfig | null;
  readonly pageJsonCheckoutConfig: CheckoutConfig | null;
  readonly sdkMetadata: ScanResult['payload']['page']['adyenMetadata'];
}

export interface ReportExportData {
  readonly implementationAttributes: ImplementationSummary;
  readonly standardCompliance: StandardCompliance;
  readonly issues: readonly IssueRow[];
  readonly bestPractices: ExportCategorySection;
  readonly security: ExportCategorySection;
  readonly skippedChecks: readonly ExportSkippedCheck[];
  readonly network: ExportNetworkData;
  readonly rawConfig: ExportRawConfigData;
}

interface FindingSection {
  readonly issueGroups: readonly IssueGroup[];
  readonly successfulChecks: readonly CheckResult[];
}

interface FindingProjection {
  readonly bestPractices: FindingSection;
  readonly security: FindingSection;
  readonly skippedChecks: readonly ExportSkippedCheck[];
  readonly network: ExportNetworkData;
  readonly rawConfig: ExportRawConfigData;
}

function bySeverityThenTitle(a: CheckResult, b: CheckResult): number {
  return (
    ISSUE_SEVERITY_ORDER.indexOf(a.severity) - ISSUE_SEVERITY_ORDER.indexOf(b.severity) ||
    a.title.localeCompare(b.title)
  );
}

function frameRemediationExample(text: string): string {
  if (text.startsWith('AdyenCheckout(')) {
    return `Update your AdyenCheckout configuration. Example: ${text}`;
  }
  if (text.startsWith('Content-Security-Policy:')) {
    return `Update your Content-Security-Policy header on the checkout response. Example: ${text}`;
  }
  if (/^[A-Z-]+:\s+/i.test(text)) {
    return `Set this response header on the checkout page: ${text}`;
  }
  if (text.startsWith('<script') || text.startsWith('<link') || text.startsWith('<iframe')) {
    return `Update your markup to match this secure example: ${text}`;
  }
  return text;
}

function resolveRemediation(check: CheckResult, impact: CheckImpact): string {
  if (check.remediation !== undefined) return frameRemediationExample(check.remediation);
  if (check.severity !== 'notice') {
    return 'Follow the linked Adyen guidance, apply the configuration change, then rerun the scan.';
  }
  return impact === 'low'
    ? 'Review this recommended improvement, apply the change, then rerun the scan.'
    : 'Review this item manually in your site config and network headers before going live.';
}

function toIssueRow(check: CheckResult, impact: CheckImpact): IssueRow {
  return {
    id: check.id,
    category: check.category,
    severity: check.severity,
    title: check.title,
    impact: IMPACT_LABELS[impact],
    impactLevel: impact,
    detail: check.detail ?? null,
    remediation: resolveRemediation(check, impact),
    docsUrl: check.docsUrl ?? ADYEN_WEB_BEST_PRACTICES_DOC,
  };
}

/**
 * Groups issues by impact in priority order, sorted by severity then title
 * within each group. Empty groups are omitted and non-issues are ignored.
 */
export function groupIssuesByImpact(checks: readonly CheckResult[]): IssueGroup[] {
  const issues = checks.filter(isIssue);
  return ISSUE_IMPACT_ORDER.map((impact) => ({
    impact,
    label: IMPACT_LABELS[impact],
    issues: issues
      .filter((check) => getImpactLevel(check) === impact)
      .toSorted(bySeverityThenTitle)
      .map((check) => toIssueRow(check, impact)),
  })).filter((group) => group.issues.length > 0);
}

function flattenGroups(groups: readonly IssueGroup[]): IssueRow[] {
  return groups.flatMap((group) => group.issues);
}

function buildFindingSection(
  checks: readonly CheckResult[],
  categories: ReadonlySet<CheckCategory>
): FindingSection {
  const matching = checks.filter((check) => categories.has(check.category));
  return {
    issueGroups: groupIssuesByImpact(matching),
    successfulChecks: matching
      .filter((check) => check.severity === 'pass')
      .toSorted((a, b) => a.title.localeCompare(b.title)),
  };
}

function buildExportSection(section: FindingSection): ExportCategorySection {
  return {
    issues: flattenGroups(section.issueGroups),
    successfulChecks: section.successfulChecks,
  };
}

function buildSkippedChecks(result: ScanResult): ExportSkippedCheck[] {
  return result.checks
    .filter((check) => check.severity === 'skip')
    .map((check) => {
      const dashIndex = check.title.indexOf(' — ');
      const hasSeparator = dashIndex !== -1;
      const title = hasSeparator ? check.title.slice(0, dashIndex).trim() : check.title;
      const parsedReason = hasSeparator ? check.title.slice(dashIndex + 3).trim() : '';
      const reason = (check.detail ?? parsedReason).trim();

      return {
        id: check.id,
        category: check.category,
        title,
        detail: check.detail ?? null,
        reason: reason === '' ? '—' : reason,
      };
    });
}

function buildNetworkData(result: ScanResult): ExportNetworkData {
  const capturedRequests = result.payload.capturedRequests.filter(
    (request) => request.type !== 'other' || readAdyenEndpoint(request.url) !== null
  );

  return { capturedRequests };
}

interface RawConfigSection {
  readonly title: string;
  readonly text: string;
}

function formatConfig(config: object | null, emptyMessage: string): string {
  return config === null ? emptyMessage : JSON.stringify(config, null, 2);
}

/** Titles and pretty-printed contents of each extracted config source, shared by every view. */
export function buildRawConfigSections(rawConfig: ExportRawConfigData): RawConfigSection[] {
  return [
    {
      title: 'Captured Checkout Fields',
      text: formatConfig(rawConfig.checkoutConfig, 'No config captured.'),
    },
    {
      title: 'Mounted Component Fields',
      text: formatConfig(rawConfig.componentConfig, 'No component config captured.'),
    },
    {
      title: 'Inferred Checkout Fields',
      text: formatConfig(rawConfig.inferredCheckoutConfig, 'No inferred config captured.'),
    },
    {
      title: 'Page JSON Fields',
      text: formatConfig(rawConfig.pageJsonCheckoutConfig, 'No option-shaped page JSON captured.'),
    },
    { title: 'SDK Metadata', text: JSON.stringify(rawConfig.sdkMetadata, null, 2) },
  ];
}

function buildRawConfigData(result: ScanResult): ExportRawConfigData {
  const { page } = result.payload;
  return {
    checkoutConfig: page.capturedConfig?.options ?? null,
    checkoutConfigComplete: page.capturedConfig?.complete ?? false,
    componentConfig: page.componentConfig,
    inferredCheckoutConfig: page.inferredConfig,
    pageJsonCheckoutConfig: page.pageJsonConfig,
    sdkMetadata: page.adyenMetadata,
  };
}

/** Reads the scan's implementation attributes as the values every view displays. */
export function summarizeImplementation(result: ScanResult): ImplementationSummary {
  const { attributes } = result;
  const environment = attributes.environment.value ?? 'unknown';
  return {
    sdkVersion: result.payload.versionInfo.detected ?? 'Unknown',
    environment,
    region: environment === 'test' ? null : attributes.region.value,
    flow: attributes.flow.value,
    flavor: attributes.flavor.value,
    importMethod: attributes.importMethod,
  };
}

/** Projects a scan result into the sections shared by the DevTools panel and reports. */
export function buildFindingProjection(result: ScanResult): FindingProjection {
  return {
    bestPractices: buildFindingSection(result.checks, BEST_PRACTICE_CATEGORIES),
    security: buildFindingSection(result.checks, SECURITY_CATEGORIES),
    skippedChecks: buildSkippedChecks(result),
    network: buildNetworkData(result),
    rawConfig: buildRawConfigData(result),
  };
}

/**
 * Builds the JSON report data from the finding projection, with each issue
 * list flattened in impact, severity, then title order.
 */
export function buildReportExportData(result: ScanResult): ReportExportData {
  const projection = buildFindingProjection(result);

  return {
    implementationAttributes: summarizeImplementation(result),
    standardCompliance: result.standardCompliance,
    issues: flattenGroups(groupIssuesByImpact(result.checks)),
    bestPractices: buildExportSection(projection.bestPractices),
    security: buildExportSection(projection.security),
    skippedChecks: projection.skippedChecks,
    network: projection.network,
    rawConfig: projection.rawConfig,
  };
}
