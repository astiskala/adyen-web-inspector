import type { JSX } from 'preact';
import type { ScanResult, CheckResult } from '../../shared/types.js';
import {
  buildFindingProjection,
  buildRawConfigSections,
  type IssueGroup,
} from '../../shared/export-report.js';
import { IdentityCard } from '../../popup/components/IdentityCard.js';
import { HealthScore } from '../../popup/components/HealthScore.js';
import { IssueList } from '../../popup/components/IssueList.js';
import { StandardComplianceBadge } from '../../popup/components/StandardComplianceBadge.js';
import { CodeSection } from '../../popup/components/CodeSection.js';
import {
  FindingGrid,
  NetworkGrid,
  SkippedGrid,
  SuccessGrid,
} from '../../popup/components/ScanTables.js';
import styles from './panel.module.css';
import { cssModule } from '../../popup/components/css-module.js';

const s = cssModule(styles);

interface Properties {
  readonly result: ScanResult;
}

interface CategorizedCheckTabProperties {
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
}: CategorizedCheckTabProperties): JSX.Element {
  return (
    <div class={s('tabContent')}>
      <section class={s('card')}>
        <h2>Issues</h2>
        {issueGroups.length === 0 ? (
          <p class="muted">{issueEmptyState}</p>
        ) : (
          issueGroups.map((group) => (
            <section class={s('impactGroup')} key={group.impact}>
              <h3>
                {group.label} <span class="dataBadge">{group.issues.length}</span>
              </h3>
              <FindingGrid issues={group.issues} label={group.label} />
            </section>
          ))
        )}
      </section>
      <section class={s('card')}>
        <h2>Successful checks</h2>
        {successfulChecks.length === 0 ? (
          <p class="muted">{successEmptyState}</p>
        ) : (
          <SuccessGrid checks={successfulChecks} label="Successful checks" />
        )}
      </section>
    </div>
  );
}

/**
Combined overview of health, implementation identity, and issues.
*/
export function OverviewTab({ result }: Properties): JSX.Element {
  return (
    <div class={`${s('tabContent')} ${s('overview')}`}>
      <div class={s('stack')}>
        <HealthScore result={result} />
        <StandardComplianceBadge compliance={result.standardCompliance} />
      </div>
      <div class={s('stack')}>
        <IdentityCard result={result} />
        <div class={s('card')}>
          <IssueList key={result.scannedAt} checks={result.checks} />
        </div>
      </div>
    </div>
  );
}

/**
Best-practice findings grouped by impact plus successful best-practice checks.
*/
export function BestPracticesTab({ result }: Properties): JSX.Element {
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
Security and third-party findings grouped by impact plus successful checks.
*/
export function SecurityTab({ result }: Properties): JSX.Element {
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
Network capture grid for requests recorded during the scan.
*/
export function NetworkTab({ result }: Properties): JSX.Element {
  const { capturedRequests } = buildFindingProjection(result).network;

  return (
    <div class={s('tabContent')}>
      <section class={s('card')}>
        <h2>
          Captured requests <span class="dataBadge">{capturedRequests.length}</span>
        </h2>
        <NetworkGrid requests={capturedRequests} />
      </section>
    </div>
  );
}

/**
JSON view of selected captured or inferred checkout fields and SDK metadata.
*/
export function RawConfigTab({ result }: Properties): JSX.Element {
  const sections = buildRawConfigSections(buildFindingProjection(result).rawConfig);

  return (
    <div class={s('tabContent')}>
      <h2 class="visuallyHidden">Extracted config</h2>
      {sections.map(({ title, text }) => (
        <CodeSection key={title} title={title} text={text} />
      ))}
    </div>
  );
}

/**
Lists skipped checks and the extracted skip reason for each entry.
*/
export function SkippedChecksTab({ result }: Properties): JSX.Element {
  const skipped = buildFindingProjection(result).skippedChecks;

  return (
    <div class={s('tabContent')}>
      <section class={s('card')}>
        <h2>
          Skipped checks <span class="dataBadge">{skipped.length}</span>
        </h2>
        <SkippedGrid checks={skipped} />
      </section>
    </div>
  );
}
