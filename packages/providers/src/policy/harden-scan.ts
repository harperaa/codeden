import type { RiskAssessment } from "./assessment";

/**
 * Reading command text in time that grows with its length, not faster (§11.2). The classifier
 * runs in the runner's process, so a command it takes long to judge holds up every session on
 * that runner. This module is CodeHarden's: upstream's modules call it in a few places, kept
 * small so upstream's own change replaces each cleanly.
 */

/**
 * The longest command the classifier reads, in characters. A longer one isn't read at all and
 * asks (`TOO_LONG`): the checks that are left read each character more than once.
 */
export const MAX_COMMAND_CHARS = 32_768;

/** The verdict on a command longer than `MAX_COMMAND_CHARS`: every level asks. */
export const TOO_LONG: RiskAssessment = {
  risky: true,
  action: "outside_worktree",
  reason: "Runs a command too long to check",
  always: true,
};

/** A quoted string found in code: where its opening quote is, and the text between the quotes. */
export interface QuotedSpan {
  index: number;
  body: string;
}

/** What `\\.` does not match in a regular expression without the `s` flag. */
const LINE_END = new Set(["\n", "\r", "\u2028", "\u2029"]);

/**
 * The quoted strings of `code`, in order, for the quote characters in `quotes`: from a quote to
 * the next one of its kind that no backslash escapes. A backslash takes the character after it,
 * which may not be a line end. With `oneLine` (the default) a string also ends, unfinished, at a
 * line break. An unfinished string is not one, and reading goes on right after its opening quote.
 *
 * It finds what `/(["'`])((?:\\.|(?!\1)[^\\\n\r])*)\1/g` finds (and without `oneLine`, with
 * only a backtick in `quotes`, what `/`((?:\\.|[^`\\])*)`/g` finds), but reads each character a
 * fixed number of times. A regular expression starts over from every quote of an unfinished
 * string, which takes time with the square of the text's length. Here an unfinished string is
 * remembered: every later quote of its kind before the place it broke off is one it escaped, and
 * reading on from there would break off at the same place.
 *
 * `work`, for tests: counts the characters looked at, so a test can check the count grows with
 * the length of the text and not with its square, without timing anything.
 */
export function quotedSpans(
  code: string,
  quotes: string,
  oneLine = true,
  work?: { reads: number },
): QuotedSpan[] {
  const out: QuotedSpan[] = [];
  /** By quote character: no string of that kind starts before this index. */
  const brokeAt = new Map<string, number>();
  let i = 0;
  while (i < code.length) {
    const quote = code[i] as string;
    if (work) work.reads += 1;
    if (!quotes.includes(quote) || i < (brokeAt.get(quote) ?? 0)) {
      i += 1;
      continue;
    }
    let j = i + 1;
    let closed = false;
    while (j < code.length) {
      const ch = code[j] as string;
      if (work) work.reads += 1;
      if (ch === quote) {
        closed = true;
        break;
      }
      if (ch === "\\") {
        const next = code[j + 1];
        if (next === undefined || LINE_END.has(next)) break;
        j += 2;
      } else if (oneLine && (ch === "\n" || ch === "\r")) break;
      else j += 1;
    }
    if (closed) {
      out.push({ index: i, body: code.slice(i + 1, j) });
      i = j + 1;
    } else {
      brokeAt.set(quote, j);
      i += 1;
    }
  }
  return out;
}

/**
 * True when some match of `head` is followed by a match of `tail` that starts at or after the
 * head's end, with no `stop` character in between: what `head[^stop]*tail` tests, for two patterns
 * that each read their own text once. Written as one pattern, every `head` in the text reads on
 * to the next `stop`, which takes time with the square of the text's length when there is none.
 * Both patterns need the `g` flag. `accept`: a test a match of `tail` must also pass.
 */
export function followedBy(
  text: string,
  head: RegExp,
  tail: RegExp,
  stop: string,
  accept: (match: RegExpMatchArray) => boolean = () => true,
): boolean {
  const tails = [...text.matchAll(tail)].filter(accept).map((m) => m.index);
  let k = 0;
  /** The first `stop` at or after the latest head's end; -1 for none. */
  let stopAt = -2;
  for (const match of text.matchAll(head)) {
    const from = match.index + match[0].length;
    while (k < tails.length && (tails[k] as number) < from) k += 1;
    if (k === tails.length) return false;
    if (stopAt !== -1 && stopAt < from) stopAt = text.indexOf(stop, from);
    if (stopAt === -1 || stopAt > (tails[k] as number)) return true;
  }
  return false;
}

/**
 * The most script text read for one command, in characters, over every way it is read (each
 * escape reading, each reading of its variables, each script it hands to a shell). A command
 * that nests scripts can be read many times over; past this it isn't read further and asks.
 */
export const MAX_WORK_CHARS = 2_000_000;

/** The verdict on a command that takes too much reading, or nests deeper than can be followed. */
export const TOO_INVOLVED: RiskAssessment = {
  risky: true,
  action: "outside_worktree",
  reason: "Runs a command too involved to check",
  always: true,
};

class WorkLimit extends Error {}
let spent = 0;
let depth = 0;

/** Count `chars` of script text as read for the command being judged (`bounded`). */
export function spend(chars: number): void {
  spent += chars;
  if (depth > 0 && spent > MAX_WORK_CHARS) throw new WorkLimit();
}

/**
 * Run one judgement of a command within the work limit: `otherwise` when it reads more than
 * `MAX_WORK_CHARS`, or nests so deep that the reader runs out of stack. Any other error is the
 * caller's, as before.
 */
export function bounded<T>(run: () => T, otherwise: T): T {
  if (depth === 0) spent = 0;
  depth += 1;
  try {
    return run();
  } catch (error) {
    if (error instanceof WorkLimit || error instanceof RangeError) return otherwise;
    throw error;
  } finally {
    depth -= 1;
  }
}
