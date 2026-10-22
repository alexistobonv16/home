/**
 * Cloudflare Pages Function: /api/tv/sync
 * GET: Retrieve playlists, favorites and last channel from Cloudflare KV
 * POST: Save and synchronize playlists, favorites and settings across devices
 *
 * Auth: only session tokens issued by /api/tv/auth (stored in KV) are valid.
 * No hardcoded fallback PINs or plain-PIN headers are accepted.
 */

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getExpectedPin(env) {
  // 1. Prioridad: PIN dinámico vigente guardado en KV (site_config.tvPin o site_config.adminPin)
  if (env && env.HOME_KV) {
    try {
      const raw = await env.HOME_KV.get('site_config');
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.tvPin && typeof cfg.tvPin === 'string' && cfg.tvPin.trim()) {
          return cfg.tvPin.trim();
        }
        if (cfg.adminPin && typeof cfg.adminPin === 'string' && cfg.adminPin.trim()) {
          return cfg.adminPin.trim();
        }
      }
    } catch {}
  }

  // 2. Prioridad: Secreto seguro configurado en variables de entorno de Cloudflare Pages
  const envPin = env?.TV_PIN || env?.ADMIN_PIN;
  if (envPin && typeof envPin === 'string' && envPin.trim()) {
    return envPin.trim();
  }

  // 3. Sin fallback público: si no hay PIN en KV ni en secrets, no se autoriza
  return '';
}

async function checkAuth(context) {
  const authHeader = context.request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  if (!context.env || !context.env.HOME_KV) return false;

  const expectedPin = await getExpectedPin(context.env);
  if (!expectedPin) return false;

  const sessionRaw = await context.env.HOME_KV.get(`tv_session_${token}`);
  if (!sessionRaw) return false;

  try {
    const session = JSON.parse(sessionRaw);
    // Invalida sesiones emitidas con un PIN anterior.
    return session.pinHash === (await sha256Hex(expectedPin));
  } catch {
    return false;
  }
}

/* ==========================================================================
   BACKUPS: rotación automática de copias de tv_data en KV.
   - 10 slots (tv_backup_0..9) + índice tv_backups_meta.
   - Auto: al guardar un cambio real, con throttle de 6 h (o force).
   - Dedup por hash de contenido para no crear copias idénticas.
   ========================================================================== */
const BACKUP_SLOTS = 10;
const AUTO_BACKUP_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 horas

// Hash rápido (djb2) para detectar copias idénticas sin comparar strings gigantes.
function quickHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return `${str.length}:${(h >>> 0).toString(36)}`;
}

// Ignora updatedAt (cambia en cada guardado) para saber si el contenido cambió de verdad.
function stripVolatile(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);
    delete obj.updatedAt;
    return JSON.stringify(obj);
  } catch {
    return jsonStr;
  }
}

async function readBackupMeta(env) {
  try {
    const raw = await env.HOME_KV.get('tv_backups_meta');
    if (raw) {
      const meta = JSON.parse(raw);
      if (meta && Array.isArray(meta.slots)) {
        while (meta.slots.length < BACKUP_SLOTS) meta.slots.push(null);
        return meta;
      }
    }
  } catch {}
  return { slots: new Array(BACKUP_SLOTS).fill(null), lastAutoAt: 0 };
}

function slotStats(dataJson) {
  let playlists = 0;
  let channels = 0;
  try {
    const d = JSON.parse(dataJson);
    if (Array.isArray(d.playlists)) {
      playlists = d.playlists.length;
      channels = d.playlists.reduce((n, p) => n + (Array.isArray(p && p.channels) ? p.channels.length : 0), 0);
    }
  } catch {}
  return {
    savedAt: new Date().toISOString(),
    size: dataJson.length,
    hash: quickHash(dataJson),
    playlists,
    channels
  };
}

// Escribe dataJson en un slot libre (o el más viejo si todos están ocupados).
async function writeBackupSlot(env, dataJson, meta) {
  let idx = meta.slots.findIndex(s => !s);
  if (idx === -1) {
    let oldest = Infinity;
    meta.slots.forEach((s, i) => {
      const t = s && s.savedAt ? Date.parse(s.savedAt) : 0;
      if (t < oldest) { oldest = t; idx = i; }
    });
  }
  await env.HOME_KV.put(`tv_backup_${idx}`, dataJson);
  meta.slots[idx] = slotStats(dataJson);
  meta.slots[idx].index = idx;
  return idx;
}

// Reserva (o reutiliza por hash) una copia de currentRaw. Devuelve {created, index}.
async function createBackupOf(env, currentRaw, meta, throttleKey) {
  const hash = quickHash(currentRaw);
  const dup = meta.slots.findIndex(s => s && s.hash === hash);
  if (dup !== -1) return { created: false, index: dup, reason: 'sin cambios' };

  if (throttleKey) {
    const last = meta[throttleKey] || 0;
    if (Date.now() - last < AUTO_BACKUP_THROTTLE_MS) return { created: false, index: -1, reason: 'throttle' };
  }

  const index = await writeBackupSlot(env, currentRaw, meta);
  if (throttleKey) meta[throttleKey] = Date.now();
  await env.HOME_KV.put('tv_backups_meta', JSON.stringify(meta));
  return { created: true, index };
}

function jsonRes(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...extraHeaders
    }
  });
}

export async function onRequestGet(context) {
  try {
    const isAuthed = await checkAuth(context);
    if (!isAuthed) {
      return new Response(JSON.stringify({ success: false, error: 'No autorizado. Por favor ingresa tu PIN.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // --- Endpoints de respaldos: ?backups=list | ?backups=<n>[&dl=1] ---
    const reqUrl = new URL(context.request.url);
    const backupsParam = reqUrl.searchParams.get('backups');
    if (backupsParam !== null && context.env && context.env.HOME_KV) {
      const meta = await readBackupMeta(context.env);

      if (backupsParam === 'list') {
        return jsonRes({ success: true, slots: meta.slots, throttleHours: AUTO_BACKUP_THROTTLE_MS / 3600000 });
      }

      const idx = parseInt(backupsParam, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= BACKUP_SLOTS) {
        return jsonRes({ success: false, error: 'Slot inválido.' }, 400);
      }
      const data = await context.env.HOME_KV.get(`tv_backup_${idx}`);
      if (!data) {
        return jsonRes({ success: false, error: 'Ese respaldo no existe.' }, 404);
      }
      if (reqUrl.searchParams.get('dl') === '1') {
        const name = `tv-backup-${idx}-${(meta.slots[idx] && meta.slots[idx].savedAt || '').replace(/[:.]/g, '-')}.json`;
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${name}"`,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });
      }
      let parsed = null;
      try { parsed = JSON.parse(data); } catch {}
      return jsonRes({ success: true, data: parsed, meta: meta.slots[idx] || null });
    }

    let tvData = null;
    if (context.env && context.env.HOME_KV) {
      const raw = await context.env.HOME_KV.get('tv_data');
      if (raw) {
        try {
          tvData = JSON.parse(raw);
        } catch {}
      }
    }

    if (!tvData) {
      tvData = {
        playlists: [],
        activePlaylistId: null,
        favorites: [],
        lastChannel: null
      };
    }

    return new Response(JSON.stringify({
      success: true,
      data: tvData
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost(context) {
  try {
    const isAuthed = await checkAuth(context);
    if (!isAuthed) {
      return new Response(JSON.stringify({ success: false, error: 'No autorizado. Por favor ingresa tu PIN.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Cuerpo de solicitud inválido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // --- Acción manual: crear respaldo de los datos ACTUALES sin sobrescribir nada ---
    if (body.createBackup === true && !Array.isArray(body.playlists)) {
      if (!context.env || !context.env.HOME_KV) {
        return jsonRes({ success: false, error: 'KV no disponible.' }, 500);
      }
      const currentRaw = await context.env.HOME_KV.get('tv_data');
      if (!currentRaw) {
        return jsonRes({ success: false, error: 'Aún no hay datos que respaldar.' }, 400);
      }
      const meta = await readBackupMeta(context.env);
      const result = await createBackupOf(context.env, currentRaw, meta, null);
      return jsonRes({
        success: true,
        created: result.created,
        index: result.index,
        reason: result.reason || null,
        slots: meta.slots
      });
    }

    // Límite de tamaño: KV soporta 25 MB, pero evitamos payloads absurdos.
    if (JSON.stringify(body).length > 5_000_000) {
      return new Response(JSON.stringify({ success: false, error: 'Payload demasiado grande.' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { playlists, activePlaylistId, favorites, lastChannel, recentChannels, epgUrl, hiddenGroups } = body;

    const payloadToSave = {
      playlists: Array.isArray(playlists) ? playlists : [],
      activePlaylistId: activePlaylistId || null,
      favorites: Array.isArray(favorites) ? favorites : [],
      recentChannels: Array.isArray(recentChannels) ? recentChannels.slice(0, 15) : [],
      lastChannel: lastChannel || null,
      epgUrl: typeof epgUrl === 'string' ? epgUrl : null,
      hiddenGroups: Array.isArray(hiddenGroups) ? hiddenGroups : [],
      updatedAt: new Date().toISOString()
    };

    if (context.env && context.env.HOME_KV) {
      const newRaw = JSON.stringify(payloadToSave);

      // Rotación de respaldos: si el contenido cambió de verdad, guarda la
      // versión anterior antes de pisarla (throttle 6 h; backupForce lo salta,
      // lo usa "Restaurar" para que el estado pre-restauración quede rescatable).
      try {
        const currentRaw = await context.env.HOME_KV.get('tv_data');
        if (currentRaw && stripVolatile(currentRaw) !== stripVolatile(newRaw)) {
          const meta = await readBackupMeta(context.env);
          const result = await createBackupOf(
            context.env,
            currentRaw,
            meta,
            body.backupForce === true ? null : 'lastAutoAt'
          );
          if (body.backupForce === true && result.created) {
            meta.lastAutoAt = Date.now();
            await context.env.HOME_KV.put('tv_backups_meta', JSON.stringify(meta));
          }
        }
      } catch {
        // El respaldo nunca debe impedir el guardado principal.
      }

      await context.env.HOME_KV.put('tv_data', newRaw);
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Listas y favoritos sincronizados en Cloudflare KV.',
      data: payloadToSave
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestOptions() {
  // Sin ACAO: solo el mismo origen consume este endpoint (tv.html).
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
