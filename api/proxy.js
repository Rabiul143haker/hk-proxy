const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  if (!rawUrl) return res.status(200).send('HK Sports Proxy Ready');

  const target = rawUrl.trim().split('#')[0].trim();
  if (!/^https?:\/\//i.test(target)) return res.status(400).send('Invalid URL');

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
      const proto = req.headers['x-forwarded-proto'] || 'https';
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

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(upstream.status).send(rewritten);
    }

    if (ct) res.setHeader('Content-Type', ct);
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    const cr = upstream.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);
    res.setHeader('Cache-Control', 'no-store');

    res.status(upstream.status);
    if (!upstream.body) return res.end();

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).send(err && err.message ? err.message : 'Proxy Error');
    }
  }
};
