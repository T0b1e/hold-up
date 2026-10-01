import type { Kind } from './rules';

export interface HoldEvent {
  kind: Kind;
  t: number;
}

export interface FixLoopOptions {
  enabled: boolean;
  /** This many commits inside the window counts as a loop. */
  commits: number;
  windowMinutes: number;
  /** A deploy/run this soon after a commit counts as a loop. */
  deployAfterCommitSeconds: number;
}

export const FIX_LOOP_DEFAULTS: FixLoopOptions = {
  enabled: true,
  commits: 4,
  windowMinutes: 10,
  deployAfterCommitSeconds: 120,
};

const KEEP = 24 * 60 * 60 * 1000;

export function record(events: HoldEvent[], kind: Kind, now = Date.now()): HoldEvent[] {
  return [...events, { kind, t: now }].filter((e) => now - e.t < KEEP).slice(-50);
}

/** Are we in a fix-loop? Returns the line to show, or undefined if all is calm. */
export function fixLoop(
  events: HoldEvent[],
  kind: Kind,
  now = Date.now(),
  opts: FixLoopOptions = FIX_LOOP_DEFAULTS
): string | undefined {
  if (!opts.enabled) return undefined;

  const commits = events.filter((e) => e.kind === 'commit' && now - e.t < opts.windowMinutes * 60_000);
  const nth = commits.length + (kind === 'commit' ? 1 : 0);
  if (nth >= opts.commits) return `${nth} commits in ${opts.windowMinutes} min. Let him cook.`;

  if ((kind === 'deploy' || kind === 'run') && commits.length > 0) {
    const secs = Math.round((now - Math.max(...commits.map((c) => c.t))) / 1000);
    if (secs < opts.deployAfterCommitSeconds) return `Running this ${secs}s after a commit. Let him cook.`;
  }
  return undefined;
}

/** Did we let this kind through very recently? Used for the optional quiet period. */
export function isQuiet(events: HoldEvent[], kind: Kind, quietSeconds: number, now = Date.now()): boolean {
  if (quietSeconds <= 0) return false;
  return events.some((e) => e.kind === kind && now - e.t < quietSeconds * 1000);
}
