// js/mpeg2-player.js
// Orchestrates the background Web Worker decoding and smooth adaptive rendering to <canvas>

class Mpeg2LivePlayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false, desynchronized: true }) : null;
    this.worker = null;
    this.frameQueue = [];
    this.isRunning = false;
    this.animId = null;
    this.lastRenderTime = 0;
    this.fps = 29.97;
    this.frameDuration = 1000 / 29.97; // Dynamically updated by stream metadata
    this.nextFrameTime = 0;
    this.active = false;
    this.renderedFrameCount = 0;
    this.currentDar = null;
    this.lastRenderedSeq = -1;
    this.recentChunkFingerprints = new Set();
    this.recentChunksRing = [];

    // Expose for DevTools console inspection
    if (typeof window !== "undefined") {
      window.tvPlayer = window.tvPlayer || {};
      window.tvPlayer.mpeg2Player = this;
      window.__mpeg2Player = this;
    }

    this._initWorker();
  }

  _initWorker() {
    try {
      this.worker = new Worker('/js/mpeg2-worker.js?v=' + Date.now());
      this.worker.onmessage = (e) => {
        const msg = e.data;
        if (!msg) return;

        // Dynamic framerate adaptation from actual stream Sequence Header
        if (msg.fps && typeof msg.fps === 'number' && msg.fps > 10 && msg.fps < 120) {
          if (Math.abs(this.fps - msg.fps) > 0.05) {
            this.fps = msg.fps;
            this.frameDuration = 1000 / msg.fps;
          }
        }

        const seq = typeof msg.seq === 'number' ? msg.seq : null;

        if (msg.type === 'frame') {
          this._enqueueFrame({
            seq,
            bitmap: msg.bitmap,
            width: msg.width,
            height: msg.height,
            pts: msg.pts,
            dar: msg.dar
          });
          if (!this.isRunning && this.active) {
            this._startRenderLoop();
          }
        } else if (msg.type === 'frame-buffer') {
          this._enqueueFrame({
            seq,
            buffer: msg.buffer,
            width: msg.width,
            height: msg.height,
            pts: msg.pts,
            dar: msg.dar
          });
          if (!this.isRunning && this.active) {
            this._startRenderLoop();
          }
        }
      };
      this.worker.onerror = (err) => {
        console.warn('[Mpeg2LivePlayer] Worker error:', err);
      };
    } catch (err) {
      console.warn('[Mpeg2LivePlayer] Failed to instantiate worker:', err);
    }
  }

  _enqueueFrame(item) {
    // Drop any frame that arrived after an already rendered newer frame
    if (item.seq !== null && typeof item.seq === "number" && this.lastRenderedSeq >= 0 && item.seq <= this.lastRenderedSeq) {
      if (item.bitmap && typeof item.bitmap.close === "function") {
        item.bitmap.close();
      }
      return;
    }

    if (item.seq === null || this.frameQueue.length === 0) {
      this.frameQueue.push(item);
      return;
    }

    const last = this.frameQueue[this.frameQueue.length - 1];
    if (last.seq === null || item.seq >= last.seq) {
      this.frameQueue.push(item);
    } else {
      // Out-of-order arrival safeguard: insert sorted by monotonic sequence number
      let inserted = false;
      for (let i = this.frameQueue.length - 1; i >= 0; i--) {
        if (this.frameQueue[i].seq !== null && item.seq >= this.frameQueue[i].seq) {
          this.frameQueue.splice(i + 1, 0, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        this.frameQueue.unshift(item);
      }
    }
  }

  start() {
    this.active = true;
    if (this.canvas) this.canvas.style.display = 'block';
    this.nextFrameTime = performance.now();
    if (!this.isRunning && this.frameQueue.length > 0) {
      this._startRenderLoop();
    }
  }

  stop() {
    this.active = false;
    this.isRunning = false;
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  _getChunkFingerprint(buf) {
    const len = buf.byteLength || (buf.buffer ? buf.buffer.byteLength : 0);
    if (len < 188) return null;
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, len);
    let h1 = len;
    let h2 = 0x5a5a5a5a;
    const step = Math.max(1, Math.floor(len / 64));
    for (let i = 0; i < len; i += step) {
      h1 = ((h1 << 5) - h1 + u8[i]) | 0;
      h2 = ((h2 << 7) - h2 + u8[i + 1 < len ? i + 1 : 0]) | 0;
    }
    return `${len}:${h1}:${h2}`;
  }

  pushChunk(chunkBuffer) {
    if (!this.worker || !chunkBuffer) return;
    try {
      const len = chunkBuffer.byteLength || (chunkBuffer.buffer ? chunkBuffer.buffer.byteLength : 0);
      if (len < 188) return;

      // Deduplicate: ignore repeated chunks sent by HLS re-parsing or retries
      const fp = this._getChunkFingerprint(chunkBuffer);
      if (fp) {
        if (this.recentChunkFingerprints.has(fp)) {
          return;
        }
        this.recentChunkFingerprints.add(fp);
        this.recentChunksRing.push(fp);
        if (this.recentChunksRing.length > 50) {
          const old = this.recentChunksRing.shift();
          this.recentChunkFingerprints.delete(old);
        }
      }

      const copyBuffer = chunkBuffer instanceof ArrayBuffer
        ? chunkBuffer.slice(0)
        : (chunkBuffer.buffer ? chunkBuffer.buffer.slice(chunkBuffer.byteOffset, chunkBuffer.byteOffset + chunkBuffer.byteLength) : null);
      if (!copyBuffer) return;
      this.worker.postMessage(
        { type: 'decode-ts', buffer: copyBuffer },
        [copyBuffer]
      );
    } catch (e) {
      console.warn('[Mpeg2LivePlayer] Push chunk error:', e);
    }
  }

  reset() {
    this.recentChunkFingerprints.clear();
    this.recentChunksRing = [];
    // Clear queued frames and free any GPU bitmaps
    while (this.frameQueue.length > 0) {
      const f = this.frameQueue.shift();
      if (f.bitmap && typeof f.bitmap.close === 'function') {
        f.bitmap.close();
      }
    }
    if (this.worker) {
      this.worker.postMessage({ type: 'reset' });
    }
    if (this.ctx && this.canvas && this.canvas.width && this.canvas.height) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.renderedFrameCount = 0;
    this.lastRenderedSeq = -1;
  }

  _startRenderLoop() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.nextFrameTime = performance.now();

    const loop = (now) => {
      if (!this.isRunning || !this.active) {
        this.isRunning = false;
        return;
      }

      // Bounded queue with smooth adaptive pacing:
      // High threshold safety cap (150 frames ~5s buffer): drop older frames only under extreme lag
      if (this.frameQueue.length > 150) {
        while (this.frameQueue.length > 45) {
          const dropped = this.frameQueue.shift();
          if (dropped.bitmap && typeof dropped.bitmap.close === 'function') {
            dropped.bitmap.close();
          }
        }
        this.nextFrameTime = now;
      }

      if (this.frameQueue.length > 0 && now >= this.nextFrameTime) {
        const frame = this.frameQueue.shift();
        this._renderFrame(frame);
        this.renderedFrameCount++;

        // Smooth adaptive pace regulation:
        // If queue builds up, gently speed up render pace to catch up without dropping frames.
        // If queue is nearly empty, gently ease to avoid starvation between HLS chunk arrivals.
        let paceFactor = 1.0;
        const qLen = this.frameQueue.length;
        if (qLen > 75) {
          paceFactor = 0.82; // 18% faster to drain backlog smoothly
        } else if (qLen > 45) {
          paceFactor = 0.90; // 10% faster
        } else if (qLen <= 5) {
          paceFactor = 1.12; // slightly slower to prevent starvation between HLS segments
        }

        this.nextFrameTime = Math.max(now, this.nextFrameTime + (this.frameDuration * paceFactor));
      }

      this.animId = requestAnimationFrame(loop);
    };

    this.animId = requestAnimationFrame(loop);
  }

  _renderFrame(frame) {
    if (!frame || !this.ctx || !this.canvas) return;
    if (frame.seq !== null && typeof frame.seq === 'number') {
      this.lastRenderedSeq = frame.seq;
    }
    const w = frame.width;
    const h = frame.height;

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    if (frame.dar && frame.dar !== this.currentDar) {
      this.currentDar = frame.dar;
      if (frame.dar === '16:9') {
        this.canvas.style.aspectRatio = '16 / 9';
      } else if (frame.dar === '4:3') {
        this.canvas.style.aspectRatio = '4 / 3';
      }
    }

    if (frame.bitmap) {
      this.ctx.drawImage(frame.bitmap, 0, 0);
      frame.bitmap.close();
    } else if (frame.buffer) {
      const imgData = new ImageData(new Uint8ClampedArray(frame.buffer), w, h);
      this.ctx.putImageData(imgData, 0, 0);
    }
  }

  destroy() {
    this.stop();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

if (typeof window !== 'undefined') {
  window.Mpeg2LivePlayer = Mpeg2LivePlayer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Mpeg2LivePlayer };
}

