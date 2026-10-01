import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { classify, shimTools, type CustomCommand, type Kind } from './rules';
import { fixLoop, isQuiet, record, type FixLoopOptions, type HoldEvent } from './history';
import { startServer, type GateRequest, type GateServer } from './server';
import { showHoldUp } from './modal';
import {
  ensureRuntime,
  findRepos,
  git,
  hooksDir,
  hooksInstalled,
  installHooks,
  sessionFile,
  uninstallHooks,
} from './install';

let server: GateServer | undefined;

const cfg = () => vscode.workspace.getConfiguration('holdUp');

const customCommands = (): CustomCommand[] =>
  cfg()
    .get<CustomCommand[]>('customCommands', [])
    .filter((c) => c && typeof c.command === 'string' && c.command.trim());

const fixLoopOptions = (): FixLoopOptions => ({
  enabled: cfg().get('fixLoop.enabled', true),
  commits: cfg().get('fixLoop.commits', 4),
  windowMinutes: cfg().get('fixLoop.windowMinutes', 10),
  deployAfterCommitSeconds: cfg().get('fixLoop.deployAfterCommitSeconds', 120),
});

function relativeTime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return `${h}h`;
}

const KIND_LABEL: Record<Kind, string> = { commit: 'commit', push: 'push', deploy: 'deploy', run: 'custom command' };

async function showStatus(ctx: vscode.ExtensionContext) {
  const enabled = cfg().get('enabled', true);
  const events = ctx.globalState.get<HoldEvent[]>('events', []);
  const now = Date.now();

  const counts = new Map<Kind, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const countsLine = [...counts.entries()].map(([k, n]) => `${KIND_LABEL[k]}: ${n}`).join('  ') || 'none yet';

  const last = events.at(-1);
  const lastLine = last ? `Last hold: ${KIND_LABEL[last.kind]}, ${relativeTime(now - last.t)} ago` : 'No holds recorded yet.';

  const toggleLabel = enabled ? '$(debug-pause) Turn Off' : '$(debug-start) Turn On';
  const picked = await vscode.window.showQuickPick<vscode.QuickPickItem>(
    [
      { label: enabled ? '$(check) Hold Up is ON' : '$(circle-slash) Hold Up is OFF' },
      { label: `Holds in last 24h: ${events.length}`, description: countsLine },
      { label: lastLine },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: toggleLabel },
      { label: '$(gear) Open Hold Up Settings' },
    ],
    { placeHolder: 'Hold Up status' }
  );

  if (picked?.label === toggleLabel) {
    await cfg().update('enabled', !enabled, vscode.ConfigurationTarget.Global);
  } else if (picked?.label.includes('Open Hold Up Settings')) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'holdUp');
  }
}

async function describe(kind: Kind, req: GateRequest, label?: string): Promise<string> {
  if (kind === 'run') return label ?? [req.tool, ...req.args].join(' ');
  const branch = await git(req.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '');
  if (kind === 'commit') return branch ? `commit on ${branch}` : 'commit';
  if (kind === 'push') return `push ${branch || 'HEAD'} → ${req.args[0] || 'remote'}`;
  return [req.tool, ...req.args].join(' ');
}

export async function activate(ctx: vscode.ExtensionContext) {
  let tools = shimTools(customCommands());
  ensureRuntime(ctx.extensionUri, tools);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  status.command = 'holdUp.showStatus';
  const paintStatus = () => {
    status.text = cfg().get('enabled', true) ? '✋ Hold Up' : '✋ off';
    status.tooltip = 'Hold Up: click for status';
  };
  paintStatus();
  status.show();

  server = await startServer(async (req, aborted) => {
    if (!cfg().get('enabled', true)) return true;
    const gate = classify(req.tool, req.args, customCommands());
    if (!gate) return true;
    if (gate.kind !== 'run' && !cfg().get(`gate.${gate.kind}`, true)) return true;

    const events = ctx.globalState.get<HoldEvent[]>('events', []);
    const loopLine = fixLoop(events, gate.kind, Date.now(), fixLoopOptions());

    if (!loopLine && isQuiet(events, gate.kind, cfg().get('quietSeconds', 0))) {
      await ctx.globalState.update('events', record(events, gate.kind));
      return true;
    }

    const base = Math.max(1, cfg().get('countdownSeconds', 5));
    const ok = await showHoldUp(
      ctx.extensionUri,
      {
        kind: gate.kind,
        isProd: gate.isProd,
        detail: await describe(gate.kind, req, gate.label),
        loopLine,
        seconds: loopLine ? Math.max(1, cfg().get('fixLoop.countdownSeconds', 15)) : base,
      },
      aborted
    );
    if (ok) await ctx.globalState.update('events', record(events, gate.kind));
    return ok;
  });

  // Terminals opened from now on know where to find us; git hooks fired from the SCM UI read the file.
  const env = ctx.environmentVariableCollection;
  env.prepend('PATH', path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.holdup', 'shims') + path.delimiter);
  env.replace('HOLDUP_PORT', String(server.port));
  env.replace('HOLDUP_TOKEN', server.token);
  fs.writeFileSync(sessionFile, JSON.stringify({ port: server.port, token: server.token, pid: process.pid }));

  ctx.subscriptions.push(
    status,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('holdUp')) return;
      paintStatus();
      if (e.affectsConfiguration('holdUp.customCommands')) {
        const next = shimTools(customCommands());
        ensureRuntime(ctx.extensionUri, next);
        if (next.join() !== tools.join()) {
          tools = next;
          vscode.window.showInformationMessage('Hold Up: custom commands updated. Open a new terminal to pick them up.');
        }
      }
    }),
    vscode.commands.registerCommand('holdUp.toggle', async () => {
      await cfg().update('enabled', !cfg().get('enabled', true), vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('holdUp.showStatus', () => showStatus(ctx)),
    vscode.commands.registerCommand('holdUp.installGitHooks', async () => {
      const repos = await findRepos();
      if (!repos.length) return void vscode.window.showWarningMessage('Hold Up: no git repo in this workspace.');
      for (const r of repos) await installHooks(r);
      vscode.window.showInformationMessage(`Hold Up: git hooks installed (${repos.length} repo).`);
    }),
    vscode.commands.registerCommand('holdUp.uninstallGitHooks', async () => {
      for (const r of await findRepos()) await uninstallHooks(r);
      vscode.window.showInformationMessage('Hold Up: git hooks removed.');
    })
  );

  void offerHooks(ctx);
}

/** Once per repo, ask if we may install the hooks. */
async function offerHooks(ctx: vscode.ExtensionContext) {
  const asked = ctx.globalState.get<string[]>('askedRepos', []);
  for (const repo of await findRepos()) {
    if (asked.includes(repo) || hooksInstalled(await hooksDir(repo))) continue;
    await ctx.globalState.update('askedRepos', [...asked, repo]);
    const pick = await vscode.window.showInformationMessage(
      `Hold Up: add a speed bump to commit and push in ${path.basename(repo)}?`,
      'Install',
      'Not now'
    );
    if (pick === 'Install') await installHooks(repo);
    return;
  }
}

export function deactivate() {
  server?.close();
  try {
    const s = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    if (s.pid === process.pid) fs.rmSync(sessionFile);
  } catch {
    /* already gone */
  }
}
