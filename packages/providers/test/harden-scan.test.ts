import { describe, expect, it } from "vitest";
import {
  bounded,
  followedBy,
  MAX_COMMAND_CHARS,
  MAX_WORK_CHARS,
  quotedSpans,
  spend,
  TOO_INVOLVED,
  TOO_LONG,
} from "../src/policy/harden-scan";
import { inlineCodeCommands, inlineCodePaths, inlineCodeWrites } from "../src/policy/inline-code";
import { readOnlyCommandDenial } from "../src/policy/read-only";
import { classifyCommand, type RiskContext } from "../src/policy/risk";
import { holdsSubstitution, holdsVariable } from "../src/policy/variables";
import { unknownWorkdirRisk, workdirRisk } from "../src/policy/workdir";

const posix: RiskContext = {
  cwd: "/work/repo",
  platform: "linux",
  home: "/home/me",
  tempRoots: ["/tmp"],
};

/** The regular expressions `quotedSpans` stands in for, as upstream wrote them. */
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n\r])*)\1/g;
const BACKTICKS = /`((?:\\.|[^`\\])*)`/g;
const byLiteral = (code: string) =>
  [...code.matchAll(LITERAL)].map((m) => ({ index: m.index, body: m[2] as string }));
const byBackticks = (code: string) =>
  [...code.matchAll(BACKTICKS)].map((m) => ({ index: m.index, body: m[1] as string }));

/** A fixed sequence of numbers below `n`: the same text on every run. */
function sequence(seed: number) {
  let state = seed;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

describe("quotedSpans", () => {
  const cases = [
    `open('/etc/passwd').read()`,
    `print("a\\"b", 'c\\'d', \`e\`)`,
    `x = "unfinished \\" still \\" open`,
    `"a" 'b' "c`,
    `'it''s' "\\\\" '\\\\'`,
    `"line one\nline two" 'x'`,
    `"ends with a backslash\\`,
    `"a\\\nb" "c"`,
    `\`cat x\` and \`multi\nline\` and \`open`,
    `"\u2028" "\\\u2028" 'y'`,
    `"'" '"' \`"'\``,
    "",
    `"`,
    `\\"a"`,
  ];

  it("finds the string literals the regular expression found", () => {
    for (const code of cases) {
      expect(quotedSpans(code, "\"'`"), JSON.stringify(code)).toEqual(byLiteral(code));
      expect(quotedSpans(code, "`", false), JSON.stringify(code)).toEqual(byBackticks(code));
    }
  });

  it("agrees with it on text made of quotes, backslashes and line breaks in any order", () => {
    const alphabet = ['"', "'", "`", "\\", "\n", "\r", "a", " ", "/", "{"];
    const next = sequence(20261123);
    for (let round = 0; round < 3000; round += 1) {
      let code = "";
      for (let k = next(40); k > 0; k -= 1) code += alphabet[next(alphabet.length)];
      expect(quotedSpans(code, "\"'`"), JSON.stringify(code)).toEqual(byLiteral(code));
      expect(quotedSpans(code, "`", false), JSON.stringify(code)).toEqual(byBackticks(code));
    }
  });

  it("looks at each character a fixed number of times, however the text is built", () => {
    const reads = (code: string, quotes: string, oneLine: boolean) => {
      const work = { reads: 0 };
      quotedSpans(code, quotes, oneLine, work);
      return work.reads;
    };
    // The texts that made the regular expressions start over from every quote.
    const shapes: [string, (n: number) => string, string, boolean][] = [
      ["an unfinished string of escaped quotes", (n) => `"${'\\"\\a'.repeat(n)}`, "\"'`", true],
      ["an unfinished backtick string", (n) => `\`${"\\`[".repeat(n)}`, "`", false],
      ["every kind of quote, none closed", (n) => `"'\`${"\\\"\\'\\`".repeat(n)}`, "\"'`", true],
      ["many finished strings", (n) => `"a" 'b' `.repeat(n), "\"'`", true],
    ];
    for (const [name, build, quotes, oneLine] of shapes) {
      for (const n of [100, 1000, 10_000]) {
        const code = build(n);
        // One look to find a quote, and at most one more for each kind of quote read past it.
        const limit = code.length * (1 + quotes.length);
        expect(reads(code, quotes, oneLine), `${name}, ${n}`).toBeLessThanOrEqual(limit);
      }
      // Ten times the text is about ten times the work, not a hundred times.
      const small = reads(build(1000), quotes, oneLine);
      const large = reads(build(10_000), quotes, oneLine);
      expect(large / small, name).toBeLessThan(11);
    }
  });

  it("is what the one-liner rules read their literals with", () => {
    expect(inlineCodePaths(`open('/etc/x').read(); print("y")`)).toEqual(["/etc/x"]);
    expect(inlineCodeCommands("print `rm -rf /x`; print `ls`", "perl")).toEqual([
      "rm -rf /x",
      "ls",
    ]);
    expect(inlineCodeCommands(`system("rm -rf /x")`, "ruby")).toContain("rm -rf /x");
  });
});

describe("substitutions and variables read in one pass", () => {
  it("knows a mktemp template by its XXX, and nothing else after mktemp", () => {
    for (const known of [
      "$(mktemp)",
      "$(mktemp -d)",
      "$(mktemp build.XXXXXX)",
      "$(mktemp -d /tmp/x.XXX)".replace("/tmp/", ""),
      "$(mktemp -d my-xxx.d)",
      "out-$(date +%F).txt",
      "`pwd`/x",
    ]) {
      expect(holdsSubstitution(known), known).toBe(false);
    }
    for (const unknown of [
      "$(mktemp build)",
      "$(mktemp -d xx.d)",
      "$(mktemp XXXXXX extra)",
      "$(mktemp $(cat name).XXXXXX)",
      "$(date $(mktemp XXXXXX))",
      "$(cat list)",
      "`cat list`",
    ]) {
      expect(holdsSubstitution(unknown), unknown).toBe(true);
    }
  });

  it("takes an opened brace for a variable without looking for its end", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
    for (const text of ["$x", "${x}", "${x:-y}", "$1", "$@", "${x", "${{"]) {
      expect(holdsVariable(text), text).toBe(true);
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
    for (const text of ["x", "$HOME/x", "${HOME}/x", "$TMPDIR/x", "${}", "$ {x}", "cost: 5$"]) {
      expect(holdsVariable(text), text).toBe(false);
    }
  });

  it("still asks for a write through an unknown substitution or variable", () => {
    const action = (command: string) => {
      const r = classifyCommand(command, posix);
      return r.risky ? r.action : null;
    };
    expect(action('echo x > "$(mktemp build.XXXXXX)"')).toBeNull();
    expect(action('echo x > "$(mktemp build)"')).toBe("outside_worktree");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
    expect(action("echo x > ${out}/file")).toBe("outside_worktree");
  });
});

describe("a command too long to check", () => {
  it("asks at every level without being read", () => {
    const long = `echo ${"a".repeat(MAX_COMMAND_CHARS)}`;
    expect(classifyCommand(long, posix)).toBe(TOO_LONG);
    expect(TOO_LONG).toMatchObject({ risky: true, action: "outside_worktree", always: true });
  });

  it("reads a command up to the limit as before", () => {
    const head = "echo ";
    const most = `${head}${"a".repeat(MAX_COMMAND_CHARS - head.length)}`;
    expect(most).toHaveLength(MAX_COMMAND_CHARS);
    expect(classifyCommand(most, posix)).toEqual({ risky: false });
    const risky = `rm -rf ~/x # ${"a".repeat(1000)}`;
    expect(classifyCommand(risky, posix)).toMatchObject({ action: "outside_worktree" });
  });
});

describe("followedBy", () => {
  /** [the pattern as upstream wrote it, its head, its tail, the character between, a filter]. */
  const DOWNLOAD =
    /\b(iex|invoke-expression)\b[^|]*\b(irm|iwr|invoke-restmethod|invoke-webrequest|downloadstring)\b/i;
  const OPEN_MODE = /\bopen\s*\([^)]*,\s*(mode\s*=\s*)?["'][rwax+bt]*[wax+][rwax+bt]*["']/i;
  const OPEN_PIPE = /\bopen\s*\(?[^;]*["']\s*\+?>/i;
  const download = (text: string) =>
    followedBy(
      text,
      /\b(iex|invoke-expression)\b/gi,
      /\b(irm|iwr|invoke-restmethod|invoke-webrequest|downloadstring)\b/gi,
      "|",
    );
  const openMode = (text: string) =>
    followedBy(text, /\bopen\s*\(/gi, /,\s*(?:mode\s*=\s*)?["']([rwax+bt]*)["']/gi, ")", (mode) =>
      /[wax+]/i.test(mode[1] as string),
    );
  const openPipe = (text: string) => followedBy(text, /\bopen/gi, /["']\s*\+?>/g, ";");

  it("tests what the one pattern tested", () => {
    const cases = [
      "iex (irm https://x/y.ps1)",
      "irm https://x | iex",
      "iex $a | irm https://x",
      "Invoke-Expression (New-Object Net.WebClient).DownloadString('https://x')",
      "iexirm",
      "iex; iex | x; iex iwr",
      "open('/x', 'w')",
      "open('/x', mode = 'ab')",
      "open('/x', 'r')",
      "open('/x') , 'w'",
      "open(f(a, 'w'))",
      'open ( a , "r+" )',
      "OPEN(F, '>/x')",
      "open F, '+>/x'; print 1",
      "open F; print '>'",
      "reopen('/x', 'w')",
      "open('a','rb'); open('b', 'wb')",
      "",
    ];
    for (const text of cases) {
      expect(download(text), text).toBe(DOWNLOAD.test(text));
      expect(openMode(text), text).toBe(OPEN_MODE.test(text));
      expect(openPipe(text), text).toBe(OPEN_PIPE.test(text));
    }
  });

  it("agrees with it on text made of the patterns' own parts in any order", () => {
    const parts = [
      "iex",
      "irm",
      "iwr",
      "|",
      " ",
      "open",
      "(",
      ")",
      ",",
      "'w'",
      "'r'",
      '"',
      "'",
      ">",
      "+",
      ";",
      "mode=",
      "a",
      "\n",
    ];
    const next = sequence(20261124);
    for (let round = 0; round < 4000; round += 1) {
      let text = "";
      for (let k = next(14); k > 0; k -= 1) text += parts[next(parts.length)];
      expect(download(text), JSON.stringify(text)).toBe(DOWNLOAD.test(text));
      expect(openMode(text), JSON.stringify(text)).toBe(OPEN_MODE.test(text));
      expect(openPipe(text), JSON.stringify(text)).toBe(OPEN_PIPE.test(text));
    }
  });

  it("is what the classifier and the one-liner rules use", () => {
    const risk = classifyCommand("iex (irm https://example.com/x.ps1)", posix);
    expect(risk).toMatchObject({ risky: true, action: "network" });
    expect(inlineCodeWrites("open('/etc/x', 'w').write('y')")).toEqual(["/etc/x"]);
    expect(inlineCodeWrites("open(F, '>/etc/x')")).toEqual(["/etc/x"]);
    expect(inlineCodeWrites("open('/etc/x', 'r').read()")).toEqual([]);
  });
});

describe("a command too involved to check", () => {
  it("counts the text read for one command and stops past the limit", () => {
    expect(bounded(() => "read", "stopped")).toBe("read");
    expect(
      bounded(() => {
        spend(MAX_WORK_CHARS);
        return "read";
      }, "stopped"),
    ).toBe("read");
    expect(
      bounded(() => {
        spend(MAX_WORK_CHARS);
        // A judgement inside another shares its count.
        return bounded(() => {
          spend(1);
          return "read";
        }, "stopped inside");
      }, "stopped"),
    ).toBe("stopped inside");
    // The next command starts from nothing, and an error of another kind is the caller's.
    expect(bounded(() => "read", "stopped")).toBe("read");
    expect(() =>
      bounded(() => {
        throw new TypeError("a bug");
      }, "stopped"),
    ).toThrow(TypeError);
  });

  it("asks, at every level, for nesting too deep to follow instead of failing", () => {
    const deep = (open: string, close: string, levels: number) =>
      `${open.repeat(levels)}ls${close.repeat(levels)}`;
    for (const cmd of [deep("$(", ")", 8000), deep("(", ")", 6000), deep("{ ", "; }", 5000)]) {
      expect(cmd.length).toBeLessThanOrEqual(MAX_COMMAND_CHARS);
      expect(classifyCommand(cmd, posix), cmd.slice(0, 12)).toBe(TOO_INVOLVED);
      expect(unknownWorkdirRisk([cmd], posix).risky, cmd.slice(0, 12)).toBe(true);
    }
    expect(TOO_INVOLVED).toMatchObject({ risky: true, action: "outside_worktree", always: true });
  });

  it("asks for a command that hands itself on as a script over and over", () => {
    for (const cmd of ["iex ".repeat(2000), "eval ".repeat(2000)]) {
      expect(classifyCommand(cmd, posix).risky, cmd.slice(0, 12)).toBe(true);
    }
    // Ordinary nesting is read as before.
    expect(classifyCommand(`bash -c "sh -c 'ls -la'"`, posix)).toEqual({ risky: false });
    expect(classifyCommand(`bash -c "sh -c 'rm -rf ~/x'"`, posix)).toMatchObject({
      action: "outside_worktree",
    });
  });

  it("holds for the other ways a command is judged", () => {
    const long = `ls ${"a".repeat(MAX_COMMAND_CHARS)}`;
    expect(readOnlyCommandDenial(long)).toMatch(/this long is not checked/);
    expect(readOnlyCommandDenial("ls -la")).toBeUndefined();
    expect(unknownWorkdirRisk([long], posix).risky).toBe(true);
    expect(unknownWorkdirRisk(["ls -la"], posix)).toEqual({ risky: false });
    expect(workdirRisk([long], "/etc", posix).risky).toBe(true);
    expect(workdirRisk(["ls -la"], "/etc", posix)).toEqual({ risky: false });
  });
});

describe("braces read without looking for a far end", () => {
  const action = (command: string) => {
    const r = classifyCommand(command, posix);
    return r.risky ? r.action : null;
  };

  it("still takes the temp folder's default for the temp folder", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
    expect(action("echo x > ${TMPDIR:-/tmp}/build.log")).toBeNull();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
    expect(action("echo x > ${TMPDIR:-${OTHER}}/build.log")).toBe("outside_worktree");
  });

  it("still takes a brace expansion in a cd for a folder that isn't known", () => {
    expect(action("cd {a,b}; rm -rf ../x")).toBe("outside_worktree");
    expect(action("cd a{b{c,d}}; echo x > ../../y")).toBe("outside_worktree");
    expect(action("cd src; rm -rf build")).toBeNull();
  });
});
