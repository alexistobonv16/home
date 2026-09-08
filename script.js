/**
 * ALEXIS TOBÓN - HOME & PROJECT SHOWCASE
 * Client-side script for Live Previews, Command Palette (Ctrl+K), NotiTec Feed & Contact Form
 */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initResponsiveDefaults();
  initIframeScaling();
  initIframeLoaders();
  initDeviceToggles();
  initReloadButtons();
  initCopyButtons();
  initInteractionHandlers();
  initFullscreenModal();
  initFooterYear();
  initCommandPalette();
  initNotiTecFeed();
  initContactForm();
});

/* ==========================================================================
   1. THEME TOGGLE (DARK / LIGHT)
   ========================================================================== */
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('at_theme', newTheme);
  showToast(newTheme === 'dark' ? 'Tema oscuro activado' : 'Tema claro activado');
}

function initTheme() {
  const themeToggleBtn = document.getElementById('theme-toggle');
  const storedTheme = localStorage.getItem('at_theme');

  if (storedTheme) {
    document.documentElement.setAttribute('data-theme', storedTheme);
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }
}

/* ==========================================================================
   2. RESPONSIVE DEFAULTS
   Sets smart default views based on device screen size and project type
   ========================================================================== */
function initResponsiveDefaults() {
  const isMobileScreen = window.innerWidth <= 768;
  const browserWindows = document.querySelectorAll('.browser-window');

  browserWindows.forEach(bw => {
    const project = bw.getAttribute('data-project');
    
    // On mobile devices, both projects default to mobile view for full-width clarity
    // On desktop, Mis Gastos defaults to mobile (PWA) and NotiTec to desktop
    let defaultView = 'desktop';
    if (isMobileScreen || project === 'gastos') {
      defaultView = 'mobile';
    }

    bw.setAttribute('data-view', defaultView);

    // Sync button states
    const btns = bw.querySelectorAll('.device-btn');
    btns.forEach(btn => {
      if (btn.getAttribute('data-view-target') === defaultView) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  });
}

/* ==========================================================================
   3. DYNAMIC IFRAME SCALING
   Computes exact scale factor for desktop views without distortion
   ========================================================================== */
function initIframeScaling() {
  const browserWindows = document.querySelectorAll('.browser-window');

  function updateScales() {
    browserWindows.forEach(bw => {
      const viewport = bw.querySelector('.browser-viewport');
      if (!viewport) return;

      const viewportWidth = viewport.clientWidth;
      
      // Desktop scaling: baseline is 1280px wide
      const desktopScale = Math.min(1, viewportWidth / 1280);
      bw.style.setProperty('--scale', desktopScale.toFixed(4));
    });
  }

  // Initial calculation
  updateScales();

  // Recalculate on resize (debounced)
  let resizeTimeout;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeTimeout);
    resizeTimeout = requestAnimationFrame(updateScales);
  });
}

/* ==========================================================================
   4. IFRAME LOADERS & ERROR HANDLING
   ========================================================================== */
function initIframeLoaders() {
  const previewIframes = document.querySelectorAll('.browser-window .preview-iframe');

  previewIframes.forEach(iframe => {
    const windowEl = iframe.closest('.browser-window');
    const loader = windowEl.querySelector('.iframe-loader');

    iframe.addEventListener('load', () => {
      if (loader) {
        loader.classList.add('hidden');
      }
    });

    // Fallback: hide loader after 6 seconds even if onload is blocked or slow
    setTimeout(() => {
      if (loader && !loader.classList.contains('hidden')) {
        loader.classList.add('hidden');
      }
    }, 6000);
  });
}

/* ==========================================================================
   5. DEVICE VIEW TOGGLE (DESKTOP VS MOBILE)
   ========================================================================== */
function initDeviceToggles() {
  const toggleButtons = document.querySelectorAll('.device-btn');

  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-view-target');
      const browserWindow = btn.closest('.browser-window');
      if (!browserWindow) return;

      // Update active state on buttons within this window
      const siblingBtns = browserWindow.querySelectorAll('.device-btn');
      siblingBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update view mode on the browser window
      browserWindow.setAttribute('data-view', targetView);

      // Trigger resize update for smooth scaling
      window.dispatchEvent(new Event('resize'));
    });
  });
}

/* ==========================================================================
   6. RELOAD BUTTON
   ========================================================================== */
function initReloadButtons() {
  const reloadButtons = document.querySelectorAll('.reload-btn');

  reloadButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const browserWindow = btn.closest('.browser-window');
      if (!browserWindow) return;

      const iframe = browserWindow.querySelector('.preview-iframe');
      const loader = browserWindow.querySelector('.iframe-loader');

      if (iframe) {
        if (loader) loader.classList.remove('hidden');

        // Add visual spin to the reload icon
        const svg = btn.querySelector('svg');
        if (svg) svg.style.transform = 'rotate(360deg)';
        setTimeout(() => { if (svg) svg.style.transform = ''; }, 600);

        // Reload iframe source
        const currentSrc = iframe.src;
        iframe.src = '';
        setTimeout(() => {
          iframe.src = currentSrc;
        }, 50);
      }
    });
  });
}

/* ==========================================================================
   7. COPY URL BUTTON & TOAST NOTIFICATION
   ========================================================================== */
function copyToClipboard(text, message) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(message || `Copiado: ${text}`);
    }).catch(() => fallbackCopy(text, message));
  } else {
    fallbackCopy(text, message);
  }
}

function fallbackCopy(text, message) {
  const tempInput = document.createElement('input');
  tempInput.value = text;
  document.body.appendChild(tempInput);
  tempInput.select();
  document.execCommand('copy');
  document.body.removeChild(tempInput);
  showToast(message || `Copiado: ${text}`);
}

function initCopyButtons() {
  const copyBtns = document.querySelectorAll('.copy-url-btn');

  copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const urlToCopy = btn.getAttribute('data-copy');
      if (urlToCopy) {
        copyToClipboard(urlToCopy, `Enlace copiado: ${urlToCopy}`);
      }
    });
  });
}

function copyEmail() {
  copyToClipboard('alexis@alexistobon.com', 'Correo copiado: alexis@alexistobon.com');
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = message;
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

/* ==========================================================================
   8. INTERACTION HANDLERS & NAVIGATION BARRIER
   ========================================================================== */
function initInteractionHandlers() {
  const browserWindows = document.querySelectorAll('.browser-window');

  browserWindows.forEach(bw => {
    const barrier = bw.querySelector('.interaction-barrier');
    const exitBtn = bw.querySelector('.interactive-exit-btn');
    const header = bw.querySelector('.browser-header');

    if (barrier) {
      barrier.addEventListener('click', () => {
        bw.classList.add('interactive');
        showToast('Navegación interactiva activada');
      });
    }

    if (exitBtn) {
      exitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        bw.classList.remove('interactive');
        showToast('Scroll de página restaurado');
      });
    }

    if (header) {
      header.addEventListener('click', (e) => {
        if (!e.target.closest('button') && !e.target.closest('a')) {
          if (bw.classList.contains('interactive')) {
            bw.classList.remove('interactive');
            showToast('Scroll de página restaurado');
          }
        }
      });
    }

    let leaveTimer;
    bw.addEventListener('mouseleave', () => {
      leaveTimer = setTimeout(() => {
        bw.classList.remove('interactive');
      }, 2000);
    });

    bw.addEventListener('mouseenter', () => {
      clearTimeout(leaveTimer);
    });
  });
}

/* ==========================================================================
   9. FULLSCREEN MODAL VIEWER
   ========================================================================== */
function openModal(url, title) {
  const modal = document.getElementById('fullscreen-modal');
  const modalIframe = document.getElementById('modal-iframe');
  const modalTitle = document.getElementById('modal-project-title');
  const modalUrlDisplay = document.getElementById('modal-url-display');
  const modalExternalLink = document.getElementById('modal-external-link');
  const modalLoader = document.getElementById('modal-loader');

  if (!modal || !modalIframe) return;

  modalTitle.textContent = title || 'Visor en Vivo';
  modalUrlDisplay.textContent = url;
  modalExternalLink.setAttribute('href', url);

  if (modalLoader) modalLoader.classList.remove('hidden');

  modalIframe.src = url;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const modal = document.getElementById('fullscreen-modal');
  const modalIframe = document.getElementById('modal-iframe');
  if (!modal) return;

  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (modalIframe) modalIframe.src = '';
}

function initFullscreenModal() {
  const modal = document.getElementById('fullscreen-modal');
  const modalIframe = document.getElementById('modal-iframe');
  const modalLoader = document.getElementById('modal-loader');
  const closeBtn = document.getElementById('modal-close-btn');
  const modalReloadBtn = document.getElementById('modal-reload-btn');
  const backdrop = modal?.querySelector('.modal-backdrop');
  const triggerCloseDots = modal?.querySelectorAll('.modal-close-trigger');

  if (!modal || !modalIframe) return;

  const openButtons = document.querySelectorAll('.open-fullscreen-btn');
  openButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = btn.getAttribute('data-url');
      const title = btn.getAttribute('data-title') || 'Vista en Vivo';
      if (url) openModal(url, title);
    });
  });

  modalIframe.addEventListener('load', () => {
    if (modalLoader) modalLoader.classList.add('hidden');
  });

  if (modalReloadBtn) {
    modalReloadBtn.addEventListener('click', () => {
      if (modalLoader) modalLoader.classList.remove('hidden');
      const current = modalIframe.src;
      modalIframe.src = '';
      setTimeout(() => { modalIframe.src = current; }, 50);
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);
  triggerCloseDots?.forEach(dot => dot.addEventListener('click', closeModal));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });
}

function scrollToSection(selector) {
  const el = document.querySelector(selector);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

/* ==========================================================================
   FEATURE 2: COMMAND PALETTE (CTRL + K / CMD + K)
   ========================================================================== */
function initCommandPalette() {
  const modal = document.getElementById('cmd-palette-modal');
  const input = document.getElementById('cmd-palette-input');
  const resultsContainer = document.getElementById('cmd-palette-results');
  const triggerBtn = document.getElementById('cmd-k-trigger');
  const backdrop = modal?.querySelector('.cmd-palette-backdrop');

  if (!modal || !input || !resultsContainer) return;

  // Detect Mac vs Windows/Linux for shortcut display
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const keyBadge = triggerBtn?.querySelector('.cmd-k-key');
  if (keyBadge && isMac) {
    keyBadge.textContent = '⌘K';
  }

  // Command Definitions
  const COMMANDS = [
    {
      id: 'proj-notitec',
      group: 'Proyectos en Directo',
      title: 'Ver NotiTec en vivo',
      desc: 'Medio de tecnología, ciencia e IA (notitec.co)',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path></svg>',
      action: () => scrollToSection('#project-notitec')
    },
    {
      id: 'proj-gastos',
      group: 'Proyectos en Directo',
      title: 'Ver Mis Gastos en vivo',
      desc: 'PWA de control de finanzas y presupuestos',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="2" x2="22" y1="10" y2="10"></line></svg>',
      action: () => scrollToSection('#project-gastos')
    },
    {
      id: 'fs-notitec',
      group: 'Proyectos en Directo',
      title: 'NotiTec en Pantalla Completa',
      desc: 'Abrir visor expandido inmersivo',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>',
      action: () => openModal('https://www.notitec.co', 'NotiTec - notitec.co')
    },
    {
      id: 'fs-gastos',
      group: 'Proyectos en Directo',
      title: 'Mis Gastos en Pantalla Completa',
      desc: 'Abrir visor expandido inmersivo',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>',
      action: () => openModal('https://gastos.alexistobon.com', 'Mis Gastos - gastos.alexistobon.com')
    },
    {
      id: 'nav-articulos',
      group: 'Navegación',
      title: 'Últimos Artículos NotiTec',
      desc: 'Explorar publicaciones recientes sobre tecnología',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
      action: () => scrollToSection('#articulos')
    },
    {
      id: 'nav-sobre-mi',
      group: 'Navegación',
      title: 'Sobre Alexis Tobón',
      desc: 'Perfil, stack tecnológico y experiencia',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
      action: () => scrollToSection('#sobre-mi')
    },
    {
      id: 'nav-contacto',
      group: 'Navegación',
      title: 'Formulario de Contacto',
      desc: 'Enviar mensaje directo para nuevos proyectos',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>',
      action: () => scrollToSection('#contacto')
    },
    {
      id: 'act-theme',
      group: 'Acciones Rápidas',
      title: 'Alternar Modo Oscuro / Claro',
      desc: 'Cambiar el tema visual de la página',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line></svg>',
      action: () => toggleTheme()
    },
    {
      id: 'act-copy-email',
      group: 'Acciones Rápidas',
      title: 'Copiar correo electrónico',
      desc: 'alexis@alexistobon.com',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
      action: () => copyEmail()
    },
    {
      id: 'ext-github',
      group: 'Enlaces Externos',
      title: 'Abrir GitHub de Alexis',
      desc: 'github.com/alexistobonv16',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
      action: () => window.open('https://github.com/alexistobonv16', '_blank')
    },
    {
      id: 'ext-linkedin',
      group: 'Enlaces Externos',
      title: 'Abrir LinkedIn de Alexis',
      desc: 'linkedin.com/in/alexistobon',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
      action: () => window.open('https://linkedin.com/in/alexistobon', '_blank')
    }
  ];

  let selectedIndex = 0;
  let filteredCommands = [...COMMANDS];

  function renderCommands() {
    resultsContainer.innerHTML = '';

    if (filteredCommands.length === 0) {
      resultsContainer.innerHTML = '<div class="cmd-empty-state">No se encontraron resultados para tu búsqueda</div>';
      return;
    }

    // Group commands
    const groups = {};
    filteredCommands.forEach(cmd => {
      if (!groups[cmd.group]) groups[cmd.group] = [];
      groups[cmd.group].push(cmd);
    });

    let globalIdx = 0;
    Object.keys(groups).forEach(groupName => {
      const groupTitle = document.createElement('div');
      groupTitle.className = 'cmd-group-title';
      groupTitle.textContent = groupName;
      resultsContainer.appendChild(groupTitle);

      groups[groupName].forEach(cmd => {
        const itemEl = document.createElement('div');
        itemEl.className = 'cmd-palette-item' + (globalIdx === selectedIndex ? ' active' : '');
        itemEl.setAttribute('data-index', globalIdx);

        itemEl.innerHTML = `
          <div class="cmd-item-left">
            <span class="cmd-item-icon">${cmd.icon}</span>
            <div>
              <div class="cmd-item-title">${cmd.title}</div>
              <div class="cmd-item-shortcut">${cmd.desc}</div>
            </div>
          </div>
          <span class="cmd-item-shortcut">↵</span>
        `;

        itemEl.addEventListener('click', () => {
          closeCmdPalette();
          cmd.action();
        });

        resultsContainer.appendChild(itemEl);
        globalIdx++;
      });
    });

    scrollActiveIntoView();
  }

  function scrollActiveIntoView() {
    const activeEl = resultsContainer.querySelector('.cmd-palette-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function filterCommands(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      filteredCommands = [...COMMANDS];
    } else {
      filteredCommands = COMMANDS.filter(cmd => 
        cmd.title.toLowerCase().includes(q) ||
        cmd.desc.toLowerCase().includes(q) ||
        cmd.group.toLowerCase().includes(q)
      );
    }
    selectedIndex = 0;
    renderCommands();
  }

  function openCmdPalette() {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    input.value = '';
    filterCommands('');
    setTimeout(() => input.focus(), 50);
  }

  function closeCmdPalette() {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }

  // Keyboard shortcut Ctrl+K or Cmd+K
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (modal.classList.contains('active')) {
        closeCmdPalette();
      } else {
        openCmdPalette();
      }
    }

    if (!modal.classList.contains('active')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeCmdPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredCommands.length > 0) {
        selectedIndex = (selectedIndex + 1) % filteredCommands.length;
        updateActiveItem();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredCommands.length > 0) {
        selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
        updateActiveItem();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        closeCmdPalette();
        filteredCommands[selectedIndex].action();
      }
    }
  });

  function updateActiveItem() {
    const items = resultsContainer.querySelectorAll('.cmd-palette-item');
    items.forEach((item, idx) => {
      if (idx === selectedIndex) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
    scrollActiveIntoView();
  }

  input.addEventListener('input', (e) => {
    filterCommands(e.target.value);
  });

  if (triggerBtn) triggerBtn.addEventListener('click', openCmdPalette);
  if (backdrop) backdrop.addEventListener('click', closeCmdPalette);
}

/* ==========================================================================
   FEATURE 1: NOTITEC RECENT ARTICLES FEED
   ========================================================================== */
async function initNotiTecFeed() {
  const grid = document.getElementById('articles-grid');
  if (!grid) return;

  try {
    // Attempt fetching from Cloudflare Pages Function proxy or public RSS parser
    let xmlText = null;
    try {
      const edgeRes = await fetch('/api/notitec-feed', { cache: 'default' });
      if (edgeRes.ok) {
        xmlText = await edgeRes.text();
      }
    } catch (_) {}

    if (!xmlText) {
      // Fallback through public CORS proxy
      const fallbackRes = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent('https://www.notitec.co/rss.xml'));
      if (fallbackRes.ok) {
        xmlText = await fallbackRes.text();
      }
    }

    if (!xmlText) return;

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const items = Array.from(xmlDoc.querySelectorAll('item')).slice(0, 3);

    if (items.length === 0) return;

    // Build new cards dynamically
    const newCardsHtml = items.map(item => {
      const title = item.querySelector('title')?.textContent || 'Noticia de Tecnología';
      const link = item.querySelector('link')?.textContent || 'https://www.notitec.co';
      const category = item.querySelector('category')?.textContent || 'Tecnología';
      const rawDate = item.querySelector('pubDate')?.textContent || '';
      let dateStr = '';
      if (rawDate) {
        const d = new Date(rawDate);
        dateStr = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
      }

      let desc = item.querySelector('description')?.textContent || '';
      desc = desc.replace(/<[^>]*>/g, '').trim();
      if (desc.length > 150) desc = desc.slice(0, 147) + '...';

      return `
        <article class="article-card">
          <div class="article-card-header">
            <span class="badge badge-brand">${escapeHtml(category)}</span>
            <time class="article-date">${escapeHtml(dateStr)}</time>
          </div>
          <h3 class="article-title">
            <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>
          </h3>
          <p class="article-excerpt">${escapeHtml(desc)}</p>
          <div class="article-footer">
            <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="article-link">
              <span>Leer artículo completo</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </a>
          </div>
        </article>
      `;
    }).join('');

    grid.innerHTML = newCardsHtml;
  } catch (e) {
    // If anything fails, initial static cards remain intact without breaking layout
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

/* ==========================================================================
   FEATURE 3: INTERACTIVE CONTACT FORM
   ========================================================================== */
function initContactForm() {
  const form = document.getElementById('contact-form');
  const submitBtn = document.getElementById('contact-submit-btn');
  const feedback = document.getElementById('form-feedback');

  if (!form || !submitBtn || !feedback) return;

  const btnText = submitBtn.querySelector('.btn-text');
  const sendIcon = submitBtn.querySelector('.send-icon');
  const spinner = submitBtn.querySelector('.btn-spinner');

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = form.querySelector('#contact-name')?.value.trim();
    const email = form.querySelector('#contact-email')?.value.trim();
    const subject = form.querySelector('#contact-subject')?.value.trim() || 'Consulta desde alexistobon.com';
    const message = form.querySelector('#contact-message')?.value.trim();

    if (!name || !email || !message) {
      showFeedback('Por favor completa todos los campos requeridos.', 'error');
      return;
    }

    // Set loading state
    submitBtn.disabled = true;
    if (btnText) btnText.textContent = 'Enviando...';
    if (sendIcon) sendIcon.style.display = 'none';
    if (spinner) spinner.style.display = 'inline-block';

    setTimeout(() => {
      // Build mailto URI as immediate guarantee
      const fullSubject = encodeURIComponent(`[${subject}] Mensaje de ${name}`);
      const body = encodeURIComponent(
        `Nombre: ${name}\n` +
        `Correo: ${email}\n` +
        `Asunto: ${subject}\n\n` +
        `Mensaje:\n${message}\n\n` +
        `---\nEnviado desde el formulario de alexistobon.com`
      );

      const mailtoUrl = `mailto:alexis@alexistobon.com?subject=${fullSubject}&body=${body}`;

      // Open mail client
      window.location.href = mailtoUrl;

      // Copy message to clipboard for convenience
      const rawText = `De: ${name} (${email})\nAsunto: ${subject}\n\n${message}`;
      copyToClipboard(rawText, 'Copia del mensaje guardada en portapapeles');

      // Reset button state
      submitBtn.disabled = false;
      if (btnText) btnText.textContent = 'Mensaje Preparado';
      if (sendIcon) sendIcon.style.display = 'inline-block';
      if (spinner) spinner.style.display = 'none';

      showFeedback(
        `¡Gracias ${name}! Se ha abierto tu gestor de correo para enviar el mensaje a alexis@alexistobon.com. Además, copiamos el texto a tu portapapeles por seguridad.`,
        'success'
      );

      form.reset();
    }, 600);
  });

  function showFeedback(text, type) {
    feedback.textContent = text;
    feedback.className = `form-feedback ${type}`;
    feedback.style.display = 'block';
  }
}

/* ==========================================================================
   10. FOOTER YEAR
   ========================================================================== */
function initFooterYear() {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}
