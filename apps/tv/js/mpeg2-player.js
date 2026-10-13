// js/mpeg2-player.js
// Orchestrates the background Web Worker decoding and smooth 29.97 fps rendering to <canvas>

class Mpeg2LivePlayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false, desynchronized: true }) : null;
    this.worker = null;
    this.frameQueue = [];
    this.isRunning = false;
    this.animId = null;
    this.lastRenderTime = 0;
    this.frameDuration = 1000 / 29.97; // ~33.36 ms per frame for 29.97 fps broadcast
    this.nextFrameTime = 0;
    this.active = false;
    this.renderedFrameCount = 0;
    this.currentDar = null;

    this._initWorker();
  }

  _initWorker() {
    try {
      this.worker = new Worker('/js/mpeg2-worker.js');
      this.worker.onmessage = (e) => {
        const msg = e.data;
        if (!msg) return;

        if (msg.type === 'frame') {
          this.frameQueue.push({
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
          this.frameQueue.push({
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
    if (this.canvas) this.canvas.style.display = 'none';
    this.reset();
  }

  pushChunk(chunkBuffer) {
    if (!this.worker || !chunkBuffer) return;
    try {
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

      // Latency safeguard: if queue exceeds 90 frames (~3s of buffer), drop stale frames to keep live broadcast sync
      if (this.frameQueue.length > 90) {
        while (this.frameQueue.length > 30) {
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
        this.nextFrameTime = Math.max(now, this.nextFrameTime + this.frameDuration);
      }

      this.animId = requestAnimationFrame(loop);
    };

    this.animId = requestAnimationFrame(loop);
  }

  _renderFrame(frame) {
    if (!frame || !this.ctx || !this.canvas) return;
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

