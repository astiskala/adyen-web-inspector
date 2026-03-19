import { buildImplementationAttributes } from './implementation-attributes.js';
import { buildIssueExportRows, type ExportIssueRow } from './export-utils.js';
import { extractHostname, isAdyenHost } from './utils.js';
import type {
  CapturedRequest,
  CheckCategory,
  CheckId,
  CheckResult,
  ScanResult,
  StandardCompliance,
} from './types.js';

const BEST_PRACTICE_EXPORT_CATEGORIES: ReadonlySet<CheckCategory> = new Set([
  'sdk-identity',
  'version-lifecycle',
  'environment',
  'auth',
  'callbacks',
  'risk',
]);
const SECURITY_EXPORT_CATEGORIES: ReadonlySet<CheckCategory> = new Set(['security', 'third-party']);

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

function buildExportSection(
  checks: readonly CheckResult[],
  issues: readonly ExportIssueRow[],
  categoryFilter: ReadonlySet<CheckCategory>
): ExportCategorySection {
  const sectionIssues = issues.filter((issue) => categoryFilter.has(issue.category));
  const successfulChecks = checks
    .filter((check) => categoryFilter.has(check.category) && check.severity === 'pass')
    .sort((a, b) => a.title.localeCompare(b.title));

  return {
    issues: sectionIssues,
    successfulChecks,
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

/** Builds the shared structured report data consumed by both JSON and PDF exports. */
export function buildReportExportData(result: ScanResult): ReportExportData {
  const issues = buildIssueExportRows(result.checks, {
    sortByImpact: true,
    friendlyRemediation: true,
    preferAdyenDocs: true,
  });

  return {
    implementationAttributes: buildImplementationAttributes(result.payload),
    standardCompliance: result.standardCompliance,
    issues,
    bestPractices: buildExportSection(result.checks, issues, BEST_PRACTICE_EXPORT_CATEGORIES),
    security: buildExportSection(result.checks, issues, SECURITY_EXPORT_CATEGORIES),
    skippedChecks: buildSkippedChecks(result),
    network: buildNetworkData(result),
    rawConfig: buildRawConfigData(result),
  };
}
