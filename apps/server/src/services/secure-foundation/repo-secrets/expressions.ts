/**
 * Where a workflow file holds expressions GitHub evaluates, for the scan of repository secrets
 * (`scan.ts`): every `${{ … }}` and the value of every `if:`, with the strings quoted inside
 * them blanked so that a name in a string isn't read as a reference. Text only, one pass.
 */

/** No expression is followed further than this, closed or not. */
export const MAX_EXPRESSION = 8_000;
const MAX_IF_LINES = 60;

export const indentOf = (line: string) => line.length - line.trimStart().length;

/**
 * How many characters of `body` at `i` are a quote of the expression there: one `'`, or, where
 * YAML itself quotes the value with `'…'` (`doubled`), the `''` that stands for one.
 */
function quoteAt(body: string, i: number, doubled: boolean): number {
  if (body[i] !== "'") return 0;
  if (!doubled) return 1;
  return body[i + 1] === "'" ? 2 : 0;
}

/** True when the value that holds position `at` is one YAML quotes with `'…'` (`key: '…`). */
function inYamlQuotes(body: string, lineStart: number, at: number): boolean {
  // Only the start of the line matters: a key and the quote that opens its value.
  const start = body.slice(lineStart, Math.min(at + 1, lineStart + 400));
  return /^[ \t]*(?:-[ \t]+)?(?:[^:'"#\n]{1,200}:[ \t]+)?'/.test(start);
}

/** Where the expression opening at `at` (`${{`) closes: the first `}}` outside a quoted string. */
function closeOf(body: string, at: number, doubled: boolean): number {
  const limit = Math.min(body.length, at + MAX_EXPRESSION);
  let quoted = false;
  let plain = -1;
  for (let i = at + 3; i < limit; i++) {
    const quote = quoteAt(body, i, doubled);
    if (quote > 0) {
      quoted = !quoted;
      i += quote - 1;
    } else if (body[i] === "}" && body[i + 1] === "}") {
      if (!quoted) return i;
      if (plain < 0) plain = i;
    }
  }
  // None outside a string (a quote left open): the first one there is, or the limit.
  return plain >= 0 ? plain : limit;
}

/**
 * Blank the insides of the quoted strings of an expression (`from` to `to` of `body`) in
 * `masked`, so a name inside a string (`'secrets.EXAMPLE'`) isn't read as a reference. A string
 * right after `[` stays: that is `secrets['NAME']`. A quote left open blanks nothing.
 */
function blankStrings(
  body: string,
  from: number,
  to: number,
  masked: string[],
  doubled: boolean,
): void {
  let open = -1;
  let inside = -1;
  for (let i = from; i < to; i++) {
    const quote = quoteAt(body, i, doubled);
    if (quote === 0) continue;
    if (open < 0) {
      open = i;
      inside = i + quote;
    } else {
      let before = open - 1;
      while (before >= from && (body[before] === " " || body[before] === "\t")) before--;
      if (body[before] !== "[") masked.fill(" ", inside, i);
      open = -1;
    }
    i += quote - 1;
  }
}

/**
 * Where GitHub evaluates expressions, as ranges of `body` in order, none overlapping another:
 * every `${{ … }}`, and the value of every `if:` with the deeper lines that continue it. Each
 * character is looked at once, however the file is built. The strings inside them are blanked
 * in `masked` on the way.
 */
export function expressionRanges(
  body: string,
  lines: string[],
  starts: number[],
  masked: string[],
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let at = body.indexOf("${{");
  /** The line `at` is on: the expressions come in order, so it only moves forward. */
  let line = 0;
  while (at >= 0) {
    while (line + 1 < starts.length && (starts[line + 1] as number) <= at) line++;
    const doubled = inYamlQuotes(body, starts[line] as number, at);
    const end = closeOf(body, at, doubled);
    blankStrings(body, at + 3, end, masked, doubled);
    ranges.push([at, end]);
    at = body.indexOf("${{", Math.max(end, at + 3));
  }
  for (const [i, text] of lines.entries()) {
    const key = /^((?:-[ \t]+)?)if[ \t]*:[ \t]*/.exec(text.trimStart());
    if (!key) continue;
    // The column of `if` itself: a step's other keys sit there too, and don't continue it.
    const indent = indentOf(text) + (key[1] as string).length;
    let last = i;
    while (last + 1 < lines.length && last - i < MAX_IF_LINES) {
      const next = lines[last + 1] as string;
      if (next.trim() && indentOf(next) <= indent) break;
      last++;
    }
    const from = (starts[i] as number) + indentOf(text) + key[0].length;
    const to = (starts[last] as number) + (lines[last] as string).length;
    // A condition YAML itself quotes with `'…'` doubles every quote inside it.
    const doubled = body[from] === "'";
    blankStrings(body, doubled ? from + 1 : from, to, masked, doubled);
    ranges.push([starts[i] as number, to]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const before = merged[merged.length - 1];
    if (before && range[0] <= before[1]) before[1] = Math.max(before[1], range[1]);
    else merged.push(range);
  }
  return merged;
}
