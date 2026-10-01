export type Kind = 'commit' | 'push' | 'deploy' | 'run';

export interface Gate {
  kind: Kind;
  tool: string;
  isProd: boolean;
  /** Set for user-defined commands: what to show in the modal. */
  label?: string;
}

/** A user-defined command from `holdUp.customCommands`, e.g. { command: "terraform apply", prod: true }. */
export interface CustomCommand {
  command: string;
  prod?: boolean;
}

export const BUILTIN_TOOLS = ['wrangler', 'vercel'];

const WRANGLER_DEPLOY = new Set(['deploy', 'publish']);
const VERCEL_DEPLOY = new Set(['deploy', 'promote', 'rollback']);

function flagValue(argv: string[], names: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    for (const n of names) {
      if (a === n) return argv[i + 1];
      if (a.startsWith(n + '=')) return a.slice(n.length + 1);
    }
  }
  return undefined;
}

const positionals = (argv: string[]) => argv.filter((a) => !a.startsWith('-'));
const firstPositional = (argv: string[]) => positionals(argv)[0];

/** "npm run deploy" -> { tool: "npm", words: ["run", "deploy"] } */
export function parseCustom(c: CustomCommand): { tool: string; words: string[] } | null {
  const [tool, ...words] = (c.command ?? '').trim().split(/\s+/).filter(Boolean);
  // git is gated by hooks, not shims; shimming it would break everything
  if (!tool || tool === 'git') return null;
  return { tool, words };
}

/** Tools that need a shim: the built-ins plus the first word of each custom command. */
export function shimTools(custom: CustomCommand[]): string[] {
  return [...new Set([...BUILTIN_TOOLS, ...custom.map((c) => parseCustom(c)?.tool).filter((t): t is string => !!t)])];
}

function matchCustom(tool: string, argv: string[], custom: CustomCommand[]): Gate | null {
  const pos = positionals(argv);
  for (const c of custom) {
    const p = parseCustom(c);
    if (!p || p.tool !== tool) continue;
    if (p.words.every((w, i) => pos[i] === w)) {
      return { kind: 'run', tool, isProd: !!c.prod, label: c.command.trim() };
    }
  }
  return null;
}

/** Decide whether a command needs a hold-up. `tool` is git-commit, git-push, wrangler, vercel or a custom tool. */
export function classify(tool: string, argv: string[], custom: CustomCommand[] = []): Gate | null {
  if (tool === 'git-commit') return { kind: 'commit', tool, isProd: false };
  if (tool === 'git-push') return { kind: 'push', tool, isProd: false };

  if (argv.some((a) => ['--help', '-h', '--version', '-v', '--dry-run'].includes(a))) return null;

  if (tool === 'wrangler') {
    const sub = firstPositional(argv);
    const isDeploy =
      (sub !== undefined && WRANGLER_DEPLOY.has(sub)) ||
      (sub === 'versions' && argv[argv.indexOf('versions') + 1] === 'deploy');
    if (!isDeploy) return null;
    const env = flagValue(argv, ['--env', '-e']);
    return { kind: 'deploy', tool, isProd: env === undefined || env === 'production' };
  }

  if (tool === 'vercel') {
    const sub = firstPositional(argv);
    if (sub !== undefined && !VERCEL_DEPLOY.has(sub)) return null;
    const prodFlag = argv.includes('--prod') || argv.includes('--production');
    return { kind: 'deploy', tool, isProd: prodFlag || sub === 'promote' || sub === 'rollback' };
  }

  return matchCustom(tool, argv, custom);
}
