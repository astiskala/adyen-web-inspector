/**
 * Callback source — the Scan's reading of captured onSubmit and beforeSubmit
 * source for the callback checks. It owns when source can be read at all
 * (captured checkout or component configuration, outside Sessions flow), the
 * uncertainty of source cut off at the capture limit, and the static patterns.
 * The patterns are heuristics: they cannot verify runtime callback behaviour,
 * so each check keeps its own severity decision.
 */

import { CALLBACK_SOURCE_LIMIT } from '../../shared/checkout-config-schema.js';
import { hasCapturedCheckoutConfig, readCheckoutField } from '../../shared/scan-evidence.js';
import type { IntegrationFlow, ScanPayload } from '../../shared/types.js';

interface UnhandledOnSubmitFilters {
  readonly paymentMethod: boolean;
  readonly actionCode: boolean;
}

const STRING_LITERAL_PATTERN = /['"`][^'"`\n]+['"`]/;
const PAYMENT_METHOD_SELECTOR_PATTERN =
  /\bpaymentMethod(?:\?\.)?\.type\b|\bpaymentMethod\s*\[\s*['"]type['"]\s*\]/;
const ACTION_CODE_SELECTOR_PATTERN =
  /\bresultCode\b|\baction(?:\?\.)?\.type\b|\baction\s*\[\s*['"]type['"]\s*\]/;

const WHITESPACE_CHARS: ReadonlySet<string | undefined> = new Set([' ', '\n', '\r', '\t', '\f']);

function isWhitespaceChar(char: string | undefined): boolean {
  return WHITESPACE_CHARS.has(char);
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (isWhitespaceChar(source[index])) {
    index += 1;
  }
  return index;
}

function findMatchingDelimiter(
  source: string,
  start: number,
  openDelimiter: string,
  closeDelimiter: string
): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === openDelimiter) {
      depth += 1;
      continue;
    }
    if (char === closeDelimiter) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findStatementEnd(source: string, start: number): number {
  const firstToken = source[start];
  if (firstToken === '{') {
    return findMatchingDelimiter(source, start, '{', '}');
  }

  const semicolonIndex = source.indexOf(';', start);
  if (semicolonIndex !== -1) {
    return semicolonIndex;
  }

  const newlineIndex = source.indexOf('\n', start);
  if (newlineIndex !== -1) {
    return newlineIndex;
  }

  return source.length - 1;
}

interface ParsedSwitchStatement {
  readonly malformed: boolean;
  readonly nextSearchIndex: number;
  readonly condition?: string;
  readonly block?: string;
}

function parseSwitchStatement(source: string, switchStart: number): ParsedSwitchStatement {
  const conditionStart = source.indexOf('(', switchStart);
  const conditionEnd = findMatchingDelimiter(source, conditionStart, '(', ')');
  if (conditionEnd === -1) {
    return { malformed: true, nextSearchIndex: source.length };
  }

  const condition = source.slice(conditionStart + 1, conditionEnd);
  const blockStart = skipWhitespace(source, conditionEnd + 1);
  if (source[blockStart] !== '{') {
    return { malformed: false, nextSearchIndex: conditionEnd + 1, condition };
  }

  const blockEnd = findMatchingDelimiter(source, blockStart, '{', '}');
  if (blockEnd === -1) {
    return { malformed: true, nextSearchIndex: source.length };
  }

  return {
    malformed: false,
    nextSearchIndex: blockEnd + 1,
    condition,
    block: source.slice(blockStart + 1, blockEnd),
  };
}

function hasStringCasesWithoutDefault(switchBlock: string): boolean {
  const hasStringCases = /\bcase\s*['"`][^'"`\n]+['"`]\s*:/.test(switchBlock);
  const hasDefaultCase = /\bdefault\s*:/.test(switchBlock);
  return hasStringCases && !hasDefaultCase;
}

function hasUnhandledSelectorIfStatement(source: string, selectorPattern: RegExp): boolean {
  const ifPattern = /\bif\s*\(/g;
  let match = ifPattern.exec(source);

  while (match !== null) {
    const conditionStart = source.indexOf('(', match.index);
    const conditionEnd = findMatchingDelimiter(source, conditionStart, '(', ')');
    if (conditionEnd === -1) return false;

    const condition = source.slice(conditionStart + 1, conditionEnd);
    const hasSelector = selectorPattern.test(condition);
    const hasSpecificLiteral = STRING_LITERAL_PATTERN.test(condition);
    if (hasSelector && hasSpecificLiteral) {
      const statementStart = skipWhitespace(source, conditionEnd + 1);
      const statementEnd = findStatementEnd(source, statementStart);
      if (statementEnd === -1) return false;

      const trailingTokenStart = skipWhitespace(source, statementEnd + 1);
      if (!source.startsWith('else', trailingTokenStart)) return true;
    }

    ifPattern.lastIndex = conditionEnd + 1;
    match = ifPattern.exec(source);
  }

  return false;
}

function hasUnhandledSelectorSwitchStatement(source: string, selectorPattern: RegExp): boolean {
  const switchPattern = /\bswitch\s*\(/g;
  let match = switchPattern.exec(source);

  while (match !== null) {
    const parsed = parseSwitchStatement(source, match.index);
    if (parsed.malformed) return false;

    if (
      parsed.condition !== undefined &&
      parsed.block !== undefined &&
      selectorPattern.test(parsed.condition) &&
      hasStringCasesWithoutDefault(parsed.block)
    ) {
      return true;
    }

    switchPattern.lastIndex = parsed.nextSearchIndex;
    match = switchPattern.exec(source);
  }

  return false;
}

/**
 * Detects onSubmit branches that select specific payment methods or action
 * codes without an else or default fallback.
 */
function detectUnhandledOnSubmitFilters(source: string): UnhandledOnSubmitFilters {
  return {
    paymentMethod:
      hasUnhandledSelectorIfStatement(source, PAYMENT_METHOD_SELECTOR_PATTERN) ||
      hasUnhandledSelectorSwitchStatement(source, PAYMENT_METHOD_SELECTOR_PATTERN),
    actionCode:
      hasUnhandledSelectorIfStatement(source, ACTION_CODE_SELECTOR_PATTERN) ||
      hasUnhandledSelectorSwitchStatement(source, ACTION_CODE_SELECTOR_PATTERN),
  };
}

interface StateDataForwarding {
  /** `complete`: state.data is used as a whole; `partial`: only selected fields are read. */
  readonly kind: 'complete' | 'partial' | 'unknown';
  readonly fields: readonly string[];
}

const IDENTIFIER_PATTERN = /^[A-Z_$][\w$]*$/i;
const NOT_MEMBER_ACCESS = String.raw`(?!\s*(?:\?\.|\.|\[))`;

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('$', String.raw`\$`);
}

function findCallbackBody(source: string): { param: string; body: string } | null {
  let trimmed = source.trimStart();
  const propertyPrefix = /^[A-Z_$][\w$]*\s*:\s*/i.exec(trimmed);
  if (propertyPrefix !== null) trimmed = trimmed.slice(propertyPrefix[0].length);
  const bareArrow = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(trimmed);
  if (bareArrow?.[1] !== undefined) {
    return { param: bareArrow[1], body: trimmed.slice(bareArrow[0].length) };
  }

  const paramsStart = trimmed.indexOf('(');
  if (paramsStart === -1) return null;
  const paramsEnd = findMatchingDelimiter(trimmed, paramsStart, '(', ')');
  if (paramsEnd === -1) return null;

  const param = trimmed
    .slice(paramsStart + 1, paramsEnd)
    .split(',')[0]
    ?.split('=')[0]
    ?.trim();
  if (param === undefined || !IDENTIFIER_PATTERN.test(param)) return null;
  return { param, body: trimmed.slice(paramsEnd + 1) };
}

/**
 * Classifies whether onSubmit forwards the whole `state.data` object or only
 * selected fields such as `state.data.paymentMethod`. Destructured or
 * wholesale-forwarded `state` is `unknown`.
 */
function detectStateDataForwarding(source: string): StateDataForwarding {
  const callback = findCallbackBody(source);
  if (callback === null) return { kind: 'unknown', fields: [] };

  // Excludes member access such as `other.state` while still matching `...state`.
  const state = String.raw`(?<![\w$])(?<![^.]\.)${escapeIdentifier(callback.param)}`;
  const data = String.raw`${state}\s*(?:\?\.|\.)\s*data\b`;
  const wholeState = new RegExp(String.raw`${state}\b${NOT_MEMBER_ACCESS}`);
  const wholeData = new RegExp(`${data}${NOT_MEMBER_ACCESS}`);
  const fieldAccess = new RegExp(
    String.raw`${data}\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\b${NOT_MEMBER_ACCESS}`,
    'g'
  );

  if (wholeData.test(callback.body)) return { kind: 'complete', fields: [] };
  if (wholeState.test(callback.body)) return { kind: 'unknown', fields: [] };

  const fields = [
    ...new Set(
      [...callback.body.matchAll(fieldAccess)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]]
      )
    ),
  ].toSorted((a, b) => a.localeCompare(b));
  return fields.includes('paymentMethod')
    ? { kind: 'partial', fields }
    : { kind: 'unknown', fields: [] };
}

/** Returns true when callback source appears to guard against duplicate submissions. */
function detectsMultipleSubmissions(source: string): boolean {
  // Looks for common patterns like .disabled = true, setLoading(true), .setAttribute('disabled', ...), etc.
  const patterns = [
    /\.disabled\s*=\s*(?:true|1)/,
    /setLoading\s*\(\s*(?:true|1)\s*\)/,
    /\.setAttribute\s*\(\s*['"]disabled['"]/,
    /\.classList\.add\s*\(\s*['"](?:is-)?loading['"]/,
    /this\.isSubmitting\s*=\s*true/,
  ];
  return patterns.some((p) => p.test(source));
}

/** Why captured onSubmit source cannot be read. */
type SourceUnavailable = 'no-config' | 'sessions-flow' | 'no-source';

/** What static inspection of captured onSubmit source found. */
export type OnSubmitSource =
  | { readonly status: 'unavailable'; readonly reason: SourceUnavailable }
  | {
      readonly status: 'read';
      /** The source reached the capture limit, so code after the cut-off was not seen. */
      readonly truncated: boolean;
      /** Branches that select payment methods or action codes without a fallback. */
      readonly unhandledFilters: UnhandledOnSubmitFilters;
      readonly stateData: StateDataForwarding;
      /** Calls `actions.resolve()` or `actions.reject()`, the v6 pattern. */
      readonly resolvesActions: boolean;
      /** Calls `component.setStatus()` or `component.handleAction()`, the v5 pattern. */
      readonly usesComponentCallbacks: boolean;
    };

/** Whether callback source shows a duplicate-submission guard. */
type SubmissionGuard =
  | { readonly status: 'unavailable'; readonly reason: 'no-config' | 'no-source' }
  | { readonly status: 'read'; readonly guarded: boolean };

type CallbackSourceKey = 'onSubmitSource' | 'beforeSubmitSource';

/** Callback source only ever comes from captured options, never from inferred values. */
function readSource(payload: ScanPayload, key: CallbackSourceKey): string {
  const evidence = readCheckoutField(payload, key, { includeInferred: false });
  return evidence.state === 'present' ? evidence.value : '';
}

/**
 * Reads the captured onSubmit source. It is unavailable without captured
 * checkout or component configuration, and in Sessions flow, where Adyen Web
 * handles submission itself.
 */
export function readOnSubmitSource(payload: ScanPayload, flow: IntegrationFlow): OnSubmitSource {
  if (!hasCapturedCheckoutConfig(payload.page))
    return { status: 'unavailable', reason: 'no-config' };
  if (flow === 'sessions') return { status: 'unavailable', reason: 'sessions-flow' };
  const source = readSource(payload, 'onSubmitSource');
  if (source === '') return { status: 'unavailable', reason: 'no-source' };

  return {
    status: 'read',
    truncated: source.length >= CALLBACK_SOURCE_LIMIT,
    unhandledFilters: detectUnhandledOnSubmitFilters(source),
    stateData: detectStateDataForwarding(source),
    resolvesActions: /actions\.(?:resolve|reject)\(/.test(source),
    usesComponentCallbacks: /component\.(?:setStatus|handleAction)\(/.test(source),
  };
}

/** Looks for a duplicate-submission guard in captured onSubmit and beforeSubmit source. */
export function readSubmissionGuard(payload: ScanPayload): SubmissionGuard {
  if (!hasCapturedCheckoutConfig(payload.page))
    return { status: 'unavailable', reason: 'no-config' };
  const combined = `${readSource(payload, 'onSubmitSource')}\n${readSource(payload, 'beforeSubmitSource')}`;
  if (combined.trim() === '') return { status: 'unavailable', reason: 'no-source' };
  return { status: 'read', guarded: detectsMultipleSubmissions(combined) };
}
