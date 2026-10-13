/**
 * Cloudflare Pages Function: /api/radio-metadata
 * High-performance real-time song metadata and album artwork engine
 * Dual-Engine: Apple Music (iTunes Search API) + Deezer Music API fallback
 * Features: Edge In-Memory Caching (12s stream cache, 2hr artwork cache) + Progressive Artwork
 */

const USER_AGENTS = [
  'VLC/3.0.18 LibVLC/3.0.18',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

// In-Memory Edge Caches (per Cloudflare Worker isolate)
const stationMetadataCache = new Map(); // key: streamUrl -> { data, timestamp }
const artworkCache = new Map();         // key: normalizedQuery -> { data, timestamp }

const STREAM_CACHE_TTL_MS = 12000;      // 12 segundos para el stream
const ARTWORK_CACHE_TTL_MS = 7200000;    // 2 horas para carátulas

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

  // 1. Quitar números iniciales tipo "01. ", "02 - " o prefijos "Now Playing: "
  let cleaned = raw
    .replace(/^(\d+[\.\-\s]+|now playing:?\s*|reproduciendo:?\s*)/i, '')
    // 2. Quitar etiquetas en paréntesis o corchetes tipo (Audio Oficial), (Official Video), [Remastered]
    .replace(/\s*[\(\[][^\)\]]*(audio|oficial|official|video|remix|version|versión|vivo|live|edit|feat|ft\.|lyric|letra|acustico|acústico|remaster|hd|4k)[^\)\]]*[\)\]]/gi, '')
    // 3. Quitar sufijos promocionales con guiones
    .replace(/\s*-\s*(audio|oficial|official|video|remix|version|versión|en vivo|live|edit|lyric video)/gi, '')
    .trim();

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
  } else if (cleaned.includes(' : ')) {
    const parts = cleaned.split(' : ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' : ').trim();
  } else if (cleaned.includes(' | ')) {
    const parts = cleaned.split(' | ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' | ').trim();
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
    'audio stream', 'station', 'online'
  ];
  return generics.some(g => s === g || s.startsWith(g + ' -') || s.endsWith('- ' + g));
}

// Extrae el título ICY leyendo los primeros bytes del stream
async function extractIcyTitleFromStream(streamRes, metaint, timeoutMs = 2800) {
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

// Búsqueda enriquecida multi-motor: Apple Music (iTunes) + Deezer
async function searchMusicArtwork(artist, title, rawTitle) {
  const cacheKey = `${artist || ''}:::${title || ''}:::${rawTitle || ''}`.toLowerCase().trim();
  if (artworkCache.has(cacheKey)) {
    const cached = artworkCache.get(cacheKey);
    if (Date.now() - cached.timestamp < ARTWORK_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const queries = [];
  if (artist && title) {
    queries.push(`${artist} ${title}`);
    const cleanArtist = artist.replace(/\s*(feat\.?|ft\.?|&|\/).*$/i, '').trim();
    if (cleanArtist && cleanArtist !== artist) {
      queries.push(`${cleanArtist} ${title}`);
    }
    queries.push(title);
  } else if (rawTitle) {
    queries.push(rawTitle);
  }

  let result = null;

  // 1. Motor Primario: Apple Music (iTunes Search API)
  for (const query of queries) {
    try {
      const u = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=1`;
      const res = await fetch(u);
      if (!res.ok) continue;

      const data = await res.json();
      if (data && data.results && data.results.length > 0) {
        const track = data.results[0];
        const art100 = track.artworkUrl100 || '';
        const artHd = art100.replace(/\b\d+x\d+\b/, '600x600');
        const art300 = art100.replace(/\b\d+x\d+\b/, '300x300');

        result = {
          source: 'apple',
          title: track.trackName || title,
          artist: track.artistName || artist,
          album: track.collectionName || '',
          year: track.releaseDate ? new Date(track.releaseDate).getFullYear() : null,
          genre: track.primaryGenreName || null,
          artwork: artHd,
          artwork300: art300,
          artwork100: art100,
          previewUrl: track.previewUrl || null,
          appleMusicUrl: track.trackViewUrl || null
        };
        break;
      }
    } catch (e) {}
  }

  // 2. Motor Secundario: Deezer API (para catálogo latino, urbano, canciones con caracteres especiales)
  if (!result) {
    for (const query of queries) {
      try {
        const u = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`;
        const res = await fetch(u);
        if (!res.ok) continue;

        const data = await res.json();
        if (data && data.data && data.data.length > 0) {
          const item = data.data[0];
          const alb = item.album || {};
          result = {
            source: 'deezer',
            title: item.title || title,
            artist: (item.artist && item.artist.name) || artist,
            album: alb.title || '',
            year: null,
            genre: null,
            artwork: alb.cover_xl || alb.cover_big || alb.cover_medium || '',
            artwork300: alb.cover_medium || alb.cover_big || '',
            artwork100: alb.cover_small || alb.cover_medium || '',
            previewUrl: item.preview || null,
            appleMusicUrl: null
          };
          break;
        }
      } catch (e) {}
    }
  }

  if (result) {
    if (artworkCache.size > 800) artworkCache.clear();
    artworkCache.set(cacheKey, { data: result, timestamp: Date.now() });
  }

  return result;
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
      const artResult = await searchMusicArtwork(artist, title, raw);
      if (artResult) {
        return new Response(JSON.stringify({
          success: true,
          hasSong: true,
          rawTitle: raw,
          ...artResult
        }), { status: 200, headers: corsHeaders });
      }
      return new Response(JSON.stringify({
        success: true,
        hasSong: true,
        title: title || raw,
        artist: artist || stationName,
        album: '',
        artwork: null,
        artwork300: null,
        artwork100: null,
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

  // Si es un stream HLS (.m3u8) y no viene una consulta directa (ID3), no intentar leer ICY
  if (!directQuery && (parsed.pathname.endsWith('.m3u8') || targetUrl.toLowerCase().includes('.m3u8'))) {
    return new Response(JSON.stringify({ success: true, hasSong: false, isHls: true }), {
      status: 200,
      headers: corsHeaders
    });
  }

  // Chequeo en caché de stream en memoria (Devuelve en 5-10ms)
  const streamCacheKey = (targetUrl + (stationName ? '::' + stationName : '')).toLowerCase();
  if (!directQuery && stationMetadataCache.has(streamCacheKey)) {
    const cached = stationMetadataCache.get(streamCacheKey);
    if (Date.now() - cached.timestamp < STREAM_CACHE_TTL_MS) {
      return new Response(JSON.stringify(cached.data), { status: 200, headers: corsHeaders });
    }
  }

  // Probar obtener metadatos ICY siguiendo redirects
  let currentUrl = targetUrl;
  let rawStreamTitle = null;

  for (let hop = 0; hop <= 3; hop++) {
    try {
      const u = new URL(currentUrl);
      if (isBlockedHostname(u.hostname)) break;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);

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
        rawStreamTitle = await extractIcyTitleFromStream(res, metaintHeader, 4000);
      }
      break;
    } catch (e) {
      break;
    }
  }

  if (rawStreamTitle && !isGenericStreamTitle(rawStreamTitle, stationName)) {
    const { artist, title, raw } = cleanTrackTitle(rawStreamTitle);
    const artResult = await searchMusicArtwork(artist, title, raw);

    const resultData = artResult ? {
      success: true,
      hasSong: true,
      rawTitle: raw,
      ...artResult
    } : {
      success: true,
      hasSong: true,
      title: title || raw,
      artist: artist || stationName,
      album: '',
      artwork: null,
      artwork300: null,
      artwork100: null,
      rawTitle: raw
    };

    if (stationMetadataCache.size > 300) stationMetadataCache.clear();
    stationMetadataCache.set(streamCacheKey, { data: resultData, timestamp: Date.now() });

    return new Response(JSON.stringify(resultData), { status: 200, headers: corsHeaders });
  }

  // Si no capturó título en este intento pero la emisora tenía una canción válida en los últimos 3 minutos (180s),
  // mantener esa canción activa para evitar que el título desaparezca y aparezca constantemente.
  if (stationMetadataCache.has(streamCacheKey)) {
    const prev = stationMetadataCache.get(streamCacheKey);
    if (prev && prev.data && prev.data.hasSong && (Date.now() - prev.timestamp < 180000)) {
      return new Response(JSON.stringify(prev.data), { status: 200, headers: corsHeaders });
    }
  }

  const noSongData = {
    success: true,
    hasSong: false,
    rawTitle: rawStreamTitle || null
  };

  // Guardar en caché negativo con TTL corto (5s) para no bloquear reintentos si fue un hipo momentáneo
  stationMetadataCache.set(streamCacheKey, { data: noSongData, timestamp: Date.now() - (STREAM_CACHE_TTL_MS - 5000) });

  return new Response(JSON.stringify(noSongData), { status: 200, headers: corsHeaders });
}
