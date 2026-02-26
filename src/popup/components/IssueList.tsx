import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { CheckResult } from '~shared/types';
import { getImpactLevel, getRemediationText } from '~shared/utils';
import styles from './IssueList.module.css';

const s = (key: string): string => styles[key] ?? '';

interface Props {
  readonly checks: readonly CheckResult[];
  readonly expandWarningsByDefault?: boolean;
}

type ImpactPriority = 'high' | 'medium' | 'low';

const IMPACT_PRIORITY_ORDER: readonly ImpactPriority[] = ['high', 'medium', 'low'];
const IMPACT_PRIORITY_LABEL: Record<ImpactPriority, string> = {
  high: 'High Impact',
  medium: 'Medium Impact',
  low: 'Low Impact',
};

interface IssueItemProps {
  readonly check: CheckResult;
  readonly dotClass: string;
}

function IssueItem({ check, dotClass }: IssueItemProps): JSX.Element {
  const isIssue =
    check.severity === 'fail' || check.severity === 'warn' || check.severity === 'notice';
  const hasDetail = Boolean(check.detail ?? check.remediation ?? check.docsUrl ?? isIssue);
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
          {isIssue && <div class={s('remediation')}>{remediation}</div>}
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

function getImpactPriority(check: CheckResult): ImpactPriority {
  const impact = getImpactLevel(check);
  if (impact === 'high' || impact === 'low') {
    return impact;
  }
  return 'medium';
}

function sortChecksByPriorityThenTitle(a: CheckResult, b: CheckResult): number {
  const aPriority = getImpactPriority(a);
  const bPriority = getImpactPriority(b);
  const aRank = IMPACT_PRIORITY_ORDER.indexOf(aPriority);
  const bRank = IMPACT_PRIORITY_ORDER.indexOf(bPriority);
  if (aRank !== bRank) {
    return aRank - bRank;
  }
  return a.title.localeCompare(b.title);
}

/**
 * Renders issue checks grouped by severity and impact with expandable details.
 */
export function IssueList({ checks, expandWarningsByDefault = false }: Props): JSX.Element {
  const failures = checks.filter((c) => c.severity === 'fail').sort(sortChecksByPriorityThenTitle);
  const warnings = checks.filter((c) => c.severity === 'warn').sort(sortChecksByPriorityThenTitle);
  const notices = checks
    .filter((c) => c.severity === 'notice')
    .sort((a, b) => a.title.localeCompare(b.title));
  const [warningsExpanded, setWarningsExpanded] = useState(expandWarningsByDefault);

  useEffect(() => {
    if (expandWarningsByDefault) {
      setWarningsExpanded(true);
    }
  }, [expandWarningsByDefault]);

  const issueGroups: Record<ImpactPriority, CheckResult[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const failure of failures) {
    issueGroups[getImpactPriority(failure)].push(failure);
  }

  const warningGroups: Record<ImpactPriority, CheckResult[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const warning of warnings) {
    warningGroups[getImpactPriority(warning)].push(warning);
  }

  function handleWarningsToggle(event: Event): void {
    if (!(event.currentTarget instanceof HTMLDetailsElement)) {
      return;
    }
    setWarningsExpanded(event.currentTarget.open);
  }

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
          {IMPACT_PRIORITY_ORDER.map((priority) => {
            const items = issueGroups[priority];
            if (items.length === 0) {
              return null;
            }

            return (
              <div key={priority}>
                <div class={s('priorityHeader')}>
                  <span>{IMPACT_PRIORITY_LABEL[priority]}</span>
                  <span class={`${s('badge')} ${s('badgeFail')}`}>{items.length}</span>
                </div>
                <ul class={s('list')}>
                  {items.map((c) => (
                    <IssueItem key={c.id} check={c} dotClass={s('dot') + ' ' + s('dotFail')} />
                  ))}
                </ul>
              </div>
            );
          })}
        </details>
      )}
      {warnings.length > 0 && (
        <details class={s('section')} open={warningsExpanded} onToggle={handleWarningsToggle}>
          <summary class={s('sectionHeader')}>
            <span>Warnings</span>
            <span class={`${s('badge')} ${s('badgeWarn')}`}>{warnings.length}</span>
          </summary>
          {IMPACT_PRIORITY_ORDER.map((priority) => {
            const items = warningGroups[priority];
            if (items.length === 0) {
              return null;
            }

            return (
              <div key={priority}>
                <div class={s('priorityHeader')}>
                  <span>{IMPACT_PRIORITY_LABEL[priority]}</span>
                  <span class={`${s('badge')} ${s('badgeWarn')}`}>{items.length}</span>
                </div>
                <ul class={s('list')}>
                  {items.map((c) => (
                    <IssueItem key={c.id} check={c} dotClass={s('dot') + ' ' + s('dotWarn')} />
                  ))}
                </ul>
              </div>
            );
          })}
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
