import type { JSX } from 'preact';
import { groupIssuesByImpact, ISSUE_STATUSES, type IssueRow } from '../../shared/export-report.js';
import type { CheckResult } from '../../shared/types.js';
import { StatusTag } from './StatusTag.js';
import styles from './IssueList.module.css';
import { cssModule } from './css-module.js';

const s = cssModule(styles);

interface Properties {
  readonly checks: readonly CheckResult[];
  readonly detailed?: boolean;
}

function IssueItem({
  issue,
  detailed,
}: {
  readonly issue: IssueRow;
  readonly detailed: boolean;
}): JSX.Element {
  if (!detailed) return <li class={s('item')}>{issue.title}</li>;

  return (
    <li class={s('item')}>
      <details>
        <summary class={s('summary')}>{issue.title}</summary>
        <div class={s('detail')}>
          <p class={s('impact')}>{issue.impact}</p>
          {issue.detail !== null && <p>{issue.detail}</p>}
          <p>
            <strong>Fix:</strong> {issue.remediation}
          </p>
          <a href={issue.docsUrl} target="_blank" rel="noopener noreferrer">
            Read documentation
          </a>
        </div>
      </details>
    </li>
  );
}

/**
Presents the check groups, with expandable fixes and documentation in Detailed.
*/
export function IssueList({ checks, detailed = true }: Properties): JSX.Element {
  const groups = groupIssuesByImpact(checks);
  const issues = groups.flatMap((group) => group.issues);
  const sections = ISSUE_STATUSES.map(({ severity, label }) => ({
    severity,
    label,
    rows: issues.filter((issue) => issue.severity === severity),
  })).filter(({ rows }) => rows.length > 0);
  const hasFailuresOrWarnings = issues.some(({ severity }) => severity !== 'notice');

  return (
    <section class={s('checks')} aria-label="Checks">
      <h2>Checks</h2>
      {!hasFailuresOrWarnings && (
        <p class={s('empty')}>
          <StatusTag tone="pass" plain>
            No fails or warnings.
          </StatusTag>
        </p>
      )}
      {sections.map(({ severity, label, rows }) => (
        <details key={severity} class={s('section')} open={severity === sections[0]?.severity}>
          <summary class={s('sectionHeader')}>
            <StatusTag tone={severity} plain>
              {label}
            </StatusTag>
            <span class={s('count')}>{rows.length}</span>
          </summary>
          <ul class={s('list')}>
            {rows.map((issue) => (
              <IssueItem key={issue.id} issue={issue} detailed={detailed} />
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
