# ✋ Hold Up

A speed bump before you commit, push or deploy in a hurry. Pops a modal with a hold-up GIF, a countdown and a short checklist. Proceed unlocks when the timer ends and the boxes are ticked.

Gates: `git commit`, `git push`, `wrangler deploy`, `vercel` (deploy / `--prod` / promote).
Fix-loop (4+ commits in 10 min, or a deploy within 2 min of a commit) gets a longer wait and the "let him cook" GIF.

## Run it
Prerequisites: [VS Code](https://code.visualstudio.com/) 1.90+ and [Node.js](https://nodejs.org/) 18+.

```
npm install
npm run build
```
Then open this folder in VS Code and press **F5** (or Run > Start Debugging). If VS Code asks you to pick a debugger, choose **"Run Extension"** (or **VS Code Extension Development**) — that launches a second VS Code window, the Extension Development Host, with Hold Up loaded. A `.vscode/launch.json` is included so after the first time it should launch straight away.

In that window, open a git repo and accept the "add a speed bump" prompt, or run **Hold Up: Install Git Hooks in This Repo** from the Command Palette. Open a *new* terminal after that so the `wrangler` / `vercel` shims are on PATH.

Other useful scripts:
```
npm run watch      # rebuild on save (keep running alongside F5)
npm run typecheck
npm test
npm run package    # produces a .vsix you can install directly (Extensions: Install from VSIX)
```

## How it works
- git: `pre-commit` / `pre-push` hooks, so the Source Control buttons are covered too. Existing hooks are kept and chained.
- wrangler / vercel: shims in `~/.holdup/shims`, prepended to PATH for VS Code terminals.
- Both call `~/.holdup/gate.js`, which asks the extension over localhost and waits for your answer.
- Fails open: if VS Code isn't running, commands just run.

## Settings
Open Settings and search "Hold Up", or edit `settings.json`.

| Setting | Default | What it does |
|---|---|---|
| `holdUp.enabled` | `true` | Master switch (also the status bar item) |
| `holdUp.countdownSeconds` | `5` | Wait before Proceed unlocks |
| `holdUp.gate.commit` / `.push` / `.deploy` | `true` | Turn each kind on or off |
| `holdUp.quietSeconds` | `0` | After you proceed, skip the modal for the same kind for N seconds (0 = always ask) |
| `holdUp.fixLoop.enabled` | `true` | Escalate when you look like you're in a fix-on-fix loop |
| `holdUp.fixLoop.commits` / `.windowMinutes` | `4` / `10` | N commits inside the window = loop |
| `holdUp.fixLoop.deployAfterCommitSeconds` | `120` | Deploy this soon after a commit = loop |
| `holdUp.fixLoop.countdownSeconds` | `15` | Countdown during a loop |
| `holdUp.customCommands` | `[]` | Extra commands to hold up |

Custom commands: first word is the tool, the rest are its leading arguments (flags ignored).
```jsonc
"holdUp.customCommands": [
  { "command": "npm run deploy", "prod": true },
  { "command": "terraform apply" },
  { "command": "docker push" }
]
```
Open a new terminal after changing this. `git` can't be listed (it's handled by hooks).

## Escape hatches
- `HOLDUP_SKIP=1 git commit ...` skips the gate once.
- Click `✋ Hold Up` in the status bar to turn it off.
- **Hold Up: Remove Git Hooks** restores any hooks that were there before.

## Known gaps
- `npx wrangler deploy` and package scripts that call a local binary bypass the shim.
- Only VS Code terminals and the SCM panel are covered.
- The GIFs are memes kept for personal use, so don't publish this to the Marketplace as is.

## Contributing
Issues and PRs welcome. Before opening a PR: `npm run typecheck`, `npm test`, and `npm run build` should all pass.

## License
MIT (see the LICENSE file)
