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

  // Extrae ciudad o subtítulo distintivo para emisoras de una misma cadena (ej: La Mega Ibagué -> Ibagué)
  function getStationVariantBadge(name) {
    const match = (name || '').match(/^(?:La Mega|Mix|Los 40|Radioacktiva|Caracol|W Radio|Blu Radio|Radio Nacional|RCN)\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
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
  const bottomBarLogo = document.getElementById('bottom-bar-logo');
  const bottomBarName = document.getElementById('bottom-bar-name');
  const bottomBarFreq = document.getElementById('bottom-bar-freq');
  const bottomBarFormatBadge = document.getElementById('bottom-bar-format-badge');
  const bottomBarBitrateBadge = document.getElementById('bottom-bar-bitrate-badge');
  const bottomBarTelemetry = document.getElementById('bottom-bar-telemetry');
  const bottomBarExpandBtn = document.getElementById('bottom-bar-expand-btn');
  const bottomBarLeft = document.getElementById('bottom-bar-left');
  const fullscreenPlayerBtn = document.getElementById('fullscreen-player-btn');

  // Fullscreen Player Overlay Elements
  const fsOverlay = document.getElementById('fullscreen-player-overlay');
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
      bottomBarBitrateBadge.textContent = activeBitrateText;
    }

    if (bottomBarTelemetry) {
      bottomBarTelemetry.textContent = `VEL: ${activeSpeedText} • RED: ${activeDataText}`;
    }

    // 9. Fullscreen Player elements
    if (fsTelemetrySpeed) {
      fsTelemetrySpeed.textContent = `VEL: ${activeSpeedText}`;
    }
    if (fsTelemetryData) {
      fsTelemetryData.textContent = `RED: ${activeDataText}`;
    }
    if (fsStationBitrateBadge) {
      fsStationBitrateBadge.textContent = activeBitrateText;
    }
    if (fsStationFormatBadge) {
      fsStationFormatBadge.textContent = fmt.ext;
      fsStationFormatBadge.className = `format-badge ${fmt.badgeClass}`;
    }
    if (fsProxyIndicator) {
      fsProxyIndicator.textContent = useProxyForced ? 'PROXY ACTIVO' : 'DIRECTO';
      fsProxyIndicator.style.color = useProxyForced ? 'var(--accent-amber)' : 'var(--accent-cyan)';
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
  window.__radioDiag = () => ({
    playing: isPlaying,
    buffering: isBuffering,
    paused: audio.paused,
    ct: +audio.currentTime.toFixed(2),
    ready: audio.readyState,
    src: (audio.currentSrc || audio.src || '').slice(0, 140),
    hls: !!hls,
    ctx: audioCtx ? audioCtx.state : null,
    ctxUsed: isAudioContextConnected,
    coarse: !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches),
    station: currentStation ? currentStation.name : null
  });

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
    if (state === 'playing') {
      nowPlayingStatus.className = 'bottom-bar-status status-playing';
      nowPlayingStatus.style.background = 'rgba(16, 185, 129, 0.12)';
      nowPlayingStatus.style.borderColor = 'rgba(16, 185, 129, 0.35)';
      nowPlayingStatus.style.color = 'var(--accent-emerald)';
      nowPlayingStatus.innerHTML = '<span class="pulse-led" style="background:#10b981;box-shadow:0 0 10px #10b981;"></span> EN VIVO';
    } else if (state === 'buffering') {
      nowPlayingStatus.className = 'bottom-bar-status status-buffering';
      nowPlayingStatus.style.background = 'rgba(245, 158, 11, 0.14)';
      nowPlayingStatus.style.borderColor = 'rgba(245, 158, 11, 0.45)';
      nowPlayingStatus.style.color = 'var(--accent-amber)';
      nowPlayingStatus.innerHTML = '<span class="pulse-led" style="background:#f59e0b;box-shadow:0 0 10px #f59e0b;"></span> CONECTANDO...';
    } else if (state === 'error') {
      nowPlayingStatus.className = 'bottom-bar-status status-error';
      nowPlayingStatus.style.background = 'rgba(239, 68, 68, 0.16)';
      nowPlayingStatus.style.borderColor = 'rgba(239, 68, 68, 0.5)';
      nowPlayingStatus.style.color = '#ef4444';
      nowPlayingStatus.innerHTML = '<span class="pulse-led" style="background:#ef4444;box-shadow:0 0 10px #ef4444;"></span> NO DISPONIBLE';
    } else if (state === 'paused') {
      nowPlayingStatus.className = 'bottom-bar-status status-paused';
      nowPlayingStatus.style.background = 'rgba(255, 255, 255, 0.06)';
      nowPlayingStatus.style.borderColor = 'var(--border-color)';
      nowPlayingStatus.style.color = 'var(--text-muted)';
      nowPlayingStatus.innerHTML = '<span class="pulse-led" style="background:#64748b;box-shadow:none;"></span> PAUSADO';
    } else {
      // ready / idle
      nowPlayingStatus.className = 'bottom-bar-status status-ready';
      nowPlayingStatus.style.background = 'rgba(255, 255, 255, 0.06)';
      nowPlayingStatus.style.borderColor = 'var(--border-color)';
      nowPlayingStatus.style.color = 'var(--text-muted)';
      nowPlayingStatus.innerHTML = '<span class="pulse-led" style="background:#64748b;box-shadow:none;"></span> LISTO';
    }

    // Sync Fullscreen Player Status
    if (fsStatusText && fsPulseLed) {
      if (state === 'playing') {
        fsStatusText.textContent = 'EN VIVO';
        fsPulseLed.style.background = '#10b981';
        fsPulseLed.style.boxShadow = '0 0 10px #10b981';
      } else if (state === 'buffering') {
        fsStatusText.textContent = 'CONECTANDO...';
        fsPulseLed.style.background = '#f59e0b';
        fsPulseLed.style.boxShadow = '0 0 10px #f59e0b';
      } else if (state === 'error') {
        fsStatusText.textContent = 'NO DISPONIBLE';
        fsPulseLed.style.background = '#ef4444';
        fsPulseLed.style.boxShadow = '0 0 10px #ef4444';
      } else if (state === 'paused') {
        fsStatusText.textContent = 'PAUSADO';
        fsPulseLed.style.background = '#64748b';
        fsPulseLed.style.boxShadow = 'none';
      } else {
        fsStatusText.textContent = 'LISTO';
        fsPulseLed.style.background = '#64748b';
        fsPulseLed.style.boxShadow = 'none';
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

    networkSpeedBytesPerSec = 0;
    updateTelemetryDisplay();
    updateCardPlayingState();
    updateDocumentTitle();

    showToast(`"${station.name}" no está disponible o el stream está fuera del aire.`);
  }

  function playStation(station, isProxyRetry = false) {
    if (!station) return;
    currentStation = station;

    // Increment token for fresh user requests, keep token for internal proxy retry
    if (!isProxyRetry) {
      currentPlaybackToken++;
      hasAttemptedProxyForCurrent = false;
      stopMetadataPolling();
      clearNowPlayingMetadata();
      consecutiveNoSongCount = 0;
      lastSongTimestamp = 0;
    }
    const token = currentPlaybackToken;

    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }

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

    updateTunerDisplay(station);
    setBufferingState(true);

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
        audio.play().catch((err) => {
          if (err.name !== 'AbortError') {
            console.warn('HLS audio.play() rejected:', err);
            handleStreamError(station, err.message, token);
          }
        });
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
      audio.play().catch((err) => {
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
    if (playIcon && pauseIcon) {
      playIcon.style.display = playing ? 'none' : 'block';
      pauseIcon.style.display = playing ? 'block' : 'none';
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
  audio.addEventListener('playing', () => {
    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }
    setPlayingState(true);
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
  // DYNAMIC TAB TITLE ON TAB SWITCH (Page Visibility API)
  // =========================================================================
  const DEFAULT_DOCUMENT_TITLE = document.title || 'Alexis Radio | Sintonizador & Streaming Online M3U';

  function updateDocumentTitle() {
    if (document.hidden) {
      if (nowPlayingSong && nowPlayingSong.title && isPlaying) {
        document.title = `▶ ${nowPlayingSong.title} - ${nowPlayingSong.artist} • Alexis Radio`;
      } else if (currentStation && isPlaying) {
        document.title = `▶ ${currentStation.name} • Alexis Radio`;
      } else if (currentStation && isBuffering) {
        document.title = `⏳ ${currentStation.name} • Alexis Radio`;
      } else if (currentStation) {
        document.title = `⏸ ${currentStation.name} • Alexis Radio`;
      } else {
        document.title = DEFAULT_DOCUMENT_TITLE;
      }
    } else {
      if (nowPlayingSong && nowPlayingSong.title && isPlaying) {
        document.title = `🎵 ${nowPlayingSong.title} - ${nowPlayingSong.artist} | Alexis Radio`;
      } else {
        document.title = DEFAULT_DOCUMENT_TITLE;
      }
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
  function setupAudioContext() {
    if (isAudioContextConnected) return;

    // Sólo desktop: si el puntero primario es coarse (móvil/tablet) NO se
    // enruta el audio por WebAudio. El pipeline nativo del <audio> tolera
    // mucho mejor las interrupciones del sistema (notificaciones, cambio de
    // app, pantalla en off, cambio de ruta de audio) — el audio por
    // MediaElementSource se corta o queda tartamudeando cuando el sistema
    // suspende el AudioContext en segundo plano. Sin contexto, el visualizador
    // usa la animación sintética (fallback ya contemplado en el bucle).
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;

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

      // Si el sistema suspende/interrumpe el contexto (notificación, otra app
      // con audio, cambio de ruta), reanudarlo mientras haya reproducción:
      // sin esto el audio conectado al contexto queda mudo o entrecortado.
      audioCtx.onstatechange = () => {
        if (audioCtx && audioCtx.state !== 'running' && isPlaying) {
          const r = audioCtx.resume();
          if (r && typeof r.catch === 'function') r.catch(() => {});
        }
      };

      isAudioContextConnected = true;
    } catch (e) {
      // If CORS blocks MediaElementAudioSource, we will use synthetic frequency visualization
      console.log('Web Audio context connected with synthetic fallback fallback available.');
    }
  }

  function drawIdleVisualizer() {
    if (!canvas || !canvasCtx) return;
    const width = canvas.width;
    const height = canvas.height;
    if (width <= 0 || height <= 0) return;
    canvasCtx.clearRect(0, 0, width, height);
    canvasCtx.strokeStyle = 'rgba(56, 189, 248, 0.1)';
    canvasCtx.lineWidth = 1;
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, height / 2);
    canvasCtx.lineTo(width, height / 2);
    canvasCtx.stroke();
    canvasCtx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    canvasCtx.fillRect(0, height / 2, width, 1.5);
  }

  function stopVisualizer() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function startVisualizer() {
    if (!canvas || !canvasCtx) return;
    stopVisualizer();

    // Do not run canvas loop on mobile (hidden) or when tab is backgrounded
    if (window.innerWidth <= 680 || document.hidden) {
      return;
    }

    if (!isPlaying) {
      drawIdleVisualizer();
      return;
    }

    const bufferLength = analyser ? analyser.frequencyBinCount : 32;
    const dataArray = new Uint8Array(bufferLength);

    function renderFrame() {
      if (window.innerWidth <= 680 || document.hidden || !isPlaying || isFullscreenPlayerOpen) {
        stopVisualizer();
        drawIdleVisualizer();
        return;
      }

      animFrameId = requestAnimationFrame(renderFrame);

      const width = canvas.width;
      const height = canvas.height;
      if (width <= 0 || height <= 0) return;

      canvasCtx.clearRect(0, 0, width, height);

      // Subtle horizontal centerline
      canvasCtx.strokeStyle = 'rgba(56, 189, 248, 0.1)';
      canvasCtx.lineWidth = 1;
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, height / 2);
      canvasCtx.lineTo(width, height / 2);
      canvasCtx.stroke();

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

      // Draw compact frequency bars for mini canvas
      const barCount = 18;
      const barWidth = Math.max(2, Math.floor((width - barCount * 2) / barCount));
      const usableHeight = height - 4;

      const heights = new Float32Array(barCount);
      if (hasData) {
        for (let i = 0; i < barCount; i++) {
          const dataIndex = Math.floor(i * (bufferLength / barCount));
          heights[i] = Math.max(2, (dataArray[dataIndex] / 255) * usableHeight);
        }
      } else {
        const time = Date.now() * 0.0035;
        for (let i = 0; i < barCount; i++) {
          const wave = Math.sin(time + i * 0.35) * 0.5 + 0.5;
          const wave2 = Math.cos(time * 0.8 + i * 0.25) * 0.5 + 0.5;
          heights[i] = Math.max(3, (wave * 0.65 + wave2 * 0.35) * usableHeight);
        }
      }

      // Batch 1: Bars with cached linear gradient
      const grad = canvasCtx.createLinearGradient(0, height, 0, 0);
      grad.addColorStop(0, '#00f0ff');
      grad.addColorStop(0.5, '#38bdf8');
      grad.addColorStop(1, '#a855f7');
      canvasCtx.fillStyle = grad;

      let x = 2;
      for (let i = 0; i < barCount; i++) {
        const h = heights[i];
        canvasCtx.fillRect(x, height - h - 1, barWidth, h);
        x += barWidth + 2;
      }

      // Batch 2: Glowing caps with white fill
      canvasCtx.fillStyle = '#ffffff';
      x = 2;
      for (let i = 0; i < barCount; i++) {
        const h = heights[i];
        canvasCtx.fillRect(x, height - h - 2, barWidth, 1.5);
        x += barWidth + 2;
      }
    }

    renderFrame();
  }

  // =========================================================================
  // MEDIA SESSION API (Lockscreen Controls & Album Art)
  // =========================================================================
  function updateMediaSession(station, songData = null) {
    if ('mediaSession' in navigator && station) {
      if (songData && songData.title) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: songData.title,
          artist: `${songData.artist} • ${station.name}`,
          album: songData.album || station.name,
          artwork: songData.artwork ? [
            { src: songData.artwork, sizes: '600x600', type: 'image/jpeg' },
            { src: songData.artwork100 || songData.artwork, sizes: '100x100', type: 'image/jpeg' }
          ] : [
            { src: station.logo || '/radio-icon-192.png', sizes: '192x192', type: 'image/png' }
          ]
        });
      } else {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: station.name,
          artist: 'Alexis Radio // ' + (station.genre || 'En Vivo'),
          album: station.freq || 'Online Stream',
          artwork: [
            { src: station.logo || '/radio-icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: station.logo || '/radio-icon-512.png', sizes: '512x512', type: 'image/png' }
          ]
        });
      }

      navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevStation());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNextStation());
    }
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

  function applyNowPlayingMetadata(song) {
    if (!song || !currentStation) return;
    const isNewSong = !nowPlayingSong || nowPlayingSong.title !== song.title || nowPlayingSong.artist !== song.artist;
    nowPlayingSong = song;

    // 1. Tarjeta en Fullscreen Player
    if (fsSongCard && fsSongTitle && fsSongArtist) {
      fsSongTitle.textContent = song.title;
      fsSongArtist.textContent = song.artist + (song.album ? ` • ${song.album}` : '');
      fsSongCard.style.display = 'flex';
    }

    if (fsAppleLink) {
      if (song.appleMusicUrl) {
        fsAppleLink.href = song.appleMusicUrl;
        fsAppleLink.style.display = 'inline-flex';
      } else {
        fsAppleLink.style.display = 'none';
      }
    }

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
    }
    if (bottomBarFreq) {
      bottomBarFreq.textContent = currentStation.name;
    }

    // 4. MediaSession & Bloqueo de pantalla
    updateMediaSession(currentStation, song);

    // 5. Título de pestaña
    updateDocumentTitle();
  }

  function clearNowPlayingMetadata() {
    if (!nowPlayingSong) return;
    nowPlayingSong = null;

    if (fsSongCard) {
      fsSongCard.style.display = 'none';
    }

    if (currentStation) {
      const fallback = getStationFallbackSvg(currentStation.name, currentStation.genre);
      if (fsStationLogo) {
        fsStationLogo.src = currentStation.logo || fallback;
      }
      if (bottomBarLogo) {
        bottomBarLogo.src = currentStation.logo || fallback;
      }
      if (bottomBarName) {
        bottomBarName.textContent = currentStation.name;
        bottomBarName.title = currentStation.name;
      }
      if (bottomBarFreq) {
        bottomBarFreq.textContent = currentStation.freq || currentStation.genre || 'WEB STREAM';
      }
      updateMediaSession(currentStation);
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
    if (activeStationFreq) activeStationFreq.innerHTML = `<span>●</span> ${escapeHtml(station.freq || 'WEB STREAM')}`;
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

    updateFullscreenPlayer(station);
    updateTelemetryDisplay();
  }

  function updateFullscreenPlayer(station) {
    if (!station) return;
    const fallback = getStationFallbackSvg(station.name, station.genre);

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
        fsSongCard.style.display = 'flex';
      }
      if (fsAppleLink) {
        if (nowPlayingSong.appleMusicUrl) {
          fsAppleLink.href = nowPlayingSong.appleMusicUrl;
          fsAppleLink.style.display = 'inline-flex';
        } else {
          fsAppleLink.style.display = 'none';
        }
      }
    } else {
      if (fsStationLogo) {
        fsStationLogo.src = station.logo || fallback;
        fsStationLogo.onerror = () => { fsStationLogo.src = fallback; };
        fsStationLogo.alt = station.name;
      }
      if (fsSongCard) {
        fsSongCard.style.display = 'none';
      }
    }

    if (fsStationName) {
      fsStationName.textContent = station.name;
    }
    if (fsStationGenre) {
      fsStationGenre.textContent = station.genre || 'General';
    }
    if (fsStationFreq) {
      fsStationFreq.textContent = station.freq || 'WEB STREAM';
    }

    updateFullscreenStarState();

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
        <div class="station-card ${isCardPlaying ? 'playing' : ''} ${staggerClass}" data-station-id="${escapeHtml(s.id)}" ${staggerStyle} tabindex="0" role="button" aria-label="${escapeHtml(s.name)} - ${isCardPlaying ? 'Sonando actualmente' : 'Reproducir'}">
          <div class="station-card-logo-wrap">
            <img class="station-card-img" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(s.name)}" data-fallback="${escapeHtml(fallbackLogo)}" onerror="this.onerror=null;this.src=this.dataset.fallback;" loading="lazy">
            ${variantBadge ? `<span class="station-variant-badge" title="${escapeHtml(variantBadge)}">${escapeHtml(variantBadge)}</span>` : ''}
            <div class="playing-badge-indicator" aria-hidden="true">
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
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="card-action-btn delete-btn" data-action="delete" title="Eliminar emisora" aria-label="Eliminar emisora">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>

            <!-- Menú '⋯' en Móvil / Táctil -->
            <div class="card-more-wrap">
              <button class="card-action-btn card-more-btn" data-action="card-more" title="Más opciones" aria-haspopup="true" aria-expanded="false" aria-label="Más opciones de ${escapeHtml(s.name)}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle></svg>
              </button>
              <div class="card-menu-dropdown" role="menu">
                <button class="card-action-btn card-menu-item edit-btn" data-action="edit" title="Editar emisora" role="menuitem">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  <span>Editar</span>
                </button>
                <button class="card-action-btn card-menu-item delete-btn" data-action="delete" title="Eliminar emisora" role="menuitem">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  <span>Eliminar</span>
                </button>
              </div>
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
          const dropdown = card.querySelector('.card-menu-dropdown');
          const isCurrentlyOpen = dropdown ? dropdown.classList.contains('open') : false;
          // Close all open card dropdowns and clear z-index elevations
          document.querySelectorAll('.card-menu-dropdown.open').forEach(d => {
            d.classList.remove('open');
            d.closest('.station-card')?.classList.remove('menu-open');
            d.parentElement.querySelector('.card-more-btn')?.setAttribute('aria-expanded', 'false');
          });
          if (dropdown && !isCurrentlyOpen) {
            dropdown.classList.add('open');
            card.classList.add('menu-open');
            actionBtn.setAttribute('aria-expanded', 'true');
            const firstItem = dropdown.querySelector('.card-menu-item');
            if (firstItem && e.detail === 0) {
              setTimeout(() => firstItem.focus(), 50);
            }
          }
          return;
        }

        // Close any open card dropdowns on action click
        document.querySelectorAll('.card-menu-dropdown.open').forEach(d => {
          d.classList.remove('open');
          d.closest('.station-card')?.classList.remove('menu-open');
          d.parentElement.querySelector('.card-more-btn')?.setAttribute('aria-expanded', 'false');
        });

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
          if (confirm(`¿Eliminar la emisora "${station.name}"?`)) {
            stations = stations.filter(s => s.id !== stationId);
            saveStations();
            if (currentStation && currentStation.id === stationId) {
              currentPlaybackToken++;
              if (connectionTimeoutTimer) {
                clearTimeout(connectionTimeoutTimer);
                connectionTimeoutTimer = null;
              }
              if (hls) {
                try { hls.destroy(); } catch (e) {}
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
      fsProxyIndicator.textContent = useProxyForced ? 'PROXY ACTIVO' : 'DIRECTO';
      fsProxyIndicator.style.color = useProxyForced ? 'var(--accent-amber)' : 'var(--accent-cyan)';
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

  function showToast(msg) {
    if (!msg) return;
    const now = Date.now();
    // Do not repeat the exact same message within 2.5 seconds
    if (msg === lastToastMsg && now - lastToastTime < 2500) {
      return;
    }
    lastToastMsg = msg;
    lastToastTime = now;

    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
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
      <span>${escapeHtml(msg)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3000);
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
  let hasPushedFullscreenHistory = false;

  // Limpiar cualquier estado residual de pantalla completa si el usuario recargó la página
  if (window.history && history.state && history.state.fullscreenPlayer) {
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) {}
  }

  function openFullscreenPlayer() {
    if (!fsOverlay) return;
    const wasAlreadyOpen = isFullscreenPlayerOpen;
    isFullscreenPlayerOpen = true;
    stopVisualizer();
    fsOverlay.classList.add('open');
    fsOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

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
  }

  function closeFullscreenPlayer(fromPopState = false) {
    if (!fsOverlay || !isFullscreenPlayerOpen) return;
    const isPop = (fromPopState === true);
    isFullscreenPlayerOpen = false;
    fsOverlay.classList.remove('open');
    fsOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    stopFsVisualizer();
    if (isPlaying && window.innerWidth > 680) {
      startVisualizer();
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

  // Fullscreen Visualizer (Cleanly retired for minimalist Now Playing view)
  function stopFsVisualizer() {
    if (fsAnimFrameId) {
      cancelAnimationFrame(fsAnimFrameId);
      fsAnimFrameId = null;
    }
  }
  function resizeFsCanvas() {}
  function drawIdleFsVisualizer() {}
  function startFsVisualizer() {}

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

  if (bottomBarLeft) {
    bottomBarLeft.addEventListener('click', openFullscreenPlayer);
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
      const openCardDropdown = document.querySelector('.card-menu-dropdown.open');
      if (openCardDropdown) {
        openCardDropdown.classList.remove('open');
        openCardDropdown.closest('.station-card')?.classList.remove('menu-open');
        const moreBtn = openCardDropdown.parentElement.querySelector('.card-more-btn');
        if (moreBtn) {
          moreBtn.setAttribute('aria-expanded', 'false');
          moreBtn.focus();
        }
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

    // If auto-sync is enabled, download updates from cloud
    if (localStorage.getItem('at_radio_autosync') === 'true') {
      downloadStationsFromCloud();
    }
  });

})();
