interface UnhandledOnSubmitFilters {
  readonly paymentMethod: boolean;
  readonly actionCode: boolean;
}

const STRING_LITERAL_PATTERN = /['"`][^'"`\n]+['"`]/;
const PAYMENT_METHOD_SELECTOR_PATTERN =
  /\bpaymentMethod(?:\?\.)?\.type\b|\bpaymentMethod\s*\[\s*['"]type['"]\s*\]/;
const ACTION_CODE_SELECTOR_PATTERN =
  /\bresultCode\b|\baction(?:\?\.)?\.type\b|\baction\s*\[\s*['"]type['"]\s*\]/;

function isWhitespaceChar(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f';
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
  if (conditionStart === -1) {
    return { malformed: false, nextSearchIndex: switchStart + 1 };
  }

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
    if (conditionStart === -1) {
      match = ifPattern.exec(source);
      continue;
    }

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

export const detectUnhandledOnSubmitFilters = (source: string): UnhandledOnSubmitFilters => {
  return {
    paymentMethod:
      hasUnhandledSelectorIfStatement(source, PAYMENT_METHOD_SELECTOR_PATTERN) ||
      hasUnhandledSelectorSwitchStatement(source, PAYMENT_METHOD_SELECTOR_PATTERN),
    actionCode:
      hasUnhandledSelectorIfStatement(source, ACTION_CODE_SELECTOR_PATTERN) ||
      hasUnhandledSelectorSwitchStatement(source, ACTION_CODE_SELECTOR_PATTERN),
  };
};

export const detectsMultipleSubmissions = (source: string): boolean => {
  // Looks for common patterns like .disabled = true, setLoading(true), .setAttribute('disabled', ...), etc.
  const patterns = [
    /\.disabled\s*=\s*(?:true|1)/,
    /setLoading\s*\(\s*(?:true|1)\s*\)/,
    /\.setAttribute\s*\(\s*['"]disabled['"]/,
    /\.classList\.add\s*\(\s*['"](?:is-)?loading['"]/,
    /this\.isSubmitting\s*=\s*true/,
  ];
  return patterns.some((p) => p.test(source));
};
