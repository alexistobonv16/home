/* =============================================================
   GolStream / Alexis TV · player.js
   Reproductor híbrido con soporte para:
   - HLS estándar (.m3u8) acelerado por hardware (MSE).
   - Vía B: Decodificador WebAssembly H.264 (FFmpeg WASM)
     a Canvas para señales entrelazadas PAFF sin cuadros IDR (Win+, etc.)
   - Decodificador WebAssembly MPEG-2 para señales SD.
   - Decodificador WebAudio MP2 (mpg123) y Dolby AC-3 / E-AC-3.
   ============================================================= */
(function (global) {
  'use strict';

  const CFG = {
    timeoutArranqueMs: 14_000,
    timeoutCongeladoMs: 14_000,
    maxReintentosRed: 3,
  };

  /* hls.js: se carga local o desde CDN con fallback */
  let promesaMotor = null;
  function cargarMotorHls() {
    if (global.Hls) return Promise.resolve(global.Hls);
    if (promesaMotor) return promesaMotor;
    promesaMotor = new Promise((resolver, rechazar) => {
      const sLocal = document.createElement('script');
      sLocal.src = './js/hls.min.js';
      sLocal.onload = () => (global.Hls ? resolver(global.Hls) : rechazar(new Error('hls.js no disponible')));
      sLocal.onerror = () => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
        s.async = true;
        s.onload = () => (global.Hls ? resolver(global.Hls) : rechazar(new Error('hls.js no disponible')));
        s.onerror = () => {
          const s2 = document.createElement('script');
          s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js';
          s2.onload = () => (global.Hls ? resolver(global.Hls) : rechazar(new Error('hls.js no disponible')));
          s2.onerror = () => { promesaMotor = null; rechazar(new Error('hls.js no cargó')); };
          document.head.appendChild(s2);
        };
        document.head.appendChild(s);
      };
      document.head.appendChild(sLocal);
    });
    return promesaMotor;
  }

  const esSafariOiOS = () => {
    const nav = global.navigator;
    if (!nav) return true;
    const ua = nav.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    return ios || (/Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua));
  };

  const BW_CLAVE = 'golstream.bw';
  let anchoBanda = 0;
  try { anchoBanda = Number(global.localStorage?.getItem(BW_CLAVE)) || 0; } catch { /* sin memoria */ }

  const NOMBRE_FORMATO = { dash: 'DASH (.mpd)', ts: 'MPEG-TS (.ts)', flv: 'Flash Video (.flv)' };

  function motivoHttp(codigo) {
    if (!codigo) return 'no se pudo acceder a la señal; puede ser red, TLS o CORS';
    if (codigo === 401 || codigo === 403) return `acceso denegado (${codigo}): puede estar geobloqueado o protegido`;
    if (codigo === 404 || codigo === 410) return `el recurso no está disponible (${codigo})`;
    if (codigo >= 500) return `el servidor del canal tiene problemas (${codigo})`;
    return `respuesta inesperada del servidor (${codigo})`;
  }

  // Carga perezosa del decodificador Dolby AC-3 / E-AC-3
  let dolbyDecoderPromise = null;
  function getDolbyDecoder() {
    if (global.__dolbyDecoder) return Promise.resolve(global.__dolbyDecoder);
    if (!dolbyDecoderPromise) {
      dolbyDecoderPromise = import('/js/decode-eac3.js')
        .then(mod => mod.decoder())
        .then(dec => {
          global.__dolbyDecoder = dec;
          console.log('[Alexis TV] decoder Dolby AC-3/E-AC-3 (ffmpeg wasm) listo');
          return dec;
        })
        .catch(err => {
          dolbyDecoderPromise = null;
          console.warn('[Alexis TV] no se pudo cargar el decoder Dolby:', err);
          return null;
        });
    }
    return dolbyDecoderPromise;
  }

  class ReproductorIPTV {
    constructor(video, ev = {}, configHls = {}) {
      this.video = video;
      this.ev = ev;
      this.configHls = configHls;
      this.hls = null;
      this.canal = null;
      this.sesion = 0;
      this.modo = null; // 'hls' | 'nativo' | 'wasm' | 'mpeg2'
      this.reintentosRed = 0;
      this.recuperacionesMedia = 0;
      this.probadoNativo = false;
      this.ultimaRecuperacion = null;
      this.tArranque = null;
      this.tCongelado = null;
      this.tReintento = null;
      this.tProgreso = null;
      this.terminal = true;
      this.diagnostico = null;

      // Elementos canvas para decodificación software (Vía B / MPEG-2)
      this.canvasH264w = document.getElementById('h264w-canvas');
      this.canvasMpeg2 = document.getElementById('mpeg2-canvas');
      this.h264wPlayer = null;
      this.mpeg2Player = null;
      this.h264wActive = false;
      this.isMpeg2Decoding = false;
      this.hasH264Video = false;
      this.isActualMpeg2Stream = false;
      this.selectedMp2Pid = null;
      this.audioCodec = null;
      this.useWebAudio = false;
      this.audioCtx = null;
      this.audioGain = null;
      this.audioDecoder = null;
      this.activeAudioSources = [];
      this.pendingAudioQueue = [];
      this.vbPending = [];
      this.vbPendingTimer = null;
      this.nextAudioTime = 0;
      this.processedAudioFrags = new Set();
      this.rawTsRing = new Map();

      this._initDecodificadores();
      this._escucharVideo();
    }

    _initDecodificadores() {
      if (global.H264WasmLivePlayer && this.canvasH264w && !this.h264wPlayer) {
        try {
          this.h264wPlayer = new global.H264WasmLivePlayer(this.canvasH264w);
          global.__h264w = this.h264wPlayer;
        } catch (e) {
          console.warn('[Reproductor] No se pudo inicializar H264WasmLivePlayer:', e);
        }
      }
      if (global.Mpeg2LivePlayer && this.canvasMpeg2 && !this.mpeg2Player) {
        try {
          this.mpeg2Player = new global.Mpeg2LivePlayer(this.canvasMpeg2);
        } catch (e) {
          console.warn('[Reproductor] No se pudo inicializar Mpeg2LivePlayer:', e);
        }
      }
    }

    async _initWebAudio() {
      if (this.audioCtx && this.audioCtx.state === 'running') return;
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
        this.audioGain = this.audioCtx.createGain();
        this.audioGain.connect(this.audioCtx.destination);
      }
      if (this.audioCtx.state === 'suspended') {
        try { await this.audioCtx.resume(); } catch (e) {}
      }
      if (!this.audioDecoder && global['mpg123-decoder'] && global['mpg123-decoder'].MPEGDecoder) {
        try {
          this.audioDecoder = new global['mpg123-decoder'].MPEGDecoder();
          await this.audioDecoder.ready;
        } catch (e) {
          console.warn('[Reproductor] Error iniciando mpg123-decoder:', e);
        }
      }
    }

    _stopWebAudio() {
      if (this.activeAudioSources) {
        for (const s of this.activeAudioSources) {
          try { s.stop(); s.disconnect(); } catch (e) {}
        }
        this.activeAudioSources = [];
      }
      this.pendingAudioQueue = [];
      this.vbPending = [];
      this.nextAudioTime = 0;
    }

    get soportaHls() {
      if (global.Hls) return global.Hls.isSupported();
      const MS = global.ManagedMediaSource || global.MediaSource;
      return !!MS?.isTypeSupported?.('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
    }

    cargar(canal) {
      this._limpiar();
      this.intentoCarga = (this.intentoCarga || 0) + 1;
      this.canal = canal;
      this.terminal = false;
      this.inicio = performance.now();
      this.ultimoTiempo = this.video.currentTime;
      this.ultimoAvance = this.inicio;
      this.ultimosCuadros = 0;
      this.cuadrosReportados = false;
      this.videoConfirmado = false;
      this.progresoConfirmacionMs = 0;
      this.diagnostico = { pais: canal.pais || '', fuente: canal.fuente || 'lista', inicioVideoMs: null,
        congelamientos: 0, bufferingMs: 0, reconexiones: 0, errores: [], resultado: 'cargando' };
      this.probadoNativo = false;
      const { url, formato } = canal;

      if (!canal.compatible && formato !== 'ts') {
        return this._caido(`formato ${NOMBRE_FORMATO[formato] || formato} no compatible con navegadores (sí con VLC)`, 'formato');
      }

      // Iniciar WebAudio durante el gesto del usuario para evitar bloqueos por políticas de autoplay
      this._initWebAudio().catch(() => {});

      let streamUrl = url ? url.trim() : '';
      if (streamUrl.startsWith('http://') || location.protocol === 'https:') {
        streamUrl = `/api/tv/proxy?url=${encodeURIComponent(streamUrl)}`;
      }

      this._emit('cargando');
      this._vigilarArranque();
      this.tProgreso = setInterval(() => this._medirProgreso(), 500);

      if (formato === 'archivo' || formato === 'audio') {
        this._cargarNativo(streamUrl);
      } else if (this._usarHlsNativo()) {
        this._cargarNativo(streamUrl);
      } else if (this.soportaHls) {
        this._cargarHls(streamUrl);
      } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
        this._cargarNativo(streamUrl);
      } else {
        this._caido('este navegador no puede reproducir HLS', 'navegador');
      }
    }

    _usarHlsNativo() {
      const nativo = this.video.canPlayType('application/vnd.apple.mpegurl');
      if (!nativo) return false;
      return esSafariOiOS() || !this.soportaHls;
    }

    reintentar() {
      if (this.canal) this.cargar(this.canal);
    }

    setCalidad(nivel) {
      if (this.hls) this.hls.currentLevel = Number(nivel);
    }

    get hayVideo() {
      if (this.h264wActive) return true;
      return !!this.canal && this.video.readyState > 0;
    }

    alternarPausa() {
      if (this.h264wActive && this.h264wPlayer) {
        if (this.h264wPlayer.active) {
          this.h264wPlayer.stop();
          this.video.pause();
          return false;
        } else {
          this.h264wPlayer.start();
          this.video.play().catch(() => {});
          if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
          return true;
        }
      }
      const v = this.video;
      if (!this.hayVideo) return null;
      if (!v.paused) {
        v.pause();
        return false;
      }
      const directo = this.hls?.liveSyncPosition;
      if (directo && v.currentTime < directo - 30) v.currentTime = directo;
      this._reproducir();
      return true;
    }

    alternarSilencio() {
      this.video.muted = !this.video.muted;
      if (this.useWebAudio && this.audioGain) {
        this.audioGain.gain.value = this.video.muted ? 0 : 1;
      }
      return this.video.muted;
    }

    get enPantallaCompleta() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    async alternarPantallaCompleta(contenedor) {
      try {
        if (this.enPantallaCompleta) {
          await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen());
        } else if (contenedor.requestFullscreen) {
          await contenedor.requestFullscreen({ navigationUI: 'hide' });
        } else if (contenedor.webkitRequestFullscreen) {
          contenedor.webkitRequestFullscreen();
        } else if (this.video.webkitEnterFullscreen) {
          this.video.webkitEnterFullscreen();
        }
      } catch (err) {
        console.warn('[IPTV] Pantalla completa no disponible:', err);
      }
    }

    get soportaPiP() {
      return (!!document.pictureInPictureEnabled && !this.video.disablePictureInPicture)
        || typeof this.video.webkitSetPresentationMode === 'function';
    }

    get enPiP() {
      return document.pictureInPictureElement === this.video || this.video.webkitPresentationMode === 'picture-in-picture';
    }

    async alternarPiP() {
      const v = this.video;
      if (this.enPiP) {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else v.webkitSetPresentationMode('inline');
        return;
      }
      if (!this.hayVideo) throw Object.assign(new Error('Aún no hay video'), { codigo: 'sin-video' });
      if (v.requestPictureInPicture) await v.requestPictureInPicture();
      else v.webkitSetPresentationMode('picture-in-picture');
    }

    detener() {
      this._limpiar();
      this.canal = null;
      this._emit('detenido');
    }

    /* ---------------- Vía B & WebAudio Helpers ---------------- */

    _firstPesPts(buf, pid) {
      if (pid === null || pid === undefined) return null;
      for (let i = 0; i + 188 <= buf.length; i += 188) {
        if (buf[i] !== 0x47) continue;
        if ((((buf[i + 1] & 0x1f) << 8) | buf[i + 2]) !== pid) continue;
        if ((buf[i + 1] & 0x40) === 0) continue;
        const afc = (buf[i + 3] >> 4) & 3;
        let off = i + 4;
        if (afc === 2 || afc === 3) off += 1 + buf[off];
        if (off + 14 >= i + 188) continue;
        if (buf[off] === 0 && buf[off + 1] === 0 && buf[off + 2] === 1) {
          if ((buf[off + 7] & 0x80) !== 0) {
            return (((buf[off + 9] >> 1) & 0x07) * 536870912) +
                   (buf[off + 10] * 4194304) +
                   (((buf[off + 11] >> 1) & 0x7f) * 32768) +
                   (buf[off + 12] * 128) +
                   ((buf[off + 13] >> 1) & 0x7f);
          }
        }
      }
      return null;
    }

    _extractMp2FromTs(arrayBuffer, targetPid) {
      const buf = new Uint8Array(arrayBuffer);
      let pmtPid = null;
      let chosenPid = targetPid || this.selectedMp2Pid || null;
      let videoPid = null;

      for (let i = 0; i < buf.length - 188; i += 188) {
        if (buf[i] !== 0x47) continue;
        const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
        const payloadStart = (buf[i + 1] & 0x40) !== 0;
        if (!payloadStart) continue;

        const adapt = (buf[i + 3] >> 4) & 3;
        let off = i + 4;
        if (adapt === 2 || adapt === 3) off += 1 + buf[off];
        if (off >= i + 188) continue;
        off += 1 + buf[off];
        if (off >= i + 188) continue;

        if (pid === 0 && pmtPid === null) {
          const sectionLen = ((buf[off + 1] & 0x0f) << 8) | buf[off + 2];
          for (let p = off + 8; p < off + 3 + sectionLen - 4; p += 4) {
            const progNum = (buf[p] << 8) | buf[p + 1];
            const progPid = ((buf[p + 2] & 0x1f) << 8) | buf[p + 3];
            if (progNum !== 0) { pmtPid = progPid; break; }
          }
          continue;
        }

        if (pmtPid !== null && pid === pmtPid) {
          const sectionLen = ((buf[off + 1] & 0x0f) << 8) | buf[off + 2];
          const progInfoLen = ((buf[off + 10] & 0x0f) << 8) | buf[off + 11];
          let p = off + 12 + progInfoLen;
          const end = off + 3 + sectionLen - 4;
          while (p < end) {
            const streamType = buf[p];
            const elemPid = ((buf[p + 1] & 0x1f) << 8) | buf[p + 2];
            const esInfoLen = ((buf[p + 3] & 0x0f) << 8) | buf[p + 4];
            if (videoPid === null && (streamType === 0x1B || streamType === 0x24 || streamType === 0x02)) {
              videoPid = elemPid;
            }
            if (!chosenPid && (streamType === 0x03 || streamType === 0x04 || streamType === 0x81 || streamType === 0x87)) {
              chosenPid = elemPid;
            }
            p += 5 + esInfoLen;
          }
          break;
        }
      }

      if (chosenPid === null) return { data: null, ptsShift: 0 };

      const chunks = [];
      for (let i = 0; i < buf.length - 188; i += 188) {
        if (buf[i] !== 0x47) continue;
        const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
        if (pid !== chosenPid) continue;

        const adapt = (buf[i + 3] >> 4) & 3;
        let off = i + 4;
        if (adapt === 2) continue;
        if (adapt === 3) off += 1 + buf[off];
        if (off >= i + 188) continue;

        const payload = buf.subarray(off, i + 188);
        const payloadStart = (buf[i + 1] & 0x40) !== 0;

        if (payloadStart && payload.length >= 9 && payload[0] === 0 && payload[1] === 0 && payload[2] === 1) {
          const pesHeaderDataLen = payload[8] || 0;
          const dataOffset = 9 + pesHeaderDataLen;
          if (dataOffset < payload.length) {
            chunks.push(payload.subarray(dataOffset));
          }
        } else {
          chunks.push(payload);
        }
      }

      if (!chunks.length) return { data: null, ptsShift: 0 };
      let totalLen = 0;
      for (const c of chunks) totalLen += c.length;
      const merged = new Uint8Array(totalLen);
      let pos = 0;
      for (const c of chunks) {
        merged.set(c, pos);
        pos += c.length;
      }

      const vPts = this._firstPesPts(buf, videoPid);
      const aPts = this._firstPesPts(buf, chosenPid);
      let ptsShift = 0;
      if (vPts !== null && aPts !== null) {
        let d = aPts - vPts;
        if (d > 4294967296) d -= 8589934592;
        else if (d < -4294967296) d += 8589934592;
        const sec = d / 90000;
        if (isFinite(sec) && Math.abs(sec) <= 3) ptsShift = sec;
      }
      return { data: merged, ptsShift };
    }

    _preprocessTsChunk(buffer) {
      if (!buffer || buffer.byteLength < 188) return { data: buffer, isMp2: false, isDolby: false };
      const u8 = new Uint8Array(buffer);
      let pmtPid = null;
      let audioPids = new Set();
      let isMp2 = false;
      let isDolby = false;

      for (let i = 0; i + 188 <= u8.length; i += 188) {
        if (u8[i] !== 0x47) continue;
        const pid = ((u8[i + 1] & 0x1f) << 8) | u8[i + 2];
        const payloadStart = (u8[i + 1] & 0x40) !== 0;
        const afc = (u8[i + 3] >> 4) & 3;
        let offset = i + 4;
        if (afc === 2 || afc === 3) offset += 1 + u8[i + 4];
        if (offset >= i + 188) continue;
        if (payloadStart) offset += 1 + u8[offset];
        if (offset >= i + 188) continue;

        if (pid === 0 && pmtPid === null) {
          const sectionLen = ((u8[offset + 1] & 0x0f) << 8) | u8[offset + 2];
          for (let p = offset + 8; p < offset + 3 + sectionLen - 4; p += 4) {
            const progNum = (u8[p] << 8) | u8[p + 1];
            if (progNum !== 0) {
              pmtPid = ((u8[p + 2] & 0x1f) << 8) | u8[p + 3];
              break;
            }
          }
        } else if (pmtPid !== null && pid === pmtPid) {
          const sectionLen = ((u8[offset + 1] & 0x0f) << 8) | u8[offset + 2];
          const progInfoLen = ((u8[offset + 10] & 0x0f) << 8) | u8[offset + 11];
          let p = offset + 12 + progInfoLen;
          const end = offset + 3 + sectionLen - 4;
          while (p < end) {
            const streamType = u8[p];
            const elemPid = ((u8[p + 1] & 0x1f) << 8) | u8[p + 2];
            const esInfoLen = ((u8[p + 3] & 0x0f) << 8) | u8[p + 4];

            if (streamType === 0x1B || streamType === 0x24) {
              this.hasH264Video = true;
              this.isActualMpeg2Stream = false;
            } else if (streamType === 0x02) {
              if (!this.hasH264Video) this.isActualMpeg2Stream = true;
            } else if (streamType === 0x03 || streamType === 0x04) {
              audioPids.add(elemPid);
              isMp2 = true;
            } else if (streamType === 0x81 || streamType === 0x87 || streamType === 0x06) {
              audioPids.add(elemPid);
              isDolby = true;
            }
            p += 5 + esInfoLen;
          }
          break;
        }
      }

      if ((!isMp2 && !isDolby) || audioPids.size === 0) {
        return { data: buffer, isMp2: false, isDolby: false };
      }

      // Enmascarar paquetes de audio en el buffer enviado a Hls.js MSE para que el navegador no falle
      const copy = new Uint8Array(u8.length);
      copy.set(u8);
      for (let i = 0; i + 188 <= copy.length; i += 188) {
        if (copy[i] !== 0x47) continue;
        const pid = ((copy[i + 1] & 0x1f) << 8) | copy[i + 2];
        if (audioPids.has(pid)) {
          copy[i + 1] = 0x1f;
          copy[i + 2] = 0xff;
          copy[i + 3] = 0x10;
          copy.fill(0xff, i + 4, i + 188);
        }
      }
      this.useWebAudio = true;
      return { data: copy.buffer, isMp2, isDolby };
    }

    _getVbPicPos() {
      const p = global.__h264w || this.h264wPlayer;
      const ct = p && p.stats ? p.stats.ct : null;
      return (typeof ct === 'number' && isFinite(ct)) ? ct : null;
    }

    _scheduleVbAudioBlock(fragStart, duration, buffer) {
      if (!this.audioCtx || !this.audioGain || !buffer) return;
      const aNow = this.audioCtx.currentTime;
      const picPos = this._getVbPicPos();
      let timeDelta = null;
      if (fragStart !== null && !isNaN(fragStart) && picPos !== null) {
        timeDelta = fragStart - picPos;
      }
      if (timeDelta !== null && timeDelta + duration <= 0.05) return;

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioGain);
      this.activeAudioSources.push(source);
      source.onended = () => {
        try { source.disconnect(); } catch (e) {}
        const idx = this.activeAudioSources.indexOf(source);
        if (idx !== -1) this.activeAudioSources.splice(idx, 1);
      };

      let desired, playDur = duration, offset = 0;
      if (timeDelta === null || isNaN(timeDelta)) {
        desired = this.nextAudioTime > aNow ? this.nextAudioTime : aNow + 0.03;
      } else if (timeDelta < 0) {
        offset = Math.min(-timeDelta, duration - 0.05);
        playDur = duration - offset;
        desired = aNow + 0.02;
      } else {
        desired = aNow + timeDelta;
      }
      let startTime = Math.max(aNow + 0.02, desired);
      if (this.nextAudioTime > aNow + 0.12 && desired < this.nextAudioTime - 0.12) {
        startTime = this.nextAudioTime;
      }
      source.start(startTime, offset);
      this.nextAudioTime = startTime + playDur;
    }

    _scheduleAudioBuffer(buffer, fragStart) {
      if (!this.audioCtx || !this.audioGain || !buffer) return;
      const aNow = this.audioCtx.currentTime;
      const duration = buffer.duration;
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioGain);
      this.activeAudioSources.push(source);
      source.onended = () => {
        try { source.disconnect(); } catch (e) {}
        const idx = this.activeAudioSources.indexOf(source);
        if (idx !== -1) this.activeAudioSources.splice(idx, 1);
      };

      let startTime = this.nextAudioTime > aNow ? this.nextAudioTime : aNow + 0.03;
      source.start(startTime, 0);
      this.nextAudioTime = startTime + duration;
    }

    _vbPendingTick() {
      const q = this.vbPending;
      if (!this.h264wActive || !this.audioCtx || !q || !q.length) return;
      while (q.length) {
        const head = q[0];
        if (head.fragStart === null || isNaN(head.fragStart)) {
          q.shift();
          this._scheduleVbAudioBlock(null, head.duration, head.buffer);
          continue;
        }
        const picPos = this._getVbPicPos();
        if (picPos === null) {
          if (this.nextAudioTime > this.audioCtx.currentTime) return;
          q.shift();
          this._scheduleVbAudioBlock(head.fragStart, head.duration, head.buffer);
          continue;
        }
        if (head.fragStart <= picPos || head.fragStart - picPos <= 0.2) {
          q.shift();
          this._scheduleVbAudioBlock(head.fragStart, head.duration, head.buffer);
          continue;
        }
        break;
      }
    }

    _ensureVbPendingTimer() {
      if (this.vbPendingTimer) return;
      this.vbPendingTimer = setInterval(() => {
        if (!this.h264wActive) {
          clearInterval(this.vbPendingTimer);
          this.vbPendingTimer = null;
          return;
        }
        this._vbPendingTick();
      }, 150);
    }

    _activarH264Wasm() {
      if (this.h264wActive) return;
      this._initDecodificadores();
      if (!this.h264wPlayer) {
        console.warn('[Alexis TV] H264WasmLivePlayer no disponible para Vía B');
        return;
      }
      this.h264wActive = true;
      this.useWebAudio = true;
      this.video.muted = true;
      if (this.canvasH264w) this.canvasH264w.style.display = 'block';
      if (this.canvasMpeg2) this.canvasMpeg2.style.display = 'none';
      this.h264wPlayer.start();
      this.vbPending = [];
      this._ensureVbPendingTimer();
      this._initWebAudio().catch(() => {});
      clearTimeout(this.tArranque);
      this.tArranque = null;
      console.log('[Alexis TV] Vía B activado: decodificador WASM H.264 activo para streams entrelazados/PAFF');
      this._emit('reproduciendo', { viaB: true });
      if (this.hls) {
        try { this.hls.startLoad(); } catch (e) {}
      }

      if (this.h264wWatchdog) clearInterval(this.h264wWatchdog);
      let lastFrames = this.h264wPlayer?.renderedFrameCount || 0;
      let stall = 0;
      this.h264wWatchdog = setInterval(() => {
        if (!this.h264wActive || this.terminal) {
          clearInterval(this.h264wWatchdog);
          this.h264wWatchdog = null;
          return;
        }
        const curFrames = this.h264wPlayer?.renderedFrameCount || 0;
        if (curFrames === lastFrames) {
          stall++;
        } else {
          stall = 0;
          lastFrames = curFrames;
        }
        if (stall >= 2 && this.hls) {
          console.warn('[Alexis TV] h264w-watchdog: reanimando hls.startLoad...');
          try { this.hls.startLoad(); } catch (e) {}
          if (stall >= 4) {
            try { this.hls.recoverMediaError(); this.hls.startLoad(); } catch (e) {}
            stall = 1;
          }
        }
      }, 3000);
    }

    _activarMpeg2() {
      if (this.isMpeg2Decoding) return;
      this._initDecodificadores();
      if (!this.mpeg2Player) return;
      this.isMpeg2Decoding = true;
      this.useWebAudio = true;
      this.video.muted = true;
      if (this.canvasMpeg2) this.canvasMpeg2.style.display = 'block';
      if (this.canvasH264w) this.canvasH264w.style.display = 'none';
      this.mpeg2Player.start();
      this._initWebAudio().catch(() => {});
      clearTimeout(this.tArranque);
      this.tArranque = null;
      console.log('[Alexis TV] Decodificador software MPEG-2 activo');
      this._emit('reproduciendo', { mpeg2: true });
    }

    /* ---------------- Internos de Reproducción ---------------- */

    _vigilarArranque() {
      const sesion = this.sesion;
      clearTimeout(this.tArranque);
      this.tArranque = setTimeout(() => {
        if (sesion === this.sesion) {
          if (this.h264wActive && this.h264wPlayer && this.h264wPlayer.renderedFrameCount > 0) return;
          this._caido('el canal no envió video a tiempo (puede estar fuera del aire)', 'timeout');
        }
      }, CFG.timeoutArranqueMs);
    }

    _cargarHls(url) {
      const sesion = this.sesion;
      if (!global.Hls) {
        cargarMotorHls().then(() => { if (sesion === this.sesion && !this.terminal) this._cargarHls(url); })
          .catch(() => {
            if (sesion !== this.sesion || this.terminal) return;
            if (this.video.canPlayType('application/vnd.apple.mpegurl')) this._cargarNativo(url);
            else this._caido('no se pudo cargar el motor de video; revisa tu conexión', 'navegador');
          });
        return;
      }
      const Hls = global.Hls;
      const self = this;

      class TolerantMediaErrorController extends Hls.DefaultConfig.errorController {
        onErrorOut(event, data) {
          if (self.h264wActive && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            data.fatal = false;
            return;
          }
          super.onErrorOut(event, data);
        }
      }

      class CustomFragLoader extends Hls.DefaultConfig.loader {
        constructor(config) {
          super(config);
          const load = this.load.bind(this);
          this.load = (context, config, callbacks) => {
            const origSuccess = callbacks.onSuccess;
            callbacks.onSuccess = (response, stats, context, networkDetails) => {
              if (sesion !== self.sesion) return;
              if (context.frag && response.data) {
                const processed = self._preprocessTsChunk(response.data);
                context.frag._rawChunkBuffer = response.data;
                const ringKey = (context.frag.sn !== undefined && context.frag.sn !== null)
                  ? context.frag.sn
                  : (context.frag.start !== undefined ? 's' + context.frag.start : null);
                if (ringKey !== null) self.rawTsRing.set(ringKey, response.data);
                if (self.rawTsRing.size > 20) {
                  const firstKey = self.rawTsRing.keys().next().value;
                  self.rawTsRing.delete(firstKey);
                }

                // Alimentar directamente el decoder WASM en cuanto llega el fragmento
                if (self.h264wActive && self.h264wPlayer) {
                  const fragStartFeed = (context.frag && typeof context.frag.start === 'number') ? context.frag.start : null;
                  self.h264wPlayer.pushChunk(response.data, fragStartFeed);
                }

                const modifiedResponse = Object.assign({}, response, { data: processed.data });
                return origSuccess(modifiedResponse, stats, context, networkDetails);
              }
              origSuccess(response, stats, context, networkDetails);
            };
            load(context, config, callbacks);
          };
        }
      }

      const movil = !!global.matchMedia?.('(max-width: 1023px)').matches;
      const hls = new Hls({
        enableWorker: true,
        fLoader: CustomFragLoader,
        errorController: TolerantMediaErrorController,
        lowLatencyMode: false,
        forceKeyFrameOnDiscontinuity: false,
        stretchShortVideoTrack: false,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 1.8,
        backBufferLength: movil ? 10 : 20,
        liveDurationInfinity: true,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 6,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 500,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 500,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        startLevel: -1,
        capLevelToPlayerSize: true,
        startFragPrefetch: true,
        progressive: false,
        ...(anchoBanda > 0 ? { abrEwmaDefaultEstimate: anchoBanda } : {}),
        ...this.configHls,
      });
      this.hls = hls;
      this.modo = 'hls';

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        if (sesion !== this.sesion) return;
        this.ev.onCalidades?.(data.levels.map((n, i) => ({ indice: i, alto: n.height, bitrate: n.bitrate })));
        this._reproducir();
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        if (sesion === this.sesion) this.ev.onNivel?.(data.level, hls.autoLevelEnabled);
      });

      hls.on(Hls.Events.FRAG_PARSED, async (_e, data) => {
        if (sesion !== this.sesion) return;
        const fragObj = (data && data.frag) ? data.frag : null;
        const ringKey = fragObj
          ? ((fragObj.sn !== undefined && fragObj.sn !== null) ? fragObj.sn
            : (fragObj.start !== undefined ? 's' + fragObj.start : null))
          : null;
        const ringBuf = (ringKey !== null && this.rawTsRing) ? this.rawTsRing.get(ringKey) : null;
        const rawTsBuffer = (fragObj && fragObj._rawChunkBuffer) ? fragObj._rawChunkBuffer
          : (ringBuf || ((data && data.payload && data.payload.buffer) ? data.payload.buffer : null));

        if (this.isActualMpeg2Stream && !this.hasH264Video && this.mpeg2Player) {
          if (!this.isMpeg2Decoding) this._activarMpeg2();
          if (rawTsBuffer) this.mpeg2Player.pushChunk(rawTsBuffer);
        }

        if (this.h264wActive && this.h264wPlayer) {
          if (rawTsBuffer) {
            const fragStartFeed = (fragObj && typeof fragObj.start === 'number') ? fragObj.start : null;
            this.h264wPlayer.pushChunk(rawTsBuffer, fragStartFeed);
          }
        }

        if (this.useWebAudio && rawTsBuffer) {
          if (this.h264wActive && this.h264wPlayer && !this.h264wPlayer.active) return;
          const fragId = (data && data.frag) ? (data.frag.sn !== undefined ? data.frag.sn : (data.frag.start !== undefined ? data.frag.start : null)) : null;
          if (fragId !== null && this.processedAudioFrags.has(fragId)) return;
          if (fragId !== null) this.processedAudioFrags.add(fragId);

          try {
            const audioExtract = this._extractMp2FromTs(rawTsBuffer, this.selectedMp2Pid);
            const rawAudio = audioExtract ? audioExtract.data : null;
            if (rawAudio && rawAudio.length) {
              await this._initWebAudio();
              const mainDecoder = (this.audioCodec === 'dolby')
                ? await getDolbyDecoder()
                : this.audioDecoder;
              if (sesion !== this.sesion) return;
              if (this.audioCtx && mainDecoder) {
                const decoded = mainDecoder.decode(rawAudio);
                if (decoded && decoded.channelData && decoded.channelData.length > 0) {
                  const numChannels = decoded.channelData.length;
                  const length = decoded.channelData[0].length;
                  if (length > 0) {
                    const sampleRate = decoded.sampleRate || 48000;
                    const audioBuffer = this.audioCtx.createBuffer(numChannels, length, sampleRate);
                    for (let ch = 0; ch < numChannels; ch++) {
                      audioBuffer.copyToChannel(decoded.channelData[ch], ch);
                    }
                    const fragStart = (data && data.frag && typeof data.frag.start === 'number') ? data.frag.start : null;
                    const ptsShift = (audioExtract && isFinite(audioExtract.ptsShift)) ? audioExtract.ptsShift : 0;
                    const audioStart = (fragStart === null || isNaN(fragStart)) ? fragStart : (fragStart + ptsShift);

                    if (this.h264wActive) {
                      if (audioStart === null || isNaN(audioStart)) {
                        this._scheduleVbAudioBlock(null, audioBuffer.duration, audioBuffer);
                      } else {
                        if (!this.vbPending) this.vbPending = [];
                        if (this.vbPending.length < 12) {
                          this.vbPending.push({ fragStart: audioStart, duration: audioBuffer.duration, buffer: audioBuffer });
                          this._ensureVbPendingTimer();
                        } else {
                          this._scheduleVbAudioBlock(audioStart, audioBuffer.duration, audioBuffer);
                        }
                      }
                    } else {
                      this._scheduleAudioBuffer(audioBuffer, audioStart);
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[Reproductor WebAudio] Error procesando audio:', e);
          }
        }
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (sesion === this.sesion) this._errorHls(data, url);
      });

      hls.attachMedia(this.video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (sesion === this.sesion) hls.loadSource(url);
      });
    }

    _errorHls(data, url) {
      if (this.terminal) return;
      const status = data.response?.code || data.networkDetails?.status || 0;
      this.diagnostico?.errores.push({ tipo: data.type, detalle: data.details, http: status, fatal: !!data.fatal });
      if (this.diagnostico?.errores.length > 20) this.diagnostico.errores.shift();
      if (data.type === global.Hls.ErrorTypes.NETWORK_ERROR) {
        this.falloRedPendiente = true;
        this._emit('fallo-red');
      }
      const ahora = performance.now();
      if (!data.fatal) {
        if (this.hls && (this.ultimaRecuperacion == null || ahora - this.ultimaRecuperacion >= 1000)) {
          if (data.type === global.Hls.ErrorTypes.NETWORK_ERROR && this.reintentosRed < CFG.maxReintentosRed) {
            this.ultimaRecuperacion = ahora;
            this.reintentosRed++;
            this.hls.startLoad();
          } else if (data.type === global.Hls.ErrorTypes.MEDIA_ERROR && this.recuperacionesMedia < 2) {
            this.ultimaRecuperacion = ahora;
            this.recuperacionesMedia++;
            this.hls.recoverMediaError();
          }
        }
        return;
      }
      const fallar = (motivo, codigo) => {
        const sesion = this.sesion;
        this._emit('fallo-fatal', { motivo, codigo });
        if (this.sesion === sesion && !this.terminal) this._caido(motivo, codigo);
      };
      const { ErrorTypes, ErrorDetails } = global.Hls;
      const codigo = status;

      if (data.type === ErrorTypes.NETWORK_ERROR) {
        if ([401, 403, 404, 410].includes(codigo)) return fallar(motivoHttp(codigo), `http-${codigo}`);
        if (!url.includes('/api/tv/proxy') && (data.details === ErrorDetails.MANIFEST_LOAD_ERROR || data.details === ErrorDetails.MANIFEST_LOAD_TIMEOUT || codigo === 0)) {
          const proxied = `/api/tv/proxy?url=${encodeURIComponent(url)}`;
          console.warn('[IPTV] Reintentando stream con proxy CORS:', proxied);
          this.hls.loadSource(proxied);
          this.hls.startLoad();
          return;
        }
        if (data.details === ErrorDetails.MANIFEST_LOAD_ERROR || data.details === ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
          if (codigo === 401 || codigo === 403 || codigo === 404 || codigo === 410) {
            return fallar(motivoHttp(codigo), `http-${codigo}`);
          }
        }
        if (data.details === ErrorDetails.MANIFEST_PARSING_ERROR) {
          if (!this.probadoNativo) {
            this.probadoNativo = true;
            this._destruirHls();
            return this._cargarNativo(url);
          }
          return fallar('la respuesta del servidor no es un stream de video válido', 'formato');
        }
        if (this.hls && this.reintentosRed < CFG.maxReintentosRed) {
          this.reintentosRed++;
          if (this.diagnostico) this.diagnostico.reconexiones++;
          this._emit('reconectando', { intento: this.reintentosRed, max: CFG.maxReintentosRed });
          const sesion = this.sesion;
          clearTimeout(this.tReintento);
          this.hls.stopLoad();
          this.tReintento = setTimeout(() => {
            if (sesion !== this.sesion || !this.hls) return;
            if (data.details === ErrorDetails.MANIFEST_LOAD_ERROR || data.details === ErrorDetails.MANIFEST_LOAD_TIMEOUT) this.hls.loadSource(url);
            else this.hls.startLoad();
          }, 1000 * 2 ** (this.reintentosRed - 1));
          return;
        }
        return fallar(`se perdió la conexión con el canal${codigo ? ` (${codigo})` : ''}`, 'red');
      }

      if (data.type === ErrorTypes.MEDIA_ERROR) {
        // En modo Vía B, los errores de buffer/decode de MSE se ignoran pues el render se hace en el canvas WASM
        if (this.h264wActive) return;

        // Si tenemos H264WasmLivePlayer listo (Vía B), activarlo de inmediato ante error de decodificación
        if (global.H264WasmLivePlayer && this.canvasH264w) {
          console.log('[Alexis TV] Conmutando automáticamente a Vía B (WASM) por incompatibilidad de decodificación MSE/PAFF');
          this._activarH264Wasm();
          return;
        }

        if (this.hls && this.recuperacionesMedia === 0) {
          this.recuperacionesMedia++;
          return this.hls.recoverMediaError();
        }
        if (this.hls && this.recuperacionesMedia === 1) {
          this.recuperacionesMedia++;
          this.hls.swapAudioCodec();
          return this.hls.recoverMediaError();
        }
        return fallar('el navegador no puede decodificar este video', 'media');
      }

      fallar('error irrecuperable del reproductor', 'otro');
    }

    _cargarNativo(url) {
      this.modo = 'nativo';
      this.video.src = url;
      this._reproducir();
    }

    _reproducir() {
      const sesion = this.sesion;
      const promesa = this.video.play();
      if (!promesa) return;
      promesa.catch((err) => {
        if (sesion !== this.sesion || this.terminal) return;
        if (err.name !== 'NotAllowedError') return;
        this.video.muted = true;
        this.video.play()
          .then(() => { if (sesion === this.sesion && !this.terminal) this._emit('silenciado'); })
          .catch(() => {
            if (sesion !== this.sesion || this.terminal) return;
            clearTimeout(this.tArranque);
            this._emit('requiere-clic');
          });
      });
    }

    _caido(motivo, codigo) {
      if (this.terminal) return;
      const resumen = this.diagnostico ? { ...this.diagnostico } : {};
      const error = resumen.errores?.at(-1);
      const iniciado = this.diagnostico?.inicioVideoMs != null;
      const confirmadoAntes = this.videoConfirmado === true;
      this._finalizarDiagnostico('fallido');
      this._limpiar();
      this._emit('caido', { motivo, codigo, iniciado, confirmadoAntes, reconexiones: resumen.reconexiones || 0,
        http: error?.http || 0, tipoHls: error?.tipo, detalleHls: error?.detalle });
    }

    _cerrarBuffer() {
      if (this.inicioBuffer != null && this.diagnostico) this.diagnostico.bufferingMs += Math.round(performance.now() - this.inicioBuffer);
      this.inicioBuffer = null;
    }

    _medirProgreso() {
      const v = this.video;
      if (this.terminal) return;
      if (!this.h264wActive && v.paused) return;
      const ahora = performance.now();
      const cuadros = this.h264wActive ? (this.h264wPlayer?.renderedFrameCount || 0) : (v.getVideoPlaybackQuality?.().totalVideoFrames || 0);
      if (cuadros > 0) this.cuadrosReportados = true;
      const sinMetrica = !this.cuadrosReportados && (v.videoWidth > 0 || (this.h264wActive && cuadros > 0));

      const avanza = this.h264wActive
        ? (cuadros > this.ultimosCuadros || cuadros > 0)
        : (v.currentTime > this.ultimoTiempo + .05 && v.readyState >= 2 && (cuadros > this.ultimosCuadros || sinMetrica || (v.videoWidth > 0 && !v.getVideoPlaybackQuality) || this.canal?.formato === 'audio'));

      if (avanza) {
        const intervaloMs = ahora - this.ultimoAvance;
        if (intervaloMs > 1500) this.progresoConfirmacionMs = 0;
        if (this.diagnostico.inicioVideoMs != null && intervaloMs <= 1500) {
          const deltaSec = this.h264wActive ? (intervaloMs / 1000) : (v.currentTime - this.ultimoTiempo);
          this.progresoConfirmacionMs += Math.min(intervaloMs, deltaSec * 1000);
        }
        if (this.falloRedPendiente) {
          this.falloRedPendiente = false;
          this._emit('recuperado');
        }
        this.ultimosCuadros = cuadros;
        this.ultimoTiempo = this.h264wActive ? (this._getVbPicPos() || (this.ultimoTiempo + 0.1)) : v.currentTime;
        this.ultimoAvance = ahora;
        this._cerrarBuffer();
        clearTimeout(this.tCongelado);
        this.tCongelado = null;
        clearTimeout(this.tArranque);
        if (this.diagnostico.inicioVideoMs == null) this.diagnostico.inicioVideoMs = Math.round(ahora - this.inicio);
        if (this.diagnostico.resultado !== 'reproduciendo') {
          this.diagnostico.resultado = 'reproduciendo';
          this._emit('reproduciendo');
        }
        const minimoMs = this.canal?.minimoConfirmacionMs === 60000 ? 60000 : 15000;
        if (!this.videoConfirmado && (v.videoWidth > 0 || this.h264wActive) && this.progresoConfirmacionMs >= minimoMs) {
          this.videoConfirmado = true;
          this.diagnostico.videoConfirmado15s = true;
          this.ev.onConfirmacionVideo?.(this.canal, { duracionConfirmadaMs: this.progresoConfirmacionMs });
        }
      } else if (this.diagnostico.inicioVideoMs != null) {
        if (ahora - this.ultimoAvance > 1500 && this.inicioBuffer == null) {
          this.inicioBuffer = this.ultimoAvance;
          this.diagnostico.congelamientos++;
          this._emit('buffering');
        }
        if (ahora - this.ultimoAvance > CFG.timeoutCongeladoMs) this._caido('la señal dejó de avanzar y no se recuperó', 'congelado');
      }
    }

    _finalizarDiagnostico(resultado) {
      if (!this.diagnostico) return;
      this._cerrarBuffer();
      const resumen = { ...this.diagnostico, resultado, intentoCarga: this.intentoCarga, duracionMs: Math.round(performance.now() - this.inicio) };
      this.ev.onDiagnostico?.(resumen);
      this.diagnostico = null;
    }

    _destruirHls() {
      if (this.hls) {
        const estimado = Math.round(this.hls.bandwidthEstimate || 0);
        if (estimado > 0 && Number.isFinite(estimado)) {
          anchoBanda = estimado;
          try { global.localStorage?.setItem(BW_CLAVE, String(estimado)); } catch { /* sin memoria */ }
        }
        this.hls.destroy();
        this.hls = null;
      }
    }

    _limpiar() {
      this._finalizarDiagnostico('detenido');
      this.terminal = true;
      this.sesion++;
      clearTimeout(this.tArranque);
      clearTimeout(this.tCongelado);
      this.tCongelado = null;
      clearTimeout(this.tReintento);
      clearInterval(this.tProgreso);
      if (this.vbPendingTimer) {
        clearInterval(this.vbPendingTimer);
        this.vbPendingTimer = null;
      }
      if (this.h264wPlayer) {
        try { this.h264wPlayer.stop(); } catch (e) {}
      }
      if (this.canvasH264w) {
        this.canvasH264w.style.display = 'none';
      }
      if (this.mpeg2Player) {
        try { this.mpeg2Player.stop(); } catch (e) {}
      }
      if (this.canvasMpeg2) {
        this.canvasMpeg2.style.display = 'none';
      }
      this.h264wActive = false;
      this.isMpeg2Decoding = false;
      this.hasH264Video = false;
      this.isActualMpeg2Stream = false;
      this.selectedMp2Pid = null;
      this.useWebAudio = false;
      this.vbPending = [];
      this.pendingAudioQueue = [];
      this.processedAudioFrags.clear();
      this.rawTsRing.clear();
      this._stopWebAudio();

      this.inicioBuffer = null;
      this.pausaUsuario = false;
      this.falloRedPendiente = false;
      this.ultimaRecuperacion = null;
      this._destruirHls();
      this.modo = null;
      this.reintentosRed = 0;
      this.recuperacionesMedia = 0;
      this.video.removeAttribute('src');
      this.video.load();
      this.ev.onCalidades?.([]);
    }

    _escucharVideo() {
      const v = this.video;
      v.addEventListener('playing', () => {
        this._cerrarBuffer();
        clearTimeout(this.tArranque);
      });
      v.addEventListener('waiting', () => {
        if (!this.terminal && this.diagnostico?.inicioVideoMs != null) {
          this.inicioBuffer = performance.now();
          this._emit('buffering');
        }
      });
      v.addEventListener('volumechange', () => {
        if (this.useWebAudio && this.audioGain) {
          this.audioGain.gain.value = v.muted ? 0 : (v.volume || 1);
        }
      });
    }

    _emit(estado, detalle = {}) {
      if (estado === 'buffering' || estado === 'reconectando') {
        if (this.diagnostico) this.diagnostico.resultado = estado;
      }
      this.ev.onEstado?.(estado, { ...detalle, intentoCarga: this.intentoCarga }, this.canal);
    }
  }

  global.ReproductorIPTV = ReproductorIPTV;
  if (typeof global.document?.createElement === 'function' && !esSafariOiOS()
    && (global.ManagedMediaSource || global.MediaSource)) cargarMotorHls().catch(() => {});
})(window);
