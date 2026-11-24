import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { formatScannedAt, type ReportMetadata } from '../shared/export-metadata.js';
import {
  buildFindingProjection,
  buildRawConfigSections,
  groupIssuesByImpact,
  ISSUE_STATUSES,
  type IssueGroup,
  type IssueRow,
} from '../shared/export-report.js';
import type { ScanResult } from '../shared/types.js';
import { InspectorBrand } from '../popup/components/InspectorBrand.js';
import { InspectorIcon } from '../popup/components/InspectorIcon.js';
import { HealthScore } from '../popup/components/HealthScore.js';
import { StandardComplianceBadge } from '../popup/components/StandardComplianceBadge.js';
import { IdentityCard } from '../popup/components/IdentityCard.js';
import { CodeSection } from '../popup/components/CodeSection.js';
import {
  FindingGrid,
  NetworkGrid,
  SkippedGrid,
  SuccessGrid,
} from '../popup/components/ScanTables.js';
import { StatusTag } from '../popup/components/StatusTag.js';
import { cssModule } from '../popup/components/css-module.js';
import { useTheme } from '../popup/components/useTheme.js';
import styles from './Report.module.css';

const s = cssModule(styles);
type Filter = 'all' | IssueRow['severity'];

interface Properties {
  readonly result: ScanResult;
  readonly metadata: ReportMetadata;
  readonly onExportJson: () => void;
  readonly onExportPdf: () => void;
}

function ReportMetadataBlock({
  result,
  metadata,
}: {
  readonly result: ScanResult;
  readonly metadata: ReportMetadata;
}): JSX.Element {
  return (
    <>
      <h1>Integration health report</h1>
      <dl class={s('metadata')}>
        <div class={s('inspected')}>
          <dt>Inspected URL</dt>
          <dd>
            <code>{result.pageUrl}</code>
          </dd>
        </div>
        <div>
          <dt>Scanned at</dt>
          <dd>
            <time dateTime={result.scannedAt}>{formatScannedAt(result.scannedAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Extension version</dt>
          <dd>{metadata.extensionVersion}</dd>
        </div>
        <div>
          <dt>Browser</dt>
          <dd>{metadata.browser}</dd>
        </div>
      </dl>
    </>
  );
}

function FixFirst({ issues }: { readonly issues: readonly IssueRow[] }): JSX.Element {
  const priorities = issues.filter(({ severity }) => severity !== 'notice').slice(0, 3);
  return (
    <section class={s('card')}>
      <h2>Fix first</h2>
      {priorities.length === 0 ? (
        <p class="muted">No fails or warnings to fix.</p>
      ) : (
        <ol class={s('priorities')}>
          {priorities.map(({ id, title, remediation }) => (
            <li key={id}>
              <strong>{title}</strong>
              <p>{remediation}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function FindingSection({
  title,
  groups,
  empty,
  filter,
}: {
  readonly title: string;
  readonly groups: readonly IssueGroup[];
  readonly empty: string;
  readonly filter: Filter;
}): JSX.Element {
  const issues = groups.flatMap((group) => group.issues);
  const hasMatch = filter === 'all' || issues.some((issue) => issue.severity === filter);
  return (
    <section class={s('findingSection')}>
      <h3>{title}</h3>
      {issues.length === 0 ? (
        <p class="muted">{empty}</p>
      ) : (
        <>
          {!hasMatch && <p class={`muted ${s('screenOnly')}`}>No findings match this filter.</p>}
          <div class={hasMatch ? '' : s('noMatch')}>
            <FindingGrid issues={issues} label={title} />
          </div>
        </>
      )}
    </section>
  );
}

function countBySeverity(
  issues: readonly IssueRow[]
): ((typeof ISSUE_STATUSES)[number] & { readonly count: number })[] {
  return ISSUE_STATUSES.map(({ severity, label }) => ({
    severity,
    label,
    count: issues.filter((issue) => issue.severity === severity).length,
  }));
}

function Findings({
  projection,
  totals,
}: {
  readonly projection: ReturnType<typeof buildFindingProjection>;
  readonly totals: ReturnType<typeof countBySeverity>;
}): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const all = totals.reduce((sum, { count }) => sum + count, 0);
  const filters = [{ severity: 'all', label: 'All', count: all } as const, ...totals];

  return (
    <section class={s('card')} aria-label="Findings" data-filter={filter}>
      <h2>Findings</h2>
      <div class={s('filters')} role="group" aria-label="Filter findings">
        {filters.map(({ severity, label, count }) => (
          <button
            class="btn"
            key={severity}
            aria-pressed={filter === severity}
            onClick={() => {
              setFilter(severity);
            }}
          >
            {label} <span class="dataBadge">{count}</span>
          </button>
        ))}
      </div>
      <FindingSection
        title="Best practices"
        groups={projection.bestPractices.issueGroups}
        empty="No best-practice issues identified."
        filter={filter}
      />
      <FindingSection
        title="Security"
        groups={projection.security.issueGroups}
        empty="No security issues identified."
        filter={filter}
      />
    </section>
  );
}

/**
The complete report for one scan, with export actions outside the printed content.
*/
export function Report({ result, metadata, onExportJson, onExportPdf }: Properties): JSX.Element {
  useTheme();
  const projection = buildFindingProjection(result);
  const issues = groupIssuesByImpact(result.checks).flatMap((group) => group.issues);
  const totals = countBySeverity(issues);
  const successes = [
    {
      title: 'Best practices',
      checks: projection.bestPractices.successfulChecks,
      empty: 'No successful best-practice checks recorded.',
    },
    {
      title: 'Security',
      checks: projection.security.successfulChecks,
      empty: 'No successful security checks recorded.',
    },
  ];

  return (
    <div class={s('page')}>
      <header class={s('toolbar')}>
        <InspectorBrand />
        <div>
          <button class="btn" onClick={onExportJson}>
            <InspectorIcon name="download" /> Export JSON
          </button>
          <button class="btn btnPrimary" onClick={onExportPdf}>
            <InspectorIcon name="download" /> Export PDF
          </button>
        </div>
      </header>
      <main class={s('report')}>
        <ReportMetadataBlock result={result} metadata={metadata} />
        <div class={s('summary')}>
          <HealthScore result={result} />
          <StandardComplianceBadge compliance={result.standardCompliance} />
        </div>
        <ul class={s('totals')} aria-label="Finding counts">
          {totals.map(({ severity, label, count }) => (
            <li key={severity}>
              <StatusTag tone={severity}>{label}</StatusTag>
              <strong>{count}</strong>
            </li>
          ))}
        </ul>
        <FixFirst issues={issues} />
        <IdentityCard result={result} />
        <Findings projection={projection} totals={totals} />
        <section class={s('card')}>
          <h2>Successful checks</h2>
          <div class={s('successGrid')}>
            {successes.map(({ title, checks, empty }) => (
              <section key={title}>
                <h3>{title}</h3>
                {checks.length === 0 ? (
                  <p class="muted">{empty}</p>
                ) : (
                  <SuccessGrid checks={checks} label={title} />
                )}
              </section>
            ))}
          </div>
        </section>
        <section class={s('card')}>
          <h2>
            Skipped checks <span class="dataBadge">{projection.skippedChecks.length}</span>
          </h2>
          <SkippedGrid checks={projection.skippedChecks} />
        </section>
        <section class={s('card')}>
          <h2>
            Network <span class="dataBadge">{projection.network.capturedRequests.length}</span>
          </h2>
          <NetworkGrid requests={projection.network.capturedRequests} />
        </section>
        <section class={s('config')}>
          <h2>Extracted config</h2>
          {buildRawConfigSections(projection.rawConfig).map(({ title, text }) => (
            <CodeSection key={title} title={title} text={text} />
          ))}
        </section>
        <footer class={s('footer')}>
          Generated by Adyen Web Inspector v{metadata.extensionVersion} ·{' '}
          {formatScannedAt(result.scannedAt)}
        </footer>
      </main>
    </div>
  );
}
