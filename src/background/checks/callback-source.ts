/**
Callback source — the Scan's reading of captured onSubmit and beforeSubmit
source for the callback checks. It owns when source can be read at all
(captured checkout or component configuration, outside Sessions flow), the
uncertainty of source cut off at the capture limit, and the static patterns.
The patterns are heuristics: they cannot verify runtime callback behaviour,
so each check keeps its own severity decision.
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
const EXIT_PATTERN = /\b(?:return|throw)\b/;

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
    if (char !== closeDelimiter) {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return index;
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
  return newlineIndex === -1 ? source.length - 1 : newlineIndex;
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

/**
A selective branch leaves submissions unhandled when no code after it
resolves them, or when it exits without resolving its own. A branch that
only adjusts data falls through to the resolution after it. `handoff`
matches code that resolves the submission or hands `actions` on.
*/
function areSubmissionsLeftUnhandled(branch: string, codeAfter: string, handoff: RegExp): boolean {
  return !handoff.test(codeAfter) || (EXIT_PATTERN.test(branch) && !handoff.test(branch));
}

function hasStringCasesWithoutDefault(switchBlock: string): boolean {
  const hasStringCases = /\bcase\s*['"`][^'"`\n]+['"`]\s*:/.test(switchBlock);
  const hasDefaultCase = /\bdefault\s*:/.test(switchBlock);
  return hasStringCases && !hasDefaultCase;
}

function hasUnhandledSelectorIfStatement(
  source: string,
  selectorPattern: RegExp,
  handoff: RegExp
): boolean {
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
      if (
        !source.startsWith('else', trailingTokenStart) &&
        areSubmissionsLeftUnhandled(
          source.slice(statementStart, statementEnd + 1),
          source.slice(statementEnd + 1),
          handoff
        )
      ) {
        return true;
      }
    }

    ifPattern.lastIndex = conditionEnd + 1;
    match = ifPattern.exec(source);
  }

  return false;
}

function hasUnhandledSelectorSwitchStatement(
  source: string,
  selectorPattern: RegExp,
  handoff: RegExp
): boolean {
  const switchPattern = /\bswitch\s*\(/g;
  let match = switchPattern.exec(source);

  while (match !== null) {
    const parsed = parseSwitchStatement(source, match.index);
    if (parsed.malformed) return false;

    if (
      parsed.condition !== undefined &&
      parsed.block !== undefined &&
      selectorPattern.test(parsed.condition) &&
      hasStringCasesWithoutDefault(parsed.block) &&
      areSubmissionsLeftUnhandled(parsed.block, source.slice(parsed.nextSearchIndex), handoff)
    ) {
      return true;
    }

    switchPattern.lastIndex = parsed.nextSearchIndex;
    match = switchPattern.exec(source);
  }

  return false;
}

/**
Detects onSubmit branches that select specific payment methods or action
codes without an else or default fallback, when other submissions cannot
reach a resolution after them.
*/
function detectUnhandledOnSubmitFilters(source: string, handoff: RegExp): UnhandledOnSubmitFilters {
  const isUnhandled = (selector: RegExp): boolean =>
    hasUnhandledSelectorIfStatement(source, selector, handoff) ||
    hasUnhandledSelectorSwitchStatement(source, selector, handoff);
  return {
    paymentMethod: isUnhandled(PAYMENT_METHOD_SELECTOR_PATTERN),
    actionCode: isUnhandled(ACTION_CODE_SELECTOR_PATTERN),
  };
}

interface StateDataForwarding {
  /**
  `whole`: state.data is passed on as one object, spread, or destructured
  with a rest element; `selected`: only named fields, including
  `paymentMethod`, are read.
  */
  readonly kind: 'whole' | 'selected' | 'unknown';
  /**
  Fields read from state.data by name, sorted.
  */
  readonly fields: readonly string[];
  /**
  Fields the merchant server should set that onSubmit combines with state.data, sorted.
  */
  readonly serverFields: readonly string[];
}

const IDENTIFIER = String.raw`[A-Za-z_$][\w$]*`;
/**
A parameter that is a plain name, optionally with a default value.
*/
const PARAMETER_NAME_PATTERN = /^\s*([a-z_$][\w$]*)\s*(?:=|$)/i;
const NOT_MEMBER_ACCESS = String.raw`(?!\s*(?:\?\.|\.|\[))`;
const SERVER_FIELD = '(amount|merchantAccount|reference|shopperReference)';
const SERVER_FIELD_KEY = new RegExp(String.raw`[{,]\s*['"]?${SERVER_FIELD}['"]?(?=\s*[:,}])`, 'g');
/**
Matches comments, and string literals so that `//` inside a URL is not read as a comment.
*/
// ponytail: regex literals and `${}` inside template literals are not tokenised.
const COMMENT_OR_STRING = /(["'`])(?:\\.|(?!\1)[^\\])*\1|\/\*[\s\S]*?\*\/|\/\/.*/g;
const LOG_CALL = /\bconsole\s*\.\s*\w+\s*\(/;

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('$', String.raw`\$`);
}

function withoutComments(source: string): string {
  return source.replaceAll(COMMENT_OR_STRING, (match, quote?: string) =>
    quote === undefined ? ' ' : match
  );
}

/**
Removes console calls, so logging state.data does not count as sending it.
*/
function withoutLogging(source: string): string {
  let result = source;
  let match = LOG_CALL.exec(result);
  while (match !== null) {
    const end = findMatchingDelimiter(result, match.index + match[0].length - 1, '(', ')');
    result = `${result.slice(0, match.index)} ${end === -1 ? '' : result.slice(end + 1)}`;
    match = LOG_CALL.exec(result);
  }
  return result;
}

/**
The object literal around `index`, or an empty string outside one.
*/
function enclosingObject(source: string, index: number): string {
  let depth = 0;
  for (let position = index - 1; position >= 0; position -= 1) {
    const char = source[position];
    if (char === '}') depth += 1;
    if (char === '{' && depth === 0) {
      const end = findMatchingDelimiter(source, position, '{', '}');
      return end === -1 ? source.slice(position) : source.slice(position, end + 1);
    }
    if (char === '{') depth -= 1;
  }
  return '';
}

function isDefined(value: string | undefined): value is string {
  return value !== undefined;
}

function sortedUnique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter(isDefined))].toSorted((a, b) => a.localeCompare(b));
}

/**
Server-owned fields assigned on state.data or set beside a `...state.data` spread.
*/
function readServerFields(body: string, data: string): string[] {
  const assigned = new RegExp(String.raw`${data}\s*\.\s*${SERVER_FIELD}\s*=(?!=)`, 'g');
  const spread = new RegExp(String.raw`\.\.\.\s*${data}${NOT_MEMBER_ACCESS}`, 'g');
  return sortedUnique([
    ...body.matchAll(assigned).map((match) => match[1]),
    ...body
      .matchAll(spread)
      .flatMap((match) => enclosingObject(body, match.index).matchAll(SERVER_FIELD_KEY))
      .map((match) => match[1]),
  ]);
}

function destructuredKeys(pattern: string): (string | undefined)[] {
  return pattern.split(',').map((entry) => /^\s*([A-Z_$][\w$]*)/i.exec(entry)?.[1]);
}

/**
The parameter names of `onSubmit(state, component, actions)` as the callback
declares them, so minified names such as `(e, t, n)` are read too.
*/
interface CallbackSignature {
  /**
  The state parameter, or null when it is destructured or no parameter list was found.
  */
  readonly state: string | null;
  readonly component: string;
  readonly actions: string;
  /**
  Source after the parameter list.
  */
  readonly body: string;
}

/**
Simple parameter names, undefined where a parameter is destructured.
Destructuring and computed defaults can hold commas, so then only the first name is certain.
*/
function readParameterNames(parameters: string): (string | undefined)[] {
  const names = parameters
    .split(',')
    .map((parameter) => PARAMETER_NAME_PATTERN.exec(parameter)?.[1]);
  return /[{[(]/.test(parameters) ? names.slice(0, 1) : names;
}

function readParameters(source: string): { names: (string | undefined)[]; body: string } {
  const bareArrow = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(source);
  if (bareArrow?.[1] !== undefined) {
    return { names: [bareArrow[1]], body: source.slice(bareArrow[0].length) };
  }
  const start = source.indexOf('(');
  const end = start === -1 ? -1 : findMatchingDelimiter(source, start, '(', ')');
  return end === -1
    ? { names: [], body: '' }
    : { names: readParameterNames(source.slice(start + 1, end)), body: source.slice(end + 1) };
}

function readSignature(source: string): CallbackSignature {
  const trimmed = source.trimStart();
  const propertyPrefix = /^[A-Z_$][\w$]*\s*:\s*/i.exec(trimmed);
  const { names, body } = readParameters(trimmed.slice(propertyPrefix?.[0].length ?? 0));
  const [state = null, component = 'component', actions = 'actions'] = names;
  return { state, component, actions, body };
}

/**
A reference to `name` that is not a member of another object, such as
`other.state`, while still matching a spread such as `...state`.
*/
function reference(name: string): string {
  return String.raw`(?<![\w$])(?<![^.]\.)${escapeIdentifier(name)}(?![\w$])`;
}

/**
Classifies whether onSubmit passes the whole `state.data` object on or only
selected fields such as `state.data.paymentMethod`, and which server-owned
fields it combines with state.data. Logging is ignored. A destructured
parameter or wholesale-forwarded `state` is `unknown`.
*/
function detectStateDataForwarding(signature: CallbackSignature): StateDataForwarding {
  if (signature.state === null) return { kind: 'unknown', fields: [], serverFields: [] };
  const body = withoutLogging(signature.body);

  const state = reference(signature.state);
  const data = String.raw`${state}\s*(?:\?\.|\.)\s*data\b`;
  const serverFields = readServerFields(body, data);
  const destructuring = new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${data}${NOT_MEMBER_ACCESS}`, 'g');
  const patterns = body
    .matchAll(destructuring)
    .map((match) => match[1])
    .filter(isDefined)
    .toArray();
  const remainder = body.replaceAll(destructuring, ' ');
  if (
    patterns.some((pattern) => pattern.includes('...')) ||
    new RegExp(`${data}${NOT_MEMBER_ACCESS}`).test(remainder)
  ) {
    return { kind: 'whole', fields: [], serverFields };
  }
  if (new RegExp(`${state}${NOT_MEMBER_ACCESS}`).test(remainder)) {
    return { kind: 'unknown', fields: [], serverFields };
  }

  const fieldAccess = new RegExp(
    String.raw`${data}\s*(?:(?:\?\.|\.)\s*(${IDENTIFIER})\b|(?:\?\.)?\s*\[\s*['"](${IDENTIFIER})['"]\s*\])${NOT_MEMBER_ACCESS}`,
    'g'
  );
  const fields = sortedUnique([
    ...patterns.flatMap(destructuredKeys),
    ...remainder.matchAll(fieldAccess).map((match) => match[1] ?? match[2]),
  ]);
  return fields.includes('paymentMethod')
    ? { kind: 'selected', fields, serverFields }
    : { kind: 'unknown', fields: [], serverFields };
}

/**
Duplicate-submission guards; minifiers write `true` as `!0`.
*/
const SUBMISSION_GUARD_PATTERNS = [
  /\.disabled\s*=\s*(?:true|!0|1)/,
  /\bset(?:Is)?(?:Loading|Submitting|Processing)\s*\(\s*(?:true|!0|1)\s*\)/,
  /\.setAttribute\s*\(\s*['"]disabled['"]/,
  /\.classList\.add\s*\(\s*['"](?:is-)?loading['"]/,
  /\bis(?:Submitting|Processing)\s*=\s*(?:true|!0)/,
];

/**
Returns true when callback source appears to guard against duplicate submissions.
*/
function hasMultipleSubmissionDetection(source: string): boolean {
  return SUBMISSION_GUARD_PATTERNS.some((pattern) => pattern.test(source));
}

/**
What static inspection of one captured onSubmit source found.
*/
interface OnSubmitReading {
  /**
  The source reached the capture limit, so code after the cut-off was not seen.
  */
  readonly truncated: boolean;
  /**
  Branches that select payment methods or action codes without a fallback.
  */
  readonly unhandledFilters: UnhandledOnSubmitFilters;
  readonly stateData: StateDataForwarding;
  /**
  Calls `actions.resolve()` or `actions.reject()`, the v6 pattern.
  */
  readonly resolvesActions: boolean;
  /**
  Calls `component.setStatus()` or `component.handleAction()`, the v5 pattern.
  */
  readonly usesComponentCallbacks: boolean;
}

function readOnSubmit(captured: string): OnSubmitReading {
  const source = withoutComments(captured);
  const signature = readSignature(source);
  const actions = reference(signature.actions);
  const component = reference(signature.component);
  const handoff = new RegExp(String.raw`${actions}|${component}\s*\.\s*handleAction\s*\(`);
  return {
    truncated: captured.length >= CALLBACK_SOURCE_LIMIT,
    unhandledFilters: detectUnhandledOnSubmitFilters(source, handoff),
    stateData: detectStateDataForwarding(signature),
    resolvesActions: new RegExp(String.raw`${actions}\s*\.\s*(?:resolve|reject)\s*\(`).test(source),
    usesComponentCallbacks: new RegExp(
      String.raw`${component}\s*\.\s*(?:setStatus|handleAction)\s*\(`
    ).test(source),
  };
}

/**
How every onSubmit source together forwards state.data: any whole object
makes it whole, and any unreadable source makes it unknown, so no source
goes unverified. Fields are those every source reads.
*/
function combineStateData(readings: readonly StateDataForwarding[]): StateDataForwarding {
  const serverFields = sortedUnique(readings.flatMap((reading) => reading.serverFields));
  for (const kind of ['whole', 'unknown'] as const) {
    if (readings.some((reading) => reading.kind === kind)) {
      return { kind, fields: [], serverFields };
    }
  }
  const fields = sortedUnique(readings.flatMap((reading) => reading.fields)).filter((field) =>
    readings.every((reading) => reading.fields.includes(field))
  );
  return { kind: 'selected', fields, serverFields };
}

/**
Combines the readings of every onSubmit source: a finding in any source
counts, and resolving through `actions` must hold for all of them.
*/
function combineReadings(readings: readonly OnSubmitReading[]): OnSubmitReading {
  return {
    truncated: readings.some((reading) => reading.truncated),
    unhandledFilters: {
      paymentMethod: readings.some((reading) => reading.unhandledFilters.paymentMethod),
      actionCode: readings.some((reading) => reading.unhandledFilters.actionCode),
    },
    stateData: combineStateData(readings.map((reading) => reading.stateData)),
    resolvesActions: readings.every((reading) => reading.resolvesActions),
    usesComponentCallbacks: readings.some((reading) => reading.usesComponentCallbacks),
  };
}

/**
Why captured onSubmit source cannot be read.
*/
type SourceUnavailable = 'no-config' | 'sessions-flow' | 'no-source';

/**
What static inspection of every captured onSubmit source found together.
*/
export type OnSubmitSource =
  | { readonly status: 'unavailable'; readonly reason: SourceUnavailable }
  | ({ readonly status: 'read' } & OnSubmitReading);

/**
Whether callback source shows a duplicate-submission guard.
*/
type SubmissionGuard =
  | { readonly status: 'unavailable'; readonly reason: 'no-config' | 'no-source' }
  | { readonly status: 'read'; readonly guarded: boolean };

type CallbackSourceKey = 'onSubmitSources' | 'beforeSubmitSources';

/**
Callback source only ever comes from captured options, never from inferred values.
*/
function readSources(payload: ScanPayload, key: CallbackSourceKey): readonly string[] {
  const evidence = readCheckoutField(payload, key, { includeInferred: false });
  return evidence.state === 'present' ? evidence.value : [];
}

/**
Reads every captured onSubmit source, AdyenCheckout's and each component's.
It is unavailable without captured checkout or component configuration, and
in Sessions flow, where Adyen Web handles submission itself.
*/
export function readOnSubmitSource(payload: ScanPayload, flow: IntegrationFlow): OnSubmitSource {
  if (!hasCapturedCheckoutConfig(payload.page)) {
    return { status: 'unavailable', reason: 'no-config' };
  }
  if (flow === 'sessions') return { status: 'unavailable', reason: 'sessions-flow' };
  const sources = readSources(payload, 'onSubmitSources');
  return sources.length === 0
    ? { status: 'unavailable', reason: 'no-source' }
    : { status: 'read', ...combineReadings(sources.map(readOnSubmit)) };
}

/**
Looks for a duplicate-submission guard in every captured onSubmit and beforeSubmit source.
*/
export function readSubmissionGuard(payload: ScanPayload): SubmissionGuard {
  if (!hasCapturedCheckoutConfig(payload.page)) {
    return { status: 'unavailable', reason: 'no-config' };
  }
  const combined = [
    ...readSources(payload, 'onSubmitSources'),
    ...readSources(payload, 'beforeSubmitSources'),
  ]
    .map(withoutComments)
    .join('\n');
  return combined.trim() === ''
    ? { status: 'unavailable', reason: 'no-source' }
    : { status: 'read', guarded: hasMultipleSubmissionDetection(combined) };
}
