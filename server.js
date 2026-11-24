const http = require('http');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rawUrl = reqUrl.searchParams.get('url') || '';
  if (!rawUrl) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('HK Sports Proxy Ready');
  }

  const target = rawUrl.trim().split('#')[0].trim();
  if (!/^https?:\/\//i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Invalid URL');
  }

  try {
    const parsed = new URL(target);
    let referer = `${parsed.protocol}//${parsed.host}/`;
    if (target.includes('hridoytv') || target.includes('workers.dev')) {
      referer = 'https://hridoytv.pages.dev/';
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Origin': referer.replace(/\/$/, ''),
      'Referer': referer,
    };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const upstream = await fetch(target, { headers, redirect: 'follow' });
    const ct = upstream.headers.get('content-type') || '';
    const finalUrl = upstream.url || target;
    const isM3u8 =
      finalUrl.toLowerCase().includes('.m3u8') ||
      target.toLowerCase().includes('.m3u8') ||
      ct.toLowerCase().includes('mpegurl');

    if (isM3u8) {
      const text = await upstream.text();
      const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
      const selfBase = `${proto}://${req.headers.host}/?url=`;

      const rewritten = text
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) {
            if (trimmed.includes('URI="')) {
              return trimmed.replace(/URI="([^"]+)"/, (_m, uri) => {
                const abs = uri.startsWith('http') ? uri : new URL(uri, finalUrl).toString();
                return `URI="${selfBase}${encodeURIComponent(abs)}"`;
              });
            }
            return line;
          }
          const abs = trimmed.startsWith('http') ? trimmed : new URL(trimmed, finalUrl).toString();
          return `${selfBase}${encodeURIComponent(abs)}`;
        })
        .join('\n');

      res.writeHead(upstream.status, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
      });
      return res.end(rewritten);
    }

    const outHeaders = { 'Cache-Control': 'no-store' };
    if (ct) outHeaders['Content-Type'] = ct;
    const cl = upstream.headers.get('content-length');
    if (cl) outHeaders['Content-Length'] = cl;
    const cr = upstream.headers.get('content-range');
    if (cr) outHeaders['Content-Range'] = cr;

    res.writeHead(upstream.status, outHeaders);
    if (!upstream.body) return res.end();

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(err && err.message ? err.message : 'Proxy Error');
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Proxy running on port', PORT);
});
