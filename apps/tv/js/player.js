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
      this.nextAudioTime = 0;
      this.processedAudioFrags = new Set();
      this.rawTsRing = new Map();
      this._silenciado = false;
      this._silenciadoUsuario = false;
      this._volumen = 1;
      const savedVol = global.localStorage?.getItem('volumen');
      if (savedVol !== null) {
        const n = Number(savedVol);
        if (!isNaN(n) && n > 0.05 && n <= 1) this._volumen = n;
      }
      this.bloqueoAutoplay = false;
      this._sincronizandoVolumen = false;
      this._cargandoCanal = false;
      this.audioChainBaselineV = 0;
      this.videoReproduciendo = false;
      this.pausaUsuario = false;

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
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
        this.audioGain = this.audioCtx.createGain();
        const safeGain = this._silenciado ? 0 : (typeof this._volumen === 'number' && !isNaN(this._volumen) ? this._volumen : 1);
        this.audioGain.gain.value = safeGain;
        this.audioGain.connect(this.audioCtx.destination);
      }
      if (this.audioCtx.state === 'suspended' && !this._silenciadoUsuario) {
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
      if (this.audioDecoder) {
        try { this.audioDecoder.reset(); } catch (e) {}
      }
    }

    get soportaHls() {
      if (global.Hls) return global.Hls.isSupported();
      const MS = global.ManagedMediaSource || global.MediaSource;
      return !!MS?.isTypeSupported?.('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
    }

    cargar(canal) {
      this._cargandoCanal = true;
      try {
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

        if (!this._silenciadoUsuario) {
          this._silenciado = false;
          this.bloqueoAutoplay = false;
        }

        const savedVol = global.localStorage?.getItem('volumen');
        if (savedVol !== null) {
          const numVol = Number(savedVol);
          if (!isNaN(numVol) && numVol > 0.05 && numVol <= 1) {
            this._volumen = numVol;
          }
        }
        this.aplicarVolumen();
      } finally {
        this._cargandoCanal = false;
      }

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
      if (this.h264wActive || this.isMpeg2Decoding) return true;
      return !!this.canal && this.video.readyState > 0;
    }

    get silenciado() {
      return this._silenciado;
    }

    set silenciado(val) {
      this._silenciado = !!val;
      this._silenciadoUsuario = this._silenciado;
      if (!this._silenciado) this.bloqueoAutoplay = false;
      this.aplicarVolumen();
    }

    get volumen() {
      return this._volumen;
    }

    set volumen(val) {
      const v = Math.max(0, Math.min(1, Number(val)));
      if (isNaN(v)) return;
      this._volumen = v;
      if (v > 0 && this._silenciado && !this._silenciadoUsuario) {
        this._silenciado = false;
        this.bloqueoAutoplay = false;
      }
      this.aplicarVolumen();
    }

    aplicarVolumen() {
      const mudo = this._silenciado;
      const safeVol = Math.max(0, Math.min(1, typeof this._volumen === 'number' && !isNaN(this._volumen) ? this._volumen : 1));
      if (this.useWebAudio) {
        this._sincronizandoVolumen = true;
        try {
          this.video.muted = true; // Silencia el video HTML5 para evitar eco o interferencias con WebAudio
        } finally {
          this._sincronizandoVolumen = false;
        }
        if (this.audioGain && this.audioCtx) {
          const targetGain = mudo ? 0 : safeVol;
          try {
            this.audioGain.gain.setValueAtTime(targetGain, this.audioCtx.currentTime);
          } catch (e) {
            this.audioGain.gain.value = targetGain;
          }
        }
      } else {
        this._sincronizandoVolumen = true;
        try {
          this.video.muted = mudo;
          this.video.volume = safeVol; // Preserva el volumen real del usuario, nunca lo corrompe a 0
        } finally {
          this._sincronizandoVolumen = false;
        }
      }
    }

    desmutear() {
      this.bloqueoAutoplay = false;
      this._silenciado = false;
      this._silenciadoUsuario = false;
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      this.aplicarVolumen();
      this._flushAudioQueue();
      this._emit('cambio-volumen', { silenciado: false, volumen: this._volumen });
    }

    alternarSilencio() {
      this._silenciado = !this._silenciado;
      this._silenciadoUsuario = this._silenciado;
      this.bloqueoAutoplay = false;
      if (!this._silenciado && this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      this.aplicarVolumen();
      if (!this._silenciado) this._flushAudioQueue();
      this._emit('cambio-volumen', { silenciado: this._silenciado, volumen: this._volumen });
      return this._silenciado;
    }

    desbloquearAudio() {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      if (this._silenciado && this.bloqueoAutoplay) {
        this.desmutear();
      }
    }

    alternarPausa() {
      if (this.h264wActive && this.h264wPlayer) {
        if (this.h264wPlayer.active) {
          this.h264wPlayer.stop();
          this.video.pause();
          this.pausaUsuario = true;
          this.videoReproduciendo = false;
          if (this.audioCtx && this.audioCtx.state === 'running') this.audioCtx.suspend().catch(() => {});
          this._emit('pausado', { pausado: true });
          return false;
        } else {
          this.h264wPlayer.start();
          this.video.play().catch(() => {});
          this.pausaUsuario = false;
          if (this.audioCtx && this.audioCtx.state === 'suspended' && !this._silenciado) this.audioCtx.resume().catch(() => {});
          this._emit('pausado', { pausado: false });
          return true;
        }
      }
      if (this.isMpeg2Decoding && this.mpeg2Player) {
        if (this.mpeg2Player.active) {
          this.mpeg2Player.stop();
          this.video.pause();
          this.pausaUsuario = true;
          this.videoReproduciendo = false;
          if (this.audioCtx && this.audioCtx.state === 'running') this.audioCtx.suspend().catch(() => {});
          this._emit('pausado', { pausado: true });
          return false;
        } else {
          this.mpeg2Player.start();
          this.video.play().catch(() => {});
          this.pausaUsuario = false;
          if (this.audioCtx && this.audioCtx.state === 'suspended' && !this._silenciado) this.audioCtx.resume().catch(() => {});
          this._emit('pausado', { pausado: false });
          return true;
        }
      }
      const v = this.video;
      if (!this.hayVideo) return null;
      if (!v.paused) {
        v.pause();
        this.pausaUsuario = true;
        this.videoReproduciendo = false;
        if (this.useWebAudio && this.audioCtx && this.audioCtx.state === 'running') {
          this.audioCtx.suspend().catch(() => {});
        }
        this._emit('pausado', { pausado: true });
        return false;
      }
      this.pausaUsuario = false;
      const directo = this.hls?.liveSyncPosition;
      if (directo && typeof directo === 'number' && Math.abs(v.currentTime - directo) > 5) {
        v.currentTime = directo;
        this._stopWebAudio();
      }
      this._reproducir();
      if (this.useWebAudio && this.audioCtx && this.audioCtx.state === 'suspended' && !this._silenciado) {
        this.audioCtx.resume().catch(() => {});
      }
      this._emit('pausado', { pausado: false });
      return true;
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
            } else if (!chosenPid && streamType === 0x06) {
              let isDolbyES = false;
              let d = p + 5;
              const dEnd = d + esInfoLen;
              while (d + 1 < dEnd) {
                const tag = buf[d];
                const len = buf[d + 1];
                if (tag === 0x6A || tag === 0x7A) isDolbyES = true;
                else if (tag === 0x05 && len >= 4 && d + 5 < dEnd) {
                  const fourcc = String.fromCharCode(buf[d + 2], buf[d + 3], buf[d + 4], buf[d + 5]);
                  if (fourcc === 'AC-3' || fourcc === 'EAC3') isDolbyES = true;
                }
                d += 2 + len;
              }
              if (isDolbyES) chosenPid = elemPid;
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
              if (!this.selectedMp2Pid) this.selectedMp2Pid = elemPid;
              isMp2 = true;
            } else if (streamType === 0x81 || streamType === 0x87) {
              audioPids.add(elemPid);
              if (!this.selectedMp2Pid) this.selectedMp2Pid = elemPid;
              isDolby = true;
            } else if (streamType === 0x06) {
              let isDolbyES = false;
              let d = p + 5;
              const dEnd = d + esInfoLen;
              while (d + 1 < dEnd) {
                const tag = u8[d];
                const len = u8[d + 1];
                if (tag === 0x6A || tag === 0x7A) {
                  isDolbyES = true;
                } else if (tag === 0x05 && len >= 4 && d + 5 < dEnd) {
                  const fourcc = String.fromCharCode(u8[d + 2], u8[d + 3], u8[d + 4], u8[d + 5]);
                  if (fourcc === 'AC-3' || fourcc === 'EAC3') isDolbyES = true;
                }
                d += 2 + len;
              }
              if (isDolbyES) {
                audioPids.add(elemPid);
                if (!this.selectedMp2Pid) this.selectedMp2Pid = elemPid;
                isDolby = true;
              }
            }
            p += 5 + esInfoLen;
          }
          break;
        }
      }

      if ((!isMp2 && !isDolby) || audioPids.size === 0) {
        return { data: buffer, isMp2: false, isDolby: false };
      }

      this.audioCodec = isDolby ? 'dolby' : (isMp2 ? 'mp2' : null);

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

    _reproducirAudioBuffer(buffer, fragStart) {
      if (!this.audioCtx || !this.audioGain || !buffer) return;
      const duration = buffer.duration;
      const aNow = this.audioCtx.currentTime;
      const v = this.video;
      const vTime = (v && typeof v.currentTime === 'number') ? v.currentTime : null;

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioGain);
      this.activeAudioSources.push(source);
      source.onended = () => {
        try { source.disconnect(); } catch (e) {}
        const idx = this.activeAudioSources.indexOf(source);
        if (idx !== -1) this.activeAudioSources.splice(idx, 1);
      };

      let startTime = this.nextAudioTime;

      // Sincronización continua de cadena WebAudio sin cortes ni pérdida de paquetes
      if (!startTime || startTime < aNow + 0.01) {
        // Arranque inicial o tras pausa/vacío de buffer (underrun)
        startTime = aNow + 0.02;
      } else if (startTime > aNow + 0.5) {
        // Limitar acumulación de latencia a máx 50ms por delante del tiempo real
        startTime = aNow + 0.05;
      } else if (typeof fragStart === 'number' && typeof vTime === 'number') {
        const delta = fragStart - vTime;
        // Solo ajustar si delta es un desfase creíble en la misma línea de tiempo (< 0.8s)
        if (Math.abs(delta) < 0.8 && Math.abs((aNow + delta) - startTime) < 0.2) {
          startTime = Math.max(aNow + 0.02, aNow + delta);
        }
      }

      source.start(startTime, 0);
      this.nextAudioTime = startTime + duration;
    }

    _scheduleVbAudioBlock(fragStart, duration, buffer) {
      if (!this.audioCtx || !this.audioGain || !buffer) return;
      this._reproducirAudioBuffer(buffer, fragStart);
    }

    _flushAudioQueue() {
      if (!this.useWebAudio || !this.audioCtx || this.h264wActive) return;
      if (!this.videoReproduciendo || this.video?.paused) return;

      while (this.pendingAudioQueue.length > 0) {
        const item = this.pendingAudioQueue.shift();
        if (item && item.buffer) {
          this._reproducirAudioBuffer(item.buffer, item.fragStart);
        }
      }
    }

    _maybeRebuildStaleChain() {
      if (!this.audioCtx || this.audioCtx.state !== 'suspended') return;
      if (this.nextAudioTime <= 0 || this.h264wActive) return;
      if (!this.video || typeof this.audioChainBaselineV !== 'number') return;
      const drift = this.video.currentTime - this.audioChainBaselineV;
      if (Math.abs(drift) > 0.4) {
        this._stopWebAudio();
        console.log('[Alexis TV] Cadena de audio desalineada tras congelación (Δ=' + drift.toFixed(2) + ' s) → reconstrucción');
      }
    }

    _scheduleAudioBuffer(buffer, fragStart) {
      if (!this.audioCtx || !this.audioGain || !buffer) return;
      const v = this.video;

      // Si el video está pausado o aún no empezó a reproducir, encolar temporalmente
      if (!this.videoReproduciendo || !v || v.paused) {
        this.pendingAudioQueue.push({ fragStart, buffer });
        if (this.pendingAudioQueue.length > 20) this.pendingAudioQueue.shift();
        return;
      }

      this._flushAudioQueue();
      this._reproducirAudioBuffer(buffer, fragStart);
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
      if (this.canvasH264w) {
        this.canvasH264w.style.display = 'block';
        this.canvasH264w.style.background = '#000';
      }
      if (this.canvasMpeg2) this.canvasMpeg2.style.display = 'none';
      if (this.video) this.video.style.opacity = '0';
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
      if (this.canvasMpeg2) {
        this.canvasMpeg2.style.display = 'block';
        this.canvasMpeg2.style.background = '#000';
      }
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
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            if (self.h264wActive) {
              data.fatal = false;
              return;
            }
            if (self.useWebAudio || data.sourceBufferName === 'audio' || data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR || data.details === Hls.ErrorDetails.BUFFER_APPENDING_ERROR) {
              data.fatal = false;
              return;
            }
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
                if (processed.isMp2 || processed.isDolby) {
                  self.useWebAudio = true;
                  self.aplicarVolumen();
                }
                context.frag._rawChunkBuffer = response.data;
                const ringKey = (context.frag.sn !== undefined && context.frag.sn !== null)
                  ? context.frag.sn
                  : (context.frag.start !== undefined ? 's' + context.frag.start : null);
                if (ringKey !== null) self.rawTsRing.set(ringKey, response.data);
                if (self.rawTsRing.size > 20) {
                  const firstKey = self.rawTsRing.keys().next().value;
                  self.rawTsRing.delete(firstKey);
                }

                response.data = processed.data;
                return origSuccess(response, stats, context, networkDetails);
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
        liveMaxLatencyDurationCount: 8,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1024 * 1024,
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
              this.aplicarVolumen();
              if (sesion !== this.sesion) return;
              if (this.audioDecoder && this.audioDecoder.ready) {
                try { await this.audioDecoder.ready; } catch (e) {}
              }
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

      if (data.details === global.Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR && data.sourceBufferName === 'audio') {
        console.log('[Alexis TV] BUFFER_ADD_CODEC_ERROR en audio ignorado: gestionado vía WebAudio');
        this.useWebAudio = true;
        this._initWebAudio().catch(() => {});
        return;
      }

      if (this.useWebAudio && data.type === global.Hls.ErrorTypes.MEDIA_ERROR && (data.sourceBufferName === 'audio' || data.details === global.Hls.ErrorDetails.BUFFER_APPENDING_ERROR)) {
        console.log('[Alexis TV] Error de SourceBuffer de audio ignorado: gestionado vía WebAudio');
        return;
      }

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
        if (this.h264wActive || this.isMpeg2Decoding) return;
        if (this.useWebAudio && (data.sourceBufferName === 'audio' || data.details === ErrorDetails.BUFFER_ADD_CODEC_ERROR || data.details === ErrorDetails.BUFFER_APPENDING_ERROR)) {
          return;
        }

        if (data.fatal) {
          if (this.hls && this.recuperacionesMedia === 0) {
            this.recuperacionesMedia++;
            console.log('[Alexis TV] Error fatal de media: intentando recuperación nativa de Hls.js (1/2)...');
            return this.hls.recoverMediaError();
          }
          if (this.hls && this.recuperacionesMedia === 1) {
            this.recuperacionesMedia++;
            console.log('[Alexis TV] Error fatal de media: intentando swapAudioCodec y recuperación nativa (2/2)...');
            this.hls.swapAudioCodec();
            return this.hls.recoverMediaError();
          }

          // Solo si las dos recuperaciones nativas de HLS.js fallan en VIDEO H.264 (ej. Win+ con video entrelazado PAFF):
          if (global.H264WasmLivePlayer && this.canvasH264w && this.hasH264Video && (data.sourceBufferName === 'video' || !data.sourceBufferName)) {
            console.log('[Alexis TV] Conmutando a Vía B (WASM) tras agotar recuperaciones nativas de video');
            this._activarH264Wasm();
            return;
          }

          return fallar('el navegador no puede decodificar este video', 'media');
        }

        // Si no es fatal, Hls.js lo gestiona internamente sin interrumpir la reproducción
        return;
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
      this.aplicarVolumen();
      const promesa = this.video.play();
      if (!promesa) return;
      promesa.catch((err) => {
        if (sesion !== this.sesion || this.terminal) return;
        if (err.name !== 'NotAllowedError') return;
        this._silenciado = true;
        this.bloqueoAutoplay = true;
        this.aplicarVolumen();
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
        if (this.progresoConfirmacionMs > 2500) {
          this.recuperacionesMedia = 0;
        }
        if (!this.h264wActive && this.useWebAudio) {
          this._flushAudioQueue();
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

      this.bloqueoAutoplay = false;
      this.audioChainBaselineV = 0;
      this.videoReproduciendo = false;
      this.pausaUsuario = false;
      if (this.video) this.video.style.opacity = '1';
      this.inicioBuffer = null;
      this.falloRedPendiente = false;
      this.ultimaRecuperacion = null;
      this._destruirHls();
      this.modo = null;
      this.reintentosRed = 0;
      this.recuperacionesMedia = 0;
      this._sincronizandoVolumen = true;
      try {
        this.video.removeAttribute('src');
        this.video.load();
      } finally {
        this._sincronizandoVolumen = false;
      }
      this.ev.onCalidades?.([]);
    }

    _escucharVideo() {
      const v = this.video;
      v.addEventListener('playing', () => {
        this.videoReproduciendo = true;
        this._cerrarBuffer();
        clearTimeout(this.tArranque);
        if (this.useWebAudio) {
          this._maybeRebuildStaleChain();
          if (this.audioCtx && this.audioCtx.state === 'suspended' && !this._silenciado) {
            this.audioCtx.resume().catch(() => {});
          }
          this._flushAudioQueue();
        }
      });
      v.addEventListener('waiting', () => {
        this.videoReproduciendo = false;
        if (!this.terminal && this.diagnostico?.inicioVideoMs != null) {
          this.inicioBuffer = performance.now();
          this._emit('buffering');
        }
      });
      v.addEventListener('pause', () => {
        this.videoReproduciendo = false;
        if (this.h264wActive && this.h264wPlayer) {
          if (this.h264wPlayer.active) this.h264wPlayer.stop();
        }
        if (this.isMpeg2Decoding && this.mpeg2Player) {
          if (this.mpeg2Player.active) this.mpeg2Player.stop();
        }
        if (this.audioCtx && this.audioCtx.state === 'running') {
          this.audioCtx.suspend().catch(() => {});
        }
      });
      v.addEventListener('play', () => {
        if (this.h264wActive && this.h264wPlayer) {
          if (!this.h264wPlayer.active) this.h264wPlayer.start();
        }
        if (this.isMpeg2Decoding && this.mpeg2Player) {
          if (!this.mpeg2Player.active) this.mpeg2Player.start();
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended' && !this._silenciado) {
          this.audioCtx.resume().catch(() => {});
        }
      });
      v.addEventListener('seeking', () => {
        this.videoReproduciendo = false;
      });
      v.addEventListener('seeked', () => {
        if (!v.paused && v.readyState >= 2) this.videoReproduciendo = true;
        if (this.useWebAudio) {
          this._flushAudioQueue();
        }
      });
      v.addEventListener('volumechange', () => {
        if (this._sincronizandoVolumen || this._cargandoCanal) return;
        this._sincronizandoVolumen = true;
        try {
          if (!this.useWebAudio) {
            if (!this.bloqueoAutoplay) {
              this._silenciado = v.muted;
              this._silenciadoUsuario = v.muted;
            }
            if (typeof v.volume === 'number' && !isNaN(v.volume) && v.volume > 0.02) {
              this._volumen = v.volume;
            }
            this.aplicarVolumen();
            this._emit('cambio-volumen', { silenciado: this._silenciado, volumen: this._volumen });
          }
        } finally {
          this._sincronizandoVolumen = false;
        }
      });
      v.addEventListener('timeupdate', () => {
        if (!v.paused && v.readyState >= 2) {
          this.videoReproduciendo = true;
        }
        if (this.audioCtx && this.audioCtx.state === 'running') {
          this.audioChainBaselineV = v.currentTime;
        }
        if (this.useWebAudio) {
          this._flushAudioQueue();
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
