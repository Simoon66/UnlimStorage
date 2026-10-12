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

function decodeManifestBase64(raw) {
  let base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Graceful responses for FFprobe / hydration endpoints on Cloudflare Pages static deployment
    if (
      url.pathname.endsWith('/media-info') ||
      url.pathname.endsWith('/ensure-streamable') ||
      url.pathname.endsWith('/preload')
    ) {
      return new Response(
        JSON.stringify({
          ok: false,
          hasBinaryOrChunks: true,
          staticWorker: true,
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // Direct proxy for /api/files/:id/download or /api/files/:id/stream on Cloudflare Pages
    if (url.pathname.startsWith('/api/files/') && (url.pathname.endsWith('/stream') || url.pathname.endsWith('/download'))) {
      const parts = url.pathname.split('/');
      const fileId = decodeURIComponent(parts[3] || '');
      const isStream = url.pathname.endsWith('/stream');
      const isInline = url.searchParams.get('inline') === '1' || isStream;
      const fileName = url.searchParams.get('name') || (isStream ? 'video.mp4' : 'file.bin');

      // If manifest param 'm' is provided or chunks in query, forward to tg-stream
      if (url.searchParams.has('m')) {
        const streamUrl = new URL('/api/public/tg-stream', request.url);
        streamUrl.search = url.search;
        return this.fetch(new Request(streamUrl.toString(), request), env);
      }

      // Single chunk fileId direct fallback
      if (fileId && !fileId.startsWith('file_')) {
        const chunkUrl = new URL('/api/public/tg-chunk', request.url);
        chunkUrl.searchParams.set('fileId', fileId);
        return this.fetch(new Request(chunkUrl.toString(), request), env);
      }

      // If file stream/download cannot be resolved directly on Cloudflare worker, return 404 JSON with CORS so client IndexedDB/blob fallback activates immediately
      return new Response(
        JSON.stringify({ error: 'File stream not found on static worker', staticWorker: true }),
        {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    // 1. Single-chunk binary proxy (/api/public/tg-chunk?fileId=...&botToken=...)
    if (url.pathname === '/api/public/tg-chunk' && (request.method === 'GET' || request.method === 'HEAD')) {
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
        return new Response(request.method === 'HEAD' ? null : fileRes.body, {
          status: fileRes.status,
          headers,
        });
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
        let fileName = 'video.mp4';
        let mimeType = 'video/mp4';
        let totalSize = 0;
        const isInline = url.searchParams.get('inline') === '1';

        if (request.method === 'POST') {
          const body = await request.json();
          chunks = Array.isArray(body.chunks) ? body.chunks : [];
          botToken = body.botToken || DEFAULT_BOT_TOKEN;
          fileName = body.fileName || 'video.mp4';
          mimeType = body.mimeType || 'video/mp4';
          totalSize = Number(body.totalSize) || 0;
        } else {
          const rawManifest = url.searchParams.get('m') || '';
          if (rawManifest) {
            const decoded = decodeManifestBase64(rawManifest);
            chunks = Array.isArray(decoded.chunks) ? decoded.chunks : [];
            botToken = decoded.botToken || DEFAULT_BOT_TOKEN;
            fileName = decoded.fileName || 'video.mp4';
            mimeType = decoded.mimeType || 'video/mp4';
            totalSize = Number(decoded.totalSize) || 0;
          }
        }

        if (!chunks.length) {
          return new Response('No chunks provided', { status: 400, headers: CORS_HEADERS });
        }

        const lowerName = String(fileName || '').toLowerCase();
        if (isInline && (lowerName.endsWith('.mkv') || mimeType === 'video/x-matroska')) {
          mimeType = 'video/webm';
        } else if (lowerName.endsWith('.mp4') || lowerName.endsWith('.m4v')) {
          mimeType = 'video/mp4';
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

        if (request.method === 'HEAD') {
          const headers = new Headers(CORS_HEADERS);
          headers.set('Accept-Ranges', 'bytes');
          headers.set('Content-Type', mimeType);
          if (effectiveTotal > 0) {
            headers.set('Content-Length', String(effectiveTotal));
          }
          return new Response(null, { status: 200, headers });
        }

        if (rangeHeader && effectiveTotal > 0) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10) || 0;
          if (start >= effectiveTotal) {
            const headers = new Headers(CORS_HEADERS);
            headers.set('Content-Range', `bytes */${effectiveTotal}`);
            return new Response(null, { status: 416, headers });
          }

          const target =
            offsets.find((o) => start >= o.start && start <= o.end) ||
            offsets[offsets.length - 1];
          const fid = target.chunk.fileId || target.chunk.f;
          const tgUrl = await resolveTelegramFileUrl(fid, botToken);

          // For open-ended browser video range requests (e.g. "bytes=0-"), serve up to the end of the current chunk
          // (or 8 MB window for instant first-frame playback) and stream body directly without arrayBuffer delay.
          const hasExplicitEnd = Boolean(parts[1] && parts[1].trim() !== '');
          const maxWindowEnd = isInline && !hasExplicitEnd
            ? Math.min(target.end, start + 8 * 1024 * 1024 - 1)
            : target.end;
          const reqEnd = hasExplicitEnd
            ? Math.min(effectiveTotal - 1, parseInt(parts[1], 10))
            : maxWindowEnd;

          const effectiveEnd = Math.min(reqEnd, target.end);
          const subStart = Math.max(0, start - target.start);
          const subEnd = Math.max(subStart, effectiveEnd - target.start);
          const expectedLen = subEnd - subStart + 1;

          const partRes = await fetch(tgUrl, {
            headers: { Range: `bytes=${subStart}-${subEnd}` },
          });

          if (partRes.ok || partRes.status === 206) {
            const upstreamLen = Number(partRes.headers.get('content-length')) || expectedLen;
            const finalEnd = Math.min(effectiveTotal - 1, start + Math.max(0, upstreamLen - 1));
            const headers = new Headers(CORS_HEADERS);
            headers.set('Accept-Ranges', 'bytes');
            headers.set('Content-Type', mimeType);
            headers.set('Content-Range', `bytes ${start}-${finalEnd}/${effectiveTotal}`);
            headers.set('Content-Length', String(upstreamLen));
            headers.set(
              'Content-Disposition',
              `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`
            );
            return new Response(partRes.body, { status: 206, headers });
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
