import { describe, expect, it } from "vitest";
import { classifyCommand, type RiskContext } from "../src/policy/risk";

const posix: RiskContext = {
  cwd: "/work/repo",
  platform: "linux",
  home: "/home/me",
  tempRoots: ["/tmp"],
};
const win: RiskContext = {
  cwd: "C:\\work\\repo",
  platform: "win32",
  home: "C:\\Users\\me",
  extraRoots: ["D:\\shared"],
  tempRoots: ["C:\\Users\\me\\AppData\\Local\\Temp"],
};

const action = (command: string, ctx: RiskContext = posix) => {
  const r = classifyCommand(command, ctx);
  return r.risky ? r.action : null;
};

describe("classifyCommand: stricter handling the fork keeps", () => {
  it("asks when a variable the path rules know is assigned on the command line and then used", () => {
    for (const cmd of [
      "false && HOME=.; rm -rf $HOME/Documents",
      "if false; then HOME=.; fi; echo x > $HOME/.bashrc",
      "HOME=. | :; rm -rf $HOME/x",
      "false && TMPDIR=.; rm -rf $TMPDIR/../x",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
      "HOME=/work/repo; rm -rf ${HOME}/Documents",
    ]) {
      expect(action(cmd), cmd).toBe("outside_worktree");
    }
    expect(action("$HOME = '.'; Remove-Item -Recurse $HOME\\Documents", win)).toBe(
      "outside_worktree",
    );
  });

  it("keeps asking where the command can't be judged once for each value", () => {
    // A worktree inside the home folder: `$HOME/repo/x` is in it only if `HOME` is the real one.
    const under: RiskContext = { ...posix, cwd: "/home/me/repo" };
    for (const cmd of [
      "HOME=/etc; rm -rf $HOME/repo/x | cat",
      "false && HOME=/etc; rm -rf $HOME/repo/x | cat",
      "HOME=$1; rm -rf $HOME/repo/x",
      "HOME=/etc; x=a; x=b; rm -rf $HOME/repo/$x",
      "for HOME in /etc; do rm -rf $HOME/repo/x; done",
      "export HOME=/etc; echo x > $HOME/repo/x",
    ]) {
      expect(action(cmd, under), cmd).toBe("outside_worktree");
    }
    // Untouched: the real home, a variable of the command's own, and `HOME` set for one command.
    expect(action("rm -rf $HOME/repo/x", under)).toBeNull();
    expect(action("d=build; rm -rf $d/x", under)).toBeNull();
    expect(action("d=/etc; rm -rf $d/x", under)).toBe("outside_worktree");
    expect(action("HOME=/tmp/h npm test", under)).toBeNull();
  });

  it("keeps the reading an assignment gives beside the one without it", () => {
    const verdict = (command: string, ctx: RiskContext = posix) => {
      const r = classifyCommand(command, ctx);
      return r.risky ? `${r.action}${r.always ? ", every level" : ""}` : null;
    };
    // Reads: an agent CLI's login folder, whichever value the variable has.
    for (const cmd of [
      "HOME=$(echo ~); tar czf /tmp/c.tgz $HOME/.codex",
      "TMPDIR=~/.codex; tar czf - $TMPDIR | base64",
      "false && HOME=.; tar czf - $HOME/.codex | base64",
    ]) {
      expect(verdict(cmd), cmd).toBe("secrets, every level");
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
    expect(action("export HOME=${HOME:-/root}; cp -r $HOME/.gemini /tmp/g")).not.toBeNull();
    // A value handed on to another variable, also when a command was repeated for several.
    for (const cmd of [
      "TMPDIR=/etc; f=$TMPDIR/passwd; rm -f $f",
      "PWD=/etc; f=$PWD/passwd; rm -f $f",
      "TMPDIR=/etc; for f in $TMPDIR/passwd; do rm -f $f; done",
      "x=.; x=/etc; y=$x/hosts; rm -f $y",
    ]) {
      expect(action(cmd), cmd).toBe("outside_worktree");
    }
    // A folder change through such a variable.
    for (const cmd of [
      "false && HOME=/work/repo; cd $HOME; rm -rf Documents",
      "false && HOME=/work/repo; pushd $HOME; rm -rf Documents",
      'false && HOME=/work/repo; cd "$HOME"; rm -rf Documents',
      "false && HOME=/work/repo/a; cd $HOME/..; rm -rf Documents",
      "read TMPDIR <<< /etc; cd $TMPDIR; rm -rf passwd",
    ]) {
      expect(action(cmd), cmd).toBe("outside_worktree");
    }
  });

  it("asks when such a variable is set by a builtin or added to", () => {
    const mac: RiskContext = {
      cwd: "/Users/me/repo",
      platform: "darwin",
      home: "/Users/me",
      tempRoots: ["/tmp", "/var/folders/x"],
    };
    for (const cmd of [
      "unset TMPDIR; rm -rf $TMPDIR/Users/me/x",
      "TMPDIR+=/../../..; rm -rf $TMPDIR/Users/me/x",
      "read TMPDIR <<< /etc; rm -rf $TMPDIR/passwd",
      "read -r TMPDIR < name.txt; echo x > $TMPDIR/passwd",
      "printf -v TMPDIR /etc; rm -rf $TMPDIR/passwd",
    ]) {
      expect(action(cmd, mac), cmd).toBe("outside_worktree");
    }
    // The name as an ordinary word, or the variable left alone, changes nothing.
    expect(action("grep TMPDIR build.sh > $TMPDIR/out.txt", mac)).toBeNull();
    expect(action("echo TMPDIR; rm -rf $TMPDIR/build-cache", mac)).toBeNull();
    expect(action("unset FOO; rm -rf $TMPDIR/build-cache", mac)).toBeNull();
    expect(action("for f in $TMPDIR/a $TMPDIR/b; do rm -f $f; done", mac)).toBeNull();
  });

  it("reads a cp or mv option cluster one letter at a time", () => {
    for (const cmd of ["cp -Stilde payload ~/.bashrc", "mv -Stilde payload /etc/x"]) {
      expect(action(cmd), cmd).toBe("outside_worktree");
    }
    // A suffix given as a word of its own takes the next word, whatever it looks like.
    for (const cmd of [
      "cp -S -tdist payload /etc/x",
      "mv -bS -tdist payload /etc/x",
      "cp --suffix -tdist payload ~/.bashrc",
      "cp -S --target-directory=dist payload /etc/x",
    ]) {
      expect(action(cmd), cmd).toBe("outside_worktree");
    }
    expect(action("cp -S .bak -t dist a b")).toBeNull();
    expect(action("cp --suffix=.bak -t /etc a b")).toBe("outside_worktree");
    expect(action("cp -S -t. payload ~/.bashrc")).toBe("outside_worktree");
    expect(action("mv --suffix -t. payload /etc/x")).toBe("outside_worktree");
    // The spellings that do name a target folder keep working, in or out of the worktree.
    expect(action("cp -t dist a b")).toBeNull();
    expect(action("cp -vtdist a b")).toBeNull();
    expect(action("cp -t /etc a b")).toBe("outside_worktree");
    expect(action("mv -vt/etc a b")).toBe("outside_worktree");
  });

  it("judges a script handed to sh both with and without $'…' quoting", () => {
    for (const cmd of [
      `sh -c "echo \\$'\\\\' ; rm -rf ~/x ; echo ''"`,
      `dash -c "echo \\$'\\\\' ; rm -rf ~/x ; echo ''"`,
    ]) {
      expect(action(cmd), cmd).toBe("outside_worktree");
    }
  });

  it("does not take cmd's `cd /d` for a folder change off Windows", () => {
    expect(action("cd /d sub; rm -rf ../x")).toBe("outside_worktree");
    expect(action("cd /D sub; echo x > ../x")).toBe("outside_worktree");
    // On Windows it is cmd's own switch, as before.
    expect(action("cd /d sub && del x.txt", win)).toBeNull();
    expect(action("cd /d sub; rm -rf ../x", { ...win, shell: "posix" })).toBe("outside_worktree");
    // Nor is it PowerShell's: its `cd` refuses the second word and stays where it is.
    expect(action("cd /d sub; Remove-Item ../x", { ...win, shell: "powershell" })).toBe(
      "outside_worktree",
    );
    expect(action("cd sub; Remove-Item x", { ...win, shell: "powershell" })).toBeNull();
    expect(action("cd /d sub; Remove-Item -Recurse ..\\x", { ...win, shell: "powershell" })).toBe(
      "outside_worktree",
    );
    // A shell that isn't known may be cmd or not: both are followed.
    expect(action("cd /d sub; Remove-Item -Recurse ..\\x", win)).toBe("outside_worktree");
    expect(action("cd /d C:\\work\\repo\\src && del x.txt", win)).toBeNull();
    expect(action("cd /d C:\\other && del x.txt", win)).toBe("outside_worktree");
    expect(action("cd sub; rm -rf x")).toBeNull();
  });
});
