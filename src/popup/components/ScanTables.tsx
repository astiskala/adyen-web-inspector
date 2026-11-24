import type { JSX } from 'preact';
import {
  type buildFindingProjection,
  ISSUE_LABELS,
  type IssueRow,
} from '../../shared/export-report.js';
import type { CheckResult } from '../../shared/types.js';
import { StatusTag } from './StatusTag.js';

type Projection = ReturnType<typeof buildFindingProjection>;

/**
A data grid of finding rows; no view needs to reformat remediation or links.
*/
export function FindingGrid({
  issues,
  label,
}: {
  readonly issues: readonly IssueRow[];
  readonly label: string;
}): JSX.Element {
  return (
    <table class="dataGrid" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">Severity</th>
          <th scope="col">Finding</th>
          <th scope="col">How to fix</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr key={issue.id} data-severity={issue.severity}>
            <td>
              <StatusTag tone={issue.severity}>{ISSUE_LABELS[issue.severity]}</StatusTag>
              <small>{issue.impact}</small>
            </td>
            <td>
              <strong>{issue.title}</strong>
              {issue.detail !== null && <small>{issue.detail}</small>}
            </td>
            <td>
              {issue.remediation}
              <small>
                <a href={issue.docsUrl} target="_blank" rel="noopener noreferrer">
                  Read documentation
                </a>
              </small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
A data grid of successful checks for the panel and report.
*/
export function SuccessGrid({
  checks,
  label,
}: {
  readonly checks: readonly CheckResult[];
  readonly label: string;
}): JSX.Element {
  return (
    <table class="dataGrid" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Check</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((check) => (
          <tr key={check.id}>
            <td>
              <StatusTag tone="pass">Pass</StatusTag>
            </td>
            <td>{check.title}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
Renders skipped checks and any reasons recorded by the check runner.
*/
export function SkippedGrid({
  checks,
}: {
  readonly checks: Projection['skippedChecks'];
}): JSX.Element {
  if (checks.length === 0) return <p class="muted">No checks were skipped.</p>;
  return (
    <table class="dataGrid" aria-label="Skipped checks">
      <thead>
        <tr>
          <th scope="col">Check</th>
          <th scope="col">Reason</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((check) => (
          <tr key={check.id}>
            <td>{check.title}</td>
            <td class="muted">{check.reason ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
Renders captured requests without turning page-controlled values into links.
*/
export function NetworkGrid({
  requests,
}: {
  readonly requests: Projection['network']['capturedRequests'];
}): JSX.Element {
  if (requests.length === 0) return <p class="muted">No Adyen requests captured.</p>;
  return (
    <table class="dataGrid" aria-label="Captured requests">
      <thead>
        <tr>
          <th scope="col">Type</th>
          <th scope="col">URL</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => (
          <tr key={`${request.type}-${request.url}-${request.statusCode}`}>
            <td>{request.type}</td>
            <td>
              <code>{request.url}</code>
            </td>
            <td>
              <HttpStatus code={request.statusCode} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HttpStatus({ code }: { readonly code: number }): JSX.Element {
  if (code >= 200 && code < 300) {
    return (
      <span class="dataBadge" data-tone="pass">
        {code}
      </span>
    );
  }
  return <span>{code === 0 ? '—' : code}</span>;
}
