/**
 * Alexis TI - Dynamic Landing Client Script
 * Fetches real-time configuration from /api/config (powered by Cloudflare KV)
 * and updates texts, logos, contact info and services dynamically.
 */

(function () {
  'use strict';

  let currentConfig = null;

  const ICONS = {
    wrench: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    wifi: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
    shield: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
    server: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
    monitor: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    cpu: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>`,
    default: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getWhatsAppUrl(phone, message) {
    const cleanPhone = (phone || '').replace(/[^\d]/g, '');
    const encodedMsg = encodeURIComponent(message || 'Hola, requiero soporte técnico.');
    return `https://wa.me/${cleanPhone}?text=${encodedMsg}`;
  }

  function applyConfig(data) {
    if (!data) return;
    currentConfig = data;

    // 1. Marca y Título
    if (data.brand) {
      if (data.brand.name) document.title = `${data.brand.name} | Soporte TI Profesional`;
      const brandNameEls = document.querySelectorAll('.dynamic-brand-name');
      brandNameEls.forEach(el => el.textContent = data.brand.name || 'Alexis TI');

      const brandLogoContainer = document.getElementById('brand-logo-container');
      if (brandLogoContainer) {
        if (data.brand.logoUrl) {
          brandLogoContainer.innerHTML = `<img src="${escapeHtml(data.brand.logoUrl)}" alt="${escapeHtml(data.brand.name)}" />`;
        } else {
          brandLogoContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
        }
      }
    }

    // 2. Hero Section
    if (data.hero) {
      const heroBadge = document.getElementById('hero-badge-text');
      if (heroBadge && data.hero.badge) heroBadge.textContent = data.hero.badge;

      const heroTitle = document.getElementById('hero-title');
      if (heroTitle && data.hero.title) heroTitle.innerHTML = escapeHtml(data.hero.title);

      const heroSubtitle = document.getElementById('hero-subtitle');
      if (heroSubtitle && data.hero.subtitle) heroSubtitle.textContent = data.hero.subtitle;

      const heroCta = document.getElementById('hero-primary-cta');
      if (heroCta && data.hero.primaryCtaText) {
        const textSpan = heroCta.querySelector('span');
        if (textSpan) textSpan.textContent = data.hero.primaryCtaText;
      }
    }

    // 3. Stats
    if (Array.isArray(data.stats) && data.stats.length > 0) {
      const statsGrid = document.getElementById('stats-grid');
      if (statsGrid) {
        statsGrid.innerHTML = data.stats.map(st => `
          <div class="stat-item">
            <span class="stat-value">${escapeHtml(st.value)}</span>
            <span class="stat-label">${escapeHtml(st.label)}</span>
          </div>
        `).join('');
      }
    }

    // 4. Servicios
    if (Array.isArray(data.services) && data.services.length > 0) {
      const servicesGrid = document.getElementById('services-grid');
      if (servicesGrid) {
        servicesGrid.innerHTML = data.services.map(srv => {
          const iconSvg = ICONS[srv.icon] || ICONS.default;
          return `
            <div class="service-card" data-service-id="${escapeHtml(srv.id || '')}">
              <div class="service-icon-box">
                ${iconSvg}
              </div>
              <h3 class="service-title">${escapeHtml(srv.title)}</h3>
              <p class="service-desc">${escapeHtml(srv.description)}</p>
            </div>
          `;
        }).join('');
      }
    }

    // 5. Contacto & Enlaces de WhatsApp
    if (data.contact) {
      const waUrl = getWhatsAppUrl(data.contact.whatsapp, data.contact.whatsappMessage);

      // Botones de WhatsApp (Header, Hero, Contacto, Flotante)
      document.querySelectorAll('.js-whatsapp-link').forEach(btn => {
        btn.href = waUrl;
      });

      // Teléfono y Correo
      const emailEl = document.getElementById('contact-email');
      if (emailEl && data.contact.email) {
        emailEl.textContent = data.contact.email;
        emailEl.href = `mailto:${data.contact.email}`;
      }

      const phoneEl = document.getElementById('contact-phone');
      if (phoneEl && data.contact.phone) {
        phoneEl.textContent = data.contact.phone;
        phoneEl.href = `tel:${data.contact.phone.replace(/[^\d+]/g, '')}`;
      }

      const locationEl = document.getElementById('contact-location');
      if (locationEl && data.contact.location) {
        locationEl.textContent = data.contact.location;
      }

      const scheduleEl = document.getElementById('contact-schedule');
      if (scheduleEl && data.contact.schedule) {
        scheduleEl.textContent = data.contact.schedule;
      }
    }

    // 6. Footer
    if (data.footer) {
      const footerAbout = document.getElementById('footer-about');
      if (footerAbout && data.footer.about) footerAbout.textContent = data.footer.about;

      const footerCopy = document.getElementById('footer-copyright');
      if (footerCopy && data.footer.copyright) footerCopy.textContent = data.footer.copyright;
    }
  }

  // Cargar configuración desde la API pública de Cloudflare Functions
  async function fetchLiveConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          applyConfig(json.data);
        }
      }
    } catch (err) {
      console.warn('Could not fetch live landing config:', err);
    }
  }

  // Theme Toggle Button
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('landing_theme', next);
    });
  }

  // Ejecución inmediata
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchLiveConfig);
  } else {
    fetchLiveConfig();
  }
})();
