// js/h264w-worker.js
// Decodificador H.264 (FFmpeg → WebAssembly) para señales que MSE/WebCodecs no pueden
// decodificar (p. ej. PAFF interlaced sin frames IDR): Vía B.
// Flujo: TS (segmento HLS) → NALs de video → FFmpeg h264 (wasm, error concealment) →
// YUV420 → RGB (WebGL o JS) → OffscreenCanvas, con pacing de 29.97 fps.
// Decoder: @gfld/compositor-ffmpeg-h264 (FFmpeg n5.1.2 compilado a wasm, SIMD activo).

import LibavH264 from './h264w-wasm.js';

/* ---------- Extracción de NALs de video de un TS (PES → annexb) ---------- */
function videoPesNals(u8) {
  let pmtPid = null, videoPid = null;
  for (let i = 0; i + 188 <= u8.length; i += 188) {
    if (u8[i] !== 0x47) continue;
    const pid = ((u8[i + 1] & 0x1f) << 8) | u8[i + 2];
    const pusi = (u8[i + 1] & 0x40) !== 0;
    const afc = (u8[i + 3] >> 4) & 3;
    let off = i + 4;
    if (afc === 2 || afc === 3) off += 1 + u8[i + 4];
    if (off >= i + 188) continue;
    if (pusi) off += 1 + u8[off];
    if (off >= i + 188) continue;
    if (pid === 0 && pmtPid === null) {
      const sl = ((u8[off + 1] & 0x0f) << 8) | u8[off + 2];
      for (let p = off + 8; p < off + 3 + sl - 4; p += 4) {
        if (((u8[p] << 8) | u8[p + 1]) !== 0) { pmtPid = ((u8[p + 2] & 0x1f) << 8) | u8[p + 3]; break; }
      }
    } else if (pmtPid !== null && pid === pmtPid) {
      const sl = ((u8[off + 1] & 0x0f) << 8) | u8[off + 2];
      const pil = ((u8[off + 10] & 0x0f) << 8) | u8[off + 11];
      let p = off + 12 + pil;
      const end = off + 3 + sl - 4;
      while (p < end) {
        const st = u8[p], epid = ((u8[p + 1] & 0x1f) << 8) | u8[p + 2];
        const esil = ((u8[p + 3] & 0x0f) << 8) | u8[p + 4];
        if (st === 0x1b) videoPid = epid;
        p += 5 + esil;
      }
      break;
    }
  }
  if (videoPid === null) return [];
  const pesList = [];
  let cur = null;
  for (let i = 0; i + 188 <= u8.length; i += 188) {
    if (u8[i] !== 0x47) continue;
    const pid = ((u8[i + 1] & 0x1f) << 8) | u8[i + 2];
    if (pid !== videoPid) continue;
    const afc = (u8[i + 3] >> 4) & 3;
    if ((afc & 1) !== 1) continue;
    let off = i + 4;
    if (afc & 2) off = i + 5 + u8[i + 4];
    if (off >= i + 188) continue;
    const pusi = (u8[i + 1] & 0x40) !== 0;
    if (pusi && cur) pesList.push(cur);
    if (pusi) cur = [];
    if (cur) for (let b = off; b < i + 188; b++) cur.push(u8[b]);
  }
  if (cur && cur.length) pesList.push(cur);
  const nals = [];
  for (const bytes of pesList) {
    if (bytes.length < 10 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 1) continue;
    const pStart = 9 + (bytes[8] || 0);
    if (pStart >= bytes.length) continue;
    const payload = bytes.slice(pStart);
    const marks = [];
    for (let j = 0; j + 3 < payload.length; j++) {
      if (payload[j] === 0 && payload[j + 1] === 0) {
        if (payload[j + 2] === 1) { marks.push(j); j += 2; }
        else if (payload[j + 2] === 0 && payload[j + 3] === 1) { marks.push(j); j += 3; }
      }
    }
    for (let k = 0; k < marks.length; k++) {
      const s = marks[k];
      const nalStart = (payload[s + 2] === 1) ? s + 3 : s + 4;
      const end = (k + 1 < marks.length) ? marks[k + 1] : payload.length;
      if (nalStart < end) nals.push(Uint8Array.from(payload.slice(nalStart, end)));
    }
  }
  return nals;
}

/* ---------- Estado ---------- */
const FPS = 29.97;
const TICK = 1000 / FPS;
const NAL_BUDGET = 96;          // máx. NALs por tick (evita bloquear el hilo)
const NAL_MAX_BYTES = 4 * 1024 * 1024; // tope del buffer de entrada WASM (dataIn)
let nalsDropped = 0;
const QUEUE_MAX = 12000;        // válvula de seguridad de memoria (≈25 s de video)

let mod = null, ctx = 0, dataIn = 0;
let yO = 0, uO = 0, vO = 0, wO = 0, hO = 0, sO = 0;

let canvas = null;
let gl = null, prog = null, tex = null, aP = -1, uTex = [];
let c2d = null, imgData = null;
let conv = 'gl';
let texW = 0, texH = 0;
let scratch = null;

let queue = [];
let tickTimer = null, statsTimer = null;
let startedAt = null, firstFrameMs = null;
let frames = 0, nalsFed = 0, renderErrs = 0, strideWarn = 0;
let curW = 0, curH = 0, curStride = 0;
// Reloj de contenido (Vía B): posición del último cuadro rendido en la línea de
// tiempo del playlist (fragStart del fragmento + cuadros rendidos dentro de él).
// El main lo usa para alinear el audio (fragStart − picPos) y así mantener labios.
let curFs = null, fsFrames = 0, lastCt = null;
let inited = false;

/* ---------- Sílabo de conversión YUV→RGB (WebGL) ---------- */
const VS = `attribute vec2 aP; varying vec2 vUV;
void main(){ vUV = vec2((aP.x+1.0)*0.5, 1.0-(aP.y+1.0)*0.5); gl_Position = vec4(aP,0.0,1.0); }`;
const FS = `precision mediump float; varying vec2 vUV;
uniform sampler2D uY; uniform sampler2D uU; uniform sampler2D uV;
void main(){
  float C = texture2D(uY,vUV).r*255.0 - 16.0;
  float D = texture2D(uU,vUV).r*255.0 - 128.0;
  float E = texture2D(uV,vUV).r*255.0 - 128.0;
  float R = (298.0*C + 409.0*E + 128.0)/65280.0;
  float G = (298.0*C - 100.0*D - 208.0*E + 128.0)/65280.0;
  float B = (298.0*C + 516.0*D + 128.0)/65280.0;
  gl_FragColor = vec4(R, G, B, 1.0);
}`;

function mkShader(g, type, src) {
  const s = g.createShader(type);
  g.shaderSource(s, src); g.compileShader(s);
  if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error('shader: ' + g.getShaderInfoLog(s));
  return s;
}

function initGL() {
  gl = canvas.getContext('webgl', { preserveDrawingBuffer: false, antialias: false });
  if (!gl) throw new Error('sin contexto webgl');
  prog = gl.createProgram();
  gl.attachShader(prog, mkShader(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, mkShader(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  aP = gl.getAttribLocation(prog, 'aP');
  gl.enableVertexAttribArray(aP);
  gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
  uTex = [gl.getUniformLocation(prog, 'uY'), gl.getUniformLocation(prog, 'uU'), gl.getUniformLocation(prog, 'uV')];
  tex = [0, 1, 2].map(i => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  });
  uTex.forEach((l, i) => gl.uniform1i(l, i));
}

function allocTex(w, h) {
  texW = w; texH = h;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const sizes = [[w, h], [w >> 1, h >> 1], [w >> 1, h >> 1]];
  sizes.forEach(([tw, th], i) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, tex[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, tw, th, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
  });
  gl.viewport(0, 0, w, h);
}

// Copia a buffer contiguo solo si el stride no es ajustado (raro: 1920 ya es múltiplo de 32)
function tight(ptr, rows, rowBytes, stride) {
  if (rowBytes === stride) return mod.HEAPU8.subarray(ptr, ptr + rows * stride);
  if (!scratch || scratch.length < rows * rowBytes) scratch = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) scratch.set(mod.HEAPU8.subarray(ptr + r * stride, ptr + r * stride + rowBytes), r * rowBytes);
  return scratch;
}

function render(ptr, yPtr, w, h, stride) {
  const uPtr = mod.HEAP32[uO >> 2], vPtr = mod.HEAP32[vO >> 2];
  curW = w; curH = h; curStride = stride;
  if (stride !== w && stride !== 0) strideWarn++;
  if (conv === 'gl') {
    if (texW !== w || texH !== h) allocTex(w, h);
    const yBuf = tight(yPtr, h, w, stride);
    const uBuf = tight(uPtr, h >> 1, w >> 1, stride >> 1);
    const vBuf = tight(vPtr, h >> 1, w >> 1, stride >> 1);
    gl.activeTexture(gl.TEXTURE0); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.LUMINANCE, gl.UNSIGNED_BYTE, yBuf);
    gl.activeTexture(gl.TEXTURE1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w >> 1, h >> 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, uBuf);
    gl.activeTexture(gl.TEXTURE2); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w >> 1, h >> 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, vBuf);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  } else {
    if (!imgData || imgData.width !== w) {
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      imgData = new ImageData(w, h);
    }
    const H = mod.HEAPU8, d = imgData.data;
    const uvStride = stride >> 1;
    let o = 0;
    for (let yy = 0; yy < h; yy++) {
      const yRow = yPtr + yy * stride, cRow = uPtr + (yy >> 1) * uvStride, c2Row = vPtr + (yy >> 1) * uvStride;
      for (let x = 0; x < w; x++) {
        const C = H[yRow + x] - 16, D = H[cRow + (x >> 1)] - 128, E = H[c2Row + (x >> 1)] - 128;
        let r = (298 * C + 409 * E + 128) >> 8;
        let g = (298 * C - 100 * D - 208 * E + 128) >> 8;
        let b = (298 * C + 516 * D + 128) >> 8;
        d[o++] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[o++] = g < 0 ? 0 : g > 255 ? 255 : g;
        d[o++] = b < 0 ? 0 : b > 255 ? 255 : b;
        d[o++] = 255;
      }
    }
    c2d.putImageData(imgData, 0, 0);
  }
}

// Liberar SIEMPRE el frame devuelto por FFmpeg → evita agotar el DPB (fuga que paraba el decode)
function renderSafe(ptr, yPtr, w, h, stride) {
  try { render(ptr, yPtr, w, h, stride); }
  finally { try { mod._close_frame(ptr); } catch (e) {} }
}

function tick() {
  if (!mod || !inited) return;
  let budget = NAL_BUDGET;
  while (queue.length && budget-- > 0) {
    const item = queue.shift();
    const nal = item.b;
    if (item.fs !== null && item.fs !== curFs) { curFs = item.fs; fsFrames = 0; }
    const nalLen = (nal && nal.length) || 0;
    if (nalLen + 4 > NAL_MAX_BYTES) {
      // NAL más grande que el buffer asignado: H.set lo escribiría fuera de
      // dataIn y corrompería el heap WASM adyacente. Se descarta (anomalía).
      nalsDropped++;
      if (nalsDropped <= 3 || nalsDropped % 100 === 0) {
        console.warn('[h264w] NAL descartado por tamaño:', nalLen, 'bytes');
      }
      continue;
    }
    const H = mod.HEAPU8, p = dataIn;
    H[p] = 0; H[p + 1] = 0; H[p + 2] = 0; H[p + 3] = 1;
    H.set(nal, p + 4);
    mod.HEAP32[yO >> 2] = 0; mod.HEAP32[uO >> 2] = 0; mod.HEAP32[vO >> 2] = 0;
    mod.HEAP32[wO >> 2] = 0; mod.HEAP32[hO >> 2] = 0; mod.HEAP32[sO >> 2] = 0;
    const ptr = mod._decode(ctx, p, nal.length + 4, yO, uO, vO, wO, hO, sO);
    nalsFed++;
    const yPtr = mod.HEAP32[yO >> 2];
    if (yPtr) {
      const w = mod.HEAP32[wO >> 2], h = mod.HEAP32[hO >> 2], stride = mod.HEAP32[sO >> 2];
      try { renderSafe(ptr, yPtr, w, h, stride); }
      catch (e) {
        renderErrs++;
        if (renderErrs <= 3 || renderErrs % 100 === 0) {
          postMessage({ type: 'error', message: 'render: ' + e.message });
        }
      }
      frames++;
      if (curFs !== null) { fsFrames++; lastCt = curFs + fsFrames / FPS; }
      if (firstFrameMs === null && startedAt !== null) firstFrameMs = Math.round(performance.now() - startedAt);
      break; // 1 frame por tick → pacing a tiempo real
    }
  }
}

function postStats() {
  postMessage({
    type: 'stats',
    frames, nalsFed, q: queue.length, firstFrameMs, ct: lastCt,
    w: curW, h: curH, stride: curStride, strideWarn, renderErrs, conv
  });
}

function startTimers() {
  if (!tickTimer) tickTimer = setInterval(tick, TICK);
  //250 ms: el main necesita el reloj de contenido (ct) fresco para alinear el audio.
  if (!statsTimer) statsTimer = setInterval(postStats, 250);
}

function stopTimers() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
}

// Silencia el ruido esperado de FFmpeg con streams rotos (EC trabajando) pero deja el resto
function quietLog(line) {
  if (/no frame!|decode_slice_header error|non-existing PPS|mmco:|SEI type \d+ size \d+ truncated|number of reference frames|error while decoding MB|concealing/i.test(line)) return;
  console.error(line);
}

async function boot() {
  mod = await LibavH264({ print: () => {}, printErr: quietLog });
  ctx = mod._create_codec_context();
  if (!ctx) throw new Error('create_codec_context falló');
  dataIn = mod._malloc(NAL_MAX_BYTES);
  yO = mod._malloc(4); uO = mod._malloc(4); vO = mod._malloc(4);
  wO = mod._malloc(4); hO = mod._malloc(4); sO = mod._malloc(4);
  postMessage({ type: 'ready' });
}

onmessage = (e) => {
  const m = e.data;
  if (!m) return;
  if (m.type === 'init') {
    if (inited) return;
    canvas = m.canvas;
    conv = m.conv === 'js' ? 'js' : 'gl';
    if (conv === 'gl') {
      try { initGL(); }
      catch (err) {
        console.warn('[h264w] WebGL no disponible, usando conversión JS:', err.message);
        if (!gl) { conv = 'js'; c2d = canvas.getContext('2d'); }
        // si gl quedó creado pero el shader falló, el canvas quedó reclamado → error fatal reportado
        else postMessage({ type: 'error', message: 'gl init: ' + err.message });
      }
    } else {
      c2d = canvas.getContext('2d');
    }
    if (conv === 'js' && !c2d) { postMessage({ type: 'error', message: 'sin contexto de render' }); return; }
    inited = true;
    postMessage({ type: 'inited', conv });
  } else if (m.type === 'start') {
    if (startedAt === null) startedAt = performance.now();
    startTimers();
  } else if (m.type === 'stop') {
    stopTimers();
  } else if (m.type === 'reset') {
    stopTimers();
    queue = [];
    if (mod && ctx) { try { mod._destroy_codec_context(ctx); } catch (e) {} }
    if (mod) ctx = mod._create_codec_context();
    frames = 0; nalsFed = 0; firstFrameMs = null; renderErrs = 0; strideWarn = 0;
    curFs = null; fsFrames = 0; lastCt = null;
    startedAt = null;
    postStats();
  } else if (m.type === 'decode-ts') {
    if (!m.buffer) return;
    try {
      const nals = videoPesNals(new Uint8Array(m.buffer));
      const fs = (typeof m.fs === 'number' && isFinite(m.fs)) ? m.fs : null;
      for (let i = 0; i < nals.length; i++) queue.push({ b: nals[i], fs });
      if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
    } catch (err) {
      postMessage({ type: 'error', message: 'decode-ts: ' + err.message });
    }
  }
};

boot().catch(err => {
  console.error('[h264w] boot falló:', err);
  postMessage({ type: 'error', message: 'boot: ' + (err && err.message) });
});
