/**
 * ALEXIS RADIO — Core Audio Engine & State Manager
 * Features: HLS (m3u8), MP3, AAC, Shoutcast/Icecast, M3U parser, Audio Visualizer, PWA, Proxying
 */

(function () {
  'use strict';

  // Default Curated Stations
  function getStationFallbackSvg(name, genre) {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const initials = ((name || 'RA').split(' ').filter(Boolean).map(w => w[0]).join('') + 'RA').replace(/[^A-Za-z0-9]/g, '').substring(0, 2).toUpperCase() || 'RA';
    let color = isLight ? '#0284c7' : '#00f0ff';
    if (genre === 'Noticias') color = isLight ? '#0284c7' : '#38bdf8';
    else if (genre === 'Rock') color = isLight ? '#dc2626' : '#ef4444';
    else if (genre === 'Electrónica') color = isLight ? '#7c3aed' : '#a855f7';
    else if (genre === 'Lofi / Chill') color = isLight ? '#059669' : '#10b981';
    else if (genre === 'Cultura') color = isLight ? '#d97706' : '#f59e0b';

    const bgFill = isLight ? '%23f1f5f9' : '%23080f24';
    const strokeColor = encodeURIComponent(color);
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='${bgFill}' stroke='${strokeColor}' stroke-width='3.5'/%3E%3Ctext x='50' y='62' font-family='monospace' font-weight='800' font-size='36' fill='${strokeColor}' text-anchor='middle'%3E${initials}%3C/text%3E%3C/svg%3E`;
  }

  // Escape para HTML (evita XSS almacenado vía emisoras sincronizadas/importadas)
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // Evita sobreimprimir insignias sobre el logo cuando el nombre ya incluye la ciudad/variante
  function getStationVariantBadge(name) {
    // Las emisoras ya indican su ciudad en su nombre ('La Mega Montería', 'Mix Manizales', etc.)
    // Evitamos cubrir el logo y el texto del arte con badges repetitivos
    return null;
  }

  // Genera un tono HSL estable y único basado en el hash del nombre de la emisora
  function getStationHue(name) {
    let hash = 0;
    const str = name || '';
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const hues = [190, 215, 255, 280, 315, 340, 160, 35, 140];
    return hues[Math.abs(hash) % hues.length];
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
  let isInitialStationLoad = true;

  // Station Sorting State ('added', 'alpha-asc', 'alpha-desc')
  let currentSortOrder = localStorage.getItem('at_radio_sort_order') || 'added';
  if (!['added', 'alpha-asc', 'alpha-desc'].includes(currentSortOrder)) {
    currentSortOrder = 'added';
  }

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

  // Playback Request Lifecycle State (prevents infinite error loops & frozen buffering)
  let currentPlaybackToken = 0;
  let hasAttemptedProxyForCurrent = false;
  let connectionTimeoutTimer = null;

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
  const sortOrderSelect = document.getElementById('sort-order-select');
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
  const bottomPlayerBar = document.getElementById('bottom-player-bar');
  const bottomBarLogo = document.getElementById('bottom-bar-logo');
  const bottomBarName = document.getElementById('bottom-bar-name');
  const bottomBarFreq = document.getElementById('bottom-bar-freq');
  const bottomBarFormatBadge = document.getElementById('bottom-bar-format-badge');
  const bottomBarBitrateBadge = document.getElementById('bottom-bar-bitrate-badge');
  const bottomBarTelemetry = document.getElementById('bottom-bar-telemetry');
  const bottomBarExpandBtn = document.getElementById('bottom-bar-expand-btn');
  const bottomBarLeft = document.getElementById('bottom-bar-left');
  const fullscreenPlayerBtn = document.getElementById('fullscreen-player-btn');
  const playerRetryBtn = document.getElementById('player-retry-btn');

  // Fullscreen Player Overlay Elements
  const fsOverlay = document.getElementById('fullscreen-player-overlay');
  const fsAmbientGlow = document.getElementById('fs-ambient-glow');
  const fsDragHandle = document.getElementById('fs-drag-handle');
  const fsCloseBtn = document.getElementById('fs-close-btn');
  const fsPulseLed = document.getElementById('fs-pulse-led');
  const fsStatusText = document.getElementById('fs-status-text');
  const fsStarBtn = document.getElementById('fs-star-btn');
  const fsStarIcon = document.getElementById('fs-star-icon');
  const fsBrowserFsBtn = document.getElementById('fs-browser-fullscreen-btn');
  const fsBrowserFsIconExpand = document.getElementById('fs-browser-fs-icon-expand');
  const fsBrowserFsIconCompress = document.getElementById('fs-browser-fs-icon-compress');
  const fsStationLogo = document.getElementById('fs-station-logo');
  const fsStationGenre = document.getElementById('fs-station-genre');
  const fsStationFreq = document.getElementById('fs-station-freq');
  const fsStationFormatBadge = document.getElementById('fs-station-format-badge');
  const fsStationBitrateBadge = document.getElementById('fs-station-bitrate-badge');
  const fsStationName = document.getElementById('fs-station-name');
  const fsCanvas = document.getElementById('fs-visualizer-canvas');
  const fsCanvasCtx = fsCanvas ? fsCanvas.getContext('2d') : null;
  const fsTelemetrySpeed = document.getElementById('fs-telemetry-speed');
  const fsTelemetryData = document.getElementById('fs-telemetry-data');
  const fsProxyIndicator = document.getElementById('fs-proxy-indicator');
  const fsSleepBtn = document.getElementById('fs-sleep-btn');
  const fsSleepBadge = document.getElementById('fs-sleep-badge');
  const fsProxyBtn = document.getElementById('fs-proxy-btn');
  const fsPrevBtn = document.getElementById('fs-prev-btn');
  const fsPlayBtn = document.getElementById('fs-play-btn');
  const fsPlayIcon = document.getElementById('fs-play-icon');
  const fsPauseIcon = document.getElementById('fs-pause-icon');
  const fsNextBtn = document.getElementById('fs-next-btn');
  const fsMuteBtn = document.getElementById('fs-mute-btn');
  const fsVolumeSlider = document.getElementById('fs-volume-slider');
  const fsSongCard = document.getElementById('fs-song-card');
  const fsSongTitle = document.getElementById('fs-song-title');
  const fsSongArtist = document.getElementById('fs-song-artist');
  const fsAppleLink = document.getElementById('fs-apple-link');
  const fsRetryBtn = document.getElementById('fs-retry-btn');

  let isFullscreenPlayerOpen = false;

  // Real-Time Now Playing & Apple Music Metadata State
  let nowPlayingSong = null;
  let metadataPollingTimer = null;
  let isMetadataFetching = false;
  let consecutiveNoSongCount = 0;
  let lastSongTimestamp = 0;

  // =========================================================================
  // STORAGE & INITIALIZATION
  // =========================================================================
  function initStorage() {
    try {
      const saved = localStorage.getItem('at_radio_stations');
      const parsed = saved !== null ? JSON.parse(saved) : null;
      // JSON válido pero no-array (p. ej. "null" u objeto) rompería el render.
      if (Array.isArray(parsed)) {
        stations = parsed;
      } else {
        stations = [...DEFAULT_STATIONS];
        saveStations();
      }
    } catch (e) {
      console.warn('Error reading radio stations from storage:', e);
      stations = [...DEFAULT_STATIONS];
    }
  }

  let autoSyncDebounceTimer = null;
  function scheduleAutoSync() {
    if (typeof uploadStationsToCloud === 'function' && localStorage.getItem('at_radio_autosync') === 'true') {
      clearTimeout(autoSyncDebounceTimer);
      autoSyncDebounceTimer = setTimeout(() => {
        uploadStationsToCloud(true);
      }, 1200);
    }
  }

  function saveStations() {
    try {
      localStorage.setItem('at_radio_stations', JSON.stringify(stations));
    } catch (e) {
      console.error('Failed to save stations to localStorage:', e);
    }
    scheduleAutoSync();
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

  // Efficient in-place card state update (avoids destroying/recreating 40 DOM nodes & images)
  function updateCardPlayingState() {
    if (!stationsGrid) return;
    const cards = stationsGrid.querySelectorAll('.station-card');
    cards.forEach(card => {
      const sId = card.getAttribute('data-station-id');
      const isThisCard = currentStation && currentStation.id === sId;
      const shouldBePlaying = isThisCard && isPlaying;
      if (shouldBePlaying) {
        if (!card.classList.contains('playing')) card.classList.add('playing');
      } else {
        if (card.classList.contains('playing')) card.classList.remove('playing');
      }

      const brTag = card.querySelector('.highlight-bitrate');
      if (brTag) brTag.remove();
    });
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
      const bitrateParent = document.getElementById('sub-item-bitrate');
      if (activeBitrateText && activeBitrateText !== '-- kbps' && activeBitrateText !== '0 kbps') {
        bottomBarBitrateBadge.textContent = activeBitrateText;
        bottomBarBitrateBadge.style.display = 'inline-flex';
        if (bitrateParent) bitrateParent.style.display = 'inline-flex';
      } else {
        bottomBarBitrateBadge.style.display = 'none';
        if (bitrateParent) bitrateParent.style.display = 'none';
      }
    }

    if (bottomBarTelemetry) {
      bottomBarTelemetry.textContent = `VEL: ${activeSpeedText} • RED: ${activeDataText}`;
    }

    fitIslandSecondaryLine();

    // 9. Fullscreen Player elements
    if (fsTelemetrySpeed) {
      fsTelemetrySpeed.textContent = `VEL: ${activeSpeedText}`;
    }
    if (fsTelemetryData) {
      fsTelemetryData.textContent = `RED: ${activeDataText}`;
    }
    if (fsStationBitrateBadge) {
      if (activeBitrateText && activeBitrateText !== '-- kbps' && activeBitrateText !== '0 kbps') {
        fsStationBitrateBadge.textContent = activeBitrateText;
        fsStationBitrateBadge.style.display = 'inline-flex';
      } else {
        fsStationBitrateBadge.style.display = 'none';
      }
    }
    if (fsStationFormatBadge) {
      fsStationFormatBadge.textContent = fmt.ext;
      fsStationFormatBadge.className = `format-badge ${fmt.badgeClass}`;
    }
    if (fsProxyIndicator) {
      if (isPlaying) {
        fsProxyIndicator.textContent = useProxyForced ? 'PROXY ACTIVO' : 'DIRECTO';
        fsProxyIndicator.style.color = useProxyForced ? 'var(--accent-amber)' : 'var(--accent-cyan)';
        fsProxyIndicator.style.display = 'inline-block';
      } else {
        fsProxyIndicator.textContent = '';
        fsProxyIndicator.style.display = 'none';
      }
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
        updateCardPlayingState();
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
        // En segundo plano no tocar el DOM: menos wake-ups y sin jank al
        // volver (el marcador se refresca en el primer tick visible).
        if (!document.hidden) updateTelemetryDisplay();
      }
    }, 1000);
  }

  // Diagnóstico (tests E2E / soporte): estado de reproducción, ruta de audio
  // (¿el stream pasa por WebAudio?) y salud del pipeline.
  window.__radioDiag = () => {
    let sum = 0;
    if (analyser && audioCtx && audioCtx.state === 'running') {
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      for (let i = 0; i < buf.length; i++) sum += buf[i];
    }
    const sounding = isAudioElementSounding();
    const mode = !sounding ? 'PLANO' : (sum > 0 ? 'BARRAS' : 'ONDA');
    return {
      sounding,
      playing: isPlaying,
      buffering: isBuffering,
      paused: audio ? audio.paused : true,
      ended: audio ? audio.ended : false,
      ct: audio ? +audio.currentTime.toFixed(2) : 0,
      ready: audio ? audio.readyState : 0,
      src: (audio ? (audio.currentSrc || audio.src || '') : '').slice(0, 140),
      hls: !!hls,
      ctx: audioCtx ? audioCtx.state : null,
      analyserSum: sum,
      visualizerMode: mode,
      loopRunning: !!unifiedVisualizerRafId,
      station: currentStation ? currentStation.name : null
    };
  };

  window.__sampleVisualizer = (durationMs = 2000) => {
    return new Promise((resolve) => {
      const samples = [];
      const startTime = Date.now();
      const interval = setInterval(() => {
        let sum = 0;
        if (analyser && audioCtx && audioCtx.state === 'running') {
          const buf = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(buf);
          for (let i = 0; i < buf.length; i++) sum += buf[i];
        }
        const sounding = isAudioElementSounding();
        const mode = !sounding ? 'PLANO' : (sum > 0 ? 'BARRAS' : 'ONDA');
        samples.push({
          t: ((Date.now() - startTime) / 1000).toFixed(2) + 's',
          station: currentStation ? currentStation.name : 'none',
          format: currentFormat,
          sounding,
          isPlaying: isPlaying,
          paused: audio.paused,
          currentTime: Number(audio.currentTime.toFixed(2)),
          anim: !!unifiedVisualizerRafId,
          freqSum: sum,
          renderMode: mode
        });
        if (Date.now() - startTime >= durationMs) {
          clearInterval(interval);
          console.table(samples);
          const avgSum = samples.reduce((a, b) => a + b.freqSum, 0) / samples.length;
          const summary = {
            station: currentStation ? currentStation.name : 'none',
            format: currentFormat,
            sounding,
            isPlaying: isPlaying,
            audioPaused: audio.paused,
            currentTime: audio.currentTime,
            avgFrequencySum: Math.round(avgSum),
            visualizerMode: !sounding ? 'PLANO' : (avgSum > 0 ? 'BARRAS' : 'ONDA'),
            animFrameRunning: !!unifiedVisualizerRafId
          };
          console.log('[Diagnostic Summary]', summary);
          resolve(summary);
        }
      }, 100);
    });
  };

  window.__playStation = (station) => playStation(station);
  window.__addStation = (station) => {
    stations.unshift(station);
    saveStations();
    renderStations();
  };

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

  function updatePlayerStatus(state) {
    if (!nowPlayingStatus) return;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    if (state === 'playing') {
      if (playerRetryBtn) playerRetryBtn.style.display = 'none';
      nowPlayingStatus.className = 'bottom-bar-status status-playing';
      nowPlayingStatus.style.background = isLight ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.14)';
      nowPlayingStatus.style.borderColor = isLight ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.45)';
      nowPlayingStatus.style.color = '#ef4444';
      nowPlayingStatus.innerHTML = '<span class="pulse-led pulse-red" style="background:#ef4444;box-shadow:0 0 8px #ef4444;"></span> EN VIVO';
    } else if (state === 'buffering') {
      if (playerRetryBtn) playerRetryBtn.style.display = 'none';
      nowPlayingStatus.className = 'bottom-bar-status status-buffering';
      nowPlayingStatus.style.background = isLight ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.16)';
      nowPlayingStatus.style.borderColor = isLight ? 'rgba(245, 158, 11, 0.4)' : 'rgba(245, 158, 11, 0.45)';
      nowPlayingStatus.style.color = 'var(--accent-amber)';
      nowPlayingStatus.innerHTML = '<span class="pulse-led pulse-amber" style="background:#f59e0b;box-shadow:0 0 8px #f59e0b;"></span> CONECTANDO...';
    } else if (state === 'error' || state === 'retrying') {
      if (playerRetryBtn) playerRetryBtn.style.display = 'inline-flex';
      nowPlayingStatus.className = 'bottom-bar-status status-error';
      nowPlayingStatus.style.background = isLight ? 'rgba(249, 115, 22, 0.12)' : 'rgba(249, 115, 22, 0.16)';
      nowPlayingStatus.style.borderColor = isLight ? 'rgba(249, 115, 22, 0.4)' : 'rgba(249, 115, 22, 0.45)';
      nowPlayingStatus.style.color = '#f97316';
      const label = state === 'retrying' ? 'REINTENTANDO...' : 'ERROR';
      nowPlayingStatus.innerHTML = `<span class="pulse-led pulse-orange" style="background:#f97316;box-shadow:0 0 8px #f97316;"></span> ${label}`;
    } else if (state === 'paused') {
      if (playerRetryBtn) playerRetryBtn.style.display = 'none';
      nowPlayingStatus.className = 'bottom-bar-status status-paused';
      nowPlayingStatus.style.background = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)';
      nowPlayingStatus.style.borderColor = isLight ? 'rgba(0, 0, 0, 0.12)' : 'var(--border-color)';
      nowPlayingStatus.style.color = 'var(--text-muted)';
      nowPlayingStatus.innerHTML = '<span class="pulse-led pulse-gray" style="background:#64748b;box-shadow:none;"></span> PAUSADO';
    } else {
      // ready / idle
      if (playerRetryBtn) playerRetryBtn.style.display = 'none';
      nowPlayingStatus.className = 'bottom-bar-status status-ready';
      nowPlayingStatus.style.background = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)';
      nowPlayingStatus.style.borderColor = isLight ? 'rgba(0, 0, 0, 0.12)' : 'var(--border-color)';
      nowPlayingStatus.style.color = 'var(--text-muted)';
      nowPlayingStatus.innerHTML = '<span class="pulse-led pulse-gray" style="background:#64748b;box-shadow:none;"></span> LISTO';
    }

    // Sync Fullscreen Player Status
    const fsBadge = document.querySelector('.fs-header-badge');
    if (fsBadge) {
      fsBadge.classList.remove('status-playing', 'status-buffering', 'status-error', 'status-paused', 'status-ready');
      const badgeState = (state === 'retrying' || state === 'error') ? 'error' : state;
      fsBadge.classList.add(`status-${badgeState}`);
    }

    if (fsStatusText && fsPulseLed) {
      if (state === 'playing') {
        fsStatusText.textContent = 'EN VIVO';
        fsPulseLed.className = 'pulse-led pulse-red';
        fsPulseLed.style.background = '#ef4444';
        fsPulseLed.style.boxShadow = '0 0 10px #ef4444';
        if (fsRetryBtn) fsRetryBtn.style.display = 'none';
        if (fsSongCard) {
          const eqBars = fsSongCard.querySelector('.fs-song-eq-bars');
          if (eqBars) eqBars.style.display = 'inline-flex';
        }
        if (isFullscreenPlayerOpen) startFsVisualizer();
      } else if (state === 'buffering') {
        fsStatusText.textContent = 'CONECTANDO...';
        fsPulseLed.className = 'pulse-led pulse-amber';
        fsPulseLed.style.background = '#f59e0b';
        fsPulseLed.style.boxShadow = '0 0 10px #f59e0b';
        if (fsRetryBtn) fsRetryBtn.style.display = 'none';
      } else if (state === 'error' || state === 'retrying') {
        fsStatusText.textContent = state === 'retrying' ? 'REINTENTANDO...' : 'ERROR';
        fsPulseLed.className = 'pulse-led pulse-orange';
        fsPulseLed.style.background = '#f97316';
        fsPulseLed.style.boxShadow = '0 0 10px #f97316';
        stopFsVisualizer();
        drawIdleFsVisualizer();
        if (fsSongCard) {
          if (fsSongTitle) fsSongTitle.textContent = 'Sin señal de emisión';
          if (fsSongArtist) fsSongArtist.textContent = 'Error al conectar con el servidor de audio';
          const badgeText = document.getElementById('fs-song-badge-text');
          if (badgeText) badgeText.textContent = 'SIN SEÑAL';
          const eqBars = fsSongCard.querySelector('.fs-song-eq-bars');
          if (eqBars) eqBars.style.display = 'none';
          if (fsAppleLink) fsAppleLink.style.display = 'none';
          if (fsRetryBtn) fsRetryBtn.style.display = 'inline-flex';
          fsSongCard.style.display = 'flex';
        }
      } else if (state === 'paused') {
        fsStatusText.textContent = 'PAUSADO';
        fsPulseLed.className = 'pulse-led pulse-gray';
        fsPulseLed.style.background = '#64748b';
        fsPulseLed.style.boxShadow = 'none';
        if (fsRetryBtn) fsRetryBtn.style.display = 'none';
        if (fsSongCard) {
          const badgeText = document.getElementById('fs-song-badge-text');
          if (badgeText) badgeText.textContent = 'EN PAUSA';
          const eqBars = fsSongCard.querySelector('.fs-song-eq-bars');
          if (eqBars) eqBars.style.display = 'none';
        }
      } else {
        fsStatusText.textContent = 'LISTO';
        fsPulseLed.className = 'pulse-led pulse-gray';
        fsPulseLed.style.background = '#64748b';
        fsPulseLed.style.boxShadow = 'none';
        if (fsRetryBtn) fsRetryBtn.style.display = 'none';
        if (fsSongCard) {
          const badgeText = document.getElementById('fs-song-badge-text');
          if (badgeText) badgeText.textContent = 'LISTO';
          const eqBars = fsSongCard.querySelector('.fs-song-eq-bars');
          if (eqBars) eqBars.style.display = 'none';
        }
      }
    }
  }

  function handleStreamError(station, reason, token) {
    if (!station) return;
    // Discard stale errors from previous stations or cancelled tokens
    if (token !== undefined && token !== currentPlaybackToken) {
      return;
    }

    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }

    // If direct stream failed and proxy was not attempted yet for this station:
    if (!hasAttemptedProxyForCurrent && !useProxyForced) {
      console.log(`[Auto-Proxy] Direct stream failed for "${station.name}". Retrying via Cloudflare Radio Proxy...`);
      hasAttemptedProxyForCurrent = true;
      showToast(`Reintentando "${station.name}" a través de Proxy...`);
      playStation(station, true);
      return;
    }

    // HARD STOP: Proxy also failed, or direct failed when useProxyForced was on
    console.warn(`[Stream Unavailable] Emisora "${station.name}" no responde:`, reason);

    if (hls) {
      try { hls.destroy(); } catch (e) {}
      hls = null;
    }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();

    isPlaying = false;
    isBuffering = false;

    if (playIcon && pauseIcon) {
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
    }
    if (fsPlayIcon && fsPauseIcon) {
      fsPlayIcon.style.display = 'block';
      fsPauseIcon.style.display = 'none';
    }
    updatePlayerStatus('error');
    updateMediaSessionPlaybackState('none');

    networkSpeedBytesPerSec = 0;
    updateTelemetryDisplay();
    updateCardPlayingState();
    updateDocumentTitle();

    showToast(`"${station.name}" no está disponible o el stream está fuera del aire.`);
  }

  function playStation(station, isProxyRetry = false) {
    if (!station) return;
    currentStation = station;

    // Reset song metadata immediately on station change
    nowPlayingSong = null;
    clearNowPlayingMetadata();

    // Increment token for fresh user requests, keep token for internal proxy retry
    if (!isProxyRetry) {
      currentPlaybackToken++;
      hasAttemptedProxyForCurrent = false;
      stopMetadataPolling();
      consecutiveNoSongCount = 0;
      lastSongTimestamp = 0;
    }
    const token = currentPlaybackToken;

    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }

    updateTunerDisplay(station);
    setBufferingState(true);

    // Reset audio and HLS instances safely
    if (hls) {
      try { hls.destroy(); } catch (e) {}
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

    let streamUrl = getPlayableUrl(station.url);
    if ((isProxyRetry || useProxyForced) && !streamUrl.startsWith('/api/radio-proxy')) {
      streamUrl = `/api/radio-proxy?url=${encodeURIComponent(station.url)}`;
    }

    // Connection timeout: 9.5s max to establish audio stream, otherwise fail cleanly
    connectionTimeoutTimer = setTimeout(() => {
      if (token === currentPlaybackToken && (isBuffering || !isPlaying)) {
        console.warn(`[Timeout] Connection timed out for "${station.name}"`);
        handleStreamError(station, 'Tiempo de espera agotado (servidor no responde)', token);
      }
    }, 9500);

    if (isM3U8 && window.Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        // Radio: la latencia no importa, y el modo LL exige cargas pequeñas y
        // frecuentes, muy sensibles a la reducción de timers/CPU que Chrome
        // aplica a las pestañas ocultas en móvil (→ buffer se vacía y el audio
        // queda entrecortado). Con búfer grande y sincronía holgada al vivo,
        // la reproducción sobrevive a los despertares de la pestaña oculta.
        lowLatencyMode: false,
        maxBufferLength: 120,
        liveSyncDurationCount: 8,
        backBufferLength: 30,
        manifestLoadingTimeOut: 8000,
        fragLoadingTimeOut: 8000
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(audio);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (token !== currentPlaybackToken) return;
        setupAudioContext();
        audio.play().then(() => {
          if (token === currentPlaybackToken && !audio.paused) {
            setPlayingState(true);
            if (window.innerWidth > 680 && !isFullscreenPlayerOpen && !document.hidden) {
              startVisualizer();
            }
            if (isFullscreenPlayerOpen && !document.hidden) {
              startFsVisualizer();
            }
          }
        }).catch((err) => {
          if (err.name !== 'AbortError') {
            console.warn('HLS audio.play() rejected:', err);
            handleStreamError(station, err.message, token);
          }
        });
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (token !== currentPlaybackToken) return;
        if (!audio.paused && (audio.currentTime > 0 || isPlaying)) {
          if (!isPlaying) setPlayingState(true);
          if (window.innerWidth > 680 && !animFrameId && !isFullscreenPlayerOpen && !document.hidden) {
            startVisualizer();
          }
          if (isFullscreenPlayerOpen && !fsAnimFrameId && !document.hidden) {
            startFsVisualizer();
          }
        }
      });

      hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
        if (token !== currentPlaybackToken) return;
        if (hls && hls.levels && hls.levels[hls.currentLevel]) {
          const lvl = hls.levels[hls.currentLevel];
          if (lvl.bitrate) {
            currentBitrateKbps = Math.round(lvl.bitrate / 1000);
            networkSpeedBytesPerSec = Math.round(lvl.bitrate / 8);
          }
        }
        currentCodec = 'HLS / AAC';
        updateTelemetryDisplay();
        updateCardPlayingState();
      });

      hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        if (token !== currentPlaybackToken) return;
        if (data && data.frag && data.frag.loaded) {
          sessionTotalBytes += data.frag.loaded;
          if (data.stats && data.stats.bwEstimate) {
            networkSpeedBytesPerSec = Math.round(data.stats.bwEstimate / 8);
          }
          updateTelemetryDisplay();
        }
      });

      if (Hls.Events.FRAG_PARSING_METADATA) {
        hls.on(Hls.Events.FRAG_PARSING_METADATA, (event, data) => {
          if (token !== currentPlaybackToken || !data || !data.samples) return;
          for (const sample of data.samples) {
            if (sample.data) {
              const rawText = decodeId3Text(sample.data);
              if (rawText && rawText.length > 3) {
                fetchStationMetadata(rawText);
                break;
              }
            }
          }
        });
      }

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (token !== currentPlaybackToken) return;
        if (data.fatal) {
          console.warn('[Hls.js Fatal Error]', data);
          handleStreamError(station, `Error HLS: ${data.details || 'stream no disponible'}`, token);
        }
      });
    } else {
      // Standard MP3 / AAC / Icecast audio stream or Safari Native HLS
      audio.src = streamUrl;
      setupAudioContext();
      audio.play().then(() => {
        if (token === currentPlaybackToken && !audio.paused) {
          setPlayingState(true);
          if (window.innerWidth > 680 && !isFullscreenPlayerOpen && !document.hidden) {
            startVisualizer();
          }
          if (isFullscreenPlayerOpen && !document.hidden) {
            startFsVisualizer();
          }
        }
      }).catch((err) => {
        if (token !== currentPlaybackToken) return;
        if (err.name === 'AbortError') return;
        console.warn('Standard audio.play() rejected:', err);
        handleStreamError(station, err.message, token);
      });

      // Probe stream telemetry (real bitrate, server icy headers, audio codec)
      probeStreamTelemetry(station.url);
    }

    updateMediaSession(station);
    updateCardPlayingState();
    updateDocumentTitle();
  }

  function togglePlayPause() {
    if (!currentStation) {
      const list = getFilteredAndSortedStations();
      const first = list.length ? list[0] : stations[0];
      if (first) playStation(first);
      return;
    }

    if (isPlaying) {
      audio.pause();
      if (hls) hls.stopLoad();
      setPlayingState(false);
    } else {
      // If was paused, stopped, or errored, re-start current station
      playStation(currentStation);
    }
  }

  function setPlayingState(playing) {
    isPlaying = playing;
    if (playing) isBuffering = false;
    updateMediaSessionPlaybackState(playing ? 'playing' : 'paused');
    if (playIcon && pauseIcon) {
      playIcon.style.display = playing ? 'none' : 'block';
      pauseIcon.style.display = playing ? 'block' : 'none';
    }
    if (playBtn) {
      playBtn.classList.toggle('is-playing', playing);
    }
    if (bottomPlayerBar) {
      bottomPlayerBar.classList.toggle('is-playing', playing);
    }
    if (fsPlayIcon && fsPauseIcon) {
      fsPlayIcon.style.display = playing ? 'none' : 'block';
      fsPauseIcon.style.display = playing ? 'block' : 'none';
    }
    updatePlayerStatus(playing ? 'playing' : 'paused');
    if (playing) {
      const fmt = detectStreamFormat(currentStation ? currentStation.url : '');
      const br = currentBitrateKbps || fmt.defaultBitrate;
      networkSpeedBytesPerSec = Math.round((br * 1000) / 8);
    } else {
      networkSpeedBytesPerSec = 0;
    }
    updateTelemetryDisplay();
    updateCardPlayingState();
    updateDocumentTitle();
    if (playing) {
      if (window.innerWidth > 680) startVisualizer();
      if (isFullscreenPlayerOpen) startFsVisualizer();
      startMetadataPolling();
    } else {
      stopVisualizer();
      drawIdleVisualizer();
      stopFsVisualizer();
      drawIdleFsVisualizer();
      stopMetadataPolling();
    }
  }

  function setBufferingState(buffering) {
    isBuffering = buffering;
    if (buffering) {
      updatePlayerStatus('buffering');
    }
    updateDocumentTitle();
  }

  // Audio Element Events
  audio.addEventListener('play', () => {
    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }
  });

  audio.addEventListener('playing', () => {
    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }
    setPlayingState(true);
    if (window.innerWidth > 680 && !isFullscreenPlayerOpen && !document.hidden) {
      startVisualizer();
    }
    if (isFullscreenPlayerOpen && !document.hidden) {
      startFsVisualizer();
    }
  });

  audio.addEventListener('timeupdate', () => {
    if (!audio.paused && audio.currentTime > 0) {
      if (!isPlaying) {
        setPlayingState(true);
      }
      if (window.innerWidth > 680 && !animFrameId && !isFullscreenPlayerOpen && !document.hidden) {
        startVisualizer();
      }
      if (isFullscreenPlayerOpen && !fsAnimFrameId && !document.hidden) {
        startFsVisualizer();
      }
    }
  });

  audio.addEventListener('pause', () => {
    if (!isBuffering && isPlaying) {
      setPlayingState(false);
    }
  });

  audio.addEventListener('waiting', () => {
    if (isPlaying) {
      setBufferingState(true);
    }
  });

  audio.addEventListener('error', (e) => {
    // Ignore error if audio src is empty (which happens during cleanup)
    if (!audio.getAttribute('src') && !audio.src) return;
    if (currentStation) {
      console.warn('HTML5 Audio Error event:', e);
      handleStreamError(currentStation, 'Error de red o decodificación', currentPlaybackToken);
    }
  });

  // =========================================================================
  // DYNAMIC TAB TITLE (Page Visibility & Real-Time Song Updates)
  // Formato: "Artista – Canción | Alexis Radio". Sin canción: "Emisora | Alexis Radio". En pausa: "Alexis Radio"
  // =========================================================================
  function updateDocumentTitle() {
    if ((isPlaying || isBuffering) && currentStation) {
      if (nowPlayingSong && nowPlayingSong.title) {
        const artist = nowPlayingSong.artist ? nowPlayingSong.artist.trim() : '';
        const title = nowPlayingSong.title.trim();
        document.title = artist ? `${artist} – ${title} | Alexis Radio` : `${title} | Alexis Radio`;
      } else {
        document.title = `${currentStation.name} | Alexis Radio`;
      }
    } else {
      document.title = 'Alexis Radio';
    }
  }

  document.addEventListener('visibilitychange', () => {
    updateDocumentTitle();
    if (document.hidden) {
      stopVisualizer();
    } else {
      if (window.innerWidth > 680 && isPlaying && !isFullscreenPlayerOpen) {
        startVisualizer();
      }
      if (isPlaying) {
        fetchStationMetadata();
      }
    }
  });

  window.addEventListener('pagehide', () => {
    updateDocumentTitle();
    stopVisualizer();
  });

  window.addEventListener('pageshow', () => {
    updateDocumentTitle();
    if (window.innerWidth > 680) startVisualizer();
  });

  // =========================================================================
  // WEB AUDIO API & REALTIME SPECTRUM VISUALIZER
  // =========================================================================

  // Universal Audio Sounding detector derived directly from <audio> element
  function isAudioElementSounding() {
    if (!audio) return false;
    if (audio.paused || audio.ended || !audio.src) return false;
    // readyState >= 2 (HAVE_CURRENT_DATA) or currentTime > 0
    if (audio.readyState >= 2 || audio.currentTime > 0) return true;
    return false;
  }

  function setupAudioContext() {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!audioCtx) {
        audioCtx = new AudioCtxClass();
      }

      if (audioCtx.state === 'suspended') {
        const r = audioCtx.resume();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      }

      if (!analyser && audioCtx) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.8;
      }

      if (!sourceNode && audioCtx && analyser) {
        sourceNode = audioCtx.createMediaElementSource(audio);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
      }

      audioCtx.onstatechange = () => {
        if (audioCtx && audioCtx.state !== 'running' && isAudioElementSounding()) {
          const r = audioCtx.resume();
          if (r && typeof r.catch === 'function') r.catch(() => {});
        }
      };

      isAudioContextConnected = true;
    } catch (e) {
      // If CORS blocks MediaElementAudioSource, we will use synthetic frequency visualization
      console.log('Web Audio context connected with synthetic fallback available.');
    }
  }

  // Resume AudioContext on any user gesture (clicks, touch, keys)
  ['click', 'touchstart', 'keydown'].forEach(evt => {
    document.addEventListener(evt, () => {
      setupAudioContext();
    }, { passive: true });
  });

  // Diagnostic & automated testing inspection hook for AnalyserNode pipeline
  window.__setVisualizerAnalyser = (node) => { analyser = node; };
  window.__getVisualizerAnalyser = () => analyser;

  let unifiedVisualizerRafId = null;
  let visualizerPhase = 0;
  const isDebugMode = (new URLSearchParams(window.location.search).get('debug') === '1');

  function updateDebugOverlay(badgeId, sounding, sum, mode) {
    if (!isDebugMode) return;
    let el = document.getElementById(badgeId);
    if (!el) {
      el = document.createElement('div');
      el.id = badgeId;
      el.className = 'visualizer-debug-overlay';
      const parent = (badgeId === 'island-debug-badge')
        ? document.getElementById('mini-visualizer-container')
        : document.querySelector('.fs-visualizer-wrapper');
      if (parent) parent.appendChild(el);
    }
    const ct = audio ? audio.currentTime.toFixed(1) : '0';
    const paused = audio ? audio.paused : true;
    const ready = audio ? audio.readyState : 0;
    const ctxState = audioCtx ? audioCtx.state : 'null';

    el.textContent = `A: ${paused ? 'PAUSED' : 'PLAY'} ct:${ct}s rdy:${ready} | CTX:${ctxState} | SUM:${sum} | ${mode}`;
  }

  function drawVisualizerOnCanvas(targetCanvas, ctx, mode, dataArray, sum, isFs) {
    const w = targetCanvas.width;
    const h = targetCanvas.height;
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    if (mode === 'PLANO') {
      const midY = Math.floor(h / 2);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(0, 240, 255, 0)');
      grad.addColorStop(0.2, isLight ? 'rgba(2, 132, 199, 0.35)' : 'rgba(0, 240, 255, 0.45)');
      grad.addColorStop(0.5, isLight ? 'rgba(2, 132, 199, 0.7)' : 'rgba(0, 240, 255, 0.85)');
      grad.addColorStop(0.8, isLight ? 'rgba(2, 132, 199, 0.35)' : 'rgba(0, 240, 255, 0.45)');
      grad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, midY, w, 1.5);
      return;
    }

    if (mode === 'BARRAS' && dataArray) {
      const barCount = isFs ? Math.min(36, Math.floor(w / 9)) : 18;
      const barSpacing = isFs ? 3 : 2;
      const barWidth = Math.max(2, Math.floor((w - barCount * barSpacing) / barCount));
      const step = Math.floor(dataArray.length / barCount) || 1;

      // Draw baseline
      ctx.strokeStyle = isLight ? 'rgba(14, 165, 233, 0.12)' : 'rgba(56, 189, 248, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i * step] || 0;
        const percent = val / 255;
        const barHeight = Math.max(2, percent * (h - 4));
        const x = i * (barWidth + barSpacing) + 2;
        const y = h - barHeight - 1;

        const grad = ctx.createLinearGradient(0, h, 0, y);
        grad.addColorStop(0, isLight ? '#0284c7' : '#00f0ff');
        grad.addColorStop(1, isLight ? '#7c3aed' : '#a855f7');
        ctx.fillStyle = grad;

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }
      return;
    }

    if (mode === 'ONDA') {
      const centerY = h / 2;
      const amplitude = Math.min(h * 0.28, isFs ? 8 : 5);

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(0, 240, 255, 0)');
      grad.addColorStop(0.2, isLight ? '#0284c7' : '#00f0ff');
      grad.addColorStop(0.5, isLight ? '#7c3aed' : '#a855f7');
      grad.addColorStop(0.8, isLight ? '#0284c7' : '#00f0ff');
      grad.addColorStop(1, 'rgba(0, 240, 255, 0)');

      ctx.lineWidth = 2;
      ctx.strokeStyle = grad;
      ctx.beginPath();

      for (let x = 0; x <= w; x += 2) {
        const wave1 = Math.sin((x / 35) + visualizerPhase);
        const wave2 = Math.sin((x / 65) - (visualizerPhase * 0.7)) * 0.5;
        const envelope = Math.sin((x / w) * Math.PI);
        const y = centerY + ((wave1 + wave2) * amplitude * envelope);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function startUnifiedVisualizerLoop() {
    if (unifiedVisualizerRafId) return;

    function renderUnifiedFrame() {
      unifiedVisualizerRafId = requestAnimationFrame(renderUnifiedFrame);

      if (document.hidden) return;

      const sounding = isAudioElementSounding();

      let sum = 0;
      let dataArray = null;

      if (sounding && analyser && audioCtx && audioCtx.state === 'running') {
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
      }

      let mode = 'PLANO';
      if (sounding) {
        mode = (sum > 0) ? 'BARRAS' : 'ONDA';
      }

      visualizerPhase += 0.04;

      // 1. Draw on Island Canvas
      if (canvas && canvasCtx && window.innerWidth > 680 && !isFullscreenPlayerOpen) {
        drawVisualizerOnCanvas(canvas, canvasCtx, mode, dataArray, sum, false);
        if (isDebugMode) {
          updateDebugOverlay('island-debug-badge', sounding, sum, mode);
        }
      }

      // 2. Draw on Fullscreen Canvas
      if (fsCanvas && fsCanvasCtx && isFullscreenPlayerOpen) {
        drawVisualizerOnCanvas(fsCanvas, fsCanvasCtx, mode, dataArray, sum, true);
        if (isDebugMode) {
          updateDebugOverlay('fs-debug-badge', sounding, sum, mode);
        }
      }
    }

    unifiedVisualizerRafId = requestAnimationFrame(renderUnifiedFrame);
  }

  function drawIdleVisualizer() {
    if (canvas && canvasCtx) {
      drawVisualizerOnCanvas(canvas, canvasCtx, 'PLANO', null, 0, false);
    }
  }

  function drawIdleFsVisualizer() {
    if (fsCanvas && fsCanvasCtx) {
      drawVisualizerOnCanvas(fsCanvas, fsCanvasCtx, 'PLANO', null, 0, true);
    }
  }

  function startVisualizer() {
    startUnifiedVisualizerLoop();
  }

  function startFsVisualizer() {
    startUnifiedVisualizerLoop();
  }

  function stopVisualizer() {
    // Keep unified loop running smoothly
  }

  function stopFsVisualizer() {
    // Keep unified loop running smoothly
  }

  // Pause visualizer when tab is hidden, resume when tab is visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopVisualizer();
      stopFsVisualizer();
    } else if (isPlaying) {
      if (isFullscreenPlayerOpen) {
        startFsVisualizer();
      } else if (window.innerWidth > 680) {
        startVisualizer();
      }
    } else {
      drawIdleVisualizer();
      drawIdleFsVisualizer();
    }
  });

  // =========================================================================
  // MEDIA SESSION API (Lockscreen Controls, SMTC & Real-Time Album Art)
  // =========================================================================
  function getMediaSessionArtwork(artworkUrl, fallbackLogo) {
    const toAbs = (url) => {
      try {
        return new URL(url, window.location.href).href;
      } catch (e) {
        return url;
      }
    };

    if (artworkUrl && typeof artworkUrl === 'string' && !artworkUrl.startsWith('data:')) {
      const isAppleCdn = /\b\d+x\d+\b/.test(artworkUrl);
      const art96 = isAppleCdn ? artworkUrl.replace(/\b\d+x\d+\b/, '96x96') : artworkUrl;
      const art256 = isAppleCdn ? artworkUrl.replace(/\b\d+x\d+\b/, '256x256') : artworkUrl;
      const art512 = isAppleCdn ? artworkUrl.replace(/\b\d+x\d+\b/, '512x512') : artworkUrl;

      return [
        { src: toAbs(art96), sizes: '96x96', type: 'image/jpeg' },
        { src: toAbs(art256), sizes: '256x256', type: 'image/jpeg' },
        { src: toAbs(art512), sizes: '512x512', type: 'image/jpeg' }
      ];
    }

    const stationLogoUrl = (fallbackLogo && typeof fallbackLogo === 'string' && !fallbackLogo.startsWith('data:'))
      ? fallbackLogo
      : '/radio-icon-512.png';

    return [
      { src: toAbs(stationLogoUrl), sizes: '96x96', type: 'image/png' },
      { src: toAbs(stationLogoUrl), sizes: '256x256', type: 'image/png' },
      { src: toAbs(stationLogoUrl), sizes: '512x512', type: 'image/png' }
    ];
  }

  function updateMediaSessionPlaybackState(state) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state; // 'playing' | 'paused' | 'none'
    } catch (e) {
      console.warn('Error setting mediaSession.playbackState:', e);
    }
  }

  function setupMediaSessionActionHandlers() {
    if (!('mediaSession' in navigator)) return;

    const actionHandlers = [
      ['play', () => {
        if (!isPlaying) togglePlayPause();
      }],
      ['pause', () => {
        if (isPlaying) togglePlayPause();
      }],
      ['previoustrack', () => playPrevStation()],
      ['nexttrack', () => playNextStation()],
      ['stop', () => {
        if (isPlaying) {
          audio.pause();
          if (hls) hls.stopLoad();
          setPlayingState(false);
          updateMediaSessionPlaybackState('none');
        }
      }]
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (err) {
        console.warn(`MediaSession action "${action}" not supported:`, err);
      }
    }

    // Streams en vivo: explícitamente no registrar seekto ni seekbackward
    const disabledActions = ['seekbackward', 'seekforward', 'seekto', 'skipad'];
    for (const action of disabledActions) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch (err) {}
    }
  }

  function updateMediaSession(station, songData = null) {
    if (!('mediaSession' in navigator)) return;

    if (!station) {
      navigator.mediaSession.metadata = null;
      updateMediaSessionPlaybackState('none');
      return;
    }

    const fallbackLogo = station.logo;

    if (songData && songData.title) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: songData.title,
        artist: songData.artist || 'Alexis Radio',
        album: songData.album || station.name,
        artwork: getMediaSessionArtwork(songData.artwork, fallbackLogo)
      });
    } else {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: station.name,
        artist: 'Alexis Radio',
        album: station.freq || station.genre || 'En Vivo',
        artwork: getMediaSessionArtwork(null, fallbackLogo)
      });
    }

    setupMediaSessionActionHandlers();
    updateMediaSessionPlaybackState(isPlaying ? 'playing' : 'paused');
  }

  // =========================================================================
  // REAL-TIME NOW PLAYING & APPLE MUSIC METADATA ENGINE
  // =========================================================================
  function decodeId3Text(data) {
    if (!data || data.length < 4) return null;
    try {
      const uint8 = new Uint8Array(data);
      let str = '';
      for (let i = 0; i < uint8.length; i++) {
        const c = uint8[i];
        if (c >= 32 && c <= 126) {
          str += String.fromCharCode(c);
        } else if (c >= 160 && c <= 255) {
          str += String.fromCharCode(c);
        }
      }
      const match = str.match(/(?:TIT2|TPE1|TXXX|StreamTitle=)\s*([A-Za-z0-9\s\-_.,'’"&!/()]+)/i);
      if (match && match[1] && match[1].trim().length > 3) {
        return match[1].trim();
      }
      const trimmed = str.replace(/\s+/g, ' ').trim();
      if (trimmed.length > 4 && trimmed.includes(' - ')) {
        return trimmed;
      }
    } catch (e) {}
    return null;
  }

  async function fetchStationMetadata(forceQuery = null) {
    if (!currentStation || !isPlaying || isMetadataFetching) return;

    // Si es un stream HLS y NO tenemos un forceQuery (etiqueta ID3 de fragmento), no sondear el endpoint ICY.
    // Los manifiestos .m3u8 no contienen cabeceras ICY y su sondeo vacío borraría la canción detectada por HLS ID3.
    const isHlsStation = (hls !== null) || (currentStation.url && currentStation.url.includes('.m3u8'));
    if (!forceQuery && isHlsStation) {
      return;
    }

    isMetadataFetching = true;

    try {
      let apiUrl = `/api/radio-metadata?url=${encodeURIComponent(currentStation.url)}&name=${encodeURIComponent(currentStation.name)}`;
      if (forceQuery) {
        apiUrl += `&query=${encodeURIComponent(forceQuery)}`;
      }

      const res = await fetch(apiUrl);
      if (!res.ok) return;
      const data = await res.json();

      if (data && data.success && data.hasSong && data.title) {
        consecutiveNoSongCount = 0;
        lastSongTimestamp = Date.now();
        applyNowPlayingMetadata(data);
      } else {
        // Debounce / Periodo de gracia para evitar que el nombre de la canción desaparezca y aparezca
        // (por jingles, menciones de estación, comerciales, cortes breves o pausas temporales de lectura ICY).
        if (nowPlayingSong) {
          consecutiveNoSongCount++;
          const timeSinceSong = Date.now() - lastSongTimestamp;
          // Periodo de gracia extendido: una canción promedio en radio dura entre 3 y 4.5 minutos.
          // Las emisoras Icecast no re-envían cabeceras ICY mientras la misma pista sigue sonando.
          // Mantener la canción visible para evitar que desaparezca y aparezca constantemente.
          if (consecutiveNoSongCount >= 24 && timeSinceSong > 270000) {
            clearNowPlayingMetadata();
            consecutiveNoSongCount = 0;
          }
        }
      }
    } catch (err) {
      // Silencioso
    } finally {
      isMetadataFetching = false;
    }
  }

  const clientArtworkCache = new Map();

  async function searchArtworkClient(artist, title) {
    const cacheKey = `${artist || ''}:::${title || ''}`.toLowerCase().trim();
    if (clientArtworkCache.has(cacheKey)) {
      return clientArtworkCache.get(cacheKey);
    }

    const cleanArtist = (artist || '').replace(/\s*(feat\.?|ft\.?|&|\/).*$/i, '').trim();
    const queries = [
      `${artist || ''} ${title || ''}`.trim(),
      cleanArtist && cleanArtist !== artist ? `${cleanArtist} ${title || ''}`.trim() : null,
      title || ''
    ].filter(Boolean);

    // 1. Motor 1: Apple Music (iTunes Search)
    for (const q of queries) {
      try {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=1`);
        if (res.ok) {
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            const track = data.results[0];
            const art100 = track.artworkUrl100 || '';
            const resObj = {
              artwork: art100.replace(/\b\d+x\d+\b/, '600x600'),
              artwork300: art100.replace(/\b\d+x\d+\b/, '300x300'),
              artwork100: art100,
              album: track.collectionName || '',
              appleMusicUrl: track.trackViewUrl || null
            };
            clientArtworkCache.set(cacheKey, resObj);
            return resObj;
          }
        }
      } catch (e) {}
    }

    // 2. Motor 2: Deezer API fallback
    for (const q of queries) {
      try {
        const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=1`);
        if (res.ok) {
          const data = await res.json();
          if (data.data && data.data.length > 0) {
            const item = data.data[0];
            const alb = item.album || {};
            const resObj = {
              artwork: alb.cover_xl || alb.cover_big || alb.cover_medium || '',
              artwork300: alb.cover_medium || alb.cover_big || '',
              artwork100: alb.cover_small || alb.cover_medium || '',
              album: alb.title || '',
              appleMusicUrl: null
            };
            clientArtworkCache.set(cacheKey, resObj);
            return resObj;
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function startMetadataPolling() {
    stopMetadataPolling();

    // Consulta inicial ultra rápida (250ms tras iniciar reproducción)
    setTimeout(() => {
      if (isPlaying) fetchStationMetadata();
    }, 250);

    // Sondeo periódico cada 10 segundos
    metadataPollingTimer = setInterval(() => {
      if (isPlaying && !document.hidden) {
        fetchStationMetadata();
      }
    }, 10000);
  }

  function stopMetadataPolling() {
    if (metadataPollingTimer) {
      clearInterval(metadataPollingTimer);
      metadataPollingTimer = null;
    }
    isMetadataFetching = false;
  }

  function checkBottomBarMarquee() {
    if (!bottomBarName) return;
    const wrapper = bottomBarName.closest('.bottom-bar-name-wrapper') || bottomBarName.parentElement;
    if (!wrapper) return;

    bottomBarName.classList.remove('has-marquee');
    bottomBarName.style.removeProperty('--marquee-distance');
    bottomBarName.style.removeProperty('--marquee-duration');

    requestAnimationFrame(() => {
      const overflow = bottomBarName.scrollWidth - wrapper.clientWidth;
      if (overflow > 4) {
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!prefersReducedMotion) {
          const dist = overflow + 18;
          const duration = Math.max(5, Math.min(18, dist / 16)) + 's';
          bottomBarName.style.setProperty('--marquee-distance', `-${dist}px`);
          bottomBarName.style.setProperty('--marquee-duration', duration);
          bottomBarName.classList.add('has-marquee');
        }
      }
    });
  }

  window.addEventListener('resize', () => {
    checkBottomBarMarquee();
    fitIslandSecondaryLine();
  });

  function updateIslandSecondaryLine(station, song) {
    const subFreq = document.getElementById('sub-item-freq');
    const bottomBarFreq = document.getElementById('bottom-bar-freq');

    if (song && song.title) {
      // Con canción activa: título principal muestra canción/artista y fila secundaria muestra la emisora
      const stName = station ? (station.name || '') : '';
      if (bottomBarFreq) bottomBarFreq.textContent = stName;
      if (subFreq) subFreq.style.display = stName ? 'inline-flex' : 'none';
    } else if (station) {
      // Sin canción activa: solo muestra frecuencia si es real (no redundante con EN VIVO ni 'WEB STREAM')
      const hasRealFreq = station.freq && !/^(WEB STREAM|WEB HI-FI|WEB|ONLINE)$/i.test(station.freq.trim());
      if (hasRealFreq) {
        if (bottomBarFreq) bottomBarFreq.textContent = station.freq.trim();
        if (subFreq) subFreq.style.display = 'inline-flex';
      } else {
        if (bottomBarFreq) bottomBarFreq.textContent = '';
        if (subFreq) subFreq.style.display = 'none';
      }
    } else {
      if (bottomBarFreq) bottomBarFreq.textContent = '';
      if (subFreq) subFreq.style.display = 'none';
    }

    fitIslandSecondaryLine();
  }

  function fitIslandSecondaryLine() {
    const subRow = document.getElementById('bottom-bar-sub-row');
    if (!subRow) return;

    const statusItem = document.getElementById('sub-item-status');
    const freqItem = document.getElementById('sub-item-freq');
    const formatItem = document.getElementById('sub-item-format');
    const bitrateItem = document.getElementById('sub-item-bitrate');

    const bottomBarFormatBadge = document.getElementById('bottom-bar-format-badge');
    const bottomBarBitrateBadge = document.getElementById('bottom-bar-bitrate-badge');
    const bottomBarFreq = document.getElementById('bottom-bar-freq');

    const hasFreq = !!(bottomBarFreq && bottomBarFreq.textContent.trim().length > 0);
    const hasFormat = !!(bottomBarFormatBadge && bottomBarFormatBadge.textContent.trim().length > 0);
    const bText = bottomBarBitrateBadge ? bottomBarBitrateBadge.textContent.trim() : '';
    const hasBitrate = !!(bText && bText !== '-- kbps' && bText !== '0 kbps');

    // Restaurar visibilidad inicial para calcular scrollWidth real
    if (statusItem) statusItem.style.display = 'inline-flex';
    if (freqItem) freqItem.style.display = hasFreq ? 'inline-flex' : 'none';
    if (formatItem) formatItem.style.display = hasFormat ? 'inline-flex' : 'none';
    if (bitrateItem) bitrateItem.style.display = hasBitrate ? 'inline-flex' : 'none';

    // Ocultar progresivamente por prioridad atómica hasta que scrollWidth <= clientWidth
    // Prioridad 1 (menor): Bitrate
    if (subRow.scrollWidth > subRow.clientWidth && bitrateItem && hasBitrate) {
      bitrateItem.style.display = 'none';
    }
    // Prioridad 2: Formato
    if (subRow.scrollWidth > subRow.clientWidth && formatItem && hasFormat) {
      formatItem.style.display = 'none';
    }
    // Prioridad 3: Frecuencia / Emisora
    if (subRow.scrollWidth > subRow.clientWidth && freqItem && hasFreq) {
      freqItem.style.display = 'none';
    }
    // Prioridad 4 (máxima): Estado nunca se oculta
  }

  function initIslandResizeObserver() {
    const leftBlock = document.getElementById('bottom-bar-left');
    const subRow = document.getElementById('bottom-bar-sub-row');

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        fitIslandSecondaryLine();
        checkBottomBarMarquee();
      });
      if (leftBlock) ro.observe(leftBlock);
      if (subRow) ro.observe(subRow);
    } else {
      window.addEventListener('resize', () => {
        fitIslandSecondaryLine();
        checkBottomBarMarquee();
      });
    }
  }

  function applyNowPlayingMetadata(song) {
    if (!song) {
      clearNowPlayingMetadata();
      return;
    }
    if (!currentStation) return;
    const isNewSong = !nowPlayingSong || nowPlayingSong.title !== song.title || nowPlayingSong.artist !== song.artist;
    nowPlayingSong = song;

    // 1. Tarjeta en Fullscreen Player
    if (fsSongCard && fsSongTitle && fsSongArtist) {
      fsSongTitle.textContent = song.title;
      fsSongArtist.textContent = song.artist + (song.album ? ` • ${song.album}` : '');
      fsSongCard.classList.remove('no-metadata');
      fsSongCard.classList.add('has-metadata');
      fsSongCard.style.display = 'flex';
      const badgeText = document.getElementById('fs-song-badge-text');
      if (badgeText) badgeText.textContent = 'SONANDO AHORA';
      const eqBars = fsSongCard.querySelector('.fs-song-eq-bars');
      if (eqBars) eqBars.style.display = 'inline-flex';
    }

    if (fsAppleLink) {
      if (song.appleMusicUrl) {
        fsAppleLink.href = song.appleMusicUrl;
        fsAppleLink.setAttribute('aria-label', `Escuchar ${song.title} de ${song.artist} en Apple Music`);
        fsAppleLink.style.display = 'inline-flex';
      } else {
        fsAppleLink.style.display = 'none';
        fsAppleLink.href = '#';
      }
    }
    if (fsRetryBtn) fsRetryBtn.style.display = 'none';

    // 2. Carga progresiva instantánea de carátula
    const instantCover = song.artwork100 || song.artwork300 || song.artwork;
    if (instantCover) {
      // Inmediato: mostrar carátula ligera (5KB, responde en ~30ms sin bloquear)
      if (bottomBarLogo && (isNewSong || bottomBarLogo.src !== instantCover)) {
        bottomBarLogo.src = instantCover;
      }
      if (fsStationLogo && (isNewSong || fsStationLogo.src !== instantCover)) {
        fsStationLogo.src = instantCover;
        fsStationLogo.style.borderRadius = '24px';
      }

      // En paralelo: precargar versión en Alta Definición (600x600 o 1000x1000)
      if (song.artwork && song.artwork !== instantCover) {
        const hdImg = new Image();
        hdImg.src = song.artwork;
        hdImg.onload = () => {
          if (nowPlayingSong && (nowPlayingSong.title === song.title || nowPlayingSong.artwork === song.artwork)) {
            if (fsStationLogo) fsStationLogo.src = song.artwork;
            if (bottomBarLogo) bottomBarLogo.src = song.artwork300 || song.artwork;
          }
        };
      }
    } else if (!song.artwork && (song.title || song.artist)) {
      // Si el servidor no trajo carátula, resolver de inmediato desde el navegador (Apple + Deezer)
      searchArtworkClient(song.artist, song.title).then(enriched => {
        if (enriched && nowPlayingSong && nowPlayingSong.title === song.title) {
          Object.assign(nowPlayingSong, enriched);
          applyNowPlayingMetadata(nowPlayingSong);
        }
      });
    }

    // 3. Barra inferior
    if (bottomBarName) {
      bottomBarName.textContent = `${song.title} — ${song.artist}`;
      bottomBarName.title = `${song.title} — ${song.artist} (${currentStation.name})`;
      checkBottomBarMarquee();
    }
    updateIslandSecondaryLine(currentStation, song);

    // 4. MediaSession & Bloqueo de pantalla
    updateMediaSession(currentStation, song);

    // 5. Título de pestaña
    updateDocumentTitle();
  }

  function clearNowPlayingMetadata() {
    nowPlayingSong = null;

    if (currentStation) {
      const fallback = getStationFallbackSvg(currentStation.name, currentStation.genre);
      if (fsStationLogo) {
        fsStationLogo.src = currentStation.logo || fallback;
        fsStationLogo.onerror = () => { fsStationLogo.src = fallback; };
        fsStationLogo.alt = currentStation.name;
      }
      if (bottomBarLogo) {
        bottomBarLogo.src = currentStation.logo || fallback;
        bottomBarLogo.onerror = () => { bottomBarLogo.src = fallback; };
        bottomBarLogo.alt = currentStation.name;
      }
      if (bottomBarName) {
        bottomBarName.textContent = currentStation.name;
        bottomBarName.title = currentStation.name;
        checkBottomBarMarquee();
      }
      updateIslandSecondaryLine(currentStation, null);
      updateMediaSession(currentStation);
    }

    if (fsSongCard) {
      if (fsSongTitle) fsSongTitle.textContent = isPlaying ? 'Sintonía en vivo' : (currentStation ? 'Transmisión pausada' : 'Sintonizador listo');
      if (fsSongArtist) {
        const hasF = currentStation && currentStation.freq && !/^(WEB STREAM|WEB HI-FI|WEB|ONLINE)$/i.test(currentStation.freq.trim());
        fsSongArtist.textContent = currentStation 
          ? (hasF ? `${currentStation.freq.trim()} • ${currentStation.genre || 'Música'}` : (currentStation.genre || 'Transmisión digital'))
          : 'Selecciona una emisora para sintonizar';
      }
      fsSongCard.classList.remove('has-metadata');
      fsSongCard.classList.add('no-metadata');
      fsSongCard.style.display = 'flex';
      const badgeText = document.getElementById('fs-song-badge-text');
      if (badgeText) {
        badgeText.textContent = isPlaying ? 'SEÑAL EN VIVO' : (currentStation ? 'EN PAUSA' : 'LISTO');
      }
      const eqBars = fsSongCard.querySelector('.fs-song-eq-bars');
      if (eqBars) eqBars.style.display = isPlaying ? 'inline-flex' : 'none';
    }

    if (fsAppleLink) {
      fsAppleLink.style.display = 'none';
      fsAppleLink.href = '#';
    }

    if (fsRetryBtn) {
      fsRetryBtn.style.display = 'none';
    }

    updateDocumentTitle();
  }

  // =========================================================================
  // STATION FILTERING & SORTING HELPER
  // =========================================================================
  function getFilteredAndSortedStations() {
    let list = stations.filter(s => {
      const matchSearch = (s.name && s.name.toLowerCase().includes(searchQuery)) ||
                          (s.genre && s.genre.toLowerCase().includes(searchQuery)) ||
                          (s.freq && s.freq.toLowerCase().includes(searchQuery));
      if (!matchSearch) return false;

      if (activeFilter === 'all') return true;
      if (activeFilter === 'starred') return s.isStarred;
      return (s.genre || '').toLowerCase().includes(activeFilter.toLowerCase());
    });

    if (currentSortOrder === 'alpha-asc') {
      return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
    } else if (currentSortOrder === 'alpha-desc') {
      return [...list].sort((a, b) => (b.name || '').localeCompare(a.name || '', 'es', { sensitivity: 'base' }));
    }
    // 'added' preserves natural insertion/creation order
    return list;
  }

  function playNextStation() {
    const list = getFilteredAndSortedStations();
    const sourceList = list.length ? list : stations;
    if (!sourceList.length) return;
    const currentIndex = sourceList.findIndex(s => s.id === (currentStation ? currentStation.id : ''));
    const nextIndex = (currentIndex + 1) % sourceList.length;
    playStation(sourceList[nextIndex]);
  }

  function playPrevStation() {
    const list = getFilteredAndSortedStations();
    const sourceList = list.length ? list : stations;
    if (!sourceList.length) return;
    const currentIndex = sourceList.findIndex(s => s.id === (currentStation ? currentStation.id : ''));
    const prevIndex = (currentIndex - 1 + sourceList.length) % sourceList.length;
    playStation(sourceList[prevIndex]);
  }

  // =========================================================================
  // TUNER UI UPDATER
  // =========================================================================
  function updateTunerDisplay(station) {
    if (!station) return;
    const fallback = getStationFallbackSvg(station.name, station.genre);

    // Top Stage Updates
    if (activeStationName) activeStationName.textContent = station.name;
    const hasTopFreq = station.freq && !/^(WEB STREAM|WEB HI-FI|WEB|ONLINE)$/i.test(station.freq.trim());
    if (activeStationFreq) activeStationFreq.innerHTML = `<span>●</span> ${escapeHtml(hasTopFreq ? station.freq.trim() : (station.genre || 'En Vivo'))}`;
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
      bottomBarName.title = station.name;
      checkBottomBarMarquee();
    }
    updateIslandSecondaryLine(station, nowPlayingSong);
    if (bottomBarBitrateBadge) {
      const b = station.bitrate;
      const bitrateParent = document.getElementById('sub-item-bitrate');
      if (b && b !== '-- kbps' && b !== '0 kbps') {
        bottomBarBitrateBadge.textContent = b.includes('kbps') ? b : `${b} kbps`;
        bottomBarBitrateBadge.style.display = 'inline-flex';
        if (bitrateParent) bitrateParent.style.display = 'inline-flex';
      } else {
        bottomBarBitrateBadge.style.display = 'none';
        if (bitrateParent) bitrateParent.style.display = 'none';
      }
    }

    updateFullscreenPlayer(station);
    updateTelemetryDisplay();
  }

  function updateFsAmbientGlow(station) {
    if (!fsAmbientGlow) return;
    if (!station) {
      fsAmbientGlow.style.background = '';
      return;
    }
    const hue = getStationHue(station.name);
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const op1 = isLight ? 0.22 : 0.38;
    const op2 = isLight ? 0.08 : 0.16;
    fsAmbientGlow.style.background = `radial-gradient(circle at 50% 36%, hsla(${hue}, 85%, 50%, ${op1}) 0%, hsla(${(hue + 45) % 360}, 80%, 45%, ${op2}) 45%, transparent 72%)`;

    if (fsOverlay) {
      fsOverlay.style.setProperty('--station-glow', `hsla(${hue}, 90%, 55%, 0.45)`);
      fsOverlay.style.setProperty('--station-color', `hsl(${hue}, 85%, 50%)`);
    }
  }

  function updateFullscreenPlayer(station) {
    if (!station) return;
    const fallback = getStationFallbackSvg(station.name, station.genre);

    updateFsAmbientGlow(station);

    const activeCover = nowPlayingSong ? (nowPlayingSong.artwork || nowPlayingSong.artwork300 || nowPlayingSong.artwork100) : null;
    if (activeCover) {
      if (fsStationLogo) {
        fsStationLogo.src = activeCover;
        fsStationLogo.onerror = () => { fsStationLogo.src = station.logo || fallback; };
        fsStationLogo.alt = `${nowPlayingSong.title} - ${nowPlayingSong.artist}`;
      }
      if (fsSongCard && fsSongTitle && fsSongArtist) {
        fsSongTitle.textContent = nowPlayingSong.title;
        fsSongArtist.textContent = nowPlayingSong.artist + (nowPlayingSong.album ? ` • ${nowPlayingSong.album}` : '');
        fsSongCard.classList.remove('no-metadata');
        fsSongCard.classList.add('has-metadata');
        fsSongCard.style.display = 'flex';
        const badgeText = document.getElementById('fs-song-badge-text');
        if (badgeText) badgeText.textContent = 'SONANDO AHORA';
        const eqBars = fsSongCard.querySelector('.fs-song-eq-bars');
        if (eqBars) eqBars.style.display = 'inline-flex';
      }
      if (fsAppleLink) {
        if (nowPlayingSong.appleMusicUrl) {
          fsAppleLink.href = nowPlayingSong.appleMusicUrl;
          fsAppleLink.setAttribute('aria-label', `Escuchar ${nowPlayingSong.title} de ${nowPlayingSong.artist} en Apple Music`);
          fsAppleLink.style.display = 'inline-flex';
        } else {
          fsAppleLink.style.display = 'none';
          fsAppleLink.href = '#';
        }
      }
      if (fsRetryBtn) fsRetryBtn.style.display = 'none';
    } else {
      if (fsStationLogo) {
        fsStationLogo.src = station.logo || fallback;
        fsStationLogo.onerror = () => { fsStationLogo.src = fallback; };
        fsStationLogo.alt = station.name;
      }
      if (fsSongCard && fsSongTitle && fsSongArtist) {
        fsSongTitle.textContent = isPlaying ? 'Sintonía en vivo' : 'Transmisión pausada';
        fsSongArtist.textContent = `${station.freq || 'WEB STREAM'} • ${station.genre || 'Transmisión digital'}`;
        fsSongCard.classList.remove('has-metadata');
        fsSongCard.classList.add('no-metadata');
        fsSongCard.style.display = 'flex';
        const badgeText = document.getElementById('fs-song-badge-text');
        if (badgeText) {
          badgeText.textContent = isPlaying ? 'SEÑAL EN VIVO' : 'EN PAUSA';
        }
        const eqBars = fsSongCard.querySelector('.fs-song-eq-bars');
        if (eqBars) eqBars.style.display = isPlaying ? 'inline-flex' : 'none';
      }
      if (fsAppleLink) {
        fsAppleLink.style.display = 'none';
        fsAppleLink.href = '#';
      }
      if (fsRetryBtn) fsRetryBtn.style.display = 'none';
    }

    if (fsStationName) {
      fsStationName.textContent = (station.name || '').trim().replace(/\s+/g, ' ');
    }
    if (fsStationGenre) {
      fsStationGenre.textContent = station.genre || 'General';
    }
    if (fsStationFreq) {
      const hasFsFreq = station.freq && !/^(WEB STREAM|WEB HI-FI|WEB|ONLINE)$/i.test(station.freq.trim());
      fsStationFreq.textContent = hasFsFreq ? station.freq.trim() : (station.genre || 'En Vivo');
    }

    updateFullscreenStarState();

    const fsArtwork = document.querySelector('.fs-artwork-wrapper');
    if (fsArtwork) {
      fsArtwork.classList.toggle('is-playing', isPlaying);
    }
    if (fsPlayBtn) {
      fsPlayBtn.classList.toggle('is-playing', isPlaying);
    }

    if (fsPlayIcon && fsPauseIcon) {
      fsPlayIcon.style.display = isPlaying ? 'none' : 'block';
      fsPauseIcon.style.display = isPlaying ? 'block' : 'none';
    }

    if (fsSleepBadge) {
      fsSleepBadge.textContent = (sleepBadge && sleepBadge.textContent) ? sleepBadge.textContent : '';
    }
    if (fsSleepBtn) {
      fsSleepBtn.classList.toggle('active', !!sleepTimerId);
    }
    if (fsProxyBtn) {
      fsProxyBtn.classList.toggle('active', useProxyForced);
    }
    if (fsMuteBtn) {
      fsMuteBtn.style.color = audio.muted ? 'var(--accent-red)' : 'var(--text-muted)';
    }
    if (fsVolumeSlider) {
      fsVolumeSlider.value = audio.volume;
      updateVolumeVisual(audio.volume);
    }
  }

  function updateFullscreenStarState() {
    if (!fsStarBtn || !currentStation) return;
    fsStarBtn.classList.toggle('starred', !!currentStation.isStarred);
    if (fsStarIcon) {
      fsStarIcon.setAttribute('fill', currentStation.isStarred ? 'currentColor' : 'none');
    }
  }

  function toggleCurrentStationStar() {
    if (!currentStation) return;
    currentStation.isStarred = !currentStation.isStarred;
    saveStations();
    updateFullscreenStarState();
    renderStations();
    showToast(currentStation.isStarred ? `Añadida a favoritas: ${currentStation.name}` : `Eliminada de favoritas`);
  }

  // =========================================================================
  // STATIONS GRID RENDERING
  // =========================================================================
  function renderStations() {
    if (!stationsGrid) return;

    const filtered = getFilteredAndSortedStations();

    if (stationCountDisplay) {
      if (filtered.length === stations.length) {
        stationCountDisplay.textContent = `${stations.length} emisoras`;
      } else {
        stationCountDisplay.textContent = `${filtered.length} de ${stations.length} emisoras`;
      }
    }

    if (!filtered.length) {
      stationsGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon-wrap">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"></circle><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"></path><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"></path><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"></path><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"></path></svg>
          </div>
          <p class="empty-state-title">Sin señal de sintonía</p>
          <p class="empty-state-desc">No se encontraron emisoras que coincidan con la búsqueda o filtro.</p>
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

    stationsGrid.innerHTML = filtered.map((s, idx) => {
      const isCurrent = currentStation && currentStation.id === s.id;
      const isCardPlaying = isCurrent && isPlaying;
      const fallbackLogo = getStationFallbackSvg(s.name, s.genre);
      const sFmt = detectStreamFormat(s.url);
      const variantBadge = getStationVariantBadge(s.name);
      const stationHue = getStationHue(s.name);

      const hasRealFreq = s.freq && !/^(WEB STREAM|WEB HI-FI|WEB|ONLINE)$/i.test(s.freq.trim());
      const freqGenreLine = hasRealFreq ? `${s.freq.trim()} · ${s.genre || 'Música'}` : `${s.genre || 'Música'}`;

      const logoSrc = /^(https?:\/\/|data:image\/)/i.test(s.logo || '') ? s.logo : fallbackLogo;

      const staggerStyle = isInitialStationLoad ? `style="--stagger-delay: ${Math.min(idx * 28, 560)}ms; --station-hue: ${stationHue};"` : `style="--station-hue: ${stationHue};"`;
      const staggerClass = isInitialStationLoad ? 'stagger-fade-in' : '';

      return `
        <div class="station-card ${isCardPlaying ? 'playing' : ''} ${staggerClass}" data-station-id="${escapeHtml(s.id)}" ${staggerStyle} tabindex="0" role="button">
          <div class="station-card-logo-wrap">
            <img class="station-card-img" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(s.name)}" data-fallback="${escapeHtml(fallbackLogo)}" onerror="this.onerror=null;this.src=this.dataset.fallback;" loading="lazy">
            <div class="playing-badge-indicator" aria-hidden="true" title="Sonando">
              <div class="mini-eq">
                <span></span><span></span><span></span><span></span>
              </div>
            </div>
          </div>

          <div class="station-card-content">
            <h3 class="station-card-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</h3>
            <div class="station-card-sub">
              <span class="station-sub-text">${escapeHtml(freqGenreLine)}</span>
              <span class="station-fmt-pill fmt-${sFmt.ext.toLowerCase()}" title="Transmisión ${sFmt.ext}">
                <span class="station-fmt-dot"></span>${sFmt.ext}
              </span>
            </div>
          </div>

          <div class="station-card-actions">
            <button class="card-action-btn star-btn ${s.isStarred ? 'starred' : ''}" data-action="star" title="${s.isStarred ? 'Quitar de favoritas' : 'Añadir a favoritas'}" aria-label="${s.isStarred ? 'Quitar de favoritas' : 'Añadir a favoritas'}">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${s.isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
            </button>

            <!-- Acciones directas en Desktop (Hover & Focus-Within) -->
            <div class="desktop-card-actions">
              <button class="card-action-btn edit-btn" data-action="edit" title="Editar emisora" aria-label="Editar emisora">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="card-action-btn delete-btn" data-action="delete" title="Eliminar emisora" aria-label="Eliminar emisora">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>

            <!-- Menú '⋯' en Móvil / Táctil -->
            <div class="card-more-wrap">
              <button class="card-action-btn card-more-btn" data-action="card-more" title="Más opciones" aria-haspopup="dialog" aria-expanded="false" aria-label="Más opciones de ${escapeHtml(s.name)}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (isInitialStationLoad) {
      setTimeout(() => {
        isInitialStationLoad = false;
        if (stationsGrid) {
          stationsGrid.querySelectorAll('.stagger-fade-in').forEach(c => c.classList.remove('stagger-fade-in'));
        }
      }, 700);
    }
  }

  // Mobile Bottom Sheet / Action Sheet for Station Options
  let activeActionSheetStation = null;

  function openCardActionSheet(station) {
    if (!station) return;
    activeActionSheetStation = station;
    const overlay = document.getElementById('card-action-sheet-overlay');
    if (!overlay) return;

    const logo = document.getElementById('action-sheet-logo');
    const title = document.getElementById('action-sheet-station-name');
    const sub = document.getElementById('action-sheet-station-sub');
    const starBtn = document.getElementById('action-sheet-star-btn');
    const starText = document.getElementById('action-sheet-star-text');
    const starSvg = starBtn ? starBtn.querySelector('polygon') : null;

    const fallbackLogo = getStationFallbackSvg(station.name, station.genre);
    const logoSrc = /^(https?:\/\/|data:image\/)/i.test(station.logo || '') ? station.logo : fallbackLogo;

    if (logo) {
      logo.src = logoSrc;
      logo.alt = station.name;
    }
    if (title) title.textContent = station.name;
    if (sub) {
      const hasRealFreq = station.freq && !/^(WEB STREAM|WEB HI-FI|WEB|ONLINE)$/i.test(station.freq.trim());
      sub.textContent = hasRealFreq ? `${station.freq.trim()} · ${station.genre || 'Música'}` : `${station.genre || 'Música'}`;
    }
    if (starText) {
      starText.textContent = station.isStarred ? 'Quitar de favoritas' : 'Añadir a favoritas';
    }
    if (starSvg) {
      starSvg.setAttribute('fill', station.isStarred ? 'currentColor' : 'none');
    }
    if (starBtn) {
      starBtn.classList.toggle('starred', !!station.isStarred);
    }

    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
    });
    document.body.style.overflow = 'hidden';
  }

  function deleteStationWithUndo(station) {
    if (!station) return;
    const deletedStation = station;
    const deletedIndex = stations.findIndex(s => s.id === station.id);
    stations = stations.filter(s => s.id !== station.id);
    saveStations();

    if (currentStation && currentStation.id === station.id) {
      currentPlaybackToken++;
      if (connectionTimeoutTimer) {
        clearTimeout(connectionTimeoutTimer);
        connectionTimeoutTimer = null;
      }
      if (hls) {
        try { hls.destroy(); } catch (err) {}
        hls = null;
      }
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      currentStation = null;
      isBuffering = false;
      setPlayingState(false);
    }

    renderStations();
    showToast(`Eliminada: ${deletedStation.name}`, 'Deshacer', () => {
      if (deletedIndex >= 0) {
        stations.splice(deletedIndex, 0, deletedStation);
      } else {
        stations.push(deletedStation);
      }
      saveStations();
      renderStations();
      showToast(`Restaurada: ${deletedStation.name}`);
    });
  }

  function closeCardActionSheet() {
    activeActionSheetStation = null;
    const overlay = document.getElementById('card-action-sheet-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (!overlay.classList.contains('open')) {
          overlay.style.display = 'none';
        }
      }, 260);
    }
    document.body.style.overflow = '';
  }

  // Action Sheet Handlers
  const actionSheetOverlay = document.getElementById('card-action-sheet-overlay');
  if (actionSheetOverlay) {
    actionSheetOverlay.addEventListener('click', (e) => {
      if (e.target === actionSheetOverlay || e.target.closest('#action-sheet-close-btn') || e.target.closest('#action-sheet-cancel-btn')) {
        closeCardActionSheet();
        return;
      }

      const itemBtn = e.target.closest('.action-sheet-item');
      if (itemBtn && activeActionSheetStation) {
        const action = itemBtn.getAttribute('data-action');
        const station = activeActionSheetStation;
        closeCardActionSheet();

        if (action === 'star') {
          station.isStarred = !station.isStarred;
          saveStations();
          renderStations();
          showToast(station.isStarred ? `Añadida a favoritas: ${station.name}` : `Eliminada de favoritas`);
        } else if (action === 'edit') {
          openEditStationModal(station);
        } else if (action === 'delete') {
          deleteStationWithUndo(station);
        }
      }
    });
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

        if (action === 'card-more') {
          openCardActionSheet(station);
          return;
        }

        if (action === 'star') {
          station.isStarred = !station.isStarred;
          saveStations();
          if (activeFilter === 'starred') {
            renderStations();
          } else {
            actionBtn.classList.toggle('starred', station.isStarred);
            const svg = actionBtn.querySelector('svg');
            if (svg) svg.setAttribute('fill', station.isStarred ? 'currentColor' : 'none');
          }
          showToast(station.isStarred ? `Añadida a favoritas: ${station.name}` : `Eliminada de favoritas`);
        } else if (action === 'edit') {
          openEditStationModal(station);
        } else if (action === 'delete') {
          deleteStationWithUndo(station);
        }
        return;
      }

      // Card Body clicked: Play/Pause station
      if (currentStation && currentStation.id === station.id && isPlaying) {
        togglePlayPause();
      } else {
        playStation(station);
      }
      // If clicked with mouse, blur to prevent persistent focus-within state
      if (e.detail > 0) {
        card.blur();
      }
    });

    // Ensure action pill disappears immediately when mouse leaves the card
    stationsGrid.addEventListener('mouseleave', (e) => {
      const card = e.target && e.target.closest ? e.target.closest('.station-card') : null;
      if (card && card.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }, true);

    // Keyboard support on card and open card dropdown
    stationsGrid.addEventListener('keydown', (e) => {
      const openDropdown = stationsGrid.querySelector('.card-menu-dropdown.open');
      if (openDropdown) {
        const items = Array.from(openDropdown.querySelectorAll('.card-menu-item'));
        const activeIdx = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIdx = (activeIdx + 1) % items.length;
          items[nextIdx]?.focus();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevIdx = (activeIdx - 1 + items.length) % items.length;
          items[prevIdx]?.focus();
          return;
        }
        if (e.key === 'Home') {
          e.preventDefault();
          items[0]?.focus();
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          items[items.length - 1]?.focus();
          return;
        }
      }

      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('station-card')) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  // Close open card dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.card-more-wrap')) {
      document.querySelectorAll('.card-menu-dropdown.open').forEach(d => {
        d.classList.remove('open');
        d.closest('.station-card')?.classList.remove('menu-open');
        d.parentElement.querySelector('.card-more-btn')?.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // =========================================================================
  // CATEGORIES & SEARCH
  // =========================================================================
  function updateCategoryPills() {
    const pills = document.querySelectorAll('.cat-pill');
    pills.forEach(p => {
      const isActive = p.getAttribute('data-category') === activeFilter;
      if (isActive) {
        p.classList.add('active');
        p.setAttribute('aria-selected', 'true');
        p.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      } else {
        p.classList.remove('active');
        p.setAttribute('aria-selected', 'false');
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

  if (sortOrderSelect) {
    sortOrderSelect.value = currentSortOrder;
    sortOrderSelect.addEventListener('change', (e) => {
      currentSortOrder = e.target.value;
      localStorage.setItem('at_radio_sort_order', currentSortOrder);
      renderStations();
      const sortLabel = e.target.options[e.target.selectedIndex].text;
      showToast(`Orden: ${sortLabel}`);
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
  if (playerRetryBtn) {
    playerRetryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentStation) {
        showToast(`Reintentando "${currentStation.name}"...`);
        playStation(currentStation, true);
      }
    });
  }
  if (fsRetryBtn) {
    fsRetryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentStation) {
        showToast(`Reintentando "${currentStation.name}"...`);
        playStation(currentStation, true);
      }
    });
  }

  function updateVolumeVisual(val) {
    const pct = Math.round((parseFloat(val) || 0) * 100);
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const trackColor = isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.22)';
    const grad = `linear-gradient(to right, var(--accent-cyan) 0%, var(--accent-cyan) ${pct}%, ${trackColor} ${pct}%, ${trackColor} 100%)`;
    if (volumeSlider) {
      volumeSlider.value = val;
      volumeSlider.style.background = grad;
    }
    if (fsVolumeSlider) {
      fsVolumeSlider.value = val;
      fsVolumeSlider.style.background = grad;
    }
  }

  function syncMuteState() {
    const color = audio.muted ? 'var(--accent-red)' : 'var(--text-muted)';
    if (muteBtn) muteBtn.style.color = color;
    if (fsMuteBtn) fsMuteBtn.style.color = color;
  }

  function handleVolumeInput(val) {
    const vol = parseFloat(val);
    audio.volume = vol;
    localStorage.setItem('at_radio_volume', vol);
    updateVolumeVisual(vol);
    audio.muted = (vol === 0);
    syncMuteState();
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => handleVolumeInput(e.target.value));

    const savedVol = localStorage.getItem('at_radio_volume');
    if (savedVol !== null) {
      audio.volume = parseFloat(savedVol);
      updateVolumeVisual(savedVol);
    } else {
      updateVolumeVisual(volumeSlider.value);
    }
  }

  if (fsVolumeSlider) {
    fsVolumeSlider.addEventListener('input', (e) => handleVolumeInput(e.target.value));
  }

  function toggleMute() {
    audio.muted = !audio.muted;
    syncMuteState();
    showToast(audio.muted ? 'Silenciado' : 'Sonido activado');
  }

  if (muteBtn) muteBtn.addEventListener('click', toggleMute);
  if (fsMuteBtn) fsMuteBtn.addEventListener('click', toggleMute);

  function toggleProxyMode() {
    useProxyForced = !useProxyForced;
    if (proxyToggleBtn) proxyToggleBtn.classList.toggle('active', useProxyForced);
    if (fsProxyBtn) fsProxyBtn.classList.toggle('active', useProxyForced);
    if (fsProxyIndicator) {
      if (isPlaying) {
        fsProxyIndicator.textContent = useProxyForced ? 'PROXY ACTIVO' : 'DIRECTO';
        fsProxyIndicator.style.color = useProxyForced ? 'var(--accent-amber)' : 'var(--accent-cyan)';
        fsProxyIndicator.style.display = 'inline-block';
      } else {
        fsProxyIndicator.textContent = '';
        fsProxyIndicator.style.display = 'none';
      }
    }
    showToast(useProxyForced ? 'Cloudflare Proxy activado (Mayor compatibilidad)' : 'Modo Directo activado');
    if (currentStation && isPlaying) {
      playStation(currentStation, useProxyForced);
    }
  }

  if (proxyToggleBtn) proxyToggleBtn.addEventListener('click', toggleProxyMode);
  if (fsProxyBtn) fsProxyBtn.addEventListener('click', toggleProxyMode);

  // Sleep Timer
  if (sleepTimerBtn) {
    sleepTimerBtn.addEventListener('click', () => {
      const modal = document.getElementById('sleep-modal');
      if (modal) modal.classList.add('open');
    });
  }

  if (fsSleepBtn) {
    fsSleepBtn.addEventListener('click', () => {
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
      if (fsSleepBadge) fsSleepBadge.textContent = '';
      if (fsSleepBtn) fsSleepBtn.classList.remove('active');
      showToast('Temporizador desactivado');
      return;
    }

    sleepTimerEnd = Date.now() + minutes * 60 * 1000;
    const badgeText = `${minutes}m`;
    if (sleepBadge) sleepBadge.textContent = badgeText;
    if (sleepTimerBtn) sleepTimerBtn.classList.add('active');
    if (fsSleepBadge) fsSleepBadge.textContent = badgeText;
    if (fsSleepBtn) fsSleepBtn.classList.add('active');

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
          if (fsSleepBadge) fsSleepBadge.textContent = '';
          if (fsSleepBtn) fsSleepBtn.classList.remove('active');
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

  // =========================================================================
  // CLOUD SYNCHRONIZATION (Cloudflare KV)
  // =========================================================================
  const cloudSyncBtn = document.getElementById('cloud-sync-btn');
  const cloudSyncModal = document.getElementById('cloud-sync-modal');
  const syncKeyInput = document.getElementById('sync-key-input');
  const generateCodeBtn = document.getElementById('generate-code-btn');
  const syncCodeDisplay = document.getElementById('sync-code-display');
  const syncCodeVal = document.getElementById('sync-code-val');
  const cloudUploadBtn = document.getElementById('cloud-upload-btn');
  const cloudDownloadBtn = document.getElementById('cloud-download-btn');
  const autoSyncCheckbox = document.getElementById('auto-sync-checkbox');
  const syncStatusMsg = document.getElementById('sync-status-msg');

  function getSyncKey() {
    const raw = (syncKeyInput && syncKeyInput.value ? syncKeyInput.value.trim() : '') || localStorage.getItem('at_radio_sync_key') || 'alexis2026';
    localStorage.setItem('at_radio_sync_key', raw);
    return raw;
  }

  async function uploadStationsToCloud(silent = false) {
    const key = getSyncKey();
    if (syncStatusMsg) syncStatusMsg.textContent = 'Estado: Subiendo a la nube...';
    try {
      const res = await fetch('/api/radio-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Key': key
        },
        body: JSON.stringify({ key, stations })
      });
      const data = await res.json();
      if (data.success) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (syncStatusMsg) syncStatusMsg.textContent = `✓ Sincronizado en nube (${data.count} emisoras - ${timeStr})`;
        if (!silent) showToast(`¡${data.count} emisoras respaldadas en la nube!`);
      } else {
        if (syncStatusMsg) syncStatusMsg.textContent = `Error: ${data.error || 'Fallo de sincronización'}`;
        if (!silent) showToast('Error al sincronizar con la nube');
      }
    } catch (err) {
      console.error('Cloud sync upload failed:', err);
      if (syncStatusMsg) syncStatusMsg.textContent = 'Error de conexión con la nube';
      if (!silent) showToast('No se pudo conectar con el servidor');
    }
  }

  async function downloadStationsFromCloud() {
    const key = getSyncKey();
    if (syncStatusMsg) syncStatusMsg.textContent = 'Estado: Descargando de la nube...';
    try {
      const res = await fetch(`/api/radio-sync?key=${encodeURIComponent(key)}`, {
        headers: { 'X-Sync-Key': key }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.stations)) {
        if (data.stations.length === 0) {
          showToast('La lista en la nube está vacía');
          if (syncStatusMsg) syncStatusMsg.textContent = 'La lista en la nube está vacía';
          return;
        }
        stations = data.stations;
        try {
          localStorage.setItem('at_radio_stations', JSON.stringify(stations));
        } catch (e) {
          console.error('Failed to save stations to localStorage:', e);
        }
        renderStations();
        if (!currentStation || !stations.find(s => s.id === currentStation.id)) {
          currentStation = stations[0];
          updateTunerDisplay(currentStation);
        }
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (syncStatusMsg) syncStatusMsg.textContent = `✓ Descargado (${stations.length} emisoras - ${timeStr})`;
        showToast(`¡${stations.length} emisoras sincronizadas desde la nube!`);
      } else {
        const msg = data.message || data.error || 'No se encontraron emisoras';
        if (syncStatusMsg) syncStatusMsg.textContent = msg;
        showToast(msg);
      }
    } catch (err) {
      console.error('Cloud sync download failed:', err);
      if (syncStatusMsg) syncStatusMsg.textContent = 'Error de conexión';
      showToast('Error al descargar emisoras de la nube');
    }
  }

  async function generateMobileSyncCode() {
    const key = getSyncKey();
    if (syncStatusMsg) syncStatusMsg.textContent = 'Generando código de enlace...';
    try {
      const res = await fetch('/api/radio-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Key': key
        },
        body: JSON.stringify({ key, stations, generateCode: true })
      });
      const data = await res.json();
      if (data.success && data.shareCode) {
        if (syncCodeDisplay) syncCodeDisplay.style.display = 'block';
        if (syncCodeVal) syncCodeVal.textContent = data.shareCode;
        if (syncStatusMsg) syncStatusMsg.textContent = `Código listo: ${data.shareCode}`;
        showToast(`Código generado: ${data.shareCode}`);
      } else {
        showToast('No se pudo generar el código');
      }
    } catch (err) {
      console.error('Generate code failed:', err);
      showToast('Error de conexión al generar código');
    }
  }

  if (cloudSyncBtn && cloudSyncModal) {
    cloudSyncBtn.addEventListener('click', () => {
      const savedKey = localStorage.getItem('at_radio_sync_key') || 'alexis2026';
      if (syncKeyInput) syncKeyInput.value = savedKey;
      if (autoSyncCheckbox) autoSyncCheckbox.checked = localStorage.getItem('at_radio_autosync') === 'true';
      cloudSyncModal.classList.add('open');
    });
  }

  if (cloudUploadBtn) {
    cloudUploadBtn.addEventListener('click', () => uploadStationsToCloud(false));
  }

  if (cloudDownloadBtn) {
    cloudDownloadBtn.addEventListener('click', downloadStationsFromCloud);
  }

  if (generateCodeBtn) {
    generateCodeBtn.addEventListener('click', generateMobileSyncCode);
  }

  if (autoSyncCheckbox) {
    autoSyncCheckbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      localStorage.setItem('at_radio_autosync', isChecked ? 'true' : 'false');
      if (isChecked) {
        showToast('Sincronización automática activada');
        uploadStationsToCloud(true);
      } else {
        showToast('Sincronización automática desactivada');
      }
    });
  }

  if (syncKeyInput) {
    syncKeyInput.addEventListener('change', () => {
      localStorage.setItem('at_radio_sync_key', syncKeyInput.value.trim() || 'alexis2026');
    });
  }

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
      if (typeof updateVolumeVisual === 'function' && volumeSlider) {
        updateVolumeVisual(volumeSlider.value);
      }
      renderStations();
      if (currentStation) {
        updateTunerDisplay(currentStation);
      }
    });
  }

  // =========================================================================
  // TOAST NOTIFICATIONS (Rate-limited & De-duplicated)
  // =========================================================================
  let lastToastMsg = '';
  let lastToastTime = 0;

  function showToast(msg, actionText = null, actionCallback = null) {
    if (!msg) return;
    const now = Date.now();
    // Do not repeat the exact same message within 2.5 seconds unless it has an action button
    if (!actionText && msg === lastToastMsg && now - lastToastTime < 2500) {
      return;
    }
    lastToastMsg = msg;
    lastToastTime = now;

    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('role', 'status');
      document.body.appendChild(container);
    }

    // Limit visible toasts to 2 at most to prevent screen flooding
    while (container.children.length >= 2) {
      container.removeChild(container.firstChild);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
      <span class="toast-message">${escapeHtml(msg)}</span>
      ${actionText ? `<button class="toast-action-btn" type="button">${escapeHtml(actionText)}</button>` : ''}
    `;

    if (actionText && actionCallback) {
      const btn = toast.querySelector('.toast-action-btn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          actionCallback();
          toast.remove();
        });
      }
    }

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, actionText ? 6000 : 3000);
  }

  // PWA Install Manager & Service Worker Registration
  let deferredInstallPrompt = null;
  const pwaInstallBtn = document.getElementById('pwa-install-btn');
  const pwaInstallModal = document.getElementById('pwa-install-modal');
  const pwaPromptInstallBtn = document.getElementById('pwa-prompt-install-btn');
  const pwaNativePromptWrap = document.getElementById('pwa-native-prompt-wrap');
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  if (isStandalone && pwaInstallBtn) {
    pwaInstallBtn.style.display = 'none';
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (pwaInstallBtn && !isStandalone) {
      pwaInstallBtn.style.display = 'inline-flex';
    }
    if (pwaNativePromptWrap) {
      pwaNativePromptWrap.style.display = 'block';
    }
  });

  if (pwaInstallBtn) {
    pwaInstallBtn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          showToast('¡Instalando Alexis Radio!');
          pwaInstallBtn.style.display = 'none';
        }
        deferredInstallPrompt = null;
      } else {
        if (pwaInstallModal) pwaInstallModal.classList.add('open');
      }
    });
  }

  if (pwaPromptInstallBtn) {
    pwaPromptInstallBtn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          showToast('¡Instalando Alexis Radio!');
          if (pwaInstallBtn) pwaInstallBtn.style.display = 'none';
          if (pwaInstallModal) pwaInstallModal.classList.remove('open');
        }
        deferredInstallPrompt = null;
      }
    });
  }

  window.addEventListener('appinstalled', () => {
    if (pwaInstallBtn) pwaInstallBtn.style.display = 'none';
    if (pwaInstallModal) pwaInstallModal.classList.remove('open');
    showToast('¡Alexis Radio instalada con éxito!');
  });

  if (pwaInstallModal) {
    pwaInstallModal.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => pwaInstallModal.classList.remove('open'));
    });
    pwaInstallModal.addEventListener('click', (e) => {
      if (e.target === pwaInstallModal) pwaInstallModal.classList.remove('open');
    });
  }

  // Header More Options Menu Controller (Accesibilidad, Clic fuera, Teclado)
  const headerMoreBtn = document.getElementById('header-more-btn');
  const headerMoreMenu = document.getElementById('header-more-menu');
  const headerMoreWrap = document.getElementById('header-more-wrap');

  if (headerMoreBtn && headerMoreMenu) {
    function toggleMoreMenu(open) {
      const isOpen = open !== undefined ? open : !headerMoreMenu.classList.contains('open');
      headerMoreMenu.classList.toggle('open', isOpen);
      headerMoreBtn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        const firstItem = headerMoreMenu.querySelector('button, a');
        if (firstItem) firstItem.focus();
      }
    }

    headerMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMoreMenu();
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (headerMoreWrap && !headerMoreWrap.contains(e.target)) {
        toggleMoreMenu(false);
      }
    });

    // Keyboard navigation inside dropdown menu
    headerMoreMenu.addEventListener('keydown', (e) => {
      const menuItems = Array.from(headerMoreMenu.querySelectorAll('button:not([disabled]), a:not([disabled])'));
      const currentIndex = menuItems.indexOf(document.activeElement);

      if (e.key === 'Escape') {
        e.preventDefault();
        toggleMoreMenu(false);
        headerMoreBtn.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (currentIndex + 1) % menuItems.length;
        menuItems[next]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (currentIndex - 1 + menuItems.length) % menuItems.length;
        menuItems[prev]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        menuItems[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        menuItems[menuItems.length - 1]?.focus();
      } else if (e.key === 'Tab') {
        toggleMoreMenu(false);
      }
    });

    // Close menu when any menu item is activated
    headerMoreMenu.querySelectorAll('button, a').forEach(item => {
      item.addEventListener('click', () => {
        toggleMoreMenu(false);
      });
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
        try { reg.update(); } catch(e) {}
      }).catch(err => {
        console.warn('Radio SW registration failed:', err);
      });
    });
  }

  // =========================================================================
  // FULLSCREEN PLAYER CONTROLLER (Modo Pantalla Completa / Now Playing)
  // =========================================================================
  let fsAnimFrameId = null;
  let fsVisualizerPhase = 0;
  let hasPushedFullscreenHistory = false;
  let lastFocusedElementBeforeFullscreen = null;

  // Limpiar cualquier estado residual de pantalla completa si el usuario recargó la página
  if (window.history && history.state && history.state.fullscreenPlayer) {
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) {}
  }

  function handleFsFocusTrap(e) {
    if (!isFullscreenPlayerOpen || !fsOverlay) return;
    if (e.key !== 'Tab') return;

    const focusables = Array.from(fsOverlay.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(el => {
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
    });
    if (!focusables || focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first || !fsOverlay.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !fsOverlay.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  window.addEventListener('keydown', handleFsFocusTrap);

  let savedScrollY = 0;

  function lockBodyScroll() {
    savedScrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    document.documentElement.classList.add('fs-scroll-locked');
    document.body.classList.add('fs-scroll-locked');
    document.body.style.top = `-${savedScrollY}px`;
  }

  function unlockBodyScroll() {
    document.documentElement.classList.remove('fs-scroll-locked');
    document.body.classList.remove('fs-scroll-locked');
    document.body.style.top = '';
    window.scrollTo(0, savedScrollY);
  }

  function openFullscreenPlayer() {
    if (!fsOverlay) return;
    const wasAlreadyOpen = isFullscreenPlayerOpen;
    lastFocusedElementBeforeFullscreen = document.activeElement;
    isFullscreenPlayerOpen = true;
    stopVisualizer();
    lockBodyScroll();
    fsOverlay.classList.add('open');
    fsOverlay.setAttribute('aria-hidden', 'false');

    // Registrar estado en el historial para que el gesto "Atrás" en celular cierre esta vista y vuelva a las emisoras
    if (!wasAlreadyOpen && !hasPushedFullscreenHistory && window.history && typeof history.pushState === 'function') {
      try {
        history.pushState({ fullscreenPlayer: true }, '', window.location.pathname + window.location.search);
        hasPushedFullscreenHistory = true;
      } catch (e) {}
    }

    if (currentStation) {
      updateFullscreenPlayer(currentStation);
    }
    resizeFsCanvas();
    startFsVisualizer();

    setTimeout(() => {
      if (fsCloseBtn) fsCloseBtn.focus();
    }, 60);
  }

  function closeFullscreenPlayer(fromPopState = false) {
    if (!fsOverlay || !isFullscreenPlayerOpen) return;
    const isPop = (fromPopState === true);
    isFullscreenPlayerOpen = false;
    fsOverlay.classList.remove('open');
    fsOverlay.setAttribute('aria-hidden', 'true');
    unlockBodyScroll();
    stopFsVisualizer();
    if (isPlaying && window.innerWidth > 680) {
      startVisualizer();
    }

    if (lastFocusedElementBeforeFullscreen && typeof lastFocusedElementBeforeFullscreen.focus === 'function') {
      try {
        lastFocusedElementBeforeFullscreen.focus();
      } catch (e) {}
    }

    if (isPop) {
      hasPushedFullscreenHistory = false;
    } else if (hasPushedFullscreenHistory) {
      hasPushedFullscreenHistory = false;
      if (window.history && history.state && history.state.fullscreenPlayer) {
        try {
          history.back();
        } catch (e) {}
      }
    }
  }

  // Interceptar el gesto o botón "Atrás" del navegador / móvil
  window.addEventListener('popstate', () => {
    if (isFullscreenPlayerOpen) {
      closeFullscreenPlayer(true);
    }
  });

  function toggleFullscreenPlayer() {
    if (isFullscreenPlayerOpen) {
      closeFullscreenPlayer();
    } else {
      openFullscreenPlayer();
    }
  }

  // Native Browser Fullscreen API Toggle
  function toggleBrowserFullscreen() {
    const docEl = document.documentElement;
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    if (!isFs) {
      const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
      if (req) {
        req.call(docEl).catch(err => {
          console.warn('Native fullscreen request rejected:', err);
        });
      }
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (exit) {
        exit.call(document).catch(err => {
          console.warn('Native fullscreen exit error:', err);
        });
      }
    }
  }

  function syncBrowserFullscreenIcons() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    if (fsBrowserFsIconExpand && fsBrowserFsIconCompress) {
      fsBrowserFsIconExpand.style.display = isFs ? 'none' : 'block';
      fsBrowserFsIconCompress.style.display = isFs ? 'block' : 'none';
    }
  }

  document.addEventListener('fullscreenchange', syncBrowserFullscreenIcons);
  document.addEventListener('webkitfullscreenchange', syncBrowserFullscreenIcons);

  // =========================================================================
  // FULLSCREEN SPECTRUM / SINE VISUALIZER (3-STATE DUAL ENGINE)
  // =========================================================================
  function stopFsVisualizer() {
    if (fsAnimFrameId) {
      cancelAnimationFrame(fsAnimFrameId);
      fsAnimFrameId = null;
    }
  }

  function resizeFsCanvas() {
    if (!fsCanvas) return;
    const rect = fsCanvas.getBoundingClientRect();
    const w = Math.floor(rect.width || 360);
    const h = Math.floor(rect.height || 38);
    if (fsCanvas.width !== w || fsCanvas.height !== h) {
      fsCanvas.width = w;
      fsCanvas.height = h;
    }
  }



  // Fullscreen Player Event Listeners
  if (fullscreenPlayerBtn) {
    fullscreenPlayerBtn.addEventListener('click', openFullscreenPlayer);
  }

  if (bottomBarExpandBtn) {
    bottomBarExpandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFullscreenPlayer();
    });
  }

  if (fsDragHandle) {
    fsDragHandle.addEventListener('click', () => closeFullscreenPlayer());
  }

  if (bottomBarLeft) {
    bottomBarLeft.addEventListener('click', openFullscreenPlayer);
    bottomBarLeft.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        openFullscreenPlayer();
      }
    });
  }

  if (fsCloseBtn) {
    fsCloseBtn.addEventListener('click', closeFullscreenPlayer);
  }

  if (fsBrowserFsBtn) {
    fsBrowserFsBtn.addEventListener('click', toggleBrowserFullscreen);
  }

  if (fsStarBtn) {
    fsStarBtn.addEventListener('click', toggleCurrentStationStar);
  }

  if (fsPrevBtn) {
    fsPrevBtn.addEventListener('click', playPrevStation);
  }

  if (fsPlayBtn) {
    fsPlayBtn.addEventListener('click', togglePlayPause);
  }

  if (fsNextBtn) {
    fsNextBtn.addEventListener('click', playNextStation);
  }

  // Touch gesture: swipe down to dismiss on mobile
  let touchStartY = 0;
  let touchStartX = 0;

  if (fsOverlay) {
    fsOverlay.addEventListener('wheel', (e) => {
      // Prevent background page from scrolling via mouse wheel while fullscreen overlay is active
      e.preventDefault();
    }, { passive: false });

    fsOverlay.addEventListener('touchmove', (e) => {
      // Prevent background page from scrolling via touch gestures while fullscreen overlay is active
      e.preventDefault();
    }, { passive: false });

    fsOverlay.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
      }
    }, { passive: true });

    fsOverlay.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches.length === 1) {
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        const deltaX = Math.abs(e.changedTouches[0].clientX - touchStartX);
        if (deltaY > 80 && deltaX < 60 && fsOverlay.scrollTop <= 10) {
          closeFullscreenPlayer();
        }
      }
    }, { passive: true });
  }

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Shortcut / focuses search input unless typing in input/textarea/select/contenteditable or modifier keys are held
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable)) {
        return;
      }
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable)) {
      return;
    }

    if (e.key === 'Escape') {
      const openDropdown = document.querySelector('.card-menu-dropdown.open');
      if (openDropdown) {
        openDropdown.classList.remove('open');
        return;
      }
      if (headerMoreMenu && headerMoreMenu.classList.contains('open')) {
        toggleMoreMenu(false);
        return;
      }
      const openModal = document.querySelector('.modal-backdrop.open');
      if (openModal) {
        openModal.classList.remove('open');
        return;
      }
      const actionSheet = document.getElementById('card-action-sheet-overlay');
      if (actionSheet && actionSheet.classList.contains('open')) {
        closeCardActionSheet();
        return;
      }
      if (isFullscreenPlayerOpen) {
        closeFullscreenPlayer();
      }
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreenPlayer();
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      playNextStation();
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      playPrevStation();
      return;
    }

    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggleMute();
      return;
    }
  });

  // Window Resize Visualizer Fix (safeguarded against mobile resize triggers)
  function resizeCanvas() {
    if (isFullscreenPlayerOpen) {
      resizeFsCanvas();
    }
    if (window.innerWidth <= 680) {
      stopVisualizer();
      return;
    }
    if (canvas && canvas.parentElement) {
      const w = canvas.parentElement.clientWidth;
      const h = canvas.parentElement.clientHeight;
      if (w > 0 && h > 0) {
        canvas.width = w;
        canvas.height = h;
        if (!animFrameId && !document.hidden) {
          startVisualizer();
        }
      }
    }
  }
  window.addEventListener('resize', resizeCanvas);

  // Testing and debug hooks (exposed immediately)
  window.updatePlayerStatus = updatePlayerStatus;
  window.applyNowPlayingMetadata = applyNowPlayingMetadata;
  window.setPlayingState = setPlayingState;
  window.openFullscreenPlayer = openFullscreenPlayer;
  window.closeFullscreenPlayer = closeFullscreenPlayer;
  window.playStation = playStation;
  window.updateMediaSession = updateMediaSession;
  window.updateDocumentTitle = updateDocumentTitle;
  window.fitIslandSecondaryLine = fitIslandSecondaryLine;
  window.updateIslandSecondaryLine = updateIslandSecondaryLine;
  window.updateCardPlayingState = updateCardPlayingState;
  window.updateActiveStationCard = updateCardPlayingState;
  window.setCurrentStation = (s) => { currentStation = s; };

  // Initialize
  function bootApp() {
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
    setupMediaSessionActionHandlers();
    initIslandResizeObserver();

    // If auto-sync is enabled, download updates from cloud
    if (localStorage.getItem('at_radio_autosync') === 'true') {
      downloadStationsFromCloud();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp);
  } else {
    bootApp();
  }

})();
