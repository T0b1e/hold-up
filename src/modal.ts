import * as vscode from 'vscode';
import type { Kind } from './rules';

export interface ModalInfo {
  kind: Kind;
  detail: string;
  isProd: boolean;
  loopLine?: string;
  seconds: number;
}

const VERB: Record<Kind, string> = {
  commit: "You're about to commit.",
  push: "You're about to push.",
  deploy: "You're about to deploy.",
  run: "You're about to run this.",
};

function checks(info: ModalInfo): string[] {
  const list = ['I tested it', 'I read the diff', "This isn't a fix on a fix"];
  if (info.isProd) list.push('I know this hits prod');
  return list;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function html(web: vscode.Webview, root: vscode.Uri, info: ModalInfo): string {
  const media = (f: string) => web.asWebviewUri(vscode.Uri.joinPath(root, 'media', f));
  const nonce = Math.random().toString(36).slice(2);
  const gif = info.loopLine ? 'let-him-cook.gif' : 'hold-up.gif';
  const boxes = checks(info)
    .map((c) => `<label><input type="checkbox"> ${esc(c)}</label>`)
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${web.cspSource}; style-src ${web.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${media('modal.css')}">
</head>
<body data-seconds="${info.seconds}">
<main class="card">
  <img class="gif" src="${media(gif)}" alt="">
  <h1>HOLD UP.</h1>
  <p class="line">${esc(info.loopLine ?? VERB[info.kind])}</p>
  <div class="detail">${info.isProd ? '<span class="pill">PROD</span>' : ''}<span>${esc(info.detail)}</span></div>
  <div class="checks">${boxes}</div>
  <div class="buttons">
    <button id="cancel">Cancel</button>
    <button id="proceed" disabled>Proceed</button>
  </div>
</main>
<script nonce="${nonce}" src="${media('modal.js')}"></script>
</body></html>`;
}

/** Opens the modal; resolves true only if Proceed was clicked. */
export function showHoldUp(root: vscode.Uri, info: ModalInfo, aborted: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'holdUp',
      '✋ Hold up',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(root, 'media')] }
    );
    panel.webview.html = html(panel.webview, root, info);

    let answer = false;
    panel.webview.onDidReceiveMessage((m: { type: string }) => {
      answer = m.type === 'proceed';
      panel.dispose();
    });
    panel.onDidDispose(() => resolve(answer));
    aborted.addEventListener('abort', () => panel.dispose());
  });
}
