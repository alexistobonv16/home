/**
 * Alexis TV · Gestor de Listas M3U (gestor-listas.js)
 * Administrador estético flotante de listas de canales (agregar, eliminar, activar, importar de KV)
 * Anclado directamente al botón naranja del header sin modales gigantes
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

  const LISTA_WIN_PLUS = {
    id: 'pl_win_plus',
    nombre: 'Win +',
    url: 'http://190.242.118.68:58008/playlist.m3u',
    tipo: 'url',
    canalesCount: 87,
    oficial: false,
    activa: false
  };

  class GestorListas {
    constructor() {
      this.listas = this.cargarListas();
      this.modoFormulario = 'url'; // 'url' | 'archivo'
      this.archivoSeleccionado = null;
    }

    cargarListas() {
      let listas = [];
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            listas = parsed.filter(l => !l.id || !l.id.startsWith('legacy_temp_'));
          }
        }
      } catch (e) {
        console.error('Error cargando listas de localStorage:', e);
      }

      // Asegurar que la oficial siempre esté presente y con su URL absoluta
      const idx = listas.findIndex(l => l.id === 'oficial');
      if (idx >= 0) {
        listas[idx].url = LISTA_OFICIAL.url;
        listas[idx].oficial = true;
        listas[idx].tipo = 'oficial';
        if (!listas[idx].canalesCount) listas[idx].canalesCount = 362;
      } else {
        listas.unshift({ ...LISTA_OFICIAL });
      }

      // Asegurar que Win + siempre esté presente con su URL activa
      const tieneWin = listas.some(l => l.id === 'pl_win_plus' || l.url === LISTA_WIN_PLUS.url || l.nombre.toLowerCase().trim() === 'win +');
      if (!tieneWin) {
        listas.push({ ...LISTA_WIN_PLUS });
      }

      // Migrar automáticamente todas las listas guardadas en la versión legacy (at_tv_playlists)
      try {
        const legacyRaw = localStorage.getItem('at_tv_playlists');
        if (legacyRaw) {
          const legacyParsed = JSON.parse(legacyRaw);
          if (Array.isArray(legacyParsed)) {
            legacyParsed.forEach(leg => {
              if (leg && leg.sourceUrl && !listas.some(l => l.url === leg.sourceUrl)) {
                listas.push({
                  id: leg.id || ('leg_' + Date.now() + Math.random().toString(36).substring(2, 5)),
                  nombre: leg.name || 'Lista Legacy',
                  url: leg.sourceUrl,
                  tipo: 'url',
                  canalesCount: leg.channelsCount || (leg.channels ? leg.channels.length : 0),
                  oficial: false,
                  activa: false
                });
              }
            });
          }
        }
      } catch (e) {
        console.warn('No se pudieron migrar listas legacy:', e);
      }

      // Detectar si se pasó una lista por parámetro URL (?lista= o ?url=)
      try {
        const params = new URLSearchParams(window.location.search);
        const urlParam = params.get('lista') || params.get('url');
        if (urlParam) {
          const norm = urlParam.toLowerCase().replace(/\/+$/, '');
          let encontrada = listas.find(l => l.url && l.url.toLowerCase().replace(/\/+$/, '') === norm);
          if (!encontrada) {
            encontrada = {
              id: 'pl_' + Date.now(),
              nombre: 'Win + (Activa)',
              url: urlParam,
              tipo: 'url',
              canalesCount: 0,
              oficial: false,
              activa: true
            };
            listas.push(encontrada);
          }
          listas.forEach(l => { l.activa = (l === encontrada); });
        }
      } catch (e) {}

      // Asegurar que al menos una esté marcada como activa
      if (!listas.some(l => l.activa)) {
        listas[0].activa = true;
      }

      return listas;
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

    async sincronizarSilenciosoKV() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return;
      try {
        const syncRes = await fetch('/api/tv/sync', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!syncRes.ok) return;
        const syncData = await syncRes.json();
        const kvPlaylists = syncData.data?.playlists || syncData.playlists || [];
        if (!Array.isArray(kvPlaylists) || kvPlaylists.length === 0) return;

        let huboCambios = false;
        for (const item of kvPlaylists) {
          const itemUrl = item.sourceUrl || item.url || '';
          const itemNombre = item.name || item.nombre || 'Lista Guardada';
          const yaExiste = this.listas.some(l => l.nombre.toLowerCase() === itemNombre.toLowerCase() || (itemUrl && l.url === itemUrl));
          if (!yaExiste) {
            let contenido = null;
            if (Array.isArray(item.channels) && item.channels.length > 0 && !itemUrl) {
              const lineas = ['#EXTM3U'];
              item.channels.forEach(ch => {
                lineas.push(`#EXTINF:-1 tvg-id="${ch.tvgId || ch.id || ''}" tvg-name="${ch.name || ''}" tvg-logo="${ch.logo || ''}" group-title="${ch.group || ''}",${ch.name || ''}`);
                lineas.push(ch.url || '');
              });
              contenido = lineas.join('\n');
            }
            this.listas.push({
              id: 'kv_' + (item.id || Date.now() + Math.random().toString(36).slice(2, 6)),
              nombre: itemNombre,
              url: itemUrl,
              tipo: itemUrl ? 'url' : 'archivo',
              contenido: contenido,
              canalesCount: item.channelsCount || (Array.isArray(item.channels) ? item.channels.length : 0),
              oficial: false,
              activa: false
            });
            huboCambios = true;
          }
        }
        if (huboCambios) {
          this.guardar();
        }
      } catch {
        // Silencioso
      }
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
          const pinPrompt = prompt('Ingresa tu PIN de Alexis TV para sincronizar listas de la nube:');
          if (!pinPrompt) return;
          return this.importarDesdeKV(pinPrompt);
        }

        const syncRes = await fetch('/api/tv/sync', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (syncRes.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          const pinPrompt = prompt('Sesión expirada. Ingresa tu PIN de Alexis TV:');
          if (!pinPrompt) return;
          return this.importarDesdeKV(pinPrompt);
        }

        const syncData = await syncRes.json();
        if (!syncData.success) {
          throw new Error(syncData.error || 'No se pudieron recuperar los datos de la nube.');
        }

        const kvPlaylists = syncData.data?.playlists || syncData.playlists || [];
        if (!Array.isArray(kvPlaylists) || kvPlaylists.length === 0) {
          alert('No se encontraron listas guardadas en tu almacenamiento de la nube (KV).');
          return;
        }

        let importadas = 0;
        for (const item of kvPlaylists) {
          const itemUrl = item.sourceUrl || item.url || '';
          const itemNombre = item.name || item.nombre || 'Lista Importada';
          const yaExiste = this.listas.some(l => l.nombre.toLowerCase() === itemNombre.toLowerCase() || (itemUrl && l.url === itemUrl));
          if (!yaExiste) {
            let contenido = null;
            if (Array.isArray(item.channels) && item.channels.length > 0 && !itemUrl) {
              const lineas = ['#EXTM3U'];
              item.channels.forEach(ch => {
                lineas.push(`#EXTINF:-1 tvg-id="${ch.tvgId || ch.id || ''}" tvg-name="${ch.name || ''}" tvg-logo="${ch.logo || ''}" group-title="${ch.group || ''}",${ch.name || ''}`);
                lineas.push(ch.url || '');
              });
              contenido = lineas.join('\n');
            }
            this.listas.push({
              id: 'kv_' + (item.id || Date.now() + Math.random().toString(36).slice(2, 6)),
              nombre: itemNombre,
              url: itemUrl,
              tipo: itemUrl ? 'url' : 'archivo',
              contenido: contenido,
              canalesCount: item.channelsCount || (Array.isArray(item.channels) ? item.channels.length : 0),
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
      const activa = this.obtenerActiva();

      // Badge total en el botón del header
      const badgeTotal = document.getElementById('badge-total-listas');
      if (badgeTotal) badgeTotal.textContent = this.listas.length;

      // Contador en el menú flotante
      const flotanteContador = document.getElementById('flotante-contador');
      if (flotanteContador) {
        flotanteContador.textContent = `${this.listas.length} lista${this.listas.length === 1 ? '' : 's'}`;
      }

      // Nombre y conteo de la lista activa en el sidebar
      const textoActiva = document.getElementById('texto-lista-activa');
      const badgeConteo = document.getElementById('badge-conteo-lista-activa');
      if (textoActiva && activa) {
        textoActiva.textContent = activa.nombre;
        textoActiva.title = activa.nombre;
      }
      if (badgeConteo && activa) {
        badgeConteo.textContent = activa.canalesCount ? `${activa.canalesCount} ch` : '…';
      }

      // Info en cabecera
      const infoLista = document.getElementById('info-lista');
      if (infoLista && activa) {
        infoLista.textContent = activa.nombre;
        infoLista.title = activa.nombre;
      }

      // Select oculto de fallback
      const select = document.getElementById('selector-lista-activa');
      if (select) {
        select.innerHTML = this.listas.map(l => `
          <option value="${l.id}" ${l.activa ? 'selected' : ''}>
            ${escapeHtml(l.nombre)} (${l.canalesCount || '…'} canales)
          </option>
        `).join('');
      }

      // Renderizar listado de items en el menú flotante
      this.renderMenuFlotante();
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

    renderMenuFlotante() {
      const contenedor = document.getElementById('items-menu-flotante');
      if (!contenedor) return;

      const activa = this.obtenerActiva();

      contenedor.innerHTML = this.listas.map(l => {
        const esActiva = (l.id === activa?.id);
        const badgeClase = l.oficial ? 'badge-oficial' : l.tipo === 'archivo' ? 'badge-archivo' : 'badge-url';
        const badgeTexto = l.oficial ? 'Oficial' : l.tipo === 'archivo' ? 'Archivo' : 'M3U';

        return `
          <div class="item-lista-flotante flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-[#141d28] transition ${esActiva ? 'activo bg-cancha/10 border border-cancha/30' : 'border border-transparent'}" data-id="${l.id}">
            <button type="button" class="item-lista-clickeable flex items-center gap-2.5 min-w-0 flex-1 text-left bg-transparent border-0 cursor-pointer p-0 text-inherit" data-accion="activar" data-id="${l.id}" title="${escapeHtml(l.nombre)}">
              <span class="punto-estado shrink-0 w-2 h-2 rounded-full ${esActiva ? 'bg-cancha' : 'bg-slate-600'}"></span>
              <div class="item-lista-textos flex flex-col min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="item-lista-nombre truncate text-xs font-semibold ${esActiva ? 'text-cancha' : 'text-slate-200'}">${escapeHtml(l.nombre)}</span>
                  <span class="item-badge ${badgeClase} text-[10px] font-mono px-1.5 py-0.5 rounded uppercase font-semibold shrink-0">${badgeTexto}</span>
                </div>
                <span class="item-lista-canales text-[11px] text-slate-400 mt-0.5 tabular-nums">${l.canalesCount ? `${l.canalesCount} canales` : 'Verificar canales'}</span>
              </div>
            </button>
            ${!l.oficial ? `
              <button type="button" class="btn-eliminar-flotante text-slate-500 hover:text-red-400 p-1.5 rounded hover:bg-red-500/10 transition shrink-0 cursor-pointer bg-transparent border-0" data-accion="eliminar" data-id="${l.id}" title="Eliminar lista '${escapeHtml(l.nombre)}'">
                <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0" width="14" height="14" style="width: 14px; height: 14px; min-width: 14px; min-height: 14px;" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            ` : ''}
          </div>
        `;
      }).join('');
    }

    iniciarUI() {
      const btnAbrir = document.getElementById('btn-abrir-gestor');
      const btnSidebar = document.getElementById('btn-sidebar-cambiar-lista');
      const menuFlotante = document.getElementById('menu-flotante-listas');
      const chevron = document.getElementById('chevron-menu-listas');
      const btnCerrar = document.getElementById('btn-cerrar-menu-flotante');
      const itemsContainer = document.getElementById('items-menu-flotante');

      const btnToggleNueva = document.getElementById('btn-toggle-nueva-lista');
      const boxForm = document.getElementById('flotante-form-box');
      const btnCancelarForm = document.getElementById('btn-cancelar-form-flotante');
      const form = document.getElementById('form-flotante-lista');
      const inputNombre = document.getElementById('input-flotante-nombre');
      const inputUrl = document.getElementById('input-flotante-url');
      const inputFile = document.getElementById('input-flotante-archivo');
      const labelFile = document.getElementById('flotante-file-name');
      const tabUrl = document.getElementById('tab-flotante-url');
      const tabArchivo = document.getElementById('tab-flotante-archivo');
      const campoUrl = document.getElementById('flotante-campo-url');
      const campoArchivo = document.getElementById('flotante-campo-archivo');
      const btnSincronizar = document.getElementById('btn-flotante-sincronizar');

      const abrirMenu = () => {
        this.actualizarUI();
        if (boxForm) boxForm.hidden = true;
        if (menuFlotante) {
          menuFlotante.hidden = false;
          menuFlotante.style.display = 'flex';
          menuFlotante.style.flexDirection = 'column';
        }
        if (btnAbrir) btnAbrir.setAttribute('aria-expanded', 'true');
        if (chevron) chevron.style.transform = 'rotate(180deg)';
      };

      const cerrarMenu = () => {
        if (menuFlotante) {
          menuFlotante.hidden = true;
          menuFlotante.style.display = 'none';
        }
        if (boxForm) boxForm.hidden = true;
        if (btnAbrir) btnAbrir.setAttribute('aria-expanded', 'false');
        if (chevron) chevron.style.transform = 'rotate(0deg)';
      };

      const toggleMenu = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (!menuFlotante) return;
        const abierto = !menuFlotante.hidden && menuFlotante.style.display !== 'none';
        if (abierto) {
          cerrarMenu();
        } else {
          abrirMenu();
        }
      };

      if (btnAbrir) btnAbrir.addEventListener('click', toggleMenu);
      if (btnSidebar) btnSidebar.addEventListener('click', toggleMenu);
      if (btnCerrar) btnCerrar.addEventListener('click', (e) => { e.stopPropagation(); cerrarMenu(); });

      // Cerrar al hacer clic fuera
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#contenedor-menu-listas') && !e.target.closest('#btn-sidebar-cambiar-lista')) {
          cerrarMenu();
        }
      });

      // Cerrar al presionar Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          cerrarMenu();
        }
      });

      // Delegación de eventos en items de la lista
      if (itemsContainer) {
        itemsContainer.addEventListener('click', (e) => {
          const btnEliminar = e.target.closest('[data-accion="eliminar"]');
          if (btnEliminar) {
            e.preventDefault();
            e.stopPropagation();
            const id = btnEliminar.dataset.id;
            if (id) this.eliminar(id);
            return;
          }

          const btnActivar = e.target.closest('[data-accion="activar"]');
          if (btnActivar) {
            e.preventDefault();
            e.stopPropagation();
            const id = btnActivar.dataset.id;
            if (id) {
              this.activar(id);
              cerrarMenu();
            }
          }
        });
      }

      // Pestañas Formulario (URL vs Archivo)
      if (tabUrl && tabArchivo && campoUrl && campoArchivo) {
        tabUrl.addEventListener('click', (e) => {
          e.preventDefault();
          this.modoFormulario = 'url';
          tabUrl.classList.add('activo');
          tabArchivo.classList.remove('activo');
          campoUrl.hidden = false;
          campoArchivo.hidden = true;
        });

        tabArchivo.addEventListener('click', (e) => {
          e.preventDefault();
          this.modoFormulario = 'archivo';
          tabArchivo.classList.add('activo');
          tabUrl.classList.remove('activo');
          campoUrl.hidden = true;
          campoArchivo.hidden = false;
        });
      }

      // Manejo de archivo seleccionado
      if (inputFile) {
        inputFile.addEventListener('change', (e) => {
          const file = e.target.files?.[0];
          if (file) {
            this.archivoSeleccionado = file;
            if (labelFile) labelFile.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
            if (inputNombre && !inputNombre.value.trim()) {
              inputNombre.value = file.name.replace(/\.[^/.]+$/, '');
            }
          }
        });
      }

      // Toggle formulario desplegable "+ Nueva Lista"
      if (btnToggleNueva && boxForm) {
        btnToggleNueva.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const visible = !boxForm.hidden;
          boxForm.hidden = visible;
          if (!visible) {
            form?.reset();
            this.archivoSeleccionado = null;
            if (labelFile) labelFile.textContent = 'Seleccionar archivo .m3u / .txt';
            setTimeout(() => inputNombre?.focus(), 50);
          }
        });
      }

      if (btnCancelarForm && boxForm) {
        btnCancelarForm.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          boxForm.hidden = true;
        });
      }

      // Guardar nueva lista
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const nombre = inputNombre?.value.trim();
          const url = inputUrl?.value.trim();
          const btnSubmit = document.getElementById('btn-flotante-submit');

          if (!nombre) {
            alert('Por favor ingresa un nombre para la lista.');
            return;
          }

          if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Guardando…';
          }

          try {
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
            cerrarMenu();
          } catch (err) {
            alert('Error: ' + err.message);
          } finally {
            if (btnSubmit) {
              btnSubmit.disabled = false;
              btnSubmit.textContent = 'Guardar y Activar';
            }
          }
        });
      }

      // Sincronizar PIN de Cloudflare KV
      if (btnSincronizar) {
        btnSincronizar.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const pin = prompt('Introduce tu PIN de Alexis TV para sincronizar listas de la nube:');
          if (pin) {
            this.importarDesdeKV(pin);
          }
        });
      }

      this.actualizarUI();
      this.sincronizarSilenciosoKV();

      // Cargar lista activa al inicio si viene por parámetro URL o no es la oficial
      const activa = this.obtenerActiva();
      if (activa && (activa.id !== 'oficial' || new URLSearchParams(window.location.search).has('lista') || new URLSearchParams(window.location.search).has('url'))) {
        setTimeout(() => {
          this.activar(activa.id);
        }, 250);
      }
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
