import { assertSafeUrl, SsrfError } from '../proxy/ssrfGuard.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const target = req.headers['x-webdav-url'];
  if (!target) return res.status(400).json({ error: 'Missing X-WebDAV-Url header' });

  // SSRF guard: validate scheme, resolve DNS, and reject any private/reserved
  // target (loopback, RFC-1918, 169.254.169.254 metadata, IPv6 ULA, encoded IP
  // literals). This is the public, multi-tenant hosted instance, so private/LAN
  // ranges are ALWAYS blocked (no allowPrivate) — unlike the self-host standalone
  // proxy, which permits LAN targets by default. global fetch can't pin the
  // resolved address, so a determined sub-TTL rebinding attacker has a narrow
  // residual window here — acceptable on Vercel's controlled egress; the
  // standalone proxy pins the connection.
  try {
    await assertSafeUrl(target);
  } catch (err) {
    if (err instanceof SsrfError) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const headers = {};
  for (const h of ['authorization', 'x-webdav-auth', 'content-type', 'if-match', 'depth', 'destination']) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(target, { method: req.method, headers, body });
    const responseHeaders = {};
    for (const h of ['content-type', 'etag', 'last-modified', 'dav', 'allow']) {
      const v = upstream.headers.get(h);
      if (v) responseHeaders[h] = v;
    }
    const responseBody = await upstream.arrayBuffer();
    res.writeHead(upstream.status, responseHeaders);
    res.end(Buffer.from(responseBody));
  } catch (err) {
    res.status(502).json({ error: 'Upstream error', detail: err.message });
  }
}
