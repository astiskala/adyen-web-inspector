import type { JSX } from 'preact';
import { groupIssuesByImpact, type IssueGroup, type IssueRow } from '../../shared/export-report.js';
import type { CheckResult } from '../../shared/types.js';
import styles from './IssueList.module.css';

const s = (key: string): string => styles[key] ?? '';

interface Props {
  readonly checks: readonly CheckResult[];
}

interface IssueItemProps {
  readonly issue: IssueRow;
  readonly dotClass: string;
}

function IssueItem({ issue, dotClass }: IssueItemProps): JSX.Element {
  return (
    <li class={s('item')}>
      <details>
        <summary class={s('summary')}>
          <span class={dotClass} />
          <span class={s('checkTitle')}>{issue.title}</span>
        </summary>
        <div class={s('detail')}>
          {issue.detail !== null && <div>{issue.detail}</div>}
          <div class={s('remediation')}>{issue.remediation}</div>
          <a class={s('docsLink')} href={issue.docsUrl} target="_blank" rel="noopener noreferrer">
            Documentation →
          </a>
        </div>
      </details>
    </li>
  );
}

interface ImpactGroupProps {
  readonly group: IssueGroup;
  readonly badgeClass: string;
  readonly dotClass: string;
}

function ImpactGroup({ group, badgeClass, dotClass }: ImpactGroupProps): JSX.Element {
  return (
    <div>
      <div class={s('priorityHeader')}>
        <span>{group.label}</span>
        <span class={`${s('badge')} ${badgeClass}`}>{group.issues.length}</span>
      </div>
      <ul class={s('list')}>
        {group.issues.map((issue) => (
          <IssueItem key={issue.id} issue={issue} dotClass={dotClass} />
        ))}
      </ul>
    </div>
  );
}

function issueGroupsWithSeverity(
  checks: readonly CheckResult[],
  severity: CheckResult['severity']
): IssueGroup[] {
  return groupIssuesByImpact(checks.filter((check) => check.severity === severity));
}

function countIssues(groups: readonly IssueGroup[]): number {
  return groups.flatMap((group) => group.issues).length;
}

/**
 * Renders issue rows from the finding projection by severity, then impact,
 * with expandable detail, remediation, and documentation.
 */
export function IssueList({ checks }: Props): JSX.Element {
  const failures = issueGroupsWithSeverity(checks, 'fail');
  const warnings = issueGroupsWithSeverity(checks, 'warn');
  const notices = issueGroupsWithSeverity(checks, 'notice').flatMap((group) => group.issues);

  if (failures.length === 0 && warnings.length === 0 && notices.length === 0) {
    return <div class={s('empty')}>No issues detected — everything looks good!</div>;
  }

  return (
    <div>
      {failures.length > 0 && (
        <details class={s('section')} open>
          <summary class={s('sectionHeader')}>
            <span>Issues</span>
            <span class={`${s('badge')} ${s('badgeFail')}`}>{countIssues(failures)}</span>
          </summary>
          {failures.map((group) => (
            <ImpactGroup
              key={group.impact}
              group={group}
              badgeClass={s('badgeFail')}
              dotClass={s('dot') + ' ' + s('dotFail')}
            />
          ))}
        </details>
      )}
      {warnings.length > 0 && (
        <details class={s('section')}>
          <summary class={s('sectionHeader')}>
            <span>Warnings</span>
            <span class={`${s('badge')} ${s('badgeWarn')}`}>{countIssues(warnings)}</span>
          </summary>
          {warnings.map((group) => (
            <ImpactGroup
              key={group.impact}
              group={group}
              badgeClass={s('badgeWarn')}
              dotClass={s('dot') + ' ' + s('dotWarn')}
            />
          ))}
        </details>
      )}
      {notices.length > 0 && (
        <details class={s('section')}>
          <summary class={s('sectionHeader')}>
            <span>Notices</span>
            <span class={`${s('badge')} ${s('badgeNotice')}`}>{notices.length}</span>
          </summary>
          <ul class={s('list')}>
            {notices.map((issue) => (
              <IssueItem key={issue.id} issue={issue} dotClass={s('dot') + ' ' + s('dotNotice')} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
