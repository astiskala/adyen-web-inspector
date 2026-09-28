import { buildImplementationAttributes } from './implementation-attributes.js';
import { buildIssueExportRows, getIssueSeverityRank, type ExportIssueRow } from './export-utils.js';
import { extractHostname, isAdyenHost } from './utils.js';
import { getImpactLevel, isIssue, ISSUE_IMPACT_ORDER } from './results.js';
import type {
  CapturedRequest,
  CheckCategory,
  CheckId,
  CheckImpact,
  CheckResult,
  ScanResult,
  StandardCompliance,
} from './types.js';

const BEST_PRACTICE_CATEGORIES: ReadonlySet<CheckCategory> = new Set([
  'sdk-identity',
  'version-lifecycle',
  'environment',
  'auth',
  'callbacks',
  'risk',
]);
const SECURITY_CATEGORIES: ReadonlySet<CheckCategory> = new Set(['security', 'third-party']);

type ImplementationAttributes = ReturnType<typeof buildImplementationAttributes>;

export interface ExportCategorySection {
  readonly issues: readonly ExportIssueRow[];
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
  readonly checkoutConfig: ScanResult['payload']['page']['checkoutConfig'];
  readonly componentConfig: ScanResult['payload']['page']['componentConfig'];
  readonly inferredCheckoutConfig: ScanResult['payload']['page']['inferredConfig'];
  readonly sdkMetadata: ScanResult['payload']['page']['adyenMetadata'];
}

export interface ReportExportData {
  readonly implementationAttributes: ImplementationAttributes;
  readonly standardCompliance: StandardCompliance;
  readonly issues: readonly ExportIssueRow[];
  readonly bestPractices: ExportCategorySection;
  readonly security: ExportCategorySection;
  readonly skippedChecks: readonly ExportSkippedCheck[];
  readonly network: ExportNetworkData;
  readonly rawConfig: ExportRawConfigData;
}

export interface ImpactGroupChecks {
  readonly impact: CheckImpact;
  readonly checks: readonly CheckResult[];
}

interface FindingSection {
  readonly issueGroups: readonly ImpactGroupChecks[];
  readonly successfulChecks: readonly CheckResult[];
}

interface FindingProjection {
  readonly bestPractices: FindingSection;
  readonly security: FindingSection;
  readonly skippedChecks: readonly ExportSkippedCheck[];
  readonly network: ExportNetworkData;
  readonly rawConfig: ExportRawConfigData;
}

function sortChecks(a: CheckResult, b: CheckResult): number {
  return (
    getIssueSeverityRank(a.severity) - getIssueSeverityRank(b.severity) ||
    a.title.localeCompare(b.title)
  );
}

function buildFindingSection(
  checks: readonly CheckResult[],
  categories: ReadonlySet<CheckCategory>
): FindingSection {
  const matching = checks.filter((check) => categories.has(check.category));
  const issues = matching.filter(isIssue);
  return {
    issueGroups: ISSUE_IMPACT_ORDER.map((impact) => ({
      impact,
      checks: issues.filter((check) => getImpactLevel(check) === impact).sort(sortChecks),
    })).filter((group) => group.checks.length > 0),
    successfulChecks: matching
      .filter((check) => check.severity === 'pass')
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

function buildExportSection(
  section: FindingSection,
  issues: readonly ExportIssueRow[]
): ExportCategorySection {
  const ids = new Set(
    section.issueGroups.flatMap((group) => group.checks.map((check) => check.id))
  );
  return {
    issues: issues.filter((issue) => ids.has(issue.id)),
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
  const capturedRequests = result.payload.capturedRequests.filter((request) => {
    if (request.type !== 'other') {
      return true;
    }

    const host = extractHostname(request.url);
    return host !== null && isAdyenHost(host);
  });

  return { capturedRequests };
}

function buildRawConfigData(result: ScanResult): ExportRawConfigData {
  return {
    checkoutConfig: result.payload.page.checkoutConfig,
    componentConfig: result.payload.page.componentConfig,
    inferredCheckoutConfig: result.payload.page.inferredConfig,
    sdkMetadata: result.payload.page.adyenMetadata,
  };
}

export const buildFindingProjection = (result: ScanResult): FindingProjection => ({
  bestPractices: buildFindingSection(result.checks, BEST_PRACTICE_CATEGORIES),
  security: buildFindingSection(result.checks, SECURITY_CATEGORIES),
  skippedChecks: buildSkippedChecks(result),
  network: buildNetworkData(result),
  rawConfig: buildRawConfigData(result),
});

/** Builds the shared structured report data consumed by both JSON and PDF exports. */
export function buildReportExportData(result: ScanResult): ReportExportData {
  const projection = buildFindingProjection(result);
  const issues = buildIssueExportRows(result.checks, {
    sortByImpact: true,
    friendlyRemediation: true,
    preferAdyenDocs: true,
  });

  return {
    implementationAttributes: buildImplementationAttributes(result.payload),
    standardCompliance: result.standardCompliance,
    issues,
    bestPractices: buildExportSection(projection.bestPractices, issues),
    security: buildExportSection(projection.security, issues),
    skippedChecks: projection.skippedChecks,
    network: projection.network,
    rawConfig: projection.rawConfig,
  };
}
