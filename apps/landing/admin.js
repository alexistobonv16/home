/**
 * Alexis TI - Admin Dashboard Controller
 * Manages authentication, live KV data retrieval, services editor,
 * tab switching and instant saving.
 */

(function () {
  'use strict';

  let sessionToken = localStorage.getItem('alexis_landing_admin_token') || '';
  let activeConfig = null;

  // DOM Elements
  const loginScreen = document.getElementById('login-screen');
  const loginForm = document.getElementById('login-form');
  const loginPinInput = document.getElementById('login-pin');
  const loginError = document.getElementById('login-error');
  const togglePwdBtn = document.getElementById('toggle-pwd-btn');
  const dashboardWrap = document.getElementById('dashboard-wrap');
  const logoutBtn = document.getElementById('logout-btn');
  const btnSaveAll = document.getElementById('btn-save-all');
  const saveBtnText = document.getElementById('save-btn-text');
  const btnResetDefaults = document.getElementById('btn-reset-defaults');
  const adminToast = document.getElementById('admin-toast');
  const toastMessage = document.getElementById('toast-message');
  const serviceItemsContainer = document.getElementById('service-items-container');
  const btnAddNewService = document.getElementById('btn-add-new-service');

  // Icons Options for Services
  const ICON_OPTIONS = [
    { value: 'wrench', label: 'Herramienta / Reparación' },
    { value: 'wifi', label: 'Wi-Fi / Redes' },
    { value: 'shield', label: 'Seguridad / Antivirus' },
    { value: 'server', label: 'Servidores / Almacenamiento' },
    { value: 'monitor', label: 'Pantalla / Help Desk Remoto' },
    { value: 'cpu', label: 'Hardware / Procesador' }
  ];

  function showToast(msg, isError = false) {
    if (!adminToast || !toastMessage) return;
    toastMessage.textContent = msg;
    adminToast.classList.toggle('error', isError);
    adminToast.style.display = 'flex';
    setTimeout(() => {
      adminToast.style.display = 'none';
    }, 3500);
  }

  // Toggle Password Visibility
  if (togglePwdBtn && loginPinInput) {
    togglePwdBtn.addEventListener('click', () => {
      const isPwd = loginPinInput.type === 'password';
      loginPinInput.type = isPwd ? 'text' : 'password';
    });
  }

  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // Authentication: Login
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.style.display = 'none';
      const pin = loginPinInput.value.trim();
      if (!pin) return;

      const submitBtn = document.getElementById('login-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verificando...';
      }

      try {
        const res = await fetch('/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();

        if (res.ok && data.success && data.token) {
          sessionToken = data.token;
          localStorage.setItem('alexis_landing_admin_token', sessionToken);
          initDashboard();
        } else {
          loginError.textContent = data.error || 'Contraseña incorrecta';
          loginError.style.display = 'block';
        }
      } catch (err) {
        loginError.textContent = 'Error de conexión con el servidor.';
        loginError.style.display = 'block';
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Ingresar al Panel';
        }
      }
    });
  }

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionToken = '';
      localStorage.removeItem('alexis_landing_admin_token');
      dashboardWrap.style.display = 'none';
      loginScreen.style.display = 'flex';
      if (loginPinInput) loginPinInput.value = '';
    });
  }

  // Load Config Data
  async function loadConfigData(defaults = false) {
    try {
      const url = defaults ? '/api/admin/data?defaults=1' : '/api/admin/data';
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });

      if (res.status === 401) {
        // Invalid session
        localStorage.removeItem('alexis_landing_admin_token');
        dashboardWrap.style.display = 'none';
        loginScreen.style.display = 'flex';
        return;
      }

      const json = await res.json();
      if (json && json.success && json.data) {
        activeConfig = json.data;
        populateForm(activeConfig);
        if (defaults) showToast('Valores por defecto cargados en el formulario');
      }
    } catch (err) {
      showToast('Error cargando configuración', true);
    }
  }

  function populateForm(cfg) {
    if (!cfg) return;

    // 1. Marca
    if (cfg.brand) {
      const nameInput = document.getElementById('brand-name');
      if (nameInput) nameInput.value = cfg.brand.name || '';

      const logoTextInput = document.getElementById('brand-logotext');
      if (logoTextInput) logoTextInput.value = cfg.brand.logoText || '';

      const logoUrlInput = document.getElementById('brand-logourl');
      if (logoUrlInput) logoUrlInput.value = cfg.brand.logoUrl || '';

      const taglineInput = document.getElementById('brand-tagline');
      if (taglineInput) taglineInput.value = cfg.brand.tagline || '';
    }

    // 2. Hero
    if (cfg.hero) {
      const badgeInput = document.getElementById('hero-badge');
      if (badgeInput) badgeInput.value = cfg.hero.badge || '';

      const titleInput = document.getElementById('hero-title-input');
      if (titleInput) titleInput.value = cfg.hero.title || '';

      const subtitleInput = document.getElementById('hero-subtitle-input');
      if (subtitleInput) subtitleInput.value = cfg.hero.subtitle || '';

      const ctaInput = document.getElementById('hero-cta-text');
      if (ctaInput) ctaInput.value = cfg.hero.primaryCtaText || '';

      const secInput = document.getElementById('hero-secondary-text');
      if (secInput) secInput.value = cfg.hero.secondaryCtaText || '';
    }

    // 3. Contacto
    if (cfg.contact) {
      const waNumInput = document.getElementById('contact-whatsapp-num');
      if (waNumInput) waNumInput.value = cfg.contact.whatsapp || '';

      const emailInput = document.getElementById('contact-email-input');
      if (emailInput) emailInput.value = cfg.contact.email || '';

      const phoneInput = document.getElementById('contact-phone-input');
      if (phoneInput) phoneInput.value = cfg.contact.phone || '';

      const locationInput = document.getElementById('contact-location-input');
      if (locationInput) locationInput.value = cfg.contact.location || '';

      const waMsgInput = document.getElementById('contact-whatsapp-msg');
      if (waMsgInput) waMsgInput.value = cfg.contact.whatsappMessage || '';

      const schedInput = document.getElementById('contact-schedule-input');
      if (schedInput) schedInput.value = cfg.contact.schedule || '';
    }

    // 4. Footer
    if (cfg.footer) {
      const aboutInput = document.getElementById('footer-about-input');
      if (aboutInput) aboutInput.value = cfg.footer.about || '';

      const copyInput = document.getElementById('footer-copyright-input');
      if (copyInput) copyInput.value = cfg.footer.copyright || '';
    }

    // 5. Servicios
    renderServicesEditor(cfg.services || []);
  }

  function renderServicesEditor(services) {
    if (!serviceItemsContainer) return;
    serviceItemsContainer.innerHTML = '';

    services.forEach((srv, index) => {
      const row = document.createElement('div');
      row.className = 'service-item-row';
      row.dataset.index = index;

      const optionsHtml = ICON_OPTIONS.map(opt => `
        <option value="${opt.value}" ${opt.value === srv.icon ? 'selected' : ''}>${opt.label}</option>
      `).join('');

      row.innerHTML = `
        <div class="service-item-header">
          <span class="service-badge">Servicio #${index + 1}</span>
          <button type="button" class="btn-remove-service js-remove-srv" title="Eliminar servicio">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            <span>Eliminar</span>
          </button>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Título del Servicio</label>
            <input type="text" class="form-input srv-title-input" value="${srv.title || ''}" placeholder="Ej: Mantenimiento y Reparación">
          </div>
          <div class="form-group">
            <label class="form-label">Icono Representativo</label>
            <select class="form-input srv-icon-select">
              ${optionsHtml}
            </select>
          </div>
          <div class="form-group" style="grid-column: 1 / -1;">
            <label class="form-label">Descripción</label>
            <textarea class="form-input form-textarea srv-desc-input" placeholder="Detalle qué incluye este servicio...">${srv.description || ''}</textarea>
          </div>
        </div>
      `;

      row.querySelector('.js-remove-srv').addEventListener('click', () => {
        row.remove();
        reindexServices();
      });

      serviceItemsContainer.appendChild(row);
    });
  }

  function reindexServices() {
    const rows = serviceItemsContainer.querySelectorAll('.service-item-row');
    rows.forEach((r, idx) => {
      const badge = r.querySelector('.service-badge');
      if (badge) badge.textContent = `Servicio #${idx + 1}`;
    });
  }

  // Add new service
  if (btnAddNewService) {
    btnAddNewService.addEventListener('click', () => {
      const currentServices = collectServicesFromDOM();
      currentServices.push({
        id: 's-' + Date.now(),
        icon: 'wrench',
        title: 'Nuevo Servicio TI',
        description: 'Describe aquí lo que ofreces para este servicio.'
      });
      renderServicesEditor(currentServices);
    });
  }

  function collectServicesFromDOM() {
    const list = [];
    if (!serviceItemsContainer) return list;
    const rows = serviceItemsContainer.querySelectorAll('.service-item-row');
    rows.forEach((r, i) => {
      const title = r.querySelector('.srv-title-input')?.value.trim() || '';
      const icon = r.querySelector('.srv-icon-select')?.value || 'wrench';
      const description = r.querySelector('.srv-desc-input')?.value.trim() || '';
      list.push({
        id: 's' + (i + 1),
        icon,
        title,
        description
      });
    });
    return list;
  }

  // Collect All Data from Form
  function collectAllData() {
    const newPinInput = document.getElementById('new-pin-input');
    const confirmPinInput = document.getElementById('confirm-pin-input');
    let newAdminPin = null;

    if (newPinInput && newPinInput.value.trim()) {
      const p1 = newPinInput.value.trim();
      const p2 = confirmPinInput ? confirmPinInput.value.trim() : '';
      if (p1 !== p2) {
        showToast('Las contraseñas no coinciden', true);
        return null;
      }
      if (p1.length < 4) {
        showToast('La nueva contraseña debe tener mínimo 4 caracteres', true);
        return null;
      }
      newAdminPin = p1;
    }

    return {
      brand: {
        name: document.getElementById('brand-name')?.value.trim() || '',
        logoText: document.getElementById('brand-logotext')?.value.trim() || '',
        logoUrl: document.getElementById('brand-logourl')?.value.trim() || '',
        tagline: document.getElementById('brand-tagline')?.value.trim() || ''
      },
      hero: {
        badge: document.getElementById('hero-badge')?.value.trim() || '',
        title: document.getElementById('hero-title-input')?.value.trim() || '',
        subtitle: document.getElementById('hero-subtitle-input')?.value.trim() || '',
        primaryCtaText: document.getElementById('hero-cta-text')?.value.trim() || '',
        secondaryCtaText: document.getElementById('hero-secondary-text')?.value.trim() || ''
      },
      services: collectServicesFromDOM(),
      contact: {
        whatsapp: document.getElementById('contact-whatsapp-num')?.value.trim().replace(/[^\d]/g, '') || '',
        email: document.getElementById('contact-email-input')?.value.trim() || '',
        phone: document.getElementById('contact-phone-input')?.value.trim() || '',
        location: document.getElementById('contact-location-input')?.value.trim() || '',
        whatsappMessage: document.getElementById('contact-whatsapp-msg')?.value.trim() || '',
        schedule: document.getElementById('contact-schedule-input')?.value.trim() || ''
      },
      footer: {
        about: document.getElementById('footer-about-input')?.value.trim() || '',
        copyright: document.getElementById('footer-copyright-input')?.value.trim() || ''
      },
      ...(newAdminPin ? { newAdminPin } : {})
    };
  }

  // Save All Changes
  if (btnSaveAll) {
    btnSaveAll.addEventListener('click', async () => {
      const payload = collectAllData();
      if (!payload) return;

      btnSaveAll.disabled = true;
      if (saveBtnText) saveBtnText.textContent = 'Guardando...';

      try {
        const res = await fetch('/api/admin/data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok && data.success) {
          showToast('¡Configuración guardada exitosamente en Cloudflare!');
          // Si cambió la contraseña, limpiar los campos de nueva contraseña
          const p1 = document.getElementById('new-pin-input');
          const p2 = document.getElementById('confirm-pin-input');
          if (p1) p1.value = '';
          if (p2) p2.value = '';
        } else {
          showToast(data.error || 'Error al guardar los cambios', true);
        }
      } catch (err) {
        showToast('Error de red al intentar guardar.', true);
      } finally {
        btnSaveAll.disabled = false;
        if (saveBtnText) saveBtnText.textContent = 'Guardar Cambios';
      }
    });
  }

  // Reset to Defaults
  if (btnResetDefaults) {
    btnResetDefaults.addEventListener('click', () => {
      if (confirm('¿Deseas recargar los textos y servicios por defecto en el formulario? (Deberás hacer clic en "Guardar Cambios" para confirmar).')) {
        loadConfigData(true);
      }
    });
  }

  // Init Dashboard
  function initDashboard() {
    loginScreen.style.display = 'none';
    dashboardWrap.style.display = 'flex';
    loadConfigData();
  }

  // Startup check
  if (sessionToken) {
    initDashboard();
  } else {
    loginScreen.style.display = 'flex';
    dashboardWrap.style.display = 'none';
  }
})();
