/**
 * ALEXIS TOBÓN - HOME & PROJECT SHOWCASE
 * Client-side script for Live Previews, Scaling, Theme Toggle & Modal
 */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initIframeScaling();
  initIframeLoaders();
  initDeviceToggles();
  initReloadButtons();
  initCopyButtons();
  initInteractionBarriers();
  initFullscreenModal();
  initFooterYear();
});

/* ==========================================================================
   1. THEME TOGGLE (DARK / LIGHT)
   ========================================================================== */
function initTheme() {
  const themeToggleBtn = document.getElementById('theme-toggle');
  const storedTheme = localStorage.getItem('at_theme');

  if (storedTheme) {
    document.documentElement.setAttribute('data-theme', storedTheme);
  } else {
    // Default to dark, matching the vibe of NotiTec and Mis Gastos
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('at_theme', newTheme);
    });
  }
}

/* ==========================================================================
   2. DYNAMIC IFRAME SCALING
   Computes exact scale factor so desktop sites render without distortion
   ========================================================================== */
function initIframeScaling() {
  const browserWindows = document.querySelectorAll('.browser-window');

  function updateScales() {
    browserWindows.forEach(bw => {
      const viewport = bw.querySelector('.browser-viewport');
      if (!viewport) return;

      const viewportWidth = viewport.clientWidth;
      const viewportHeight = viewport.clientHeight;

      // Desktop scaling: baseline is 1280px wide
      const desktopScale = Math.min(1, viewportWidth / 1280);
      bw.style.setProperty('--scale', desktopScale.toFixed(4));

      // Mobile scaling: baseline is 375px wide, 667px high
      const scaleX = (viewportWidth - 24) / 375;
      const scaleY = (viewportHeight - 24) / 667;
      const mobileScale = Math.min(1, Math.min(scaleX, scaleY));
      bw.style.setProperty('--scale-mobile', mobileScale.toFixed(4));
    });
  }

  // Initial calculation
  updateScales();

  // Recalculate on resize (debounced via requestAnimationFrame)
  let resizeTimeout;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeTimeout);
    resizeTimeout = requestAnimationFrame(updateScales);
  });
}

/* ==========================================================================
   3. IFRAME LOADERS & ERROR HANDLING
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

    // Fallback: hide loader after 7 seconds even if onload is blocked or slow
    setTimeout(() => {
      if (loader && !loader.classList.contains('hidden')) {
        loader.classList.add('hidden');
      }
    }, 7000);
  });
}

/* ==========================================================================
   4. DEVICE VIEW TOGGLE (DESKTOP VS MOBILE)
   ========================================================================== */
function initDeviceToggles() {
  const toggleButtons = document.querySelectorAll('.device-btn');

  toggleButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetView = btn.getAttribute('data-view-target');
      const browserWindow = btn.closest('.browser-window');
      if (!browserWindow) return;

      // Update active state on buttons within this window
      const siblingBtns = browserWindow.querySelectorAll('.device-btn');
      siblingBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update view mode on the browser window
      browserWindow.setAttribute('data-view', targetView);

      // Trigger resize update
      window.dispatchEvent(new Event('resize'));
    });
  });
}

/* ==========================================================================
   5. RELOAD BUTTON
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
   6. COPY URL BUTTON & TOAST NOTIFICATION
   ========================================================================== */
function initCopyButtons() {
  const copyBtns = document.querySelectorAll('.copy-url-btn');

  copyBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const urlToCopy = btn.getAttribute('data-copy');
      if (!urlToCopy) return;

      try {
        await navigator.clipboard.writeText(urlToCopy);
        showToast(`Enlace copiado: ${urlToCopy}`);
      } catch (err) {
        // Fallback for non-https or restricted environments
        const tempInput = document.createElement('input');
        tempInput.value = urlToCopy;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        showToast(`Enlace copiado: ${urlToCopy}`);
      }
    });
  });
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
   7. INTERACTION BARRIER
   Allows scrolling the main page smoothly until user clicks to navigate inside
   ========================================================================== */
function initInteractionBarriers() {
  const barriers = document.querySelectorAll('.interaction-barrier');

  barriers.forEach(barrier => {
    barrier.addEventListener('click', () => {
      const browserWindow = barrier.closest('.browser-window');
      if (browserWindow) {
        browserWindow.classList.add('interactive');
      }
    });
  });

  // When mouse leaves the browser window, re-engage barrier after 1.5s
  const browserWindows = document.querySelectorAll('.browser-window');
  browserWindows.forEach(bw => {
    let leaveTimer;
    bw.addEventListener('mouseleave', () => {
      leaveTimer = setTimeout(() => {
        bw.classList.remove('interactive');
      }, 1500);
    });
    bw.addEventListener('mouseenter', () => {
      clearTimeout(leaveTimer);
    });
  });
}

/* ==========================================================================
   8. FULLSCREEN MODAL VIEWER
   ========================================================================== */
function initFullscreenModal() {
  const modal = document.getElementById('fullscreen-modal');
  const modalIframe = document.getElementById('modal-iframe');
  const modalTitle = document.getElementById('modal-project-title');
  const modalUrlDisplay = document.getElementById('modal-url-display');
  const modalExternalLink = document.getElementById('modal-external-link');
  const modalLoader = document.getElementById('modal-loader');
  const closeBtn = document.getElementById('modal-close-btn');
  const modalReloadBtn = document.getElementById('modal-reload-btn');
  const backdrop = modal?.querySelector('.modal-backdrop');
  const triggerCloseDots = modal?.querySelectorAll('.modal-close-trigger');

  if (!modal || !modalIframe) return;

  // Open modal
  const openButtons = document.querySelectorAll('.open-fullscreen-btn');
  openButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = btn.getAttribute('data-url');
      const title = btn.getAttribute('data-title') || 'Vista en Vivo';

      if (!url) return;

      modalTitle.textContent = title;
      modalUrlDisplay.textContent = url;
      modalExternalLink.setAttribute('href', url);

      if (modalLoader) modalLoader.classList.remove('hidden');

      modalIframe.src = url;
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    });
  });

  // Iframe loaded inside modal
  modalIframe.addEventListener('load', () => {
    if (modalLoader) modalLoader.classList.add('hidden');
  });

  // Reload inside modal
  if (modalReloadBtn) {
    modalReloadBtn.addEventListener('click', () => {
      if (modalLoader) modalLoader.classList.remove('hidden');
      const current = modalIframe.src;
      modalIframe.src = '';
      setTimeout(() => { modalIframe.src = current; }, 50);
    });
  }

  // Close modal function
  function closeModal() {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    // Clear iframe to halt background processes and audio/video if any
    modalIframe.src = '';
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);
  triggerCloseDots?.forEach(dot => dot.addEventListener('click', closeModal));

  // ESC key to close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });
}

/* ==========================================================================
   9. FOOTER YEAR
   ========================================================================== */
function initFooterYear() {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}
