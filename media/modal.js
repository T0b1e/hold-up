const vscode = acquireVsCodeApi();
const proceed = document.getElementById('proceed');
const boxes = [...document.querySelectorAll('input[type=checkbox]')];
let left = Number(document.body.dataset.seconds);

function refresh() {
  proceed.disabled = !(left <= 0 && boxes.every((b) => b.checked));
  proceed.textContent = left > 0 ? 'Proceed ' + left : 'Proceed';
}

function send(type) {
  vscode.postMessage({ type });
}

setInterval(() => {
  if (left > 0) {
    left -= 1;
    refresh();
  }
}, 1000);

boxes.forEach((b) => b.addEventListener('change', refresh));
document.getElementById('cancel').addEventListener('click', () => send('cancel'));
proceed.addEventListener('click', () => !proceed.disabled && send('proceed'));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') send('cancel');
  if (e.key === 'Enter' && !proceed.disabled) send('proceed');
});

refresh();
document.getElementById('cancel').focus();
