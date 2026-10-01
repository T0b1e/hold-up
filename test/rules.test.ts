import { describe, expect, it } from 'vitest';
import { classify, shimTools } from '../src/rules';
import { fixLoop, isQuiet, record, type HoldEvent } from '../src/history';

describe('classify', () => {
  it('gates git hooks', () => {
    expect(classify('git-commit', [])?.kind).toBe('commit');
    expect(classify('git-push', ['origin', 'url'])?.kind).toBe('push');
  });

  it('gates wrangler deploy, treats no --env as prod', () => {
    expect(classify('wrangler', ['deploy'])).toMatchObject({ kind: 'deploy', isProd: true });
    expect(classify('wrangler', ['deploy', '--env', 'staging'])).toMatchObject({ isProd: false });
    expect(classify('wrangler', ['deploy', '-e=production'])).toMatchObject({ isProd: true });
    expect(classify('wrangler', ['versions', 'deploy'])?.kind).toBe('deploy');
  });

  it('ignores wrangler commands that do not deploy', () => {
    expect(classify('wrangler', ['dev'])).toBeNull();
    expect(classify('wrangler', ['deploy', '--dry-run'])).toBeNull();
    expect(classify('wrangler', ['--help'])).toBeNull();
  });

  it('gates vercel deploys, prod only with --prod', () => {
    expect(classify('vercel', [])).toMatchObject({ kind: 'deploy', isProd: false });
    expect(classify('vercel', ['--prod'])).toMatchObject({ isProd: true });
    expect(classify('vercel', ['deploy', '--prebuilt', '--prod'])).toMatchObject({ isProd: true });
    expect(classify('vercel', ['promote', 'x'])).toMatchObject({ isProd: true });
  });

  it('ignores other vercel commands', () => {
    for (const sub of ['dev', 'env', 'logs', 'link', 'login']) {
      expect(classify('vercel', [sub])).toBeNull();
    }
  });
});

describe('custom commands', () => {
  const custom = [{ command: 'npm run deploy', prod: true }, { command: 'terraform apply' }, { command: 'git push' }];

  it('matches leading positionals and ignores flags', () => {
    expect(classify('npm', ['run', 'deploy'], custom)).toMatchObject({ kind: 'run', isProd: true, label: 'npm run deploy' });
    expect(classify('npm', ['--silent', 'run', 'deploy', '--', 'x'], custom)?.kind).toBe('run');
    expect(classify('terraform', ['apply', '-auto-approve'], custom)).toMatchObject({ isProd: false });
  });

  it('does not match other subcommands or tools', () => {
    expect(classify('npm', ['run', 'build'], custom)).toBeNull();
    expect(classify('npm', ['install'], custom)).toBeNull();
    expect(classify('terraform', ['plan'], custom)).toBeNull();
  });

  it('never shims git', () => {
    expect(shimTools(custom)).toEqual(['wrangler', 'vercel', 'npm', 'terraform']);
  });
});

describe('fixLoop', () => {
  const now = 1_000_000_000;
  const commit = (agoSec: number): HoldEvent => ({ kind: 'commit', t: now - agoSec * 1000 });

  it('is calm for a normal pace', () => {
    expect(fixLoop([commit(500)], 'commit', now)).toBeUndefined();
  });

  it('fires on the 4th commit in 10 minutes', () => {
    expect(fixLoop([commit(500), commit(300), commit(100)], 'commit', now)).toMatch(/4 commits/);
  });

  it('fires on a deploy right after a commit', () => {
    expect(fixLoop([commit(40)], 'deploy', now)).toMatch(/40s after a commit/);
    expect(fixLoop([commit(400)], 'deploy', now)).toBeUndefined();
  });

  it('respects custom thresholds and can be switched off', () => {
    const opts = { enabled: true, commits: 2, windowMinutes: 5, deployAfterCommitSeconds: 10 };
    expect(fixLoop([commit(100)], 'commit', now, opts)).toMatch(/2 commits in 5 min/);
    expect(fixLoop([commit(100)], 'commit', now, { ...opts, enabled: false })).toBeUndefined();
    expect(fixLoop([commit(40)], 'deploy', now, opts)).toBeUndefined();
  });

  it('quiet period only applies to the same kind', () => {
    const ev: HoldEvent[] = [{ kind: 'push', t: now - 30_000 }];
    expect(isQuiet(ev, 'push', 60, now)).toBe(true);
    expect(isQuiet(ev, 'push', 10, now)).toBe(false);
    expect(isQuiet(ev, 'commit', 60, now)).toBe(false);
    expect(isQuiet(ev, 'push', 0, now)).toBe(false);
  });

  it('record drops old events', () => {
    const old: HoldEvent = { kind: 'commit', t: now - 25 * 3600 * 1000 };
    expect(record([old], 'push', now)).toHaveLength(1);
  });
});
