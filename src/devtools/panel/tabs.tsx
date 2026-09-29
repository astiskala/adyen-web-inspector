import type { JSX } from 'preact';
import type { ScanResult, CheckResult, Severity } from '../../shared/types.js';
import {
  buildFindingProjection,
  buildRawConfigSections,
  type IssueGroup,
  type IssueRow,
} from '../../shared/export-report.js';
import { IdentityCard } from '../../popup/components/IdentityCard.js';
import { HealthScore } from '../../popup/components/HealthScore.js';
import { IssueList } from '../../popup/components/IssueList.js';
import { StandardComplianceBadge } from '../../popup/components/StandardComplianceBadge.js';
import styles from './panel.module.css';
import { cssModule } from '../../popup/components/css-module.js';

const s = cssModule(styles);

interface Props {
  readonly result: ScanResult;
}

const SEVERITY_CLASSES: Readonly<Record<Severity, string>> = {
  pass: 'severityPass',
  fail: 'severityFail',
  warn: 'severityWarn',
  notice: 'severityNotice',
  info: 'severityInfo',
  skip: 'severitySkip',
};

interface SeverityBadgeProps {
  readonly severity: Severity;
}

function SeverityBadge({ severity }: SeverityBadgeProps): JSX.Element {
  return <span class={`${s('severity')} ${s(SEVERITY_CLASSES[severity])}`}>{severity}</span>;
}

function IssueItem({ issue }: { readonly issue: IssueRow }): JSX.Element {
  return (
    <div class={s('checkCard')}>
      <div class={s('checkSummaryStatic')}>
        <span class={s('checkSummaryTitle')}>{issue.title}</span>
        <SeverityBadge severity={issue.severity} />
      </div>
      <div class={s('checkBody')}>
        {issue.detail !== null && (
          <div>
            <strong>Detail:</strong> {issue.detail}
          </div>
        )}
        <div>
          <strong>Remediation:</strong> {issue.remediation}
        </div>
        <a href={issue.docsUrl} target="_blank" rel="noopener noreferrer">
          Documentation →
        </a>
      </div>
    </div>
  );
}

function ImpactGroupSection({ group }: { readonly group: IssueGroup }): JSX.Element {
  return (
    <div class={s('impactGroupSection')}>
      <h3 class={s('impactGroupTitle')}>
        {group.label}
        <span class={s('impactGroupCount')}>{group.issues.length}</span>
      </h3>
      <div class={s('checkList')}>
        {group.issues.map((issue) => (
          <IssueItem key={issue.id} issue={issue} />
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
        <SeverityBadge severity="pass" />
      </div>
    </div>
  );
}

interface CategorizedCheckTabProps {
  readonly issueGroups: readonly IssueGroup[];
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
          issueGroups.map((group) => <ImpactGroupSection key={group.impact} group={group} />)
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
        <StandardComplianceBadge compliance={result.standardCompliance} />
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
  const { issueGroups, successfulChecks } = buildFindingProjection(result).bestPractices;

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
  const { issueGroups, successfulChecks } = buildFindingProjection(result).security;

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
  const reqs = buildFindingProjection(result).network.capturedRequests;

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
 * JSON view of selected captured/inferred checkout fields and SDK metadata.
 */
export function RawConfigTab({ result }: Props): JSX.Element {
  const sections = buildRawConfigSections(buildFindingProjection(result).rawConfig);

  return (
    <div class={s('tabContent')}>
      {sections.map(({ title, text }) => (
        <div key={title} class={s('section')}>
          <h3 class={s('sectionTitle')}>{title}</h3>
          <pre class={s('codeBlock')}>{text}</pre>
        </div>
      ))}
    </div>
  );
}

/**
 * Lists skipped checks and the extracted skip reason for each entry.
 */
export function SkippedChecksTab({ result }: Props): JSX.Element {
  const skipped = buildFindingProjection(result).skippedChecks;

  return (
    <div class={s('tabContent')}>
      {skipped.length === 0 ? (
        <div class={s('emptyState')}>No checks were skipped.</div>
      ) : (
        <div class={s('checkList')}>
          {skipped.map((check) => (
            <div key={check.id} class={s('checkCard')}>
              <div class={s('checkSummaryStatic')}>
                <span class={s('checkSummaryTitle')}>{check.title}</span>
                {check.reason !== '—' && <span class={s('skipReason')}>{check.reason}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
