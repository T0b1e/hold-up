import * as http from 'http';
import * as crypto from 'crypto';

export interface GateRequest {
  tool: string;
  args: string[];
  cwd: string;
}

/** Resolve true to let the command through. `aborted` fires if the command was Ctrl+C'd meanwhile. */
export type GateHandler = (req: GateRequest, aborted: AbortSignal) => Promise<boolean>;

export interface GateServer {
  port: number;
  token: string;
  close(): void;
}

export function startServer(handler: GateHandler): Promise<GateServer> {
  const token = crypto.randomBytes(16).toString('hex');

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/gate' || req.headers['x-holdup-token'] !== token) {
      res.writeHead(403).end();
      return;
    }

    const aborter = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) aborter.abort();
    });

    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let allow = true; // fail open
      try {
        const parsed = JSON.parse(body) as GateRequest;
        allow = await handler(
          { tool: String(parsed.tool), args: (parsed.args ?? []).map(String), cwd: String(parsed.cwd ?? '') },
          aborter.signal
        );
      } catch (e) {
        console.error('[hold-up] gate failed, letting it through:', e);
      }
      if (!res.writableEnded && !res.destroyed) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ allow }));
      }
    });
  });

  server.timeout = 0; // the modal can sit open as long as it likes

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as import('net').AddressInfo;
      resolve({ port, token, close: () => server.close() });
    });
  });
}
