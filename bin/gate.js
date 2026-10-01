#!/usr/bin/env node
// Hold Up gate. Called by git hooks and the wrangler/vercel shims.
//   gate.js <tool> [args...]            ask, then exit 0 (go) or 1 (cancelled)
//   gate.js --exec <tool> [args...]     ask, then run the real <tool>
// Fails open: if the extension can't be reached, the command just runs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const home = path.join(os.homedir(), '.holdup');
const shimDir = path.join(home, 'shims');

const args = process.argv.slice(2);
const exec = args[0] === '--exec';
if (exec) args.shift();
const tool = args.shift();

function go() {
  if (!exec) process.exit(0);
  runReal();
}

function stop() {
  process.stderr.write('\n  Hold Up: cancelled. Good call.\n\n');
  process.exit(1);
}

function runReal() {
  const norm = (p) => path.resolve(p).toLowerCase();
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const clean = (process.env[pathKey] || '')
    .split(path.delimiter)
    .filter((p) => p && norm(p) !== norm(shimDir))
    .join(path.delimiter);
  const env = { ...process.env, [pathKey]: clean };
  const win = process.platform === 'win32';
  const argv = win ? args.map((a) => (/[\s"&|<>^%]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a)) : args;
  const child = spawn(tool, argv, { stdio: 'inherit', shell: win, env });
  child.on('error', (e) => {
    process.stderr.write('Hold Up: could not run ' + tool + ': ' + e.message + '\n');
    process.exit(127);
  });
  child.on('exit', (code, signal) => process.exit(code === null ? (signal ? 1 : 0) : code));
}

function targets() {
  const list = [];
  if (process.env.HOLDUP_PORT && process.env.HOLDUP_TOKEN) {
    list.push({ port: Number(process.env.HOLDUP_PORT), token: process.env.HOLDUP_TOKEN });
  }
  try {
    const s = JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8'));
    if (!list.some((t) => t.port === s.port)) list.push({ port: s.port, token: s.token });
  } catch {}
  return list;
}

function ask(list, i) {
  if (i >= list.length) return go(); // nobody home, fail open
  const body = JSON.stringify({ tool, args, cwd: process.cwd() });
  const req = http.request(
    {
      host: '127.0.0.1',
      port: list[i].port,
      path: '/gate',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-holdup-token': list[i].token },
    },
    (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return ask(list, i + 1);
        let allow = true;
        try {
          allow = JSON.parse(data).allow !== false;
        } catch {}
        allow ? go() : stop();
      });
    }
  );
  req.on('error', () => ask(list, i + 1));
  req.end(body);
}

if (!tool || process.env.HOLDUP_SKIP) go();
else ask(targets(), 0);
