const DEFAULT_BOT_TOKEN = '8552451944:AAGnsazvo2X2okXtKrAtAYGnuiizg_n8gkM';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, Content-Disposition',
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
        const fileRes = await fetch(tgFileUrl);
        if (!fileRes.ok) {
          return new Response(JSON.stringify({ error: 'Upstream chunk fetch failed' }), {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
        const headers = new Headers(CORS_HEADERS);
        headers.set('Content-Type', 'application/octet-stream');
        const len = fileRes.headers.get('content-length');
        if (len) headers.set('Content-Length', len);
        return new Response(fileRes.body, { status: 200, headers });
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

    // 2. Multi-chunk continuous stream download (/api/public/tg-stream)
    if (url.pathname === '/api/public/tg-stream') {
      try {
        let chunks = [];
        let botToken = DEFAULT_BOT_TOKEN;
        let fileName = 'download.bin';
        let mimeType = 'application/octet-stream';
        let totalSize = 0;

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

        const sorted = [...chunks].sort((a, b) => (a.partIndex || 0) - (b.partIndex || 0));
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
        headers.set('Content-Type', mimeType);
        headers.set(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(fileName)}"`
        );
        if (totalSize > 0) {
          headers.set('Content-Length', String(totalSize));
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
