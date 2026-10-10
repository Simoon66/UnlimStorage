const DEFAULT_BOT_TOKEN = '8552451944:AAGnsazvo2X2okXtKrAtAYGnuiizg_n8gkM';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Content-Type, Content-Disposition, Accept-Ranges',
};

async function resolveTelegramFileUrl(fileId, botToken) {
  const token = (botToken || DEFAULT_BOT_TOKEN).trim();
  const metaRes = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const metaJson = await metaRes.json();
  if (!metaJson.ok || !metaJson.result?.file_path) {
    throw new Error(metaJson.description || 'Could not resolve storage chunk path');
  }
  return `https://api.telegram.org/file/bot${token}/${metaJson.result.file_path}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/public/')) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 1. Single-chunk binary proxy (/api/public/tg-chunk?fileId=...&botToken=...)
    if (url.pathname === '/api/public/tg-chunk' && request.method === 'GET') {
      const fileId = url.searchParams.get('fileId') || '';
      const botToken = url.searchParams.get('botToken') || DEFAULT_BOT_TOKEN;
      if (!fileId) {
        return new Response(JSON.stringify({ error: 'Missing fileId' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      try {
        const tgFileUrl = await resolveTelegramFileUrl(fileId, botToken);
        const rangeHeader = request.headers.get('Range');
        const fileRes = await fetch(
          tgFileUrl,
          rangeHeader ? { headers: { Range: rangeHeader } } : undefined
        );
        if (!fileRes.ok && fileRes.status !== 206) {
          return new Response(JSON.stringify({ error: 'Upstream chunk fetch failed' }), {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
        const headers = new Headers(CORS_HEADERS);
        headers.set('Content-Type', 'application/octet-stream');
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'public, max-age=86400');
        const len = fileRes.headers.get('content-length');
        if (len) headers.set('Content-Length', len);
        const cr = fileRes.headers.get('content-range');
        if (cr) headers.set('Content-Range', cr);
        return new Response(fileRes.body, { status: fileRes.status, headers });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err instanceof Error ? err.message : 'Chunk proxy error' }),
          {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // 2. Multi-chunk continuous stream & HTTP 206 Range video stream (/api/public/tg-stream)
    if (url.pathname === '/api/public/tg-stream') {
      try {
        let chunks = [];
        let botToken = DEFAULT_BOT_TOKEN;
        let fileName = 'download.bin';
        let mimeType = 'application/octet-stream';
        let totalSize = 0;
        const isInline = url.searchParams.get('inline') === '1';

        if (request.method === 'POST') {
          const body = await request.json();
          chunks = Array.isArray(body.chunks) ? body.chunks : [];
          botToken = body.botToken || DEFAULT_BOT_TOKEN;
          fileName = body.fileName || 'download.bin';
          mimeType = body.mimeType || 'application/octet-stream';
          totalSize = Number(body.totalSize) || 0;
        } else {
          const rawManifest = url.searchParams.get('m') || '';
          if (rawManifest) {
            const decoded = JSON.parse(atob(rawManifest));
            chunks = Array.isArray(decoded.chunks) ? decoded.chunks : [];
            botToken = decoded.botToken || DEFAULT_BOT_TOKEN;
            fileName = decoded.fileName || 'download.bin';
            mimeType = decoded.mimeType || 'application/octet-stream';
            totalSize = Number(decoded.totalSize) || 0;
          }
        }

        if (!chunks.length) {
          return new Response('No chunks provided', { status: 400, headers: CORS_HEADERS });
        }

        const sorted = [...chunks].sort(
          (a, b) => (a.partIndex ?? a.p ?? 0) - (b.partIndex ?? b.p ?? 0)
        );

        let runningOffset = 0;
        const offsets = sorted.map((c, idx) => {
          const sz = Number(c.sizeBytes ?? c.s) || 19922944;
          const entry = {
            chunk: c,
            index: idx,
            start: runningOffset,
            end: runningOffset + sz - 1,
            size: sz,
          };
          runningOffset += sz;
          return entry;
        });

        const effectiveTotal = runningOffset > 0 ? runningOffset : totalSize;
        const rangeHeader = request.headers.get('Range');

        if (rangeHeader && effectiveTotal > 0) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10) || 0;
          const reqEnd = parts[1]
            ? Math.min(effectiveTotal - 1, parseInt(parts[1], 10))
            : effectiveTotal - 1;

          const target =
            offsets.find((o) => start >= o.start && start <= o.end) ||
            offsets[offsets.length - 1];
          const fid = target.chunk.fileId || target.chunk.f;
          const tgUrl = await resolveTelegramFileUrl(fid, botToken);

          const effectiveEnd = Math.min(reqEnd, target.end);
          const subStart = Math.max(0, start - target.start);
          const subEnd = Math.max(subStart, effectiveEnd - target.start);

          const partRes = await fetch(tgUrl, {
            headers: { Range: `bytes=${subStart}-${subEnd}` },
          });

          if (partRes.ok || partRes.status === 206) {
            const arrBuf = await partRes.arrayBuffer();
            const actualLen = arrBuf.byteLength;
            const finalEnd = start + Math.max(0, actualLen - 1);
            const headers = new Headers(CORS_HEADERS);
            headers.set('Accept-Ranges', 'bytes');
            headers.set('Content-Type', mimeType);
            headers.set('Content-Range', `bytes ${start}-${finalEnd}/${effectiveTotal}`);
            headers.set('Content-Length', String(actualLen));
            headers.set(
              'Content-Disposition',
              `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`
            );
            return new Response(arrBuf, { status: 206, headers });
          }
        }

        const { readable, writable } = new TransformStream();

        (async () => {
          const writer = writable.getWriter();
          try {
            for (const chunk of sorted) {
              const fid = chunk.fileId || chunk.f;
              const tgUrl = await resolveTelegramFileUrl(fid, botToken);
              const partRes = await fetch(tgUrl);
              if (!partRes.ok || !partRes.body) {
                throw new Error('Part fetch failed');
              }
              const reader = partRes.body.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) await writer.write(value);
              }
            }
            await writer.close();
          } catch (err) {
            try {
              await writer.abort(err);
            } catch {
              // ignore
            }
          }
        })();

        const headers = new Headers(CORS_HEADERS);
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Type', mimeType);
        headers.set(
          'Content-Disposition',
          `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`
        );
        if (effectiveTotal > 0) {
          headers.set('Content-Length', String(effectiveTotal));
        }
        return new Response(readable, { status: 200, headers });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err instanceof Error ? err.message : 'Stream error' }),
          {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // 3. Default static asset serving on Cloudflare Pages with SPA fallback
    if (env && env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status === 404 && !url.pathname.startsWith('/api/')) {
        return env.ASSETS.fetch(new URL('/index.html', request.url));
      }
      return assetRes;
    }

    return fetch(request);
  },
};
