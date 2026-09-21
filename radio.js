/**
 * ALEXIS RADIO — Core Audio Engine & State Manager
 * Features: HLS (m3u8), MP3, AAC, Shoutcast/Icecast, M3U parser, Audio Visualizer, PWA, Proxying
 */

(function () {
  'use strict';

  // Default Curated Stations
  function getStationFallbackSvg(name, genre) {
    const initials = (name || 'RA').split(' ').filter(Boolean).map(w => w[0]).join('').substring(0, 2).toUpperCase() || 'RA';
    let color = '#00f0ff';
    if (genre === 'Noticias') color = '#38bdf8';
    else if (genre === 'Rock') color = '#ef4444';
    else if (genre === 'Electrónica') color = '#a855f7';
    else if (genre === 'Lofi / Chill') color = '#10b981';
    else if (genre === 'Cultura') color = '#f59e0b';

    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%23080f24' stroke='${encodeURIComponent(color)}' stroke-width='3.5'/%3E%3Ctext x='50' y='62' font-family='monospace' font-weight='800' font-size='36' fill='${encodeURIComponent(color)}' text-anchor='middle'%3E${initials}%3C/text%3E%3C/svg%3E`;
  }

  // Default Curated Stations
  const DEFAULT_STATIONS = [
    {
      id: 'caracol-radio',
      name: 'Caracol Radio',
      url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CARACOL_RADIO_SC',
      genre: 'Noticias',
      freq: '100.9 FM',
      logo: getStationFallbackSvg('Caracol Radio', 'Noticias'),
      isDefault: true
    },
    {
      id: 'w-radio',
      name: 'W Radio Colombia',
      url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/WRADIO_SC',
      genre: 'Noticias',
      freq: '99.9 FM',
      logo: getStationFallbackSvg('W Radio', 'Noticias'),
      isDefault: true
    },
    {
      id: 'blu-radio',
      name: 'Blu Radio',
      url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/BLURADIO_SC',
      genre: 'Noticias',
      freq: '89.9 FM',
      logo: getStationFallbackSvg('Blu Radio', 'Noticias'),
      isDefault: true
    },
    {
      id: 'la-mega',
      name: 'La Mega',
      url: 'https://mdstrm.com/audio/632c9ae6660fef03fe3855fe/live.m3u8',
      genre: 'Música',
      freq: '90.9 FM',
      logo: getStationFallbackSvg('La Mega', 'Música'),
      isDefault: true
    },
    {
      id: 'radionica',
      name: 'Radiónica',
      url: 'https://rtvc-live-radio.akamaized.net/radionica/radionica/radionica.isml/radionica.m3u8',
      genre: 'Rock',
      freq: '99.1 FM',
      logo: getStationFallbackSvg('Radiónica', 'Rock'),
      isDefault: true
    },
    {
      id: 'radio-nacional',
      name: 'Radio Nacional de Colombia',
      url: 'https://rtvc-live-radio.akamaized.net/radionacional/radionacional/radionacional.isml/radionacional.m3u8',
      genre: 'Cultura',
      freq: '95.9 FM',
      logo: getStationFallbackSvg('Radio Nacional', 'Cultura'),
      isDefault: true
    },
    {
      id: 'lofi-girl',
      name: 'Lofi Girl Radio',
      url: 'https://stream.zeno.fm/f3wvbbqmdg8uv',
      genre: 'Lofi / Chill',
      freq: 'WEB HI-FI',
      logo: getStationFallbackSvg('Lofi Girl', 'Lofi / Chill'),
      isDefault: true
    },
    {
      id: 'synthwave-radio',
      name: 'Nightride Synthwave FM',
      url: 'https://stream.nightride.fm/nightride.mp3',
      genre: 'Electrónica',
      freq: '80s CYBER',
      logo: getStationFallbackSvg('Synthwave FM', 'Electrónica'),
      isDefault: true
    },
    {
      id: 'ibiza-global',
      name: 'Ibiza Global Radio',
      url: 'https://listenssl.ibizaglobalradio.com:8024/ibizaglobalradio.mp3',
      genre: 'Electrónica',
      freq: '100.8 FM',
      logo: getStationFallbackSvg('Ibiza Global', 'Electrónica'),
      isDefault: true
    },
    {
      id: 'bbc-world',
      name: 'BBC World Service',
      url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service',
      genre: 'Noticias',
      freq: 'WORLD SERVICE',
      logo: getStationFallbackSvg('BBC World', 'Noticias'),
      isDefault: true
    },
    {
      id: 'radioacktiva',
      name: 'Radioacktiva',
      url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIO_ACTIVA.mp3',
      genre: 'Rock',
      freq: '97.9 FM',
      logo: getStationFallbackSvg('Radioacktiva', 'Rock'),
      isDefault: true
    },
    {
      id: 'besame',
      name: 'Bésame Radio',
      url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/BESAME_SC',
      genre: 'Música',
      freq: '94.9 FM',
      logo: getStationFallbackSvg('Bésame Radio', 'Música'),
      isDefault: true
    }
  ];

  // State
  let stations = [];
  let currentStation = null;
  let isPlaying = false;
  let isBuffering = false;
  let useProxyForced = false;
  let activeFilter = 'all';
  let searchQuery = '';
  let sleepTimerId = null;
  let sleepTimerEnd = null;

  // Real-Time Telemetry & Bitrate State
  let currentBitrateKbps = null;
  let currentFormat = 'MP3';
  let currentCodec = 'MP3';
  let sessionTotalBytes = 0;
  let networkSpeedBytesPerSec = 0;
  let telemetryTimer = null;
  let probeAbortController = null;

  // Audio & HLS
  const audio = new Audio();
  audio.preload = 'none';
  audio.crossOrigin = 'anonymous';
  let hls = null;

  // Web Audio Visualizer
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let isAudioContextConnected = false;
  let animFrameId = null;

  // DOM Elements
  const playBtn = document.getElementById('play-main-btn');
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');
  const prevBtn = document.getElementById('prev-station-btn');
  const nextBtn = document.getElementById('next-station-btn');
  const volumeSlider = document.getElementById('volume-slider');
  const muteBtn = document.getElementById('mute-btn');
  const activeStationName = document.getElementById('active-station-name');
  const activeStationFreq = document.getElementById('active-station-freq');
  const activeStationGenre = document.getElementById('active-station-genre');
  const activeStationLogo = document.getElementById('active-station-logo');
  const nowPlayingStatus = document.getElementById('now-playing-status');
  const stationsGrid = document.getElementById('stations-grid');
  const searchInput = document.getElementById('search-input');
  const stationCountDisplay = document.getElementById('station-count-display');
  const resetDefaultsBtn = document.getElementById('reset-defaults-btn');
  const sleepTimerBtn = document.getElementById('sleep-timer-btn');
  const sleepBadge = document.getElementById('sleep-badge');
  const proxyToggleBtn = document.getElementById('proxy-toggle-btn');
  const canvas = document.getElementById('visualizer-canvas');
  const canvasCtx = canvas ? canvas.getContext('2d') : null;

  // Top Stage Telemetry Elements
  const telemetryFormatVal = document.getElementById('telemetry-format-val');
  const telemetryBitrateVal = document.getElementById('telemetry-bitrate-val');
  const telemetrySpeedVal = document.getElementById('telemetry-speed-val');
  const telemetryDataVal = document.getElementById('telemetry-data-val');
  const activeStationCodecBadge = document.getElementById('active-station-codec-badge');
  const activeStationBitrateBadge = document.getElementById('active-station-bitrate-badge');
  const visualizerStatsText = document.getElementById('visualizer-stats-text');

  // Bottom Player Bar Elements
  const bottomBarLogo = document.getElementById('bottom-bar-logo');
  const bottomBarName = document.getElementById('bottom-bar-name');
  const bottomBarFreq = document.getElementById('bottom-bar-freq');
  const bottomBarFormatBadge = document.getElementById('bottom-bar-format-badge');
  const bottomBarBitrateBadge = document.getElementById('bottom-bar-bitrate-badge');
  const bottomBarTelemetry = document.getElementById('bottom-bar-telemetry');

  // =========================================================================
  // STORAGE & INITIALIZATION
  // =========================================================================
  function initStorage() {
    try {
      const saved = localStorage.getItem('at_radio_stations');
      if (saved !== null) {
        stations = JSON.parse(saved);
      } else {
        stations = [...DEFAULT_STATIONS];
        saveStations();
      }
    } catch (e) {
      console.warn('Error reading radio stations from storage:', e);
      stations = [...DEFAULT_STATIONS];
    }
  }

  function saveStations() {
    try {
      localStorage.setItem('at_radio_stations', JSON.stringify(stations));
    } catch (e) {
      console.error('Failed to save stations to localStorage:', e);
    }
  }

  // =========================================================================
  // FORMAT DETECTION & TELEMETRY MONITOR
  // =========================================================================
  function detectStreamFormat(rawUrl, contentType = '') {
    const url = (rawUrl || '').toLowerCase();
    const type = (contentType || '').toLowerCase();

    if (url.includes('.m3u8') || type.includes('mpegurl') || type.includes('application/x-mpegurl')) {
      return { ext: 'M3U8', codec: 'HLS', badgeClass: 'badge-hls', defaultBitrate: 128 };
    }
    if (url.includes('.aac') || url.includes('aac') || type.includes('aac')) {
      return { ext: 'AAC', codec: 'AAC+', badgeClass: 'badge-aac', defaultBitrate: 64 };
    }
    if (url.includes('.ogg') || url.includes('.opus') || type.includes('ogg') || type.includes('opus')) {
      return { ext: 'OGG', codec: 'OGG', badgeClass: 'badge-ogg', defaultBitrate: 128 };
    }
    if (url.includes('.mp3') || type.includes('mpeg') || type.includes('audio/mp3') || url.includes('_sc') || url.includes('streamtheworld')) {
      return { ext: 'MP3', codec: 'MP3', badgeClass: 'badge-mp3', defaultBitrate: 128 };
    }

    return { ext: 'MP3', codec: 'MP3', badgeClass: 'badge-mp3', defaultBitrate: 128 };
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0.00 MB';
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return mb.toFixed(2) + ' MB';
    }
    return (mb / 1024).toFixed(2) + ' GB';
  }

  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '0.0 KB/s';
    const kb = bytesPerSec / 1024;
    if (kb < 1000) {
      return kb.toFixed(1) + ' KB/s';
    }
    return (kb / 1024).toFixed(2) + ' MB/s';
  }

  function updateTelemetryDisplay() {
    const fmt = detectStreamFormat(currentStation ? currentStation.url : '');
    const activeBitrate = currentBitrateKbps || (isPlaying ? fmt.defaultBitrate : null);
    const activeBitrateText = activeBitrate ? `${activeBitrate} kbps` : (isPlaying ? 'Detectando...' : '-- kbps');
    const activeSpeedText = isPlaying ? formatSpeed(networkSpeedBytesPerSec) : '0.0 KB/s';
    const activeDataText = formatBytes(sessionTotalBytes);

    // 1. Format tag in Top Stage
    if (telemetryFormatVal) {
      telemetryFormatVal.textContent = fmt.ext;
      telemetryFormatVal.className = `telemetry-val format-tag ${fmt.badgeClass}`;
    }

    // 2. Bitrate value in Top Stage
    if (telemetryBitrateVal) {
      telemetryBitrateVal.textContent = activeBitrateText;
    }

    // 3. Real-time network speed in Top Stage
    if (telemetrySpeedVal) {
      telemetrySpeedVal.textContent = activeSpeedText;
    }

    // 4. Accumulated session data in Top Stage
    if (telemetryDataVal) {
      telemetryDataVal.textContent = activeDataText;
    }

    // 5. Codec Badge in Top Stage
    const codecEl = document.getElementById('active-station-codec-badge');
    if (codecEl) {
      codecEl.textContent = currentCodec || fmt.codec;
      codecEl.className = `format-badge ${fmt.badgeClass}`;
    }

    // 6. Active Station Bitrate Badge in Top Stage
    const bitrateBadgeEl = document.getElementById('active-station-bitrate-badge');
    if (bitrateBadgeEl) {
      bitrateBadgeEl.textContent = activeBitrateText;
    }

    // 7. Visualizer Stats overlay
    if (visualizerStatsText) {
      visualizerStatsText.textContent = `SPECTRUM ANALYZER • ${fmt.ext} ${activeBitrateText} • RED: ${activeSpeedText}`;
    }

    // 8. Bottom Player Bar elements
    if (bottomBarFormatBadge) {
      bottomBarFormatBadge.textContent = fmt.ext;
      bottomBarFormatBadge.className = `format-badge ${fmt.badgeClass}`;
    }

    if (bottomBarBitrateBadge) {
      bottomBarBitrateBadge.textContent = activeBitrateText;
    }

    if (bottomBarTelemetry) {
      bottomBarTelemetry.textContent = `VEL: ${activeSpeedText} • RED: ${activeDataText}`;
    }
  }

  async function probeStreamTelemetry(targetUrl) {
    if (!targetUrl) return;
    if (probeAbortController) {
      probeAbortController.abort();
      probeAbortController = null;
    }

    probeAbortController = new AbortController();
    const probeUrl = `/api/radio-proxy?probe=1&url=${encodeURIComponent(targetUrl)}`;

    try {
      const res = await fetch(probeUrl, { signal: probeAbortController.signal });
      if (res.ok) {
        const data = await res.json();
        if (data.bitrate) {
          currentBitrateKbps = data.bitrate;
          networkSpeedBytesPerSec = Math.round((data.bitrate * 1000) / 8);
        }
        if (data.codec) {
          currentCodec = data.codec;
        }
        updateTelemetryDisplay();
        renderStations();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Bitrate probe warning:', err);
      }
    }
  }

  function startTelemetryLoop() {
    if (telemetryTimer) clearInterval(telemetryTimer);

    telemetryTimer = setInterval(() => {
      if (isPlaying) {
        const fmt = detectStreamFormat(currentStation ? currentStation.url : '');
        const br = currentBitrateKbps || fmt.defaultBitrate;
        const bytesThisSec = Math.round((br * 1000) / 8);
        sessionTotalBytes += bytesThisSec;
        networkSpeedBytesPerSec = bytesThisSec;
        updateTelemetryDisplay();
      }
    }, 1000);
  }

  // =========================================================================
  // AUDIO CONTROLLER & HLS
  // =========================================================================
  function getPlayableUrl(rawUrl) {
    if (!rawUrl) return '';
    const trimmed = rawUrl.trim();
    // If proxy forced or if the stream is insecure HTTP on an HTTPS page
    const isHttpsPage = window.location.protocol === 'https:';
    const isHttpStream = trimmed.startsWith('http://');

    if (useProxyForced || (isHttpsPage && isHttpStream)) {
      return `/api/radio-proxy?url=${encodeURIComponent(trimmed)}`;
    }
    return trimmed;
  }

  function playStation(station, forceProxy = false) {
    if (!station) return;
    currentStation = station;

    // Reset current audio/HLS
    if (hls) {
      hls.destroy();
      hls = null;
    }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();

    const fmt = detectStreamFormat(station.url);
    currentFormat = fmt.ext;
    currentCodec = fmt.codec;
    currentBitrateKbps = null;
    networkSpeedBytesPerSec = Math.round((fmt.defaultBitrate * 1000) / 8);

    const isM3U8 = fmt.ext === 'M3U8';

    updateTunerDisplay(station);
    setBufferingState(true);

    let streamUrl = getPlayableUrl(station.url);
    if (forceProxy && !streamUrl.startsWith('/api/radio-proxy')) {
      streamUrl = `/api/radio-proxy?url=${encodeURIComponent(station.url)}`;
    }

    if (isM3U8 && window.Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(audio);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setupAudioContext();
        audio.play().catch(handlePlayError);
      });

      hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
        if (hls && hls.levels && hls.levels[hls.currentLevel]) {
          const lvl = hls.levels[hls.currentLevel];
          if (lvl.bitrate) {
            currentBitrateKbps = Math.round(lvl.bitrate / 1000);
            networkSpeedBytesPerSec = Math.round(lvl.bitrate / 8);
          }
        }
        currentCodec = 'HLS / AAC';
        updateTelemetryDisplay();
        renderStations();
      });

      hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        if (data && data.frag && data.frag.loaded) {
          sessionTotalBytes += data.frag.loaded;
          if (data.stats && data.stats.bwEstimate) {
            networkSpeedBytesPerSec = Math.round(data.stats.bwEstimate / 8);
          }
          updateTelemetryDisplay();
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('[Hls.js Fatal Error]', data);
          if (!forceProxy) {
            console.log('[Hls.js] Retrying with Cloudflare Radio Proxy...');
            playStation(station, true);
          } else {
            setBufferingState(false);
            showToast('Error cargando stream HLS. Servidor no disponible.');
          }
        }
      });
    } else {
      // Standard MP3 / AAC / Icecast audio stream or Safari Native HLS
      audio.src = streamUrl;
      setupAudioContext();
      audio.play().catch((err) => {
        console.warn('Direct play error:', err);
        if (!forceProxy) {
          console.log('Retrying stream with Radio Proxy...');
          playStation(station, true);
        } else {
          handlePlayError(err);
        }
      });

      // Probe stream telemetry (real bitrate, server icy headers, audio codec)
      probeStreamTelemetry(station.url);
    }

    updateMediaSession(station);
    renderStations();
  }

  function togglePlayPause() {
    if (!currentStation) {
      const first = stations[0];
      if (first) playStation(first);
      return;
    }

    if (isPlaying) {
      audio.pause();
      if (hls) hls.stopLoad();
      setPlayingState(false);
    } else {
      setBufferingState(true);
      if (hls) hls.startLoad();
      audio.play().catch(handlePlayError);
    }
  }

  function handlePlayError(err) {
    setBufferingState(false);
    setPlayingState(false);
    console.error('Audio playback failed:', err);
    showToast('No se pudo reproducir el stream. Intenta activando el Proxy.');
  }

  function setPlayingState(playing) {
    isPlaying = playing;
    isBuffering = false;
    if (playIcon && pauseIcon) {
      playIcon.style.display = playing ? 'none' : 'block';
      pauseIcon.style.display = playing ? 'block' : 'none';
    }
    if (nowPlayingStatus) {
      nowPlayingStatus.innerHTML = playing ? '<span class="pulse-led"></span> EN VIVO' : 'PAUSADO';
    }
    if (playing) {
      const fmt = detectStreamFormat(currentStation ? currentStation.url : '');
      const br = currentBitrateKbps || fmt.defaultBitrate;
      networkSpeedBytesPerSec = Math.round((br * 1000) / 8);
    } else {
      networkSpeedBytesPerSec = 0;
    }
    updateTelemetryDisplay();
    renderStations();
  }

  function setBufferingState(buffering) {
    isBuffering = buffering;
    if (buffering && nowPlayingStatus) {
      nowPlayingStatus.innerHTML = '<span class="pulse-led" style="background:#f59e0b;box-shadow:0 0 10px #f59e0b;"></span> CONECTANDO...';
    }
  }

  // Audio Element Events
  audio.addEventListener('playing', () => {
    setPlayingState(true);
  });

  audio.addEventListener('pause', () => {
    setPlayingState(false);
  });

  audio.addEventListener('waiting', () => {
    setBufferingState(true);
  });

  audio.addEventListener('error', (e) => {
    console.warn('HTML5 Audio Error:', e);
    if (currentStation && !useProxyForced) {
      console.log('Switching to proxy after audio error...');
      playStation(currentStation, true);
    } else {
      setBufferingState(false);
      setPlayingState(false);
      showToast('Error de conexión con la emisora.');
    }
  });

  // =========================================================================
  // WEB AUDIO API & REALTIME SPECTRUM VISUALIZER
  // =========================================================================
  function setupAudioContext() {
    if (isAudioContextConnected) return;

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!audioCtx) {
        audioCtx = new AudioCtxClass();
      }

      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;

      sourceNode = audioCtx.createMediaElementSource(audio);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);

      isAudioContextConnected = true;
    } catch (e) {
      // If CORS blocks MediaElementAudioSource, we will use synthetic frequency visualization
      console.log('Web Audio context connected with synthetic fallback fallback available.');
    }
  }

  function startVisualizer() {
    if (!canvas || !canvasCtx) return;

    const bufferLength = analyser ? analyser.frequencyBinCount : 32;
    const dataArray = new Uint8Array(bufferLength);

    function renderFrame() {
      animFrameId = requestAnimationFrame(renderFrame);

      const width = canvas.width;
      const height = canvas.height;

      canvasCtx.clearRect(0, 0, width, height);

      // Grid background line
      canvasCtx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
      canvasCtx.lineWidth = 1;
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, height / 2);
      canvasCtx.lineTo(width, height / 2);
      canvasCtx.stroke();

      if (isPlaying) {
        let hasData = false;

        if (analyser && isAudioContextConnected) {
          analyser.getByteFrequencyData(dataArray);
          for (let i = 0; i < bufferLength; i++) {
            if (dataArray[i] > 0) {
              hasData = true;
              break;
            }
          }
        }

        // Draw frequency bars
        const barCount = 42;
        const barWidth = (width / barCount) - 2;
        let x = 0;

        for (let i = 0; i < barCount; i++) {
          let barHeight = 0;

          if (hasData) {
            const dataIndex = Math.floor(i * (bufferLength / barCount));
            barHeight = (dataArray[dataIndex] / 255) * (height - 15);
          } else {
            // Synthetic wave animation when stream has no CORS permissions for raw PCM
            const time = Date.now() * 0.003;
            const wave = Math.sin(time + i * 0.25) * 0.5 + 0.5;
            const wave2 = Math.cos(time * 0.7 + i * 0.15) * 0.5 + 0.5;
            barHeight = ((wave * 0.6 + wave2 * 0.4)) * (height - 20) + 4;
          }

          // Gradient for bars (Cyan -> Violet)
          const grad = canvasCtx.createLinearGradient(0, height, 0, 0);
          grad.addColorStop(0, '#00f0ff');
          grad.addColorStop(0.7, '#38bdf8');
          grad.addColorStop(1, '#a855f7');

          canvasCtx.fillStyle = grad;
          canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);

          // Glowing cap dot
          canvasCtx.fillStyle = '#ffffff';
          canvasCtx.fillRect(x, height - barHeight - 2, barWidth, 2);

          x += barWidth + 2;
        }
      } else {
        // Idle flat baseline
        canvasCtx.fillStyle = 'rgba(56, 189, 248, 0.2)';
        canvasCtx.fillRect(0, height - 3, width, 2);
      }
    }

    renderFrame();
  }

  // =========================================================================
  // MEDIA SESSION API (Lockscreen Controls)
  // =========================================================================
  function updateMediaSession(station) {
    if ('mediaSession' in navigator && station) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: station.name,
        artist: 'Alexis Radio // ' + (station.genre || 'En Vivo'),
        album: station.freq || 'Online Stream',
        artwork: [
          { src: station.logo || '/tv-icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: station.logo || '/tv-icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevStation());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNextStation());
    }
  }

  function playNextStation() {
    if (!stations.length) return;
    const currentIndex = stations.findIndex(s => s.id === (currentStation ? currentStation.id : ''));
    const nextIndex = (currentIndex + 1) % stations.length;
    playStation(stations[nextIndex]);
  }

  function playPrevStation() {
    if (!stations.length) return;
    const currentIndex = stations.findIndex(s => s.id === (currentStation ? currentStation.id : ''));
    const prevIndex = (currentIndex - 1 + stations.length) % stations.length;
    playStation(stations[prevIndex]);
  }

  // =========================================================================
  // TUNER UI UPDATER
  // =========================================================================
  function updateTunerDisplay(station) {
    if (!station) return;
    const fallback = getStationFallbackSvg(station.name, station.genre);

    // Top Stage Updates
    if (activeStationName) activeStationName.textContent = station.name;
    if (activeStationFreq) activeStationFreq.innerHTML = `<span>●</span> ${station.freq || 'WEB STREAM'}`;
    const genreTextEl = document.getElementById('active-station-genre-text');
    if (genreTextEl) {
      genreTextEl.textContent = station.genre || 'General';
    }
    if (activeStationLogo) {
      activeStationLogo.src = station.logo || fallback;
      activeStationLogo.onerror = () => { activeStationLogo.src = fallback; };
      activeStationLogo.alt = station.name;
    }

    // Bottom Player Bar Updates
    if (bottomBarLogo) {
      bottomBarLogo.src = station.logo || fallback;
      bottomBarLogo.onerror = () => { bottomBarLogo.src = fallback; };
      bottomBarLogo.alt = station.name;
    }
    if (bottomBarName) {
      bottomBarName.textContent = station.name;
    }
    if (bottomBarFreq) {
      bottomBarFreq.textContent = station.freq || station.genre || 'WEB STREAM';
    }

    updateTelemetryDisplay();
  }

  // =========================================================================
  // STATIONS GRID RENDERING
  // =========================================================================
  function renderStations() {
    if (!stationsGrid) return;

    let filtered = stations.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(searchQuery) ||
                          (s.genre && s.genre.toLowerCase().includes(searchQuery)) ||
                          (s.freq && s.freq.toLowerCase().includes(searchQuery));
      if (!matchSearch) return false;

      if (activeFilter === 'all') return true;
      if (activeFilter === 'starred') return s.isStarred;
      return (s.genre || '').toLowerCase().includes(activeFilter.toLowerCase());
    });

    if (stationCountDisplay) {
      stationCountDisplay.textContent = `${filtered.length} de ${stations.length} emisoras`;
    }

    if (!filtered.length) {
      stationsGrid.innerHTML = `
        <div class="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <p>No se encontraron emisoras que coincidan con la búsqueda o filtro.</p>
          <button class="btn btn-primary" id="reset-filter-btn">Restablecer Filtros</button>
        </div>
      `;
      const resetBtn = document.getElementById('reset-filter-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          activeFilter = 'all';
          searchQuery = '';
          if (searchInput) searchInput.value = '';
          updateCategoryPills();
          renderStations();
        });
      }
      return;
    }

    stationsGrid.innerHTML = filtered.map(s => {
      const isCurrent = currentStation && currentStation.id === s.id;
      const isCardPlaying = isCurrent && isPlaying;
      const fallbackLogo = getStationFallbackSvg(s.name, s.genre);
      const sFmt = detectStreamFormat(s.url);

      return `
        <div class="station-card ${isCardPlaying ? 'playing' : ''}" data-station-id="${s.id}">
          <div class="station-card-logo-wrap">
            <img class="station-card-img" src="${s.logo || fallbackLogo}" alt="${s.name}" onerror="this.src='${fallbackLogo}'" loading="lazy">
            <div class="playing-badge-indicator">
              <div class="mini-eq">
                <span></span><span></span><span></span><span></span>
              </div>
            </div>
          </div>

          <div class="station-card-content">
            <div class="station-card-name" title="${s.name}">${s.name}</div>
            <div class="station-card-meta">
              <span class="badge-tag">${s.freq || 'WEB'}</span>
              <span class="badge-tag">${s.genre || 'Música'}</span>
              <span class="badge-tag ${sFmt.badgeClass}">${sFmt.ext}</span>
              ${isCurrent && currentBitrateKbps ? `<span class="badge-tag highlight-bitrate">${currentBitrateKbps} kbps</span>` : ''}
            </div>
          </div>

          <div class="station-card-actions">
            <button class="card-action-btn star-btn ${s.isStarred ? 'starred' : ''}" data-action="star" title="Favorita">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="${s.isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            </button>
            <button class="card-action-btn edit-btn" data-action="edit" title="Editar emisora">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="card-action-btn delete-btn" data-action="delete" title="Eliminar emisora">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Grid Click Delegator
  if (stationsGrid) {
    stationsGrid.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('.card-action-btn');
      const card = e.target.closest('.station-card');
      if (!card) return;

      const stationId = card.getAttribute('data-station-id');
      const station = stations.find(s => s.id === stationId);
      if (!station) return;

      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.getAttribute('data-action');

        if (action === 'star') {
          station.isStarred = !station.isStarred;
          saveStations();
          renderStations();
          showToast(station.isStarred ? `Añadida a favoritas: ${station.name}` : `Eliminada de favoritas`);
        } else if (action === 'edit') {
          openEditStationModal(station);
        } else if (action === 'delete') {
          if (confirm(`¿Eliminar la emisora "${station.name}"?`)) {
            stations = stations.filter(s => s.id !== stationId);
            saveStations();
            if (currentStation && currentStation.id === stationId) {
              audio.pause();
              setPlayingState(false);
            }
            renderStations();
            showToast('Emisora eliminada');
          }
        }
        return;
      }

      // Card Body clicked: Play/Pause station
      if (currentStation && currentStation.id === station.id && isPlaying) {
        togglePlayPause();
      } else {
        playStation(station);
      }
    });
  }

  // =========================================================================
  // CATEGORIES & SEARCH
  // =========================================================================
  function updateCategoryPills() {
    const pills = document.querySelectorAll('.cat-pill');
    pills.forEach(p => {
      if (p.getAttribute('data-category') === activeFilter) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });
  }

  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      activeFilter = pill.getAttribute('data-category') || 'all';
      updateCategoryPills();
      renderStations();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = (e.target.value || '').trim().toLowerCase();
      renderStations();
    });
  }

  if (resetDefaultsBtn) {
    resetDefaultsBtn.addEventListener('click', () => {
      if (confirm('¿Deseas restaurar las emisoras predeterminadas? Se volverán a añadir las emisoras originales sin borrar las que hayas creado.')) {
        let addedCount = 0;
        DEFAULT_STATIONS.forEach(defStation => {
          if (!stations.some(s => s.id === defStation.id || s.name.toLowerCase() === defStation.name.toLowerCase())) {
            stations.push({ ...defStation });
            addedCount++;
          }
        });
        saveStations();
        renderStations();
        showToast(addedCount > 0 ? `Se restauraron ${addedCount} emisoras predeterminadas.` : 'Todas las emisoras predeterminadas ya están presentes.');
      }
    });
  }

  // =========================================================================
  // CONTROLS & EVENTS (Play, Prev, Next, Volume, Sleep, Proxy)
  // =========================================================================
  if (playBtn) playBtn.addEventListener('click', togglePlayPause);
  if (nextBtn) nextBtn.addEventListener('click', playNextStation);
  if (prevBtn) prevBtn.addEventListener('click', playPrevStation);

  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      audio.volume = vol;
      localStorage.setItem('at_radio_volume', vol);
      if (vol === 0) {
        audio.muted = true;
      } else {
        audio.muted = false;
      }
    });

    const savedVol = localStorage.getItem('at_radio_volume');
    if (savedVol !== null) {
      audio.volume = parseFloat(savedVol);
      volumeSlider.value = savedVol;
    }
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      audio.muted = !audio.muted;
      muteBtn.style.color = audio.muted ? 'var(--accent-red)' : 'var(--text-muted)';
      showToast(audio.muted ? 'Silenciado' : 'Sonido activado');
    });
  }

  if (proxyToggleBtn) {
    proxyToggleBtn.addEventListener('click', () => {
      useProxyForced = !useProxyForced;
      proxyToggleBtn.classList.toggle('active', useProxyForced);
      showToast(useProxyForced ? 'Cloudflare Proxy activado (Mayor compatibilidad)' : 'Modo Directo activado');
      if (currentStation && isPlaying) {
        playStation(currentStation, useProxyForced);
      }
    });
  }

  // Sleep Timer
  if (sleepTimerBtn) {
    sleepTimerBtn.addEventListener('click', () => {
      const modal = document.getElementById('sleep-modal');
      if (modal) modal.classList.add('open');
    });
  }

  function setSleepTimer(minutes) {
    if (sleepTimerId) {
      clearTimeout(sleepTimerId);
      sleepTimerId = null;
    }

    if (minutes <= 0) {
      sleepTimerEnd = null;
      if (sleepBadge) sleepBadge.textContent = '';
      if (sleepTimerBtn) sleepTimerBtn.classList.remove('active');
      showToast('Temporizador desactivado');
      return;
    }

    sleepTimerEnd = Date.now() + minutes * 60 * 1000;
    if (sleepBadge) sleepBadge.textContent = `${minutes}m`;
    if (sleepTimerBtn) sleepTimerBtn.classList.add('active');

    sleepTimerId = setTimeout(() => {
      // Smooth fade out
      const fadeInterval = setInterval(() => {
        if (audio.volume > 0.05) {
          audio.volume -= 0.05;
        } else {
          clearInterval(fadeInterval);
          audio.pause();
          setPlayingState(false);
          audio.volume = parseFloat(localStorage.getItem('at_radio_volume') || '1');
          if (sleepBadge) sleepBadge.textContent = '';
          if (sleepTimerBtn) sleepTimerBtn.classList.remove('active');
          showToast('Temporizador: Radio apagada');
        }
      }, 200);
    }, minutes * 60 * 1000);

    showToast(`Radio se apagará en ${minutes} minutos`);
  }

  // =========================================================================
  // M3U PARSER & PLAYLIST IMPORTER / EXPORTER
  // =========================================================================
  function parseM3UContent(text) {
    const lines = text.split(/\r?\n/);
    const parsedStations = [];
    let currentItem = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        // Parse metadata: tvg-logo, group-title, station title
        const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
        const groupMatch = line.match(/group-title="([^"]+)"/i);

        // Name is after the last comma
        const commaIdx = line.lastIndexOf(',');
        let name = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : 'Emisora M3U';

        currentItem = {
          name: name || 'Emisora M3U',
          logo: logoMatch ? logoMatch[1] : '',
          genre: groupMatch ? groupMatch[1] : 'Música'
        };
      } else if (!line.startsWith('#')) {
        // URL line
        if (line.startsWith('http://') || line.startsWith('https://')) {
          const stationName = currentItem ? currentItem.name : `Emisora ${parsedStations.length + 1}`;
          parsedStations.push({
            id: 'm3u-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
            name: stationName,
            url: line,
            genre: currentItem ? currentItem.genre : 'Importada',
            logo: currentItem ? currentItem.logo : '',
            freq: 'M3U STREAM',
            isDefault: false
          });
        }
        currentItem = null;
      }
    }

    return parsedStations;
  }

  function exportM3U() {
    let m3u = '#EXTM3U\n';
    stations.forEach(s => {
      m3u += `#EXTINF:-1 tvg-logo="${s.logo || ''}" group-title="${s.genre || 'Música'}",${s.name}\n${s.url}\n`;
    });

    const blob = new Blob([m3u], { type: 'audio/x-mpegurl;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alexis-radio-playlist.m3u';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Lista M3U descargada con éxito');
  }

  function exportJSONBackup() {
    const blob = new Blob([JSON.stringify(stations, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alexis-radio-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Copia de seguridad descargada');
  }

  // =========================================================================
  // MODALS LOGIC (Add/Edit, M3U Import/Export, Sleep Timer)
  // =========================================================================
  const addModal = document.getElementById('add-station-modal');
  const addForm = document.getElementById('add-station-form');
  const m3uModal = document.getElementById('m3u-modal');
  const sleepModal = document.getElementById('sleep-modal');

  // Open Add Modal
  const openAddBtn = document.getElementById('add-station-btn');
  if (openAddBtn) {
    openAddBtn.addEventListener('click', () => {
      if (addForm) addForm.reset();
      document.getElementById('station-modal-id').value = '';
      document.getElementById('station-modal-title').textContent = 'Añadir Nueva Emisora';
      if (addModal) addModal.classList.add('open');
    });
  }

  // Open Edit Modal
  function openEditStationModal(station) {
    if (!station || !addModal) return;
    document.getElementById('station-modal-title').textContent = 'Editar Emisora';
    document.getElementById('station-modal-id').value = station.id;
    document.getElementById('station-input-name').value = station.name;
    document.getElementById('station-input-url').value = station.url;
    document.getElementById('station-input-genre').value = station.genre || 'Música';
    document.getElementById('station-input-freq').value = station.freq || '';
    document.getElementById('station-input-logo').value = station.logo || '';
    addModal.classList.add('open');
  }

  // Save Station Form Submit
  if (addForm) {
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('station-modal-id').value;
      const name = document.getElementById('station-input-name').value.trim();
      const url = document.getElementById('station-input-url').value.trim();
      const genre = document.getElementById('station-input-genre').value.trim() || 'Música';
      const freq = document.getElementById('station-input-freq').value.trim() || 'WEB STREAM';
      const logo = document.getElementById('station-input-logo').value.trim();

      if (!name || !url) {
        alert('Por favor introduce el nombre y la URL del stream.');
        return;
      }

      if (id) {
        // Edit existing
        const idx = stations.findIndex(s => s.id === id);
        if (idx !== -1) {
          stations[idx].name = name;
          stations[idx].url = url;
          stations[idx].genre = genre;
          stations[idx].freq = freq;
          stations[idx].logo = logo;
          if (currentStation && currentStation.id === id) {
            currentStation = stations[idx];
            updateTunerDisplay(currentStation);
          }
          showToast('Emisora actualizada');
        }
      } else {
        // Add new station
        const newStation = {
          id: 'custom-' + Date.now(),
          name,
          url,
          genre,
          freq,
          logo,
          isDefault: false
        };
        stations.unshift(newStation);
        showToast('Emisora agregada con éxito');
      }

      saveStations();
      renderStations();
      addModal.classList.remove('open');
    });
  }

  // Open M3U Import/Export Modal
  const openM3uBtn = document.getElementById('m3u-manager-btn');
  if (openM3uBtn) {
    openM3uBtn.addEventListener('click', () => {
      if (m3uModal) m3uModal.classList.add('open');
    });
  }

  // Import M3U Actions
  const m3uTextInput = document.getElementById('m3u-text-input');
  const parseM3uTextBtn = document.getElementById('parse-m3u-text-btn');
  if (parseM3uTextBtn && m3uTextInput) {
    parseM3uTextBtn.addEventListener('click', () => {
      const text = m3uTextInput.value.trim();
      if (!text) {
        alert('Pega el contenido o la URL de la lista M3U.');
        return;
      }

      if (text.startsWith('http://') || text.startsWith('https://')) {
        // Remote URL fetch through radio-proxy
        showToast('Descargando lista remota...');
        fetch(`/api/radio-proxy?url=${encodeURIComponent(text)}`)
          .then(res => res.text())
          .then(remoteText => {
            const imported = parseM3UContent(remoteText);
            if (imported.length > 0) {
              stations = [...imported, ...stations];
              saveStations();
              renderStations();
              m3uModal.classList.remove('open');
              m3uTextInput.value = '';
              showToast(`¡Se importaron ${imported.length} emisoras con éxito!`);
            } else {
              alert('No se encontraron canales de audio válidos en la lista M3U.');
            }
          })
          .catch(err => {
            alert('Error al descargar la lista remota: ' + err.message);
          });
      } else {
        // Direct text paste
        const imported = parseM3UContent(text);
        if (imported.length > 0) {
          stations = [...imported, ...stations];
          saveStations();
          renderStations();
          m3uModal.classList.remove('open');
          m3uTextInput.value = '';
          showToast(`¡Se importaron ${imported.length} emisoras con éxito!`);
        } else {
          alert('No se pudieron extraer emisoras del texto M3U introducido.');
        }
      }
    });
  }

  // File Upload M3U
  const m3uFileInput = document.getElementById('m3u-file-input');
  if (m3uFileInput) {
    m3uFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        const imported = parseM3UContent(content);
        if (imported.length > 0) {
          stations = [...imported, ...stations];
          saveStations();
          renderStations();
          m3uModal.classList.remove('open');
          showToast(`¡Se importaron ${imported.length} emisoras desde archivo!`);
        } else {
          alert('No se encontraron canales válidos en el archivo M3U.');
        }
      };
      reader.readAsText(file);
    });
  }

  // Export Buttons
  const exportM3uBtn = document.getElementById('export-m3u-btn');
  if (exportM3uBtn) exportM3uBtn.addEventListener('click', exportM3U);

  const exportJsonBtn = document.getElementById('export-json-btn');
  if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportJSONBackup);

  // Sleep Options Buttons
  document.querySelectorAll('.sleep-opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.getAttribute('data-minutes'), 10);
      setSleepTimer(mins);
      if (sleepModal) sleepModal.classList.remove('open');
    });
  });

  // Close modals on Backdrop or X click
  document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.remove('open');
    });
  });

  // Modal Tabs
  document.querySelectorAll('.modal-tabs .tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
      const parent = tab.closest('.modal-dialog');
      const tabTarget = tab.getAttribute('data-tab');

      parent.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      parent.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

      tab.classList.add('active');
      const activePane = parent.querySelector(`.tab-pane[data-pane="${tabTarget}"]`);
      if (activePane) activePane.style.display = 'block';
    });
  });

  // Theme Toggle
  const themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('at_theme', next);
    });
  }

  // =========================================================================
  // TOAST NOTIFICATIONS
  // =========================================================================
  function showToast(msg) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
      <span>${msg}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  // Service Worker Register
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/radio-sw.js').catch(err => {
        console.warn('Radio SW registration failed:', err);
      });
    });
  }

  // Window Resize Visualizer Fix
  function resizeCanvas() {
    if (canvas) {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
    }
  }
  window.addEventListener('resize', resizeCanvas);

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    initStorage();
    if (stations.length > 0) {
      currentStation = stations[0];
      updateTunerDisplay(currentStation);
    }
    renderStations();
    resizeCanvas();
    startVisualizer();
    startTelemetryLoop();
    updateTelemetryDisplay();
  });

})();
