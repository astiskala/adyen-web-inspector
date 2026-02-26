import type { JSX } from 'preact';
import type { ScanResult, CapturedRequest, CheckResult } from '~shared/types';
import { extractHostname, getImpactLevel, isAdyenHost } from '~shared/utils';
import { IdentityCard } from '../../popup/components/IdentityCard';
import { HealthScore } from '../../popup/components/HealthScore';
import { IssueList } from '../../popup/components/IssueList';
import styles from './panel.module.css';

const s = (key: string): string => styles[key] ?? '';
const BEST_PRACTICE_CATEGORY_SET = new Set([
  'sdk-identity',
  'version-lifecycle',
  'environment',
  'auth',
  'callbacks',
  'risk',
]);
const SECURITY_CATEGORY_SET = new Set(['security', 'third-party']);

type ImpactGroup = 'high' | 'medium' | 'low' | 'manual';
const IMPACT_GROUP_ORDER: readonly ImpactGroup[] = ['high', 'medium', 'low', 'manual'];
const IMPACT_GROUP_LABEL: Record<ImpactGroup, string> = {
  high: 'High impact',
  medium: 'Medium impact',
  low: 'Low impact',
  manual: 'Manual verification',
};

interface Props {
  readonly result: ScanResult;
}

interface SeverityBadgeProps {
  readonly severity: string;
}

function SeverityBadge({ severity }: SeverityBadgeProps): JSX.Element {
  const colorMap: Record<string, string> = {
    pass: 'var(--color-green)',
    fail: 'var(--color-red)',
    warn: 'var(--color-amber)',
    notice: 'var(--color-blue)',
    skip: 'var(--color-text-secondary)',
    info: 'var(--color-blue)',
  };
  const color = colorMap[severity] ?? 'var(--color-text-secondary)';
  return (
    <span
      style={{
        color,
        fontWeight: 600,
        fontSize: '11px',
        textTransform: 'uppercase',
      }}
    >
      {severity}
    </span>
  );
}

function isIssue(check: CheckResult): boolean {
  return check.severity === 'fail' || check.severity === 'warn' || check.severity === 'notice';
}

function isPass(check: CheckResult): boolean {
  return check.severity === 'pass';
}

function isSecurityCheck(check: CheckResult): boolean {
  return SECURITY_CATEGORY_SET.has(check.category);
}

function isSecurityIssue(check: CheckResult): boolean {
  return isSecurityCheck(check) && isIssue(check);
}

function isSecurityPass(check: CheckResult): boolean {
  return isSecurityCheck(check) && isPass(check);
}

function isBestPracticeCheck(check: CheckResult): boolean {
  return BEST_PRACTICE_CATEGORY_SET.has(check.category);
}

function isBestPracticeIssue(check: CheckResult): boolean {
  return isBestPracticeCheck(check) && isIssue(check);
}

function isBestPracticePass(check: CheckResult): boolean {
  return isBestPracticeCheck(check) && isPass(check);
}

function getImpactGroup(check: CheckResult): ImpactGroup {
  const impact = getImpactLevel(check);
  if (impact === 'high' || impact === 'medium' || impact === 'low' || impact === 'manual') {
    return impact;
  }
  return 'manual';
}

function severityRank(check: CheckResult): number {
  if (check.severity === 'fail') return 0;
  if (check.severity === 'warn') return 1;
  if (check.severity === 'notice') return 2;
  if (check.severity === 'pass') return 3;
  if (check.severity === 'skip') return 4;
  return 5;
}

function sortChecksBySeverityThenTitle(a: CheckResult, b: CheckResult): number {
  const rankDiff = severityRank(a) - severityRank(b);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  return a.title.localeCompare(b.title);
}

function sortChecksByTitle(a: CheckResult, b: CheckResult): number {
  return a.title.localeCompare(b.title);
}

interface ImpactGroupChecks {
  readonly impact: ImpactGroup;
  readonly checks: readonly CheckResult[];
}

function buildImpactGroups(checks: readonly CheckResult[]): ImpactGroupChecks[] {
  return IMPACT_GROUP_ORDER.map((impact) => ({
    impact,
    checks: checks
      .filter((check) => getImpactGroup(check) === impact)
      .sort(sortChecksBySeverityThenTitle),
  })).filter((group) => group.checks.length > 0);
}

interface BestPracticeImpactSectionProps {
  readonly impact: ImpactGroup;
  readonly checks: readonly CheckResult[];
}

function BestPracticeItem({ check }: { readonly check: CheckResult }): JSX.Element {
  const hasExpandedBody = Boolean(check.detail ?? check.remediation ?? check.docsUrl);

  return (
    <div class={s('checkCard')}>
      <div class={s('checkSummaryStatic')}>
        <span class={s('checkSummaryTitle')}>{check.title}</span>
        <SeverityBadge severity={check.severity} />
      </div>
      {hasExpandedBody && (
        <div class={s('checkBody')}>
          {check.detail !== undefined && (
            <div>
              <strong>Detail:</strong> {check.detail}
            </div>
          )}
          {check.remediation !== undefined && (
            <div>
              <strong>Remediation:</strong> {check.remediation}
            </div>
          )}
          {check.docsUrl !== undefined && (
            <a href={check.docsUrl} target="_blank" rel="noopener noreferrer">
              Documentation →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function BestPracticeImpactSection({
  impact,
  checks,
}: BestPracticeImpactSectionProps): JSX.Element | null {
  if (checks.length === 0) return null;

  return (
    <div class={s('impactGroupSection')}>
      <h3 class={s('impactGroupTitle')}>
        {IMPACT_GROUP_LABEL[impact]}
        <span class={s('impactGroupCount')}>{checks.length}</span>
      </h3>
      <div class={s('checkList')}>
        {checks.map((check) => (
          <BestPracticeItem key={check.id} check={check} />
        ))}
      </div>
    </div>
  );
}

function SuccessfulCheckItem({ check }: { readonly check: CheckResult }): JSX.Element {
  return (
    <div class={s('checkCard')}>
      <div class={s('checkSummaryStatic')}>
        <span class={s('checkSummaryTitle')}>{check.title}</span>
        <span class={s('passBadge')}>PASS</span>
      </div>
    </div>
  );
}

interface CategorizedCheckTabProps {
  readonly issueGroups: readonly ImpactGroupChecks[];
  readonly successfulChecks: readonly CheckResult[];
  readonly issueEmptyState: string;
  readonly successEmptyState: string;
}

function CategorizedCheckTab({
  issueGroups,
  successfulChecks,
  issueEmptyState,
  successEmptyState,
}: CategorizedCheckTabProps): JSX.Element {
  return (
    <div class={s('tabContent')}>
      <div class={s('section')}>
        <h3 class={s('sectionTitle')}>Issues</h3>
        {issueGroups.length === 0 ? (
          <div class={s('emptyStateSubsection')}>{issueEmptyState}</div>
        ) : (
          issueGroups.map((group) => (
            <BestPracticeImpactSection
              key={group.impact}
              impact={group.impact}
              checks={group.checks}
            />
          ))
        )}
      </div>

      <div class={s('section')}>
        <h3 class={s('sectionTitle')}>Successful Checks</h3>
        {successfulChecks.length === 0 ? (
          <div class={s('emptyStateSubsection')}>{successEmptyState}</div>
        ) : (
          <div class={s('checkList')}>
            {successfulChecks.map((check) => (
              <SuccessfulCheckItem key={check.id} check={check} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab Components ───────────────────────────────────────────────────────────

/**
 * Combined overview of implementation identity, health score, and issues.
 */
export function OverviewTab({ result }: Props): JSX.Element {
  return (
    <div class={s('tabContent')}>
      <div class={s('overviewCard')}>
        <IdentityCard result={result} />
        <HealthScore result={result} />
        <div class={s('overviewIssues')}>
          <IssueList checks={result.checks} />
        </div>
      </div>
    </div>
  );
}

/**
 * Best-practice findings grouped by impact plus successful best-practice checks.
 */
export function BestPracticesTab({ result }: Props): JSX.Element {
  const issueGroups = buildImpactGroups(result.checks.filter(isBestPracticeIssue));
  const successfulChecks = result.checks.filter(isBestPracticePass).sort(sortChecksByTitle);

  return (
    <CategorizedCheckTab
      issueGroups={issueGroups}
      successfulChecks={successfulChecks}
      issueEmptyState="No best-practice issues identified."
      successEmptyState="No successful best-practice checks recorded."
    />
  );
}

/**
 * Security and third-party findings grouped by impact plus successful checks.
 */
export function SecurityTab({ result }: Props): JSX.Element {
  const issueGroups = buildImpactGroups(result.checks.filter(isSecurityIssue));
  const successfulChecks = result.checks.filter(isSecurityPass).sort(sortChecksByTitle);

  return (
    <CategorizedCheckTab
      issueGroups={issueGroups}
      successfulChecks={successfulChecks}
      issueEmptyState="No security issues identified."
      successEmptyState="No successful security checks recorded."
    />
  );
}

/**
 * Network capture table for requests recorded during the scan.
 */
export function NetworkTab({ result }: Props): JSX.Element {
  const reqs: readonly CapturedRequest[] = result.payload.capturedRequests.filter((req) => {
    if (req.type !== 'other') {
      return true;
    }

    const host = extractHostname(req.url);
    return host !== null && isAdyenHost(host);
  });

  return (
    <div class={s('tabContent')}>
      <div class={s('section')}>
        <h3 class={s('sectionTitle')}>Captured Requests</h3>
        {reqs.length === 0 ? (
          <div class={s('emptyState')}>No Adyen requests captured.</div>
        ) : (
          <table class={s('netTable')}>
            <thead>
              <tr>
                <th>Type</th>
                <th>URL</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {reqs.map((req) => (
                <tr key={`${req.type}-${req.url}-${req.statusCode}`}>
                  <td>{req.type}</td>
                  <td>{req.url}</td>
                  <td>{req.statusCode === 0 ? '—' : req.statusCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * Raw JSON view of extracted checkout configuration and SDK metadata.
 */
export function RawConfigTab({ result }: Props): JSX.Element {
  const config = result.payload.page.checkoutConfig;
  const metadata = result.payload.page.adyenMetadata;
  const configText = config ? JSON.stringify(config, null, 2) : 'No config captured.';
  const metaText = JSON.stringify(metadata ?? null, null, 2);

  return (
    <div class={s('tabContent')}>
      <div class={s('section')}>
        <h3 class={s('sectionTitle')}>Raw Checkout Config</h3>
        <pre class={s('codeBlock')}>{configText}</pre>
      </div>
      <div class={s('section')}>
        <h3 class={s('sectionTitle')}>SDK Metadata</h3>
        <pre class={s('codeBlock')}>{metaText}</pre>
      </div>
    </div>
  );
}

/**
 * Lists skipped checks and the extracted skip reason for each entry.
 */
export function SkippedChecksTab({ result }: Props): JSX.Element {
  const skipped = result.checks.filter((c) => c.severity === 'skip');

  return (
    <div class={s('tabContent')}>
      {skipped.length === 0 ? (
        <div class={s('emptyState')}>No checks were skipped.</div>
      ) : (
        <div class={s('checkList')}>
          {skipped.map((check) => {
            const dashIndex = check.title.indexOf(' — ');
            const checkName =
              dashIndex === -1 ? check.title : check.title.slice(0, dashIndex).trim();
            const skipReason = dashIndex === -1 ? '' : check.title.slice(dashIndex + 3).trim();
            return (
              <div key={check.id} class={s('checkCard')}>
                <div class={s('checkSummaryStatic')}>
                  <span class={s('checkSummaryTitle')}>{checkName}</span>
                  {skipReason && (
                    <span
                      style={{
                        color: 'var(--color-text-secondary)',
                        fontSize: '11px',
                        flexShrink: 0,
                      }}
                    >
                      {skipReason}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
