/**
 * Alexis TV · Gestor de Listas M3U (gestor-listas.js)
 * Administrador estético de listas de canales (agregar, editar, eliminar, activar, importar de KV)
 */
(function(global) {
  'use strict';

  const STORAGE_KEY = 'at_playlists_v2';
  const TOKEN_KEY = 'at_tv_token';

  const LISTA_OFICIAL = {
    id: 'oficial',
    nombre: 'Alexis TV Oficial (Deportes & Latam)',
    url: new URL('./data/catalogo-pro.json', typeof location !== 'undefined' ? location.href : 'https://tv.alexistobon.com/').href,
    tipo: 'oficial',
    canalesCount: 362,
    oficial: true,
    activa: true
  };

  class GestorListas {
    constructor() {
      this.listas = this.cargarListas();
      this.editandoId = null;
      this.modoFormulario = 'url'; // 'url' | 'archivo'
      this.archivoSeleccionado = null;
    }

    cargarListas() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Asegurar que la oficial siempre esté presente y con su URL absoluta
            const idx = parsed.findIndex(l => l.id === 'oficial');
            if (idx >= 0) {
              parsed[idx].url = LISTA_OFICIAL.url;
              parsed[idx].oficial = true;
              parsed[idx].tipo = 'oficial';
              if (!parsed[idx].canalesCount) parsed[idx].canalesCount = 362;
            } else {
              parsed.unshift(LISTA_OFICIAL);
            }
            return parsed;
          }
        }
      } catch (e) {
        console.error('Error cargando listas de localStorage:', e);
      }
      return [LISTA_OFICIAL];
    }

    guardar() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.listas));
      } catch (e) {
        console.error('Error guardando listas:', e);
      }
      this.actualizarUI();
    }

    obtenerActiva() {
      return this.listas.find(l => l.activa) || this.listas[0];
    }

    async activar(id) {
      const pl = this.listas.find(l => l.id === id);
      if (!pl) return;

      this.listas.forEach(l => { l.activa = (l.id === id); });
      this.guardar();

      const toastFn = global.toast || global.AlexisTV?.toast;
      if (typeof toastFn === 'function') {
        toastFn(`Cargando lista: ${pl.nombre}…`);
      }

      if (pl.tipo === 'archivo' && pl.contenido) {
        const parsearFn = global.ParserM3U?.parsear || global.parsear;
        const aplicarListaFn = global.AlexisTV?.aplicarLista || global.aplicarLista;
        if (typeof parsearFn === 'function' && typeof aplicarListaFn === 'function') {
          try {
            const res = parsearFn(pl.contenido, 'local');
            aplicarListaFn({
              canales: res.canales,
              grupos: res.grupos,
              url: `local:${pl.id}`,
              urlFinal: `local:${pl.id}`
            });
            return;
          } catch (err) {
            alert('Error al procesar el archivo guardado: ' + err.message);
          }
        }
      }

      // Si es URL o catálogo oficial
      let targetUrl = pl.url;
      if (pl.oficial || pl.id === 'oficial' || String(targetUrl).endsWith('catalogo-pro.json')) {
        targetUrl = global.AlexisTV?.CONFIG?.listaPorDefecto || LISTA_OFICIAL.url;
      }
      const cargarFn = global.AlexisTV?.cargar || global.cargar;
      if (typeof cargarFn === 'function') {
        cargarFn(targetUrl, { forzar: true });
      }
    }

    async agregar({ nombre, url, tipo, contenido, canalesCount }) {
      const nueva = {
        id: 'pl_' + Date.now(),
        nombre: nombre.trim() || 'Lista sin nombre',
        url: url ? url.trim() : '',
        tipo: tipo || 'url',
        contenido: contenido || null,
        canalesCount: canalesCount || 0,
        oficial: false,
        activa: true
      };

      // Si se activa, desactivar las demás
      this.listas.forEach(l => { l.activa = false; });
      this.listas.push(nueva);
      this.guardar();
      await this.activar(nueva.id);
    }

    editar(id, { nombre, url }) {
      const pl = this.listas.find(l => l.id === id);
      if (!pl) return;

      pl.nombre = nombre.trim() || pl.nombre;
      if (url && pl.tipo === 'url') {
        pl.url = url.trim();
      }
      this.guardar();

      if (pl.activa) {
        this.activar(pl.id);
      }
    }

    eliminar(id) {
      const pl = this.listas.find(l => l.id === id);
      if (!pl) return;

      if (pl.oficial) {
        alert('No se puede eliminar la lista oficial predeterminada.');
        return;
      }

      const confirmar = confirm(`¿Estás seguro de que deseas eliminar la lista "${pl.nombre}"?`);
      if (!confirmar) return;

      const eraActiva = pl.activa;
      this.listas = this.listas.filter(l => l.id !== id);

      if (eraActiva) {
        this.listas[0].activa = true;
        this.activar(this.listas[0].id);
      }

      this.guardar();
    }

    descargarM3U(id) {
      const pl = this.listas.find(l => l.id === id);
      if (!pl) return;

      let contenidoM3U = pl.contenido;
      if (!contenidoM3U) {
        if (pl.url) {
          window.open(pl.url, '_blank');
          return;
        }
      }

      const blob = new Blob([contenidoM3U], { type: 'audio/x-mpegurl;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${pl.nombre.replace(/[^a-z0-9_-]/gi, '_')}.m3u`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }

    async importarDesdeKV(pin) {
      try {
        let token = localStorage.getItem(TOKEN_KEY);
        if (!token && pin) {
          const authRes = await fetch('/api/tv/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pin.trim() })
          });
          const authData = await authRes.json();
          if (!authData.success || !authData.token) {
            throw new Error(authData.error || 'PIN incorrecto');
          }
          token = authData.token;
          localStorage.setItem(TOKEN_KEY, token);
        }

        if (!token) {
          throw new Error('Se requiere un PIN de acceso.');
        }

        const syncRes = await fetch('/api/tv/sync', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const syncData = await syncRes.json();

        if (!syncData.success) {
          throw new Error(syncData.error || 'No se pudieron recuperar los datos de la nube.');
        }

        const kvPlaylists = syncData.playlists || [];
        if (!Array.isArray(kvPlaylists) || kvPlaylists.length === 0) {
          alert('No se encontraron listas guardadas en tu almacenamiento de la nube (KV).');
          return;
        }

        let importadas = 0;
        for (const item of kvPlaylists) {
          const yaExiste = this.listas.some(l => l.nombre === item.name || (item.url && l.url === item.url));
          if (!yaExiste) {
            this.listas.push({
              id: 'kv_' + (item.id || Date.now() + Math.random().toString(36).slice(2, 6)),
              nombre: item.name || 'Lista Importada',
              url: item.url || '',
              tipo: item.url ? 'url' : 'archivo',
              canalesCount: Array.isArray(item.channels) ? item.channels.length : 0,
              oficial: false,
              activa: false
            });
            importadas++;
          }
        }

        this.guardar();
        alert(`✅ ¡Éxito! Se importaron ${importadas} listas desde tu almacenamiento en la nube.`);
      } catch (err) {
        alert('⚠️ Error al importar de la nube: ' + err.message);
      }
    }

    actualizarUI() {
      this.renderListaCards();
      this.renderSelectorSidebar();
      const badge = document.getElementById('badge-total-listas');
      if (badge) badge.textContent = this.listas.length;
      const countEl = document.getElementById('gestor-contador-listas');
      if (countEl) countEl.textContent = `${this.listas.length} lista${this.listas.length === 1 ? '' : 's'} guardada${this.listas.length === 1 ? '' : 's'}`;
    }

    actualizarConteoCanales(urlOId, count) {
      if (!count || count <= 0) return;
      const pl = this.listas.find(l => 
        l.id === urlOId || 
        l.url === urlOId || 
        (l.oficial && String(urlOId).includes('catalogo-pro.json')) || 
        l.activa
      );
      if (pl && pl.canalesCount !== count) {
        pl.canalesCount = count;
        this.guardar();
      }
    }

    renderSelectorSidebar() {
      const select = document.getElementById('selector-lista-activa');
      const activa = this.obtenerActiva();

      // Actualizar el trigger del menú custom
      const textoActiva = document.getElementById('texto-lista-activa');
      const badgeConteo = document.getElementById('badge-conteo-lista-activa');
      const badgeTotal = document.getElementById('desplegable-total-badge');
      const itemsContainer = document.getElementById('items-desplegable-listas');

      if (textoActiva && activa) {
        textoActiva.textContent = activa.nombre;
        textoActiva.title = activa.nombre;
      }
      if (badgeConteo && activa) {
        badgeConteo.textContent = activa.canalesCount ? `${activa.canalesCount} ch` : '…';
      }
      if (badgeTotal) {
        badgeTotal.textContent = this.listas.length;
      }

      // Renderizar items del dropdown custom
      if (itemsContainer) {
        itemsContainer.innerHTML = this.listas.map(l => {
          const esActiva = (l.id === activa?.id);
          const badgeTipo = l.oficial ? 'Oficial' : l.tipo === 'archivo' ? 'Archivo' : 'M3U';
          return `
            <li class="desplegable-item ${esActiva ? 'activo' : ''}" data-id="${l.id}" role="option" aria-selected="${esActiva}">
              <div class="desplegable-item-info">
                <span class="h-2 w-2 rounded-full ${esActiva ? 'bg-cancha shadow-[0_0_8px_#3ddc84]' : 'bg-slate-600'} shrink-0"></span>
                <span class="desplegable-item-nombre">${escapeHtml(l.nombre)}</span>
                <span class="text-[9px] text-slate-500 uppercase font-mono px-1 py-0.2 bg-white/5 rounded shrink-0">${badgeTipo}</span>
              </div>
              <span class="desplegable-item-conteo">${l.canalesCount ? `${l.canalesCount} ch` : '…'}</span>
            </li>
          `;
        }).join('');
      }

      // Mantener select oculto sincronizado por si acaso
      if (select) {
        select.innerHTML = this.listas.map(l => `
          <option value="${l.id}" ${l.activa ? 'selected' : ''}>
            ${escapeHtml(l.nombre)} (${l.canalesCount || '…'} canales)
          </option>
        `).join('');
      }
    }

    renderListaCards() {
      const contenedor = document.getElementById('gestor-contenedor-listas');
      if (!contenedor) return;

      contenedor.innerHTML = this.listas.map(pl => {
        const badgeTipo = pl.oficial 
          ? '<span class="gestor-card-badge badge-oficial">Oficial</span>' 
          : pl.tipo === 'archivo' 
            ? '<span class="gestor-card-badge badge-url">Archivo</span>' 
            : '<span class="gestor-card-badge badge-url">M3U URL</span>';

        const badgeActiva = pl.activa 
          ? '<span class="gestor-card-badge badge-activa">🟢 En uso</span>' 
          : '';

        const metaInfo = pl.tipo === 'url' ? (pl.url || '') : 'Archivo subido localmente';

        return `
          <div class="gestor-card ${pl.activa ? 'activa' : ''}" data-id="${pl.id}">
            <div class="gestor-card-info">
              <div class="gestor-card-title">
                <span>${escapeHtml(pl.nombre)}</span>
                ${badgeActiva}
                ${badgeTipo}
              </div>
              <div class="gestor-card-meta">
                ${pl.canalesCount ? `<b>${pl.canalesCount} canales</b> · ` : ''}${escapeHtml(metaInfo)}
              </div>
            </div>
            <div class="gestor-card-actions">
              ${!pl.activa ? `
                <button type="button" class="btn-card-action btn-card-activar" data-accion="activar" data-id="${pl.id}" title="Cargar esta lista">
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  <span>Activar</span>
                </button>
              ` : ''}
              ${!pl.oficial ? `
                <button type="button" class="btn-card-action" data-accion="editar" data-id="${pl.id}" title="Editar nombre o URL">
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  <span class="sr-only">Editar</span>
                </button>
                <button type="button" class="btn-card-action btn-card-danger" data-accion="eliminar" data-id="${pl.id}" title="Eliminar lista">
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  <span class="sr-only">Eliminar</span>
                </button>
              ` : ''}
              ${pl.contenido || pl.url ? `
                <button type="button" class="btn-card-action" data-accion="descargar" data-id="${pl.id}" title="Descargar archivo M3U">
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                  <span class="sr-only">Descargar</span>
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    iniciarUI() {
      const dialog = document.getElementById('dialogo-gestor-listas');
      const btnAbrir = document.getElementById('btn-abrir-gestor');
      const btnAbrirSidebar = document.getElementById('btn-abrir-gestor-sidebar');
      const btnCerrar = document.getElementById('btn-cerrar-gestor');
      const btnMostrarForm = document.getElementById('btn-mostrar-formulario');
      const boxForm = document.getElementById('gestor-form-box');
      const btnCancelarForm = document.getElementById('btn-cancelar-form');
      const form = document.getElementById('form-gestor-lista');
      const selectSidebar = document.getElementById('selector-lista-activa');
      const btnImportarKV = document.getElementById('btn-importar-kv');

      const tabUrl = document.getElementById('tab-modo-url');
      const tabArchivo = document.getElementById('tab-modo-archivo');
      const campoUrl = document.getElementById('campo-modo-url');
      const campoArchivo = document.getElementById('campo-modo-archivo');
      const fileInput = document.getElementById('input-archivo-m3u');
      const dropzone = document.getElementById('dropzone-m3u');
      const archivoNombre = document.getElementById('nombre-archivo-seleccionado');

      const abrirModal = () => {
        this.actualizarUI();
        if (boxForm) boxForm.hidden = true;
        this.editandoId = null;
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      };

      if (btnAbrir) btnAbrir.addEventListener('click', abrirModal);
      if (btnAbrirSidebar) btnAbrirSidebar.addEventListener('click', abrirModal);
      if (btnCerrar && dialog) btnCerrar.addEventListener('click', () => dialog.close());

      // Cerrar al hacer clic en el backdrop
      if (dialog) {
        dialog.addEventListener('click', (e) => {
          if (e.target === dialog) dialog.close();
        });
      }

      // Manejador del Desplegable Personalizado
      const btnToggle = document.getElementById('btn-toggle-desplegable');
      const menuCustom = document.getElementById('menu-desplegable-listas');
      const itemsCustom = document.getElementById('items-desplegable-listas');
      const btnAdminDesplegable = document.getElementById('btn-desplegable-administrar');

      const cerrarDesplegable = () => {
        if (menuCustom) {
          menuCustom.hidden = true;
          menuCustom.style.display = 'none';
        }
        if (btnToggle) btnToggle.setAttribute('aria-expanded', 'false');
      };

      const toggleDesplegable = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!menuCustom) return;
        const estaAbierto = !menuCustom.hidden && menuCustom.style.display !== 'none';
        if (estaAbierto) {
          cerrarDesplegable();
        } else {
          this.renderSelectorSidebar();
          menuCustom.hidden = false;
          menuCustom.style.display = 'block';
          if (btnToggle) btnToggle.setAttribute('aria-expanded', 'true');
        }
      };

      if (btnToggle) btnToggle.addEventListener('click', toggleDesplegable);

      if (itemsCustom) {
        itemsCustom.addEventListener('click', (e) => {
          const item = e.target.closest('.desplegable-item');
          if (!item) return;
          const id = item.dataset.id;
          if (id) {
            cerrarDesplegable();
            this.activar(id);
          }
        });
      }

      if (btnAdminDesplegable) {
        btnAdminDesplegable.addEventListener('click', () => {
          cerrarDesplegable();
          abrirModal();
        });
      }

      // Cerrar al hacer clic fuera o pulsar ESC
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#desplegable-lista-custom')) {
          cerrarDesplegable();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && menuCustom && !menuCustom.hidden) {
          cerrarDesplegable();
        }
      });

      // Cambio desde selector en el sidebar (oculto para fallback)
      if (selectSidebar) {
        selectSidebar.addEventListener('change', (e) => {
          this.activar(e.target.value);
        });
      }

      // Pestañas URL / Archivo
      if (tabUrl && tabArchivo) {
        tabUrl.addEventListener('click', () => {
          this.modoFormulario = 'url';
          tabUrl.classList.add('activo');
          tabArchivo.classList.remove('activo');
          campoUrl.hidden = false;
          campoArchivo.hidden = true;
        });

        tabArchivo.addEventListener('click', () => {
          this.modoFormulario = 'archivo';
          tabArchivo.classList.add('activo');
          tabUrl.classList.remove('activo');
          campoUrl.hidden = true;
          campoArchivo.hidden = false;
        });
      }

      // Drag and drop archivo
      if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
          if (e.dataTransfer.files?.length) {
            fileInput.files = e.dataTransfer.files;
            handleFile(fileInput.files[0]);
          }
        });
        fileInput.addEventListener('change', (e) => {
          if (e.target.files?.length) handleFile(e.target.files[0]);
        });
      }

      const handleFile = (file) => {
        this.archivoSeleccionado = file;
        if (archivoNombre) archivoNombre.textContent = `Archivo: ${file.name} (${Math.round(file.size / 1024)} KB)`;
        const inputNombre = document.getElementById('input-nombre-lista');
        if (inputNombre && !inputNombre.value.trim()) {
          inputNombre.value = file.name.replace(/\.[^/.]+$/, "");
        }
      };

      // Botón Nueva Lista
      if (btnMostrarForm && boxForm) {
        btnMostrarForm.addEventListener('click', () => {
          this.editandoId = null;
          form.reset();
          if (archivoNombre) archivoNombre.textContent = 'Ningún archivo seleccionado';
          this.archivoSeleccionado = null;
          document.getElementById('form-titulo-gestor').textContent = 'Agregar Nueva Lista';
          document.getElementById('btn-submit-gestor').textContent = 'Guardar y Activar';
          boxForm.hidden = false;
          document.getElementById('input-nombre-lista').focus();
        });
      }

      if (btnCancelarForm && boxForm) {
        btnCancelarForm.addEventListener('click', () => {
          boxForm.hidden = true;
          this.editandoId = null;
        });
      }

      // Submit Formulario
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const nombre = document.getElementById('input-nombre-lista').value.trim();
          const url = document.getElementById('input-url-lista').value.trim();
          const btnSubmit = document.getElementById('btn-submit-gestor');

          if (!nombre) {
            alert('Por favor introduce un nombre para la lista.');
            return;
          }

          btnSubmit.disabled = true;
          btnSubmit.textContent = 'Procesando…';

          try {
            if (this.editandoId) {
              this.editar(this.editandoId, { nombre, url });
              boxForm.hidden = true;
              this.editandoId = null;
            } else {
              if (this.modoFormulario === 'url') {
                if (!url) throw new Error('Por favor ingresa la URL de la lista M3U.');
                await this.agregar({ nombre, url, tipo: 'url' });
              } else {
                if (!this.archivoSeleccionado) throw new Error('Por favor selecciona un archivo .m3u o .m3u8.');
                const texto = await this.archivoSeleccionado.text();
                let count = 0;
                const parsearFn = global.ParserM3U?.parsear || global.parsear;
                if (typeof parsearFn === 'function') {
                  const res = parsearFn(texto, 'local');
                  count = res.canales?.length || 0;
                }
                await this.agregar({ nombre, tipo: 'archivo', contenido: texto, canalesCount: count });
              }
              boxForm.hidden = true;
              if (dialog) dialog.close();
            }
          } catch (err) {
            alert('Error: ' + err.message);
          } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = 'Guardar y Activar';
          }
        });
      }

      // Eventos de tarjetas (activar, editar, eliminar, descargar)
      const contenedor = document.getElementById('gestor-contenedor-listas');
      if (contenedor) {
        contenedor.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-accion]');
          if (!btn) return;

          const accion = btn.dataset.accion;
          const id = btn.dataset.id;

          if (accion === 'activar') {
            this.activar(id);
            if (dialog) dialog.close();
          } else if (accion === 'eliminar') {
            this.eliminar(id);
          } else if (accion === 'descargar') {
            this.descargarM3U(id);
          } else if (accion === 'editar') {
            const pl = this.listas.find(l => l.id === id);
            if (!pl) return;
            this.editandoId = id;
            document.getElementById('input-nombre-lista').value = pl.nombre;
            document.getElementById('input-url-lista').value = pl.url || '';
            document.getElementById('form-titulo-gestor').textContent = `Editar Lista: ${pl.nombre}`;
            document.getElementById('btn-submit-gestor').textContent = 'Guardar Cambios';
            boxForm.hidden = false;
            campoArchivo.hidden = true;
            campoUrl.hidden = (pl.tipo === 'archivo');
            document.getElementById('input-nombre-lista').focus();
          }
        });
      }

      // Importar de Cloudflare KV
      if (btnImportarKV) {
        btnImportarKV.addEventListener('click', () => {
          const pin = prompt('Introduce tu PIN de administrador para importar tus listas guardadas en la nube:');
          if (pin) {
            this.importarDesdeKV(pin);
          }
        });
      }

      this.actualizarUI();
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Inicializar al cargar el DOM o si ya cargó
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      global.GestorListasInstancia = new GestorListas();
      global.GestorListasInstancia.iniciarUI();
    });
  } else {
    global.GestorListasInstancia = new GestorListas();
    global.GestorListasInstancia.iniciarUI();
  }

})(window);
