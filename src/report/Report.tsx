/**
Printable report — what the report page renders and prints: the finding
projection and implementation rows the popup and panel show, laid out for paper.
*/

import type { JSX } from 'preact';
import { HEALTH_TIER_COLORS, SEVERITY_COLORS, STATUS_COLORS } from '../shared/constants.js';
import type { ReportMetadata } from '../shared/export-metadata.js';
import {
  buildFindingProjection,
  buildRawConfigSections,
  implementationRows,
  summarizeImplementation,
  type IssueGroup,
} from '../shared/export-report.js';
import { STANDARD_COMPLIANCE_COPY } from '../shared/standard-compliance.js';
import type { CheckResult, ScanResult, StandardCompliance } from '../shared/types.js';
import { cssModule } from '../popup/components/css-module.js';
import styles from './Report.module.css';

const s = cssModule(styles);

type FindingProjection = ReturnType<typeof buildFindingProjection>;

interface Properties {
  readonly result: ScanResult;
  readonly metadata: ReportMetadata;
}

interface LabelledRow {
  readonly label: string;
  readonly value: string;
}

function LabelledTable({ rows }: { readonly rows: readonly LabelledRow[] }): JSX.Element {
  return (
    <table class={s('labelled')}>
      <tbody>
        {rows.map(({ label, value }) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Muted({ text }: { readonly text: string }): JSX.Element {
  return <p class={s('muted')}>{text}</p>;
}

function DocumentationLink({
  href,
  text,
}: {
  readonly href: string;
  readonly text: string;
}): JSX.Element {
  return (
    <a class={s('docsLink')} href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
}

function ScoreBlock({ health }: { readonly health: ScanResult['health'] }): JSX.Element {
  return (
    <div class={s('scoreBlock')}>
      <div class={s('scoreNumber')} style={`color:${HEALTH_TIER_COLORS[health.tier]}`}>
        {health.score}
      </div>
      <div class={s('scoreMeta')}>
        <strong>{health.tier}</strong>
        <br />
        {health.passing} of {health.total} checks passing
      </div>
    </div>
  );
}

function Compliance({ compliance }: { readonly compliance: StandardCompliance }): JSX.Element {
  const { compliant, reasons } = compliance;
  return (
    <div class={s('compliance')}>
      <div class={s('complianceHeader')}>
        <span
          class={s('complianceIcon')}
          style={`color:${compliant ? STATUS_COLORS.pass : STATUS_COLORS.fail}`}
        >
          {compliant ? '\u{2713}' : '\u{2717}'}
        </span>
        <span class={s('complianceLabel')}>
          {compliant ? STANDARD_COMPLIANCE_COPY.metLabel : STANDARD_COMPLIANCE_COPY.unmetLabel}
        </span>
      </div>
      {!compliant && reasons.length > 0 && (
        <ul class={s('reasons')}>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <div class={s('caveat')}>
        {STANDARD_COMPLIANCE_COPY.caveat} See the{' '}
        <DocumentationLink
          href={STANDARD_COMPLIANCE_COPY.checklistUrl}
          text={STANDARD_COMPLIANCE_COPY.checklistLabel}
        />
        {'.'}
      </div>
    </div>
  );
}

function IssueTable({
  groups,
  emptyMessage,
}: {
  readonly groups: readonly IssueGroup[];
  readonly emptyMessage: string;
}): JSX.Element {
  if (groups.length === 0) return <Muted text={emptyMessage} />;
  return (
    <table>
      <thead>
        <tr>
          <th class={s('status')}>Severity</th>
          <th>Finding</th>
          <th>Remediation</th>
        </tr>
      </thead>
      <tbody>
        {groups.flatMap((group) => [
          <tr key={group.impact} class={s('impactRow')}>
            <td colSpan={3}>
              {group.label} ({group.issues.length})
            </td>
          </tr>,
          ...group.issues.map((issue) => (
            <tr key={issue.id}>
              <td class={s('status')} style={`color:${SEVERITY_COLORS[issue.severity]}`}>
                {issue.severity}
              </td>
              <td>
                {issue.title}
                {issue.detail !== null && <small>{issue.detail}</small>}
              </td>
              <td>
                {issue.remediation}
                <br />
                <DocumentationLink href={issue.docsUrl} text="Read documentation" />
              </td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  );
}

function SuccessfulChecks({
  checks,
  emptyMessage,
}: {
  readonly checks: readonly CheckResult[];
  readonly emptyMessage: string;
}): JSX.Element {
  if (checks.length === 0) return <Muted text={emptyMessage} />;
  return (
    <table>
      <thead>
        <tr>
          <th class={s('status')}>Status</th>
          <th>Check</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((check) => (
          <tr key={check.id}>
            <td class={s('status')} style={`color:${STATUS_COLORS.pass}`}>
              pass
            </td>
            <td>{check.title}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SkippedChecks({
  checks,
}: {
  readonly checks: FindingProjection['skippedChecks'];
}): JSX.Element {
  return (
    <table>
      <thead>
        <tr>
          <th>Check</th>
          <th>Skip Reason</th>
        </tr>
      </thead>
      <tbody>
        {checks.length === 0 ? (
          <tr>
            <td colSpan={2}>No checks were skipped.</td>
          </tr>
        ) : (
          checks.map((check) => (
            <tr key={check.id}>
              <td>{check.title}</td>
              <td class={s('muted')}>{check.reason ?? '—'}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function Network({ network }: { readonly network: FindingProjection['network'] }): JSX.Element {
  const requests = network.capturedRequests;
  return (
    <>
      <h3>Captured Requests</h3>
      {requests.length === 0 ? (
        <Muted text="No Adyen requests captured." />
      ) : (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>URL</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={`${request.type}-${request.url}-${request.statusCode}`}>
                <td>{request.type}</td>
                <td class={s('url')}>{request.url}</td>
                <td>{request.statusCode === 0 ? '—' : request.statusCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
The printable report for one scan result.
*/
export function Report({ result, metadata }: Properties): JSX.Element {
  const date = new Date(result.scannedAt).toLocaleString();
  const projection = buildFindingProjection(result);

  return (
    <main class={s('report')}>
      <h1>Adyen Web Inspector</h1>
      <LabelledTable
        rows={[
          { label: 'Inspected URL', value: result.pageUrl },
          { label: 'Scanned At', value: date },
          { label: 'Extension Version', value: metadata.extensionVersion },
          { label: 'Browser', value: metadata.browser },
        ]}
      />
      <ScoreBlock health={result.health} />
      <Compliance compliance={result.standardCompliance} />

      <h2>Implementation Attributes</h2>
      <LabelledTable rows={implementationRows(summarizeImplementation(result))} />

      <h2>Best Practices</h2>
      <IssueTable
        groups={projection.bestPractices.issueGroups}
        emptyMessage="No best-practice issues identified."
      />

      <h2>Security</h2>
      <IssueTable
        groups={projection.security.issueGroups}
        emptyMessage="No security issues identified."
      />

      <h2>Successful Checks</h2>
      <h3>Best Practices</h3>
      <SuccessfulChecks
        checks={projection.bestPractices.successfulChecks}
        emptyMessage="No successful best-practice checks recorded."
      />
      <h3>Security</h3>
      <SuccessfulChecks
        checks={projection.security.successfulChecks}
        emptyMessage="No successful security checks recorded."
      />

      <h2>Skipped Checks</h2>
      <SkippedChecks checks={projection.skippedChecks} />

      <h2>Network</h2>
      <Network network={projection.network} />

      <h2>Extracted Config</h2>
      {buildRawConfigSections(projection.rawConfig).map(({ title, text }) => (
        <div key={title}>
          <h3>{title}</h3>
          <pre class={s('code')}>{text}</pre>
        </div>
      ))}

      <div class={s('footer')}>
        Generated by Adyen Web Inspector v{metadata.extensionVersion} — {date}
      </div>
    </main>
  );
}
