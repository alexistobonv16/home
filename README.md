# alexistobon.com - Home & Showcase de Proyectos

Página de inicio para **alexistobon.com** diseñada para mostrar en tiempo real las plataformas activas de Alexis Tobón:
- **NotiTec** (`https://www.notitec.co`)
- **Mis Gastos** (`https://gastos.alexistobon.com`)

## Características Principales

1. **Visores en Directo (Live Browser Frames)**:
   - Marcos de ventana simulados con estética macOS y barra de direcciones SSL.
   - Escalado responsivo dinámico vía CSS Transform (`transform: scale(...)`), que renderiza el sitio de escritorio completo y nítido dentro de la tarjeta sin barras horizontales.
   - Conmutador de vistas: **Escritorio** y **Móvil / PWA** (ideal para la experiencia de smartphone de *Mis Gastos*).
   - Botón para recargar la vista en tiempo real.
   - Botón para copiar los enlaces directos.
   - Barrera de interacción inteligente: evita que el scroll principal quede atrapado hasta que el usuario hace clic para interactuar.

2. **Visor en Pantalla Completa (Modal)**:
   - Permite expandir cualquiera de los proyectos a una ventana de navegación ampliada sin salir de `alexistobon.com`.

3. **Diseño Moderno & Accesibilidad**:
   - Tema oscuro por defecto con soporte para Modo Claro (persistencia en `localStorage`).
   - Efectos de cristal esmerilado (*glassmorphism*), gradientes modernos y tipografía *Plus Jakarta Sans* y *JetBrains Mono*.
   - Sección sobre mí con enlaces a GitHub, LinkedIn y correo directo.

---

## Cómo Probar Localmente

### Opción 1: Con Node / npm
```bash
npm run dev
```
Abre en tu navegador `http://localhost:3000`.

### Opción 2: Con Python
```bash
python -m http.server 3000
```

### Opción 3: Abrir directamente
Puedes abrir directamente el archivo `index.html` con doble clic en tu navegador preferido.

---

## Despliegue en alexistobon.com

Dado que es un sitio estático ultra ligero y sin dependencias de compilación complejas:

### En Cloudflare Pages / Vercel / Netlify
1. Conecta tu repositorio de GitHub a tu proveedor de hosting favorito.
2. Configuración de Build:
   - **Build command**: (dejar vacío)
   - **Output directory**: `.` (o directorio raíz)
3. Asocia tu dominio personalizado `alexistobon.com`.
