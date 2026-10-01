import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

const MARK = '# hold-up';
const HOOKS: Record<string, string> = { 'pre-commit': 'git-commit', 'pre-push': 'git-push' };

export const holdHome = path.join(os.homedir(), '.holdup');
export const shimDir = path.join(holdHome, 'shims');
export const sessionFile = path.join(holdHome, 'session.json');

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('git', args, { cwd, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out.trim())))
  );
}

/** Copy gate.js to a stable home and write one shim per tool; stale shims are removed. Safe to run any time. */
export function ensureRuntime(ext: vscode.Uri, tools: string[]): void {
  fs.mkdirSync(shimDir, { recursive: true });
  fs.copyFileSync(path.join(ext.fsPath, 'bin', 'gate.js'), path.join(holdHome, 'gate.js'));

  for (const f of fs.readdirSync(shimDir)) {
    if (!tools.includes(f.replace(/\.cmd$/, ''))) fs.rmSync(path.join(shimDir, f), { force: true });
  }

  for (const tool of tools) {
    const sh = `#!/bin/sh\nexec node "$HOME/.holdup/gate.js" --exec ${tool} "$@"\n`;
    const cmd = `@echo off\r\nnode "%USERPROFILE%\\.holdup\\gate.js" --exec ${tool} %*\r\nexit /b %ERRORLEVEL%\r\n`;
    fs.writeFileSync(path.join(shimDir, tool), sh, { mode: 0o755 });
    fs.writeFileSync(path.join(shimDir, tool + '.cmd'), cmd);
  }
}

/** Repo roots of the open workspace folders. */
export async function findRepos(): Promise<string[]> {
  const roots = new Set<string>();
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    try {
      roots.add(await git(f.uri.fsPath, ['rev-parse', '--show-toplevel']));
    } catch {
      /* not a repo */
    }
  }
  return [...roots];
}

export async function hooksDir(repo: string): Promise<string> {
  return path.resolve(repo, await git(repo, ['rev-parse', '--git-path', 'hooks']));
}

export function hooksInstalled(dir: string): boolean {
  return Object.keys(HOOKS).every((h) => {
    try {
      return fs.readFileSync(path.join(dir, h), 'utf8').includes(MARK);
    } catch {
      return false;
    }
  });
}

export async function installHooks(repo: string): Promise<void> {
  const dir = await hooksDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const gate = path.join(holdHome, 'gate.js').replace(/\\/g, '/');

  for (const [hook, tool] of Object.entries(HOOKS)) {
    const file = path.join(dir, hook);
    const prev = file + '.holdup-prev';
    if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(MARK)) fs.renameSync(file, prev);

    // pre-push gets "<remote> <url>" as args and the ref list on stdin; we leave stdin alone for the chained hook.
    const script = `#!/bin/sh
${MARK} (remove with "Hold Up: Remove Git Hooks")
node "${gate}" ${tool} "$@" || exit 1
[ -f "$0.holdup-prev" ] && exec sh "$0.holdup-prev" "$@"
exit 0
`;
    fs.writeFileSync(file, script, { mode: 0o755 });
  }
}

export async function uninstallHooks(repo: string): Promise<void> {
  const dir = await hooksDir(repo);
  for (const hook of Object.keys(HOOKS)) {
    const file = path.join(dir, hook);
    const prev = file + '.holdup-prev';
    try {
      if (!fs.readFileSync(file, 'utf8').includes(MARK)) continue;
      fs.rmSync(file);
      if (fs.existsSync(prev)) fs.renameSync(prev, file);
    } catch {
      /* nothing there */
    }
  }
}
