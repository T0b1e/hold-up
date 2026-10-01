# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hold Up is a VS Code extension that pops a modal (countdown + checklist + meme GIF) before `git commit`, `git push`, `wrangler deploy`, `vercel deploy`/`--prod`/promote, and user-configured custom commands. It's a personal speed bump, not a Marketplace-ready extension (see README "Known gaps").

## Commands

```
npm install
npm run build       # esbuild bundle -> dist/extension.js
npm run watch        # esbuild --watch
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run package      # vsce package
```

Run a single test file: `npx vitest run test/rules.test.ts`. There's one test file (`test/rules.test.ts`) covering `src/rules.ts` and `src/history.ts` — pure logic, no VS Code API mocking needed.

To manually exercise the extension: press **F5** in VS Code to launch the Extension Development Host, open a git repo there, and accept the hook-install prompt (or run the `Hold Up: Install Git Hooks in This Repo` command). Open a *new* terminal afterward so the `wrangler`/`vercel` PATH shims take effect.

## Architecture

The extension has two halves that communicate over a localhost HTTP server, because the thing that needs to be gated (a git hook, or `wrangler`/`vercel` invoked from any terminal) runs as a separate OS process from the running VS Code extension:

1. **Extension host process** (`src/extension.ts`): on `activate()`, starts an HTTP server (`src/server.ts`, 127.0.0.1, random port, random bearer token) and writes `~/.holdup/session.json` with `{port, token, pid}`. It also prepends `~/.holdup/shims` onto `PATH` for every VS Code-spawned terminal via `environmentVariableCollection`, and exports `HOLDUP_PORT`/`HOLDUP_TOKEN`. Decision logic (classify → fix-loop check → quiet-period check → show modal → record event) lives in `activate()`'s `startServer` callback.

2. **Out-of-process gate script** (`bin/gate.js`): a single dependency-free Node script copied to `~/.holdup/gate.js` by `ensureRuntime()` (in `src/install.ts`). It's invoked two ways:
   - Directly by git hooks (`pre-commit`/`pre-push`, installed by `installHooks()`) as `gate.js <tool> [args]` — exits 0 (allow) or 1 (block), which git interprets as prevent/allow the commit or push.
   - Via generated PATH shims (`~/.holdup/shims/<tool>` and `<tool>.cmd`, one pair per shimmed tool) as `gate.js --exec <tool> [args]` — after getting an answer, it `spawn`s the real tool with the shim directory stripped from `PATH` (so it doesn't recursively re-trigger itself) and forwards its exit code.

   `gate.js` finds the running extension via `HOLDUP_PORT`/`HOLDUP_TOKEN` env vars (set in VS Code-opened terminals) and/or falls back to reading `~/.holdup/session.json` (for terminals/hooks not opened by VS Code, e.g. git GUI tools). It tries each candidate target in turn and **fails open** — if no server answers, or the POST errors, or the extension isn't running, the command is simply allowed to proceed. `HOLDUP_SKIP=1` bypasses the gate entirely without even making a request.

   Existing hooks at install time are preserved: `installHooks()` renames a pre-existing non-hold-up hook to `<hook>.holdup-prev` and the generated hook chains to it after gating; `uninstallHooks()` reverses this.

3. **Decision logic** is split into pure, independently testable modules (no VS Code imports), both covered by `test/rules.test.ts`:
   - `src/rules.ts` — `classify(tool, argv, customCommands)` turns a tool invocation into a `Gate | null` (kind: commit/push/deploy/run, isProd, optional label). `git` is special-cased to never be shimmed (hooks cover it); shimming it would break hook chaining. Custom commands match on leading positional words only, ignoring flags.
   - `src/history.ts` — `fixLoop()` detects "fix-on-fix" patterns (N commits within a time window, or a deploy/run shortly after a commit) using a rolling event log capped at 50 entries / 24h, stored in `ExtensionContext.globalState`. `isQuiet()` implements the optional "don't ask again for N seconds" grace period, per-kind.

4. **UI** (`src/modal.ts` + `media/modal.{css,js}`): a `vscode.WebviewPanel` with a strict CSP (no inline scripts; nonce-gated). The checklist items are fixed text plus a conditional "I know this hits prod" box; Proceed stays disabled until the countdown ends and (per `media/modal.js`, not read into context here but implied by the webview contract) presumably all checkboxes are ticked. The panel resolves `true` only on an explicit "proceed" postMessage; disposal otherwise (including via the `aborted` AbortSignal, used when the underlying shell command is Ctrl+C'd while the modal is open) resolves `false`.

When changing gating behavior, prefer editing `classify`/`fixLoop`/`isQuiet` and adding cases to `test/rules.test.ts` — those are synchronous and fast to iterate on without the Extension Development Host. Changes to shim generation, hook installation, or the webview require manual verification via F5 since they touch the filesystem, child processes, or VS Code APIs.
