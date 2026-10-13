// js/h264w-player.js
// H264WasmLivePlayer — reproductor de respaldo (Vía B) para canales H.264 que el
// navegador no puede decodificar por MSE/WebCodecs (p. ej. interlaced PAFF sin IDR).
// API espejo de Mpeg2LivePlayer: start() / stop() / pushChunk(ts) / reset() / destroy().
// El render ocurre dentro del worker sobre un OffscreenCanvas (WebGL YUV→RGB a 29.97 fps).

class H264WasmLivePlayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.worker = null;
    this.offscreen = null;
    this.active = false;
    this.ready = false;
    this.inited = false;
    this.initSent = false;
    this.renderedFrameCount = 0;
    this.stats = {
      frames: 0, nalsFed: 0, q: 0, w: 0, h: 0,
      firstFrameMs: null, renderErrs: 0, strideWarn: 0, conv: '-', ct: null
    };
    this._lastStatsLog = 0;
    this._initWorker();
  }

  _initWorker() {
    if (!this.canvas) return;
    try {
      this.offscreen = this.canvas.transferControlToOffscreen();
    } catch (err) {
      console.warn('[H264Wasm] No se pudo transferir el canvas:', err);
      return;
    }
    try {
      this.worker = new Worker('/js/h264w-worker.js', { type: 'module' });
    } catch (err) {
      console.warn('[H264Wasm] No se pudo crear el worker:', err);
      return;
    }
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === 'ready') {
        this.ready = true;
        this._sendInit();
      } else if (m.type === 'inited') {
        this.inited = true;
        this.stats.conv = m.conv;
        console.log('[H264Wasm] Decoder listo (render: ' + m.conv + ')');
        if (this.active) this.worker.postMessage({ type: 'start' });
      } else if (m.type === 'stats') {
        this.stats.frames = m.frames;
        this.stats.nalsFed = m.nalsFed;
        this.stats.q = m.q;
        this.stats.w = m.w;
        this.stats.h = m.h;
        this.stats.firstFrameMs = m.firstFrameMs;
        this.stats.renderErrs = m.renderErrs;
        this.stats.strideWarn = m.strideWarn;
        this.stats.ct = (typeof m.ct === 'number' && isFinite(m.ct)) ? m.ct : null;
        this.renderedFrameCount = m.frames;
        const now = Date.now();
        if (now - this._lastStatsLog > 15000) {
          this._lastStatsLog = now;
          console.log('[H264Wasm] ' + m.frames + ' frames | ' + m.w + 'x' + m.h +
            ' | cola=' + m.q + ' | errores render=' + m.renderErrs);
        }
      } else if (m.type === 'error') {
        console.warn('[H264Wasm]', m.message);
      }
    };
    this.worker.onerror = (err) => {
      console.warn('[H264Wasm] Worker error:', err && err.message);
    };
  }

  _sendInit() {
    if (this.initSent || !this.worker || !this.offscreen) return;
    this.initSent = true;
    let probeGl = false;
    try { probeGl = !!document.createElement('canvas').getContext('webgl'); } catch (e) {}
    this.worker.postMessage({ type: 'init', canvas: this.offscreen, conv: probeGl ? 'gl' : 'js' }, [this.offscreen]);
  }

  start() {
    this.active = true;
    if (this.canvas) this.canvas.style.display = 'block';
    if (this.ready) {
      this._sendInit();
      if (this.inited) this.worker.postMessage({ type: 'start' });
    }
  }

  stop() {
    this.active = false;
    if (this.worker) {
      try { this.worker.postMessage({ type: 'stop' }); } catch (e) {}
    }
    if (this.canvas) this.canvas.style.display = 'none';
    this.reset();
  }

  pushChunk(chunkBuffer, fragStart) {
    if (!this.worker || !chunkBuffer || !this.active) return;
    try {
      const copyBuffer = chunkBuffer instanceof ArrayBuffer
        ? chunkBuffer.slice(0)
        : (chunkBuffer.buffer ? chunkBuffer.buffer.slice(chunkBuffer.byteOffset, chunkBuffer.byteOffset + chunkBuffer.byteLength) : null);
      if (!copyBuffer) return;
      this.worker.postMessage(
        { type: 'decode-ts', buffer: copyBuffer,
          fs: (typeof fragStart === 'number' && isFinite(fragStart)) ? fragStart : null },
        [copyBuffer]
      );
    } catch (e) {
      console.warn('[H264Wasm] Push chunk error:', e);
    }
  }

  reset() {
    if (this.worker) {
      try { this.worker.postMessage({ type: 'reset' }); } catch (e) {}
    }
    this.renderedFrameCount = 0;
    this.stats = {
      frames: 0, nalsFed: 0, q: 0, w: 0, h: 0,
      firstFrameMs: null, renderErrs: 0, strideWarn: 0, conv: this.stats.conv, ct: null
    };
  }

  destroy() {
    this.active = false;
    if (this.worker) {
      try { this.worker.terminate(); } catch (e) {}
      this.worker = null;
    }
  }
}

window.H264WasmLivePlayer = H264WasmLivePlayer;
