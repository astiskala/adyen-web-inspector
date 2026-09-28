import type { JSX } from 'preact';
import { groupIssuesByImpact, type ImpactGroupChecks } from '../../shared/export-report.js';
import type { CheckResult } from '../../shared/types.js';
import { getRemediationText, IMPACT_LABELS, isIssue } from '../../shared/results.js';
import styles from './IssueList.module.css';

const s = (key: string): string => styles[key] ?? '';

interface Props {
  readonly checks: readonly CheckResult[];
}

interface IssueItemProps {
  readonly check: CheckResult;
  readonly dotClass: string;
}

function IssueItem({ check, dotClass }: IssueItemProps): JSX.Element {
  const showRemediation = isIssue(check);
  const hasDetail = Boolean(check.detail ?? check.remediation ?? check.docsUrl ?? showRemediation);
  const remediation = getRemediationText(check);

  if (!hasDetail) {
    return (
      <li class={s('item')}>
        <div class={s('summary')}>
          <span class={dotClass} />
          <span class={s('checkTitle')}>{check.title}</span>
        </div>
      </li>
    );
  }

  return (
    <li class={s('item')}>
      <details>
        <summary class={s('summary')}>
          <span class={dotClass} />
          <span class={s('checkTitle')}>{check.title}</span>
        </summary>
        <div class={s('detail')}>
          {check.detail !== undefined && <div>{check.detail}</div>}
          {showRemediation && <div class={s('remediation')}>{remediation}</div>}
          {check.docsUrl !== undefined && (
            <a class={s('docsLink')} href={check.docsUrl} target="_blank" rel="noopener noreferrer">
              Documentation →
            </a>
          )}
        </div>
      </details>
    </li>
  );
}

interface ImpactGroupProps {
  readonly group: ImpactGroupChecks;
  readonly badgeClass: string;
  readonly dotClass: string;
}

function ImpactGroup({ group, badgeClass, dotClass }: ImpactGroupProps): JSX.Element {
  return (
    <div>
      <div class={s('priorityHeader')}>
        <span>{IMPACT_LABELS[group.impact]}</span>
        <span class={`${s('badge')} ${badgeClass}`}>{group.checks.length}</span>
      </div>
      <ul class={s('list')}>
        {group.checks.map((c) => (
          <IssueItem key={c.id} check={c} dotClass={dotClass} />
        ))}
      </ul>
    </div>
  );
}

function byTitle(a: CheckResult, b: CheckResult): number {
  return a.title.localeCompare(b.title);
}

/**
 * Renders issue checks grouped by severity and impact with expandable details.
 */
export function IssueList({ checks }: Props): JSX.Element {
  const failures = checks.filter((c) => c.severity === 'fail');
  const warnings = checks.filter((c) => c.severity === 'warn');
  const notices = checks.filter((c) => c.severity === 'notice').toSorted(byTitle);

  if (failures.length === 0 && warnings.length === 0 && notices.length === 0) {
    return <div class={s('empty')}>No issues detected — everything looks good!</div>;
  }

  return (
    <div>
      {failures.length > 0 && (
        <details class={s('section')} open>
          <summary class={s('sectionHeader')}>
            <span>Issues</span>
            <span class={`${s('badge')} ${s('badgeFail')}`}>{failures.length}</span>
          </summary>
          {groupIssuesByImpact(failures).map((group) => (
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
            <span class={`${s('badge')} ${s('badgeWarn')}`}>{warnings.length}</span>
          </summary>
          {groupIssuesByImpact(warnings).map((group) => (
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
            {notices.map((c) => (
              <IssueItem key={c.id} check={c} dotClass={s('dot') + ' ' + s('dotNotice')} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
