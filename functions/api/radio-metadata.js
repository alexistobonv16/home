/**
 * Cloudflare Pages Function: /api/radio-metadata
 * Detects real-time Now Playing song metadata from Icecast/Shoutcast streams
 * and automatically enriches it with Apple Music (iTunes Search API) album artwork,
 * album title, and track details.
 */

const USER_AGENTS = [
  'VLC/3.0.18 LibVLC/3.0.18',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedHostname(hostname) {
  const h = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata') return true;

  const dotMatch = h.match(/^(\d{1,3}(?:\.\d{1,3}){3})\.(?:sslip\.io|nip\.io)$/);
  if (dotMatch) return isPrivateIPv4(dotMatch[1]);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateIPv4(h);

  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
    if (h.startsWith('::ffff:')) return true;
  }
  return false;
}

function cleanTrackTitle(raw) {
  if (!raw) return { artist: '', title: '', raw: '' };
  // Quitar etiquetas superfluas tipo (Official Video), [Remastered], etc.
  let cleaned = raw.replace(/\s*[\(\[][^\)\]]*(official|audio|video|remaster|radio edit|club mix|lyric|album version|version)[^\)\]]*[\)\]]/gi, '').trim();
  
  let artist = '';
  let title = '';
  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  } else if (cleaned.includes(' / ')) {
    const parts = cleaned.split(' / ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' / ').trim();
  } else {
    title = cleaned;
  }
  return { artist, title, raw };
}

function isGenericStreamTitle(str, stationName = '') {
  if (!str || str.length < 3) return true;
  const s = str.toLowerCase().trim();
  const stName = (stationName || '').toLowerCase().trim();

  if (stName && (s === stName || s.includes(stName))) return true;

  const generics = [
    'unknown', 'en vivo', 'live', 'transmisión', 'transmision', 'radio',
    'zeno media', 'zeno.fm', 'icecast', 'shoutcast', 'publicidad',
    'comerciales', 'identificador', 'sintonizador', 'offline', 'connecting',
    'audio stream', 'station'
  ];
  return generics.some(g => s === g || s.startsWith(g + ' -') || s.endsWith('- ' + g));
}

// Extrae el título ICY leyendo los primeros bytes del stream
async function extractIcyTitleFromStream(streamRes, metaint, timeoutMs = 3500) {
  const reader = streamRes.body.getReader();
  let count = 0;
  let metaLength = 0;
  let metaBytes = [];
  let state = 0; // 0: audio, 1: length, 2: meta
  const startTime = Date.now();

  try {
    while (Date.now() - startTime < timeoutMs) {
      const { done, value } = await reader.read();
      if (done || !value) break;

      let offset = 0;
      while (offset < value.length) {
        if (state === 0) {
          const need = metaint - count;
          const take = Math.min(need, value.length - offset);
          count += take;
          offset += take;
          if (count >= metaint) {
            state = 1;
            count = 0;
          }
        } else if (state === 1) {
          const lengthByte = value[offset++];
          metaLength = lengthByte * 16;
          if (metaLength === 0) {
            state = 0;
          } else {
            state = 2;
            metaBytes = [];
          }
        } else if (state === 2) {
          const need = metaLength - metaBytes.length;
          const take = Math.min(need, value.length - offset);
          for (let i = 0; i < take; i++) {
            metaBytes.push(value[offset + i]);
          }
          offset += take;
          if (metaBytes.length >= metaLength) {
            const rawStr = new TextDecoder('utf-8').decode(new Uint8Array(metaBytes));
            const match = rawStr.match(/StreamTitle=['"]([^'"]*)['"]/i);
            if (match && match[1]) {
              return match[1].trim();
            }
            state = 0;
          }
        }
      }
    }
  } catch (err) {
    // Timeout or abort
  } finally {
    try { await reader.cancel(); } catch (e) {}
  }
  return null;
}

// Búsqueda en la API de Apple (iTunes Search API)
async function searchAppleMusic(artist, title, rawTitle) {
  const queries = [];
  if (artist && title) {
    queries.push(`${artist} ${title}`);
    queries.push(`${title}`);
  } else if (rawTitle) {
    queries.push(rawTitle);
  }

  for (const query of queries) {
    try {
      const u = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=1`;
      const res = await fetch(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          'Accept': 'application/json'
        }
      });
      if (!res.ok) continue;

      const data = await res.json();
      if (data && data.results && data.results.length > 0) {
        const track = data.results[0];
        const artworkHd = (track.artworkUrl100 || '').replace('100x100bb.jpg', '600x600bb.jpg');
        return {
          title: track.trackName || title,
          artist: track.artistName || artist,
          album: track.collectionName || '',
          year: track.releaseDate ? new Date(track.releaseDate).getFullYear() : null,
          genre: track.primaryGenreName || null,
          artwork: artworkHd,
          artwork100: track.artworkUrl100 || '',
          previewUrl: track.previewUrl || null,
          appleMusicUrl: track.trackViewUrl || null
        };
      }
    } catch (e) {}
  }
  return null;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent',
      'Access-Control-Max-Age': '86400'
    }
  });
}

export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  let targetUrl = (searchParams.get('url') || '').trim();
  const directQuery = (searchParams.get('query') || '').trim();
  const stationName = (searchParams.get('name') || '').trim();

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=12'
  };

  // 1. Si el cliente envió una consulta directa (por ejemplo, desde etiquetas ID3 de HLS)
  if (directQuery) {
    const { artist, title, raw } = cleanTrackTitle(directQuery);
    if (!isGenericStreamTitle(raw, stationName)) {
      const appleResult = await searchAppleMusic(artist, title, raw);
      if (appleResult) {
        return new Response(JSON.stringify({
          success: true,
          hasSong: true,
          rawTitle: raw,
          ...appleResult
        }), { status: 200, headers: corsHeaders });
      }
      return new Response(JSON.stringify({
        success: true,
        hasSong: true,
        title: title || raw,
        artist: artist || stationName,
        album: '',
        artwork: null,
        rawTitle: raw
      }), { status: 200, headers: corsHeaders });
    }
  }

  if (!targetUrl) {
    return new Response(JSON.stringify({ success: true, hasSong: false, reason: 'No url provided' }), {
      status: 200,
      headers: corsHeaders
    });
  }

  // Auto-protocolo
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'http://' + targetUrl;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'URL mal formada' }), { status: 400, headers: corsHeaders });
  }

  if (isBlockedHostname(parsed.hostname)) {
    return new Response(JSON.stringify({ success: false, error: 'Host bloqueado' }), { status: 403, headers: corsHeaders });
  }

  // Probar obtener metadatos ICY siguiendo redirects
  let currentUrl = targetUrl;
  let rawStreamTitle = null;

  for (let hop = 0; hop <= 4; hop++) {
    try {
      const u = new URL(currentUrl);
      if (isBlockedHostname(u.hostname)) break;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(currentUrl, {
        headers: {
          'Icy-MetaData': '1',
          'User-Agent': USER_AGENTS[0],
          'Accept': '*/*'
        },
        signal: controller.signal,
        redirect: 'manual'
      });
      clearTimeout(timeoutId);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('Location');
        if (!loc) break;
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }

      const metaintHeader = parseInt(res.headers.get('icy-metaint') || '0', 10);
      if (metaintHeader > 0 && res.body) {
        rawStreamTitle = await extractIcyTitleFromStream(res, metaintHeader, 3500);
      }
      break;
    } catch (e) {
      break;
    }
  }

  if (rawStreamTitle && !isGenericStreamTitle(rawStreamTitle, stationName)) {
    const { artist, title, raw } = cleanTrackTitle(rawStreamTitle);
    const appleResult = await searchAppleMusic(artist, title, raw);

    if (appleResult) {
      return new Response(JSON.stringify({
        success: true,
        hasSong: true,
        rawTitle: raw,
        ...appleResult
      }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      success: true,
      hasSong: true,
      title: title || raw,
      artist: artist || stationName,
      album: '',
      artwork: null,
      rawTitle: raw
    }), { status: 200, headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    success: true,
    hasSong: false,
    rawTitle: rawStreamTitle || null
  }), { status: 200, headers: corsHeaders });
}
