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
  initQrModal();
  initPingMonitor();
  hydrateProjectsAndContact();
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
    // Respect the view configured in data-default-view or data-view
    const configuredView = bw.getAttribute('data-default-view') || bw.getAttribute('data-view') || 'desktop';
    const targetView = isMobileScreen ? 'mobile' : configuredView;

    bw.setAttribute('data-view', targetView);

    // Sync button states
    const btns = bw.querySelectorAll('.device-btn');
    btns.forEach(btn => {
      if (btn.getAttribute('data-view-target') === targetView) {
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
  function updateScales() {
    const browserWindows = document.querySelectorAll('.browser-window');
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

  if (!window._iframeScalingResizeBound) {
    window._iframeScalingResizeBound = true;
    let resizeTimeout;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeTimeout);
      resizeTimeout = requestAnimationFrame(updateScales);
    });
  }
}

/* ==========================================================================
   4. IFRAME LOADERS & ERROR HANDLING
   ========================================================================== */
function initIframeLoaders() {
  const previewIframes = document.querySelectorAll('.browser-window .preview-iframe');

  previewIframes.forEach(iframe => {
    if (iframe._loaderBound) return;
    iframe._loaderBound = true;

    const windowEl = iframe.closest('.browser-window');
    const loader = windowEl?.querySelector('.iframe-loader');

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
let deviceTogglesInit = false;
function initDeviceToggles() {
  if (deviceTogglesInit) return;
  deviceTogglesInit = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.device-btn');
    if (!btn) return;

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
}

/* ==========================================================================
   6. RELOAD BUTTON
   ========================================================================== */
let reloadButtonsInit = false;
function initReloadButtons() {
  if (reloadButtonsInit) return;
  reloadButtonsInit = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.reload-btn');
    if (!btn) return;

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

let copyButtonsInit = false;
function initCopyButtons() {
  if (copyButtonsInit) return;
  copyButtonsInit = true;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-url-btn');
    if (!btn) return;
    const urlToCopy = btn.getAttribute('data-copy');
    if (urlToCopy) {
      copyToClipboard(urlToCopy, `Enlace copiado: ${urlToCopy}`);
    }
  });
}

function copyEmail() {
  copyToClipboard('admin@alexistobon.com', 'Correo copiado: admin@alexistobon.com');
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
let interactionDelegationInit = false;
function initInteractionHandlers() {
  if (!interactionDelegationInit) {
    interactionDelegationInit = true;

    document.addEventListener('click', (e) => {
      const barrier = e.target.closest('.interaction-barrier');
      if (barrier) {
        const bw = barrier.closest('.browser-window');
        if (bw) {
          bw.classList.add('interactive');
          showToast('Navegación interactiva activada');
        }
        return;
      }

      const exitBtn = e.target.closest('.interactive-exit-btn');
      if (exitBtn) {
        e.stopPropagation();
        const bw = exitBtn.closest('.browser-window');
        if (bw) {
          bw.classList.remove('interactive');
          showToast('Scroll de página restaurado');
        }
        return;
      }

      const header = e.target.closest('.browser-header');
      if (header && !e.target.closest('button') && !e.target.closest('a')) {
        const bw = header.closest('.browser-window');
        if (bw && bw.classList.contains('interactive')) {
          bw.classList.remove('interactive');
          showToast('Scroll de página restaurado');
        }
      }
    });
  }

  const browserWindows = document.querySelectorAll('.browser-window');
  browserWindows.forEach(bw => {
    if (bw._interactionLeaveBound) return;
    bw._interactionLeaveBound = true;

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

let fullscreenInit = false;
function initFullscreenModal() {
  const modal = document.getElementById('fullscreen-modal');
  const modalIframe = document.getElementById('modal-iframe');
  const modalLoader = document.getElementById('modal-loader');
  const closeBtn = document.getElementById('modal-close-btn');
  const modalReloadBtn = document.getElementById('modal-reload-btn');
  const backdrop = modal?.querySelector('.modal-backdrop');
  const triggerCloseDots = modal?.querySelectorAll('.modal-close-trigger');

  if (!modal || !modalIframe) return;

  if (!fullscreenInit) {
    fullscreenInit = true;

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.open-fullscreen-btn');
      if (!btn) return;
      e.preventDefault();
      const url = btn.getAttribute('data-url');
      const title = btn.getAttribute('data-title') || 'Vista en Vivo';
      if (url) openModal(url, title);
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
  let dynamicProjectCommands = [
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
    }
  ];

  const staticCommands = [
    {
      id: 'nav-admin',
      group: 'Administración',
      title: 'Panel de Administración',
      desc: 'Gestionar proyectos y sitios en vivo (/admin)',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
      action: () => window.location.href = '/admin'
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
      desc: 'admin@alexistobon.com',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
      action: () => copyEmail()
    },
    {
      id: 'act-open-qr',
      group: 'Acciones Rápidas',
      title: 'Abrir Tarjeta QR y Compartir',
      desc: 'Código QR y compartir perfil',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
      action: () => openQrModal()
    },
    {
      id: 'act-download-vcard',
      group: 'Acciones Rápidas',
      title: 'Descargar Contacto (.vcf)',
      desc: 'Guardar Alexis Tobón en tu agenda',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>',
      action: () => downloadVCard()
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

  let COMMANDS = [...dynamicProjectCommands, ...staticCommands];
  let selectedIndex = 0;
  let filteredCommands = [...COMMANDS];

  window.updateCommandPaletteProjects = function(projects) {
    if (!Array.isArray(projects) || !projects.length) return;
    dynamicProjectCommands = [];
    projects.forEach(p => {
      const dom = p.domain || (p.url ? p.url.replace(/^https?:\/\//, '') : '');
      dynamicProjectCommands.push({
        id: `proj-${p.id}`,
        group: 'Proyectos en Directo',
        title: `Ver ${p.title} en vivo`,
        desc: `${p.badge || 'Proyecto'} (${dom})`,
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path></svg>',
        action: () => scrollToSection(`#project-${p.id}`)
      });
      dynamicProjectCommands.push({
        id: `fs-${p.id}`,
        group: 'Proyectos en Directo',
        title: `${p.title} en Pantalla Completa`,
        desc: `Abrir visor expandido inmersivo (${dom})`,
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>',
        action: () => openModal(p.url, `${p.title} - ${dom}`)
      });
    });
    COMMANDS = [...dynamicProjectCommands, ...staticCommands];
    filterCommands(input.value.trim());
  };

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
   FEATURE 3: SILENT BACKGROUND CONTACT FORM (to admin@alexistobon.com)
   ========================================================================== */
function initContactForm() {
  const form = document.getElementById('contact-form');
  const submitBtn = document.getElementById('contact-submit-btn');
  const feedback = document.getElementById('form-feedback');

  if (!form || !submitBtn || !feedback) return;

  const btnText = submitBtn.querySelector('.btn-text');
  const sendIcon = submitBtn.querySelector('.send-icon');
  const spinner = submitBtn.querySelector('.btn-spinner');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = form.querySelector('#contact-name')?.value.trim();
    const email = form.querySelector('#contact-email')?.value.trim();
    const subject = form.querySelector('#contact-subject')?.value.trim() || 'Consulta desde alexistobon.com';
    const message = form.querySelector('#contact-message')?.value.trim();

    if (!name || !email || !message) {
      showFeedback('Por favor completa todos los campos requeridos.', 'error');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showFeedback('Por favor ingresa un correo electrónico válido.', 'error');
      return;
    }

    // Set loading state
    submitBtn.disabled = true;
    if (btnText) btnText.textContent = 'Enviando...';
    if (sendIcon) sendIcon.style.display = 'none';
    if (spinner) spinner.style.display = 'inline-block';

    try {
      // 1. Try via Cloudflare Function
      let data = {};
      let isSuccess = false;

      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ name, email, subject, message })
        });
        data = await response.json().catch(() => ({}));
        if (response.ok && (data.success === true || data.success === 'true')) {
          isSuccess = true;
        }
      } catch (proxyErr) {
        data = {};
      }

      // Check if FormSubmit activation is required
      if (data.needsActivation || (data.message && data.message.toLowerCase().includes('activation'))) {
        showFeedback(
          `📬 <strong>¡Acción requerida (única vez)!</strong> FormSubmit ha enviado un correo a <strong>admin@alexistobon.com</strong> con el botón <em>"Activate Form"</em>. Por favor abre tu bandeja y haz clic en ese enlace para activar el formulario permanentemente.`,
          'info'
        );
        showToast('Revisa admin@alexistobon.com para activar');
        return;
      }

      // 2. If function succeeded
      if (isSuccess) {
        showFeedback(
          `¡Gracias ${escapeHtml(name)}! Tu mensaje ha sido enviado directamente a <strong>admin@alexistobon.com</strong>. Te responderé lo más pronto posible a <em>${escapeHtml(email)}</em>.`,
          'success'
        );
        form.reset();
        showToast('Mensaje enviado con éxito a admin@alexistobon.com');
        return;
      }

      // 3. Fallback: try direct client-side to FormSubmit AJAX
      const directResponse = await fetch('https://formsubmit.co/ajax/admin@alexistobon.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          _subject: `[${subject}] Mensaje de ${name} vía alexistobon.com`,
          Nombre: name,
          Email: email,
          Asunto: subject,
          Mensaje: message
        })
      });

      const directData = await directResponse.json().catch(() => ({}));

      if (directData.message && directData.message.toLowerCase().includes('activation')) {
        showFeedback(
          `📬 <strong>¡Paso de activación única!</strong> FormSubmit ha enviado un correo a <strong>admin@alexistobon.com</strong>. Solo debes abrirlo y hacer clic en <em>"Activate Form"</em>. A partir de ese momento todos los mensajes llegarán automáticamente.`,
          'info'
        );
        showToast('Revisa admin@alexistobon.com para activar');
        return;
      }

      if (directData.success === 'true' || directData.success === true) {
        showFeedback(
          `¡Gracias ${escapeHtml(name)}! Tu mensaje ha sido enviado directamente a <strong>admin@alexistobon.com</strong>. Te responderé a la brevedad.`,
          'success'
        );
        form.reset();
        showToast('Mensaje enviado con éxito a admin@alexistobon.com');
        return;
      }

      throw new Error(data.error || directData.message || 'No se pudo enviar el mensaje en este momento.');

    } catch (err) {
      // 4. Ultimate graceful fallback to mailto
      const fullSubject = encodeURIComponent(`[${subject}] Mensaje de ${name}`);
      const body = encodeURIComponent(
        `Nombre: ${name}\n` +
        `Correo: ${email}\n` +
        `Asunto: ${subject}\n\n` +
        `Mensaje:\n${message}\n\n` +
        `---\nEnviado desde alexistobon.com`
      );
      const mailtoUrl = `mailto:admin@alexistobon.com?subject=${fullSubject}&body=${body}`;

      showFeedback(
        `Nota: El servicio de envío reportó un detalle temporal (${escapeHtml(err.message)}). Puedes hacer clic para <a href="${mailtoUrl}" class="direct-email-link" style="text-decoration:underline;">enviar directamente a admin@alexistobon.com</a>. Además, guardamos tu mensaje en el portapapeles.`,
        'error'
      );
      copyToClipboard(`De: ${name} (${email})\nAsunto: ${subject}\n\n${message}`);
    } finally {
      submitBtn.disabled = false;
      if (btnText) btnText.textContent = 'Enviar Mensaje';
      if (sendIcon) sendIcon.style.display = 'inline-block';
      if (spinner) spinner.style.display = 'none';
    }
  });

  function showFeedback(htmlContent, type) {
    feedback.innerHTML = htmlContent;
    feedback.className = `form-feedback ${type}`;
    feedback.style.display = 'block';
  }
}

/* ==========================================================================
   FEATURE 4: QR CODE & DIGITAL BUSINESS CARD MODAL (.vcf)
   ========================================================================== */
function downloadVCard() {
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Alexis Tobón',
    'N:Tobón;Alexis;;;',
    'TITLE:Full Stack Developer & Tech Lead',
    'EMAIL;TYPE=INTERNET,WORK:admin@alexistobon.com',
    'URL:https://alexistobon.com',
    'X-SOCIALPROFILE;type=github:https://github.com/alexistobonv16',
    'X-SOCIALPROFILE;type=linkedin:https://linkedin.com/in/alexistobon',
    'NOTE:Portafolio y proyectos en vivo: NotiTec y Mis Gastos',
    'END:VCARD'
  ].join('\r\n');

  const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Alexis_Tobon.vcf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Tarjeta de contacto (.vcf) descargada');
}

function openQrModal() {
  const modal = document.getElementById('qr-modal');
  if (modal) {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeQrModal() {
  const modal = document.getElementById('qr-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function initQrModal() {
  const trigger = document.getElementById('qr-modal-trigger');
  const modal = document.getElementById('qr-modal');
  const closeBtn = document.getElementById('qr-close-btn');
  const backdrop = document.getElementById('qr-backdrop');
  const vcardBtn = document.getElementById('download-vcard-btn');
  const copyBtn = document.getElementById('copy-portfolio-btn');

  if (trigger) trigger.addEventListener('click', openQrModal);
  if (closeBtn) closeBtn.addEventListener('click', closeQrModal);
  if (backdrop) backdrop.addEventListener('click', closeQrModal);

  if (vcardBtn) {
    vcardBtn.addEventListener('click', downloadVCard);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copyToClipboard('https://alexistobon.com', 'Enlace copiado: https://alexistobon.com');
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal?.classList.contains('active')) {
      closeQrModal();
    }
  });
}

/* ==========================================================================
   FEATURE 5: REAL-TIME PING / LATENCY HEALTH CHECK
   ========================================================================== */
async function measurePing(url) {
  const start = performance.now();
  try {
    const pingUrl = url + (url.includes('?') ? '&' : '?') + '_ping=' + Date.now();
    await fetch(pingUrl, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store'
    });
    return Math.round(performance.now() - start);
  } catch (e) {
    return null;
  }
}

let pingIntervalId = null;
function runPingCheck() {
  const badges = document.querySelectorAll('.ping-badge[data-ping-url]');
  if (!badges.length) return;

  badges.forEach(async (badge) => {
    const url = badge.getAttribute('data-ping-url');
    const valEl = badge.querySelector('.ping-val');
    if (!url || !valEl) return;

    const ms = await measurePing(url);
    badge.classList.remove('fast', 'medium', 'slow', 'offline');

    if (ms !== null && !isNaN(ms)) {
      valEl.textContent = `${ms} ms`;
      if (ms < 150) {
        badge.classList.add('fast');
        badge.setAttribute('title', `Latencia excelente: ${ms} ms`);
      } else if (ms < 400) {
        badge.classList.add('medium');
        badge.setAttribute('title', `Latencia normal: ${ms} ms`);
      } else {
        badge.classList.add('slow');
        badge.setAttribute('title', `Latencia moderada: ${ms} ms`);
      }
    } else {
      valEl.textContent = 'En línea';
      badge.classList.add('fast');
      badge.setAttribute('title', 'Servicio en línea y respondiendo');
    }
  });
}

function initPingMonitor() {
  setTimeout(runPingCheck, 800);
  if (!pingIntervalId) {
    pingIntervalId = setInterval(runPingCheck, 45000);
  }
}

/* ==========================================================================
   FOOTER YEAR
   ========================================================================== */
function initFooterYear() {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}

/* ==========================================================================
   FEATURE 6: DYNAMIC HYDRATION & SYNC FROM CLOUDFLARE KV (/api/projects)
   Enables Alexis Tobón to add, edit, reorder or toggle projects via /admin
   without requiring manual code changes or builds.
   ========================================================================== */
function escapeHtml(str) {
  return (str || '').replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

function generateProjectCardHtml(proj, index) {
  const isMobileScreen = window.innerWidth <= 768;
  const isReversed = index % 2 === 1;
  const badgeColorClass = `badge-${proj.badgeColor || 'brand'}`;
  const defaultView = proj.defaultView || 'desktop';
  const effectiveView = isMobileScreen ? 'mobile' : defaultView;
  const tagsHtml = (proj.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const domain = proj.domain || (proj.url ? proj.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'sitio web');

  return `
    <article class="project-showcase ${isReversed ? 'reversed' : ''}" id="project-${proj.id}">
      <div class="project-info">
        <div class="project-meta-top">
          <div class="meta-left-group">
            <span class="badge ${badgeColorClass}">${escapeHtml(proj.badge || 'Proyecto')}</span>
            <span class="status-live-pill">
              <span class="pulse-dot"></span> Online
            </span>
          </div>
          <div class="ping-badge" data-ping-url="${escapeHtml(proj.url)}" title="Latencia medida en tiempo real">
            <span class="ping-dot"></span>
            <span class="ping-val">Ping...</span>
          </div>
        </div>
        <h3 class="project-title">
          <a href="${escapeHtml(proj.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(proj.title)}</a>
        </h3>
        <p class="project-domain">${escapeHtml(domain)}</p>
        <p class="project-description">
          ${escapeHtml(proj.description || '')}
        </p>
        
        <div class="project-tech-tags">
          ${tagsHtml}
        </div>

        <div class="project-links">
          <a href="${escapeHtml(proj.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">
            <span>Visitar ${escapeHtml(domain)}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </a>
          <button class="btn btn-ghost open-fullscreen-btn" data-url="${escapeHtml(proj.url)}" data-title="${escapeHtml(proj.title)} - ${escapeHtml(domain)}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
            <span>Pantalla Completa</span>
          </button>
        </div>

        <div class="preview-tips">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <span>Usa los controles del navegador para alternar entre vista móvil y escritorio.</span>
        </div>
      </div>

      <!-- Live Browser Mockup -->
      <div class="browser-mockup-wrapper">
        <div class="browser-window" data-project="${proj.id}" data-default-view="${defaultView}" data-view="${effectiveView}">
          <!-- Window Chrome / Header -->
          <div class="browser-header">
            <div class="window-dots">
              <span class="dot dot-close"></span>
              <span class="dot dot-minimize"></span>
              <span class="dot dot-maximize"></span>
            </div>

            <div class="browser-address-bar">
              <svg class="ssl-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <span class="url-text">${escapeHtml(proj.url)}</span>
              <button class="copy-url-btn" data-copy="${escapeHtml(proj.url)}" title="Copiar enlace">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>

            <div class="browser-controls">
              <!-- View toggle: Desktop vs Mobile -->
              <div class="device-toggle-group">
                <button class="device-btn ${effectiveView === 'desktop' ? 'active' : ''}" data-view-target="desktop" title="Vista Escritorio">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                </button>
                <button class="device-btn ${effectiveView === 'mobile' ? 'active' : ''}" data-view-target="mobile" title="Vista Móvil">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                </button>
              </div>

              <!-- Reload iframe -->
              <button class="control-btn reload-btn" title="Recargar vista en vivo">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
              </button>

              <!-- Expand fullscreen modal -->
              <button class="control-btn open-fullscreen-btn" data-url="${escapeHtml(proj.url)}" data-title="${escapeHtml(proj.title)} - ${escapeHtml(domain)}" title="Abrir en pantalla completa">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
              </button>
            </div>
          </div>

          <!-- Browser Screen / Iframe Container -->
          <div class="browser-viewport">
            <!-- Loading overlay -->
            <div class="iframe-loader">
              <div class="spinner"></div>
              <span>Cargando ${escapeHtml(domain)} en vivo...</span>
            </div>

            <!-- Interactive scroll barrier/overlay -->
            <div class="interaction-barrier" title="Toca o haz clic para interactuar con la página">
              <div class="barrier-pill">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="m10 15 5-3-5-3v6Z"/></svg>
                <span>Toca para navegar aquí</span>
              </div>
            </div>

            <!-- Floating exit interaction button -->
            <button class="interactive-exit-btn" title="Pausar navegación interactiva y volver al scroll de la página">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              <span>Pausar interacción</span>
            </button>

            <!-- Scaled Iframe -->
            <div class="iframe-scaler">
              <iframe 
                src="${escapeHtml(proj.url)}" 
                class="preview-iframe" 
                loading="lazy" 
                title="Vista en directo de ${escapeHtml(proj.title)}"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms">
              </iframe>
            </div>
          </div>
        </div>
      </div>
    </article>
  `;
}

function applyContactUpdates(c) {
  if (!c) return;

  if (c.email) {
    document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
      link.href = `mailto:${c.email}`;
      const val = link.querySelector('.contact-value');
      if (val) val.textContent = c.email;
    });

    const directNoteLink = document.querySelector('.form-direct-note a');
    if (directNoteLink) {
      directNoteLink.href = `mailto:${c.email}`;
      directNoteLink.textContent = c.email;
    }
  }

  if (c.github) {
    document.querySelectorAll('a[href*="github.com"]').forEach(link => {
      link.href = c.github;
      const val = link.querySelector('.contact-value');
      if (val && c.githubLabel) val.textContent = c.githubLabel;
    });
  }

  if (c.linkedin) {
    document.querySelectorAll('a[href*="linkedin.com"]').forEach(link => {
      link.href = c.linkedin;
      const val = link.querySelector('.contact-value');
      if (val && c.linkedinLabel) val.textContent = c.linkedinLabel;
    });
  }

  if (c.statusText) {
    const statusTextEl = document.querySelector('.status-badge .status-text');
    if (statusTextEl) statusTextEl.textContent = c.statusText;
  }

  if (c.statusAvailable !== undefined) {
    const statusBadge = document.querySelector('.status-badge');
    if (statusBadge) {
      statusBadge.style.display = c.statusAvailable === false ? 'none' : 'inline-flex';
    }
  }
}

function applyProjectsUpdates(projects) {
  const container = document.querySelector('.projects-list');
  if (!container) return;

  const currentShowcases = container.querySelectorAll('.project-showcase');
  const currentIds = Array.from(currentShowcases).map(el => el.id.replace(/^project-/, ''));
  const newIds = projects.map(p => p.id);

  // If project list count or IDs or ordering changed, re-render everything
  const needsFullRerender = currentIds.length !== newIds.length || currentIds.some((id, i) => id !== newIds[i]);

  if (needsFullRerender) {
    const html = projects.map((p, idx) => generateProjectCardHtml(p, idx)).join('');
    container.innerHTML = html;

    const statNum = document.querySelector('.stat-card .stat-number');
    if (statNum) {
      statNum.textContent = `${projects.length}+`;
    }

    initResponsiveDefaults();
    initIframeScaling();
    initIframeLoaders();
    initInteractionHandlers();
    runPingCheck();
  } else {
    // Projects exist in DOM: update properties in-place immediately (no iframe reload!)
    const isMobileScreen = window.innerWidth <= 768;

    projects.forEach(proj => {
      const el = document.getElementById(`project-${proj.id}`);
      if (!el) return;

      const bw = el.querySelector('.browser-window');
      if (bw) {
        const defaultView = proj.defaultView || 'desktop';
        bw.setAttribute('data-default-view', defaultView);

        const targetView = isMobileScreen ? 'mobile' : defaultView;
        bw.setAttribute('data-view', targetView);

        // Update active class on desktop/mobile device toggle buttons
        const btns = bw.querySelectorAll('.device-btn');
        btns.forEach(b => {
          if (b.getAttribute('data-view-target') === targetView) {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
      }

      // Title & URL
      const titleLink = el.querySelector('.project-title a');
      if (titleLink) {
        titleLink.textContent = proj.title;
        titleLink.href = proj.url;
      }

      // Domain
      const domainEl = el.querySelector('.project-domain');
      if (domainEl) domainEl.textContent = proj.domain || '';

      // Description
      const descEl = el.querySelector('.project-description');
      if (descEl) descEl.textContent = proj.description || '';

      // Badge & Color
      const badgeEl = el.querySelector('.badge');
      if (badgeEl) {
        badgeEl.textContent = proj.badge || 'Proyecto';
        badgeEl.className = `badge badge-${proj.badgeColor || 'brand'}`;
      }

      // Tech tags
      const tagsContainer = el.querySelector('.project-tech-tags');
      if (tagsContainer && Array.isArray(proj.tags)) {
        tagsContainer.innerHTML = proj.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
      }

      // Visit button
      const visitLink = el.querySelector('.project-links .btn-outline');
      if (visitLink) {
        visitLink.href = proj.url;
        const span = visitLink.querySelector('span');
        if (span) span.textContent = `Visitar ${proj.domain || 'sitio'}`;
      }

      // Fullscreen button
      const fsBtn = el.querySelector('.project-links .open-fullscreen-btn');
      if (fsBtn) {
        fsBtn.setAttribute('data-url', proj.url);
        fsBtn.setAttribute('data-title', `${proj.title} - ${proj.domain || proj.url}`);
      }

      // Address bar
      const urlText = el.querySelector('.browser-address-bar .url-text');
      if (urlText) urlText.textContent = proj.url;

      const copyBtn = el.querySelector('.copy-url-btn');
      if (copyBtn) copyBtn.setAttribute('data-copy', proj.url);

      const fsControlBtn = el.querySelector('.browser-controls .open-fullscreen-btn');
      if (fsControlBtn) {
        fsControlBtn.setAttribute('data-url', proj.url);
        fsControlBtn.setAttribute('data-title', `${proj.title} - ${proj.domain || proj.url}`);
      }

      // Ping url
      const pingBadge = el.querySelector('.ping-badge');
      if (pingBadge) pingBadge.setAttribute('data-ping-url', proj.url);
    });

    // Recalculate iframe scale factor for the updated views
    initIframeScaling();
    window.dispatchEvent(new Event('resize'));
    runPingCheck();
  }

  if (typeof window.updateCommandPaletteProjects === 'function') {
    window.updateCommandPaletteProjects(projects);
  }
}

async function hydrateProjectsAndContact() {
  try {
    const res = await fetch('/api/projects?_t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;

    const data = await res.json();
    if (!data) return;

    if (data.contact) {
      applyContactUpdates(data.contact);
    }

    if (Array.isArray(data.projects) && data.projects.length > 0) {
      applyProjectsUpdates(data.projects);
    }
  } catch (err) {
    console.debug('Dynamic projects fallback:', err);
  }
}
