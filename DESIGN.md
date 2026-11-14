# Design System — Plataforma Chome

## Dirección visual

**Pozo blanco dentro de un chrome tintado.** La app es una superficie de
contenido blanca (el "pozo") enmarcada por un shell edge-to-edge en gris tenue
(sidebar + header). La elevación y los bordes cargan la jerarquía; el color es
neutral con la marca Chome como acento medido. La interfaz no compite con los
datos: los presenta. Siempre en claro — no hay dark mode (`color-scheme: light`).

Los tokens viven en `app/globals.css` dentro de `@theme`, en OKLCH para control
perceptual preciso de luminosidad.

---

## Color

### Filosofía

Paleta desaturada sobre lienzo blanco. La marca Chome aporta tres acentos con
roles estrictos:

- **Verde esmeralda `#005c3f`** (`--color-primary`) — acciones principales, foco, éxito.
- **Naranja `#e78400`** (`--color-signal`) — **reservado a estados pendientes** y
  sus badges/alertas. Nunca para acciones ni decoración.
- **Amber `#ffd53f`** (`--color-accent`) — realces puntuales.

Cada color semántico tiene 4 variantes: base, `-tint` (superficie), `-line`
(borde), `-ink` (texto sobre tint).

### Tokens de color

<!-- Generada desde app/globals.css. No editar a mano: el test
     components/__tests__/design-tokens-contrast.test.ts valida los
     mínimos de contraste sobre los valores reales del CSS. -->

| Token | Valor OKLCH | Hex aprox. | Uso |
|---|---|---|---|
| `--color-primary` | `oklch(0.415 0.098 166)` | `#005c3f` | Verde esmeralda Chome — acciones, foco |
| `--color-primary-tint` | `oklch(0.945 0.035 166)` | `#d8f5e7` | Superficie de realce |
| `--color-primary-line` | `oklch(0.850 0.060 166)` | `#a9dbc5` | Borde / hover |
| `--color-primary-ink` | `oklch(0.230 0.090 166)` | `#002912` | Texto sobre tint |
| `--color-primary-strong` | `oklch(0.330 0.098 166)` | `#004429` | Estado hover |
| `--color-primary-deep` | `oklch(0.220 0.090 166)` | `#002610` | Fondo hero card |
| `--color-signal` | `oklch(0.705 0.165 62)` | `#e78400` | Naranja Chome — **solo** pendientes |
| `--color-signal-tint` | `oklch(0.965 0.022 62)` | `#fff1e5` | Fondo de alerta pendiente |
| `--color-signal-line` | `oklch(0.892 0.052 62)` | `#f5d4b9` | Borde de alerta pendiente |
| `--color-signal-ink` | `oklch(0.402 0.130 62)` | `#773100` | Texto sobre signal-tint |
| `--color-accent` | `oklch(0.893 0.165 89)` | `#ffd53f` | Amber Chome — realces puntuales |
| `--color-accent-tint` | `oklch(0.975 0.030 89)` | `#fff6e1` | Fondo de realce |
| `--color-accent-line` | `oklch(0.920 0.065 89)` | `#f6e3b4` | Borde de realce |
| `--color-accent-ink` | `oklch(0.450 0.120 89)` | `#705000` | Texto sobre accent-tint |
| `--color-success` | `oklch(0.415 0.098 166)` | `#005c3f` | Completado, aprobado (= verde primary) |
| `--color-success-tint` | `oklch(0.945 0.035 166)` | `#d8f5e7` | Fondo de éxito |
| `--color-success-line` | `oklch(0.850 0.060 166)` | `#a9dbc5` | Borde de éxito |
| `--color-success-ink` | `oklch(0.230 0.090 166)` | `#002912` | Texto sobre success-tint |
| `--color-warning` | `oklch(0.720 0.140 78)` | `#d49824` | Parcial, en progreso |
| `--color-warning-tint` | `oklch(0.970 0.030 85)` | `#fef4df` | Fondo de advertencia |
| `--color-warning-line` | `oklch(0.900 0.060 82)` | `#f2dbb1` | Borde de advertencia |
| `--color-warning-ink` | `oklch(0.395 0.110 75)` | `#683b00` | Texto sobre warning-tint |
| `--color-danger` | `oklch(0.520 0.155 27)` | `#b13a34` | Rechazado, error |
| `--color-danger-tint` | `oklch(0.965 0.012 27)` | `#fcf1ef` | Fondo de error |
| `--color-danger-line` | `oklch(0.890 0.030 27)` | `#eed4d0` | Borde de error |
| `--color-danger-ink` | `oklch(0.355 0.135 27)` | `#720c0e` | Texto sobre danger-tint |
| `--color-info` | `oklch(0.520 0.080 240)` | `#3a6f92` | Informativo |
| `--color-info-tint` | `oklch(0.965 0.008 240)` | `#eff4f8` | Fondo informativo |
| `--color-info-line` | `oklch(0.892 0.020 240)` | `#d0dee8` | Borde informativo |
| `--color-info-ink` | `oklch(0.330 0.075 240)` | `#013958` | Texto sobre info-tint |
| `--color-bg` | `oklch(0.965 0.002 0)` | `#f3f3f3` aprox. | Lienzo gris suave |
| `--color-surface` | `oklch(1.000 0     0)` | `#ffffff` | Superficie de contenido (pozo) |
| `--color-surface-2` | `oklch(0.974 0.002 0)` | `#f6f6f6` aprox. | Hover, panel secundario |
| `--color-surface-3` | `oklch(0.955 0.002 0)` | `#eeeeee` aprox. | Terciario, inset |
| `--color-chrome` | `oklch(0.965 0.002 0)` | `#f3f3f3` aprox. | Relleno del shell (sidebar + header) |
| `--color-chrome-hover` | `oklch(0.940 0.002 0)` | `#e9e9e9` aprox. | Hover dentro del chrome |
| `--color-border` | `oklch(0.925 0.002 0)` | `#e5e5e5` aprox. | Hairline decorativa, divisores |
| `--color-border-strong` | `oklch(0.848 0.002 0)` | `#cecece` aprox. | Divisor fuerte |
| `--color-border-control` | `oklch(0.640 0.002 0)` | `#8d8d8d` aprox. | **Contorno de controles** — WCAG 1.4.11 ≥3:1 |
| `--color-border-control-hover` | `oklch(0.545 0.002 0)` | `#717171` aprox. | Hover del contorno de controles |
| `--color-rule` | `oklch(0.225 0.002 0)` | `#1d1d1d` aprox. | Regla tipográfica fuerte |
| `--color-text` | `oklch(0.180 0.002 0)` | `#121212` aprox. | Texto principal |
| `--color-text-muted` | `oklch(0.430 0.002 0)` | `#515151` aprox. | Secundario |
| `--color-text-subtle` | `oklch(0.500 0.002 0)` | `#646464` aprox. | Placeholder (WCAG AA) |
| `--color-text-faint` | `oklch(0.535 0.002 0)` | `#717171` aprox. | Sutil — cumple AA también sobre chrome |
| `--color-overlay` | `oklch(0.180 0.004 90 / 0.24)` | `—` | Overlay de modales |
| `--color-brand-surface` | `oklch(1.000 0 0)` | `#ffffff` | Superficie de marca |
| `--color-brand-text` | `oklch(0.180 0.004 90)` | `#121210` | Texto de marca |
| `--color-brand-text-muted` | `oklch(0.430 0.005 90)` | `#51504d` | Texto de marca secundario |
| `--color-brand-border` | `oklch(0.918 0.004 90)` | `#e5e4e1` | Borde de marca |

### Reglas de uso

- **Nunca** hardcodear `oklch()` en componentes. Siempre `var(--color-*)` o
  clases Tailwind del tema.
- El naranja signal **solo** para pendientes y sus badges/alertas.
- Los colores de estado comparten la estructura tint/line/ink.
- Los bordes y la elevación llevan la jerarquía; las sombras son suaves y se
  reservan a superficies flotantes (cards, popovers, modales). **Excepción: los
  tableros (`/dashboard` y los Indicadores de Control operacional)** no llevan
  sombra por bloque; ver «Excepción de los tableros» más abajo y la regla 7 de
  `AGENTS.md`.

---

## Tipografía

### Fuentes (`next/font/local` + `geist`)

| Token | Familia | Uso |
|---|---|---|
| `--font-display` | **Exo** | Marca Chome, títulos (`text-h1/h2/h3`, `text-display`) |
| `--font-sans` | **Myriad Pro** | UI, body, formularios, tablas, navegación |
| `--font-mono` | **Geist Mono** | Datos tabulares, códigos, valores numéricos (salvo las cifras de KPI de los tableros, que van en sans). Nunca rótulos ni insignias |

`--font-serif` existe solo por compatibilidad y apunta a Exo. Los títulos y el
cuerpo comparten un sistema tipográfico coherente: Exo para display, Myriad Pro
para lectura.

### Escala tipográfica

| Utility | Tamaño | Fuente / peso | Uso |
|---|---|---|---|
| `text-2xs` | 11px | — | Piso legible: meta densa, insignia `sm`. Reemplaza `text-[11px]`; `text-[10px]`/`[9px]` están prohibidos |
| `text-eyebrow` | 12px | Myriad 500, caja de oración, sin tracking, muted | Rótulo de bloque o de campo |
| `th-type` | 12px | Myriad 500, caja de oración, subtle | Cabecera de tabla (`TableHead`, `DataTable`) |
| `text-xs` | 12px | — | Labels, micro |
| `text-sm` | 13px | — | UI densa, celdas de tabla, listas |
| `text-base` | 15px | — | Body, párrafos |
| `text-h3` | 15px | Exo 600 | Sub-sección |
| `text-h2` / `text-lg` | 17px | Exo 600 | Cabeceras de sección |
| `text-h1` / `text-xl` | 22px | Exo 600 | Títulos de página (el título de la TopBar también va en Exo 600) |
| `text-display` / `text-2xl` | 28px | Exo 600 | Momentos display, login |
| `text-3xl` | 36px | — | Momento de marca |
| `text-sub` | 13px | Myriad muted | Descripciones y texto secundario |

### Reglas

- Datos numéricos (cantidades, precios, totales) siempre en `font-mono tabular-nums`.
  **Excepción: los tableros (`/dashboard` y `/*/indicadores`)**, donde las cifras de KPI y los
  titulares de gráfico van en `font-sans font-semibold tabular-nums`
  (`KpiCard numerals="sans"`, vía `DASHBOARD_KPI`).
- **Caja de oración en toda la interfaz** (auditoría UX-05, 2026-11-07). No hay
  rótulos, cabeceras ni insignias en MAYÚSCULAS espaciadas: llegaban a 63 por
  pantalla y nada destacaba. La jerarquía la llevan el tamaño y el color. La
  regla ESLint `local/ui-type-scale` rechaza `uppercase` y `text-[9|10px]` en
  clases; sólo se exceptúa un `uppercase` que normaliza un dato tecleado
  (patente, código, RUT), con un `eslint-disable` que lo dice.
- **Pesos 400–600.** El 700 queda para la marca; títulos y cifras van en 600.
- **Una cifra se pasa como número** a `KpiCard`/`SummaryBar`, que la formatean
  en es-CL (`2.246`, nunca `2246`); la regla `local/no-string-kpi-value` rechaza
  `value={String(n)}`. Una palabra («Ninguno», «Sin datos», «Al día») va con
  `valueKind: "text"` en sans muted: con estilo de cifra se leía como un número
  roto.
- Fechas y códigos de transacción en mono; un código, una cifra con su unidad y
  una fecha no se parten en dos líneas (`TableCell nowrap`).
- Sin itálica: el texto vacío o de meta («Sin nombre», «Pendiente») va en
  `--color-text-subtle`.
- El cuerpo aplica `font-feature-settings: "ss01", "cv11"`.

---

## Layout — AppShell

Estructura de la app autenticada (`components/layout/app-shell.tsx`):

```
┌───────────────────────────────────────────────────────────────┐
│  bg-(--color-chrome) · h-[100dvh]  — shell tintado en "L"      │
│ ┌──────────┐ ┌───────────────────────────────────────────────┐│
│ │ DesktopNav│ │  [data-shell-scroll] — pozo blanco              ││
│ │  (rail +  │ │  bg-(--color-surface) · lg:rounded-tl-[36px]   ││
│ │  panel)   │ │  overflow-y-auto (scroll container)            ││
│ │  al ras   │ │ ┌───────────────────────────────────────────┐ ││
│ │           │ │ │ <header> TopBar — banner, NO sticky        │ ││
│ │           │ │ ├───────────────────────────────────────────┤ ││
│ │           │ │ │ <main id="main-content">                   │ ││
│ │           │ │ │  <PageContainer> → <PageHeader /> + conten.│ ││
│ │           │ │ └───────────────────────────────────────────┘ ││
│ └──────────┘ └───────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

- El **sidebar va al ras** (izquierda de la "L" tintada), no es una tarjeta
  flotante. El panel principal es un **pozo blanco** (`bg-surface`) con la esquina
  superior izquierda redondeada (`lg:rounded-tl-[36px]` — valor fijo en
  `app-shell.tsx`, no deriva de ningún token de radio; existe un
  `--radius-shell` de 40px pensado para esto en `globals.css` pero no está
  conectado); su `overflow-y-auto` crea el scroll container y clipea el radio.
  El pozo también lleva `shadow-well` (sombra interior fija a su borde
  lateral y esquina), distinta de las sombras de superficies flotantes.
- El **TopBar NO es sticky**: scrollea con el contenido, dentro del pozo. Por eso
  no lleva fondo propio —hereda el del pozo y con él la sombra `inset`, de modo
  que cabecera y zona de trabajo quedan sin costura—. (La documentación afirmó
  durante un tiempo lo contrario y citaba un hook `useHideOnScroll` que nunca
  existió en el repo.)
- El `<header>` de la TopBar es el landmark **`banner`**, y por eso vive como
  hermano de `<main>` y no dentro de él: un `<header>` descendiente de `main`
  pierde esa correspondencia, y hasta el 2026-09-21 la aplicación no exponía
  ningún landmark de cabecera. El nodo con `overflow-y-auto` es el pozo
  (`[data-shell-scroll]`), no `<main>`, así que todo `sticky top-0` y todo
  `scroll-mt-*` de las páginas resuelve contra el pozo.
- `<main>` va **sin clases**, y no es estética: un `transform`, `filter`,
  `contain` u `overflow` ahí lo volvería bloque contenedor de los modales
  `fixed inset-0` de las páginas y rompería el `sticky` del detalle de
  inspección. `components/layout/app-shell.test.tsx` lo congela.
- **Command palette ⌘K / Ctrl+K** global (lazy), navega a cualquier destino
  permitido.
- **Feature toggles**: `enabledModuleIds` oculta módulos deshabilitados en toda
  la navegación.

### Mobile

El rail desaparece y la navegación colapsa en un **drawer** de columna única:

- Overlay `bg-overlay` con fade; drawer `w-64`, `bg-chrome`, slide-in-from-left,
  `ease-drawer`, `--duration-slow`.
- La hamburguesa del TopBar abre/cierra; `MobileNav` es un acordeón.
- `DataTable` oculta la tabla y muestra `renderMobileCard` (tarjetas apiladas).

### Grupos de layout

- `(auth)` — login/registro, sin AppShell (solo QueryProvider).
- `(app)` — rutas autenticadas, AppShell completo.
- `(print)` — impresión A4 (OC), sin AppShell, con auth check.
- `(mecanico)` — app del mecánico (`/m/mantencion`), sin AppShell. **Excepción
  declarada** (2026-11-07): tiene paleta propia (`app/(mecanico)/mant-app.css`,
  variables `.mant`: verde `#27894d`, ámbar, naranja), portada del prototipo
  validado para uso en terreno (pantalla al sol, guantes, objetivos de 52–56 px),
  y conserva los `<input type="date">` nativos porque en el teléfono el selector
  del sistema es el mejor control. Lo que sí rige ahí es la tipografía de la
  plataforma: caja de oración (sin MAYÚSCULAS espaciadas) y el mismo saludo por
  hora que el Inicio. No es un modelo para pantallas de `(app)`.

---

## Navegación

La navegación se **deriva del registry**: cada módulo declara ítems por `areaId`
en su manifest, y `components/layout/areas.ts` define el catálogo de áreas (icono
Phosphor + orden). `nav-items.ts` los agrupa y filtra por permiso y por módulos
habilitados.

### Áreas del rail

| Área | Icono | Orden |
|---|---|---|
| Dashboard | `SquaresFour` | fija (entrada del rail) |
| Adquisiciones | `Stack` | 10 |
| Control operacional | `Car` | 15 |
| Bodega | `Warehouse` | 20 |
| Reportes | `ChartBar` | 30 |
| Prevención | `ShieldCheck` | 40 |
| TI | `Desktop` | 45 |
| Soporte | `Lifebuoy` | 50 |

Cada área es un icono del rail; al activarla despliega un panel con sus ítems
(y submenús). El estado activo se resuelve con `isHrefActive` / `findActiveArea`,
con reglas especiales para los submódulos de Prevención.

### Estado de los ítems

- **Un solo estado activo para todo el menú** (decisión 2026-11-07, UX-09):
  áreas, subítems, Inicio, Soporte, *flyout* del rail y menú móvil usan
  `bg-nav-active-bg text-nav-active-ink font-semibold` (tokens
  `--color-nav-active-bg` = `primary-tint`, `--color-nav-active-ink` =
  `primary-ink`) y el ícono en `--color-primary`. Es el mismo verde de
  selección de los chips y segmentados. Las clases salen de los helpers de
  `nav-rows.tsx` (`navRowClass`, `navIconClass`, `navRailClass`): no se
  escriben a mano.
- **Inactivo**: texto `--color-text-muted`, ícono `--color-text-subtle`; hover
  `bg-nav-hover-bg` (`--color-chrome-hover`) con transición de color 140ms.
  Un padre con un hijo activo va en `--color-text`, sin relleno.
- Sin paleta `slate-*` ni colores literales en el menú (lo vigila
  `components/__tests__/ui-primitives-no-literal-colors.test.ts`).
- Rótulos de grupo a 14px y peso 500, en hasta dos líneas (`line-clamp-2`): los
  grupos de administración caben sin renombrarse. Los rótulos de sección
  («Plataforma», grupos del manifiesto) usan `text-eyebrow`.
- Badge de pendientes: naranja signal, mono `text-2xs`, `99+` para >99.
- Los ítems se filtran por permisos (`canSeeNav`) y toggles de módulo.

### TopBar

- `h-[3.5rem]` en móvil, `lg:min-h-[4.5rem]` en escritorio; no es sticky (ver
  AppShell). **Desktop**: el *breadcrumb* lo pasa cada página por
  `PageHeader.breadcrumb` (no se deriva solo; `/dashboard` no lleva), título en
  Exo 600 y, **debajo**, la descripción en hasta dos líneas (`line-clamp-2`,
  ~72 caracteres por línea): es la línea que responde «qué es esto» y no se
  trunca. Conviene que no pase de ~90 caracteres y que no repita datos que ya
  muestra un control (el período, por ejemplo). Chip de faena opcional, campana
  de notificaciones (contador estático, sin animación en bucle) y avatar con
  dropdown.
- **Mobile**: hamburguesa + marca Chome a la izquierda, campana + avatar a la
  derecha; el breadcrumb se oculta (`hidden lg:flex`).

### NavigationProgress

Barra de progreso sutil (tipo NProgress) durante navegaciones SPA, activada por
cambios de ruta vía `template.tsx`, que además aplica un fade sutil de página.

---

## Componentes (`components/ui/`, 50)

### Button

6 variantes + 7 tamaños. Lleva `motion-safe:active:scale-[0.98]` en el press —
la única excepción al principio "sin scale" del resto del sistema (ver Motion).

| Variante | Fondo | Texto | Borde |
|---|---|---|---|
| `primary` | `--color-primary` | white | — |
| `secondary` | `--color-surface` | `--color-text` | `--color-border-control` |
| `ghost` | transparente | `--color-text-muted` | — |
| `destructive` | `--color-danger` | white | — |
| `signal` | `--color-signal-tint` | `--color-signal-ink` | `--color-signal-line` |
| `link` | — | `--color-primary-ink` | — |

Tamaños, móvil-first (`h-11` / 44px táctil en mobile → más compacto en
desktop vía `sm:`): `sm` (`sm:30px`), `default` (`sm:34px`), `lg` (`sm:38px`),
`icon`/`icon-sm` (30–34px cuadrados), `icon-mobile`/`icon-mobile-sm` (fuerzan
el tamaño táctil también en desktop). Estados: loading con spinner +
`aria-busy`, disabled con opacidad.

### Input / Select / Textarea

- Alturas distintas por control, no una talla única (mismo patrón móvil `h-11`
  → desktop `sm:` que Button): `Input` `sm:34px` + `radius-md`; `Select`
  trigger `sm:36px` (`h-9`) + `radius-lg`; `Textarea` sin altura fija
  (`min-h-[80px]`, `resize-y`) + `radius-lg`. El trigger de `Select` **no** es
  idéntico al `Input`: difiere en alto, radio y padding horizontal.
- Borde `--color-border-control` (no `--color-border`, reservado a hairlines
  decorativas/divisores), fondo `--color-surface`, placeholder
  `--color-text-subtle`.
- Focus: borde `--color-primary` + ring `--color-primary-line`.
- Error: borde `--color-danger` + ring + `aria-invalid`.
- Disabled/read-only: fondo `--color-surface-2`.
- `Select` (Radix): content con animación de escala, check Phosphor, foco de
  ítem en `--color-primary-tint`.

### Field + Label

- Label `text-sm font-medium`, required muestra `*`.
- Helper `text-xs text-subtle`; error `text-xs text-danger` con `role="alert"`.
- `FieldGroup` con `gap-4`. Inyecta `aria-labelledby` / `aria-describedby` en el
  hijo vía `React.cloneElement`.

### Table / DataTable

Tabla semántica con scroll horizontal (`TableRoot` → `overflow-x-auto`),
cabeceras en `th-type` (caja de oración, 12px, subtle; ordenables o no, el mismo
tratamiento), filas con hover `bg-surface-2`, celdas numéricas en mono tabular y
`TableCell nowrap` para códigos, cifras con unidad y fechas. `DataTable`
(`components/ui/data-table.tsx`) integra búsqueda (conectada al TopBar vía
`useSafeShellHeader`), ordenamiento, paginación, estados vacíos/skeleton y vista
mobile (`renderMobileCard`).

**Tabla dentro de otra superficie: `framed={false}`.** `TableRoot` trae su propio
marco (`rounded-2xl`, borde y fondo) porque normalmente *es* la superficie. Si la
tabla vive dentro de una `Card`, una `Section` o un `<details>`, el resultado son
dos marcos concéntricos con el mismo radio a 20 px de distancia: una tarjeta
dentro de una tarjeta. En ese caso se pasa `framed={false}` a `DataTable` o a
`TableRoot`; si la `Card` sólo aporta un título, se quita la `Card` y la tabla
queda como única superficie con el título como encabezado de sección.

### Otros

- **Badge**: **un solo tratamiento tipográfico** para todas las variantes (sans,
  peso 500, caja de oración, `whitespace-nowrap`; `sm` = `text-2xs`, `default` =
  `text-xs`, `lg` = `text-sm`). La severidad la llevan el color (`-tint` de fondo,
  `-ink` de texto) y el punto opcional, no la tipografía. Hasta el 2026-11-07 las
  severidades iban en mono MAYÚSCULAS y las neutras en sans, y una misma columna
  mezclaba «Normal» con «● ALTA» (UX-04). Un estado largo lleva una insignia
  corta y el detalle en la fila (o en el `title`).
- **Dialog / Sheet**: overlay `bg-overlay` + `backdrop-blur`, content flotante
  (`shadow-lg`), animación fade + zoom. Título en `font-display` (Exo).
- **Tabs, Popover, DropdownMenu, Tooltip, Checkbox**: primitives Radix
  envueltas en `components/ui/` con tokens del tema. `Collapsible` se usa
  directo desde Radix en la navegación (`components/layout/`), sin wrapper
  propio. No hay `ScrollArea`: no es una dependencia del proyecto — el scroll
  nativo se estiliza con `scrollbar-width`/`scrollbar-color` en `globals.css`.
- **EmptyState / ErrorState**: usados consistentemente; empty en lenguaje de
  usuario + CTA real. **Skeleton**: shimmer en cargas. **Avatar**: iniciales con
  color por hash del nombre (OKLCH). **Pagination**: componente compartido único.

### Período: tres patrones

Un mismo control para la misma pregunta (auditoría UX-07, 2026-11-07: había seis
controles distintos y tres maneras de aplicarlos).

| Pregunta | Control | Dónde |
|---|---|---|
| Período de calendario (un mes o un rango de fechas) | `PeriodControl` (`components/ui/period-control.tsx`): paso ‹ ›, atajos, grilla de meses y rango personalizado en un *popover* | Combustible, Control operacional, Analítica, Facturación, Compras DTE |
| Granularidad (Mes / Trimestre / Año) | `SegmentedControl` | Inicio |
| Ventana móvil (7 días / 30 días / Este mes / Todo) | `SegmentedControl` | Mantención |

- Se aplica al cambiar, con `router.replace(url, { scroll: false })` y sin botón
  «Aplicar»/«Filtrar». La única excepción es el rango personalizado: son dos
  campos, así que lleva «Aplicar rango» dentro del *popover*.
- `PeriodControl` va en `PageHeader.actions` (es un control de la página, no del
  contenido) y nunca toca `window.history` ni cookies: la cookie del período de
  Combustibles vive sólo en su envoltorio (`components/combustibles/fuel-period-control.tsx`,
  sobre `PeriodControlCore`). En Next 16, un `history.replaceState` seguido de
  `revalidatePath` + `router.refresh` recarga la página entera.
- Un enlace de `SegmentedControl` que sólo cambia la consulta de la misma página
  usa `replace` y `scroll={false}`; uno que lleva a otra página conserva el
  historial.

### Exportar

`ExportButton` (exportación por acción de servidor) y `ExportLink` (descarga GET,
`<a download>`: sigue siendo un enlace) en `components/ui/export-button.tsx`.
Rótulo «Exportar Excel» (o un calificativo: «Exportar historial», «Descargar
plantilla»), ícono `EXPORT_ICON` (`FileXls`) y variante `secondary`: el primario
de la cabecera es para la acción que crea trabajo. No se arman enlaces de
descarga a mano.

### Modales multivista: el alto no cambia

Un modal cuya vista activa alterna —pestañas, `SegmentedControl`, pasos de un
asistente— pasa `stableHeight` a `DialogContent`/`SheetContent`. El primitivo
cambia el `max-h` por un `h` fijo y el cuerpo scrollea, así que la caja deja de
medir su contenido. Sin eso, «Editar vehículo» saltaba ~600 px al pasar de
«Documentos» a «Combustible» (reportado el 2026-10-29); el defecto es de
escritorio, porque en móvil el sheet ya es `inset-0`.

- El alto por defecto es la cota del `max-h` (`min(85vh,56rem)` en Sheet,
  `min(90dvh,54rem)` en Dialog). Si la vista más alta es más corta, se calibra
  con un `h-[…]` por `className` (`twMerge` deja ganar la última clase); nunca
  se vuelve a un alto variable.
- En un sheet con pestañas, la `TabsList` va `shrink-0` y sólo el panel scrollea
  (`min-h-0 flex-1 overflow-y-auto`); si no, la tira se va con el formulario.
- No se aplica a la divulgación progresiva (aparece un campo condicional, un
  aviso de validación): ahí crecer es información nueva, no un cambio de vista.
- `components/__tests__/modal-alto-estable.test.ts` falla si un modal con
  pestañas o segmentos no lo usa; `e2e/modal-alto-estable.spec.ts` mide la caja
  real al recorrer las pestañas del vehículo.

---

## Motion

**"La bitácora es calma."** Transiciones de color, no de escala — con la
excepción ya señalada de `Button` (`active:scale-[0.98]`).

| Token | Valor | Uso |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.20, 0.80, 0.30, 1)` | Entradas, hover |
| `--ease-in-out` | `cubic-bezier(0.60, 0, 0.20, 1)` | Transiciones simétricas |
| `--ease-drawer` | `cubic-bezier(0.30, 0.80, 0.10, 1)` | Drawer slide |
| `--ease-panel` | `cubic-bezier(0.22, 1, 0.36, 1)` | Paneles laterales |
| `--duration-fast` | 140ms | Hover, foco |
| `--duration-default` | 180ms | Modales, selects |
| `--duration-slow` | 220ms | Drawers, layout |
| `--duration-hero` | 600ms | Intro del octágono en el hero de `/login` |

Animaciones: fade de página (`template.tsx`), modal fade + zoom-95, drawer
slide, select zoom-95, shimmer de skeleton, entrada/salida de toasts (Sonner con
barra de progreso), intro y estados del hero de `/login` (octágono de marca).
`prefers-reduced-motion: reduce` lleva todas las duraciones a 0ms.

**Excepción del hero de `/login`**: el hero de `(auth)` es la única superficie
de la plataforma que es identidad de marca, no bitácora — ya era la única con
gradiente radial y logo a tamaño de póster. Su octágono se dibuja a sí mismo al
cargar (`--duration-hero`, 600ms, por encima del techo de 220ms) y, en error,
el marco hace un shake de 4px (`auth-frame-shake`, transform, no color). Ambas
excepciones están acotadas a `.auth-hero-*` en `app/globals.css` y no
autorizan reusar el patrón en `(app)`: ahí sigue rigiendo transiciones de
color, no de escala, sin excepciones nuevas. El movimiento del hero solo existe
dentro de `@media (prefers-reduced-motion: no-preference)`: bajo `reduce`, sus
tres estados (pendiente, error, éxito) se siguen comunicando por color y
opacidad, nunca por movimiento.

---

## Radios y sombras

| Token | Valor | Uso |
|---|---|---|
| `--radius-xs` | 4px | Micro chips, badges |
| `--radius-sm` | 6px | Inputs densos, celdas |
| `--radius` | 8px | Ítems de navegación |
| `--radius-md` | 10px | `Button`, `Input`, controles |
| `--radius-lg` | 12px | `Select`, `Textarea`, contenedores secundarios |
| `--radius-xl` | 16px | Hero cards, `Select` content |
| `--radius-2xl` | 20px | `Dialog`, `TableRoot` |
| `--radius-shell` | 40px | Pensado para la esquina del pozo — hoy no conectado (ver AppShell) |
| `--radius-full` | pills | `Badge`, avatares |

**Radios anidados.** Un contenedor con radio dentro de otro usa *radio exterior −
relleno entre ambos*, nunca menos de 4 px; un interior más redondeado que su
contenedor (p. ej. una tabla `2xl` dentro de un `<details>` `xl`) se ve como un
error de montaje. Y antes de anidar, preguntar si el interior necesita marco: una
lista de filas dentro de una tarjeta se separa con `divide-y`, no con un borde
por fila.

Sombras suaves (`--shadow-xs/sm/card/md/lg`) reservadas a superficies
flotantes (cards, popovers, modales) + `--shadow-well`: sombra interior fija
al borde lateral y esquina superior del pozo principal — no es una superficie
flotante, es el propio contenedor de scroll del pozo (`[data-shell-scroll]`,
hermano mayor de `<main>`).

### Excepción de los tableros (`/dashboard` y los Indicadores)

Sólo en `/dashboard` (todas sus vistas) y en los Indicadores de Control
operacional (`/flota/indicadores`, `/mantencion/indicadores`,
`/combustibles/indicadores`) la superficie no es una tarjeta flotante
por bloque sino **un panel por grupo**: `DashboardPanel`
(`components/ui/dashboard-panel.tsx`) pone el borde, `rounded-2xl` y el fondo, y
sus celdas (`PanelBlock`, `ChartSlot`, tiles `KpiCard surface="flat"`) se separan
con líneas de 1px, sin sombra ni tarjeta anidada. Las cifras de KPI van en sans
semibold con `tabular-nums`, no en mono. El resto de la app mantiene tarjetas
flotantes y numerales mono. Motivo y límites (los paneles son `div`, nunca
regiones; Finanzas abre con gráficos) en la regla 7 de `AGENTS.md`. Las piezas
son compartidas: `DashboardSection` (`components/dashboard/dashboard-section.tsx`),
`DASHBOARD_KPI` (`components/ui/dashboard-panel.tsx`) y `lazyChart`
(`components/charts/lazy-chart.tsx`) para todo gráfico de Recharts.

---


## Gráficos

Fase 1 de `AUDITORIA_VISUALIZACIONES_CHOME.md` (2026-11-03). Rigen en toda la
plataforma; el tablero suma su excepción de superficie (regla 7 de AGENTS.md).

### Paleta (`lib/chart-palette.ts`, tokens en `app/globals.css`)

| Token | Valor | Uso |
|---|---|---|
| `--color-chart-1` | `oklch(0.415 0.098 166)` | Esmeralda (= primary). Primera categoría, serie protagonista |
| `--color-chart-2` | `oklch(0.500 0.090 245)` | Azul tinta |
| `--color-chart-3` | `oklch(0.580 0.115 68)` | Ocre |
| `--color-chart-4` | `oklch(0.480 0.095 330)` | Ciruela |
| `--color-chart-5` | `oklch(0.545 0.075 200)` | Verde azulado |
| `--color-chart-6` | `oklch(0.400 0.020 250)` | Pizarra oscura |
| `--color-chart-reference` | `oklch(0.640 0.010 250)` | Plan, meta, período anterior, «sin dato» |

- Todos miden ≥3:1 sobre `surface` y `surface-2` (WCAG 1.4.11) y los seis se
  separan entre sí por matiz o luminancia; lo comprueba
  `components/__tests__/design-tokens-contrast.test.ts`. **No hay hex en los
  gráficos.**
- **Estado ≠ categoría.** Cumple/vencido/pendiente/grave usan los semánticos
  (`success`, `warning`, `danger`, `signal`); la serie categórica es para faenas,
  módulos, proveedores. Nunca un color que no codifica nada (una barra de cada
  color en un ranking: usa `RankedList`).
- **Más de seis categorías:** resalta una y el resto en `reference`, o parte en
  small multiples. No se recicla el color.
- **Secuencial** (antigüedad, severidad creciente): de `reference` a `danger`
  interpolado en OKLab (`agingColor` en `components/charts/aging-bar.tsx`); en
  OKLCH el matiz gira y la rampa deriva a violeta o rosa.
- **Etapas de un ciclo de vida** (`/seguimiento`): rampa de un matiz, de clara a
  oscura según el avance; los tonos de las insignias se repiten entre vecinas.

### Primitivas (`components/charts/`)

| Primitiva | Para | Notas |
|---|---|---|
| `ChartSection` | Todo gráfico en una pantalla de módulo | `<figure>` con nombre = título, `summary` (la frase que responde), «Ver datos», estado vacío con CTA (A4), drill-down. En el tablero se usa `ChartFrame`. |
| `ChartDataTable` | Alternativa textual | `<details>` «Ver datos»; server-safe. Con `excel={{ permission }}` ofrece «Exportar Excel» (opt-in). Ver «Exportar a Excel». |
| `CoverageNotice` | Aviso de cobertura de un gráfico de combustible o integraciones | Una línea: qué meses de la ventana no tienen datos del proveedor o están incompletos y qué cifras quedan cortas. Ver «Aviso de cobertura de datos». |
| `BulletBar` | Medida contra capacidad/meta | `role="meter"`; marcas rotuladas; reemplaza radiales y barras sin contexto. |
| `AgingBar` | Pendientes por antigüedad | Tramos en orden cronológico, color secuencial, cifra visible por tramo, cada tramo enlaza a su subconjunto. |
| `ComplianceCalendar` | Filas × períodos con estado | `<table>` real; ícono + color + texto oculto por celda; contenedor desplazable con foco de teclado. `statusLabels` cambia los rótulos (Fuentes: Completo/Parcial/Sin datos); `selected` y `linkNavigation` para cuando filtra la misma pantalla. Adaptador de programas de Prevención: `ProgramComplianceSection` (casillas, cierres mensuales del PDTP, sesiones del CPHS; `wording`/`statusLabels`/`legend` cambian el vocabulario cuando la celda no es una «actividad hecha», y `hrefFor` puede devolver `undefined` para una celda sin a dónde llevar). |
| `MonthlyTrendChart` | Serie mensual: conteos apilados + una línea de % opcional | Eje de conteos a la izquierda y de % (0–100) a la derecha (A5b). El mes en curso es parcial (columna tenue, tramo punteado) y la línea se corta donde `rate` es `null` (sin dato o datos insuficientes, nunca 0). Los meses vacíos entre dos con datos se rellenan (`fillMonthSeries`): un hueco se ve. Inspecciones, alcotest y PPA. |
| `ShareBar` | Partes excluyentes de un total (estado de una solicitud) | Barra 100 % en el orden del dominio, color por token, leyenda con cifra y enlace por parte; segmentos fuera del tabulador. |
| `RiskMatrix` / `ResidualBands` | Matriz P×C de la MIPER | Tabla 3×3 con conteo y clase por celda; clases discretas (`risk-bands.ts`), nunca interpolado. Cada celda muestra los 3 peligros más frecuentes (al pasar el puntero o con foco) y filtra la matriz por la celda exacta (`?celda=P4xC2`). |
| `RiskShareBar` | Mezcla de clasificaciones de riesgo en una celda de tabla | Versión compacta de `ShareBar` para las 4 bandas del RE-04. |
| `DebtAgingChart`, `BillingFlowChart`, `ChartFrame` | Facturación y tablero | Movidos desde `dashboard/charts/` (quedan re-exports allí). |
| `StageDurationBar` | Plazos por tramo de un proceso (solicitud → aprobación → OC → llegada → entrega) | Una barra apilada por grupo (todas las faenas, cada faena), un segmento por tramo con el largo de su **mediana** y una marca en el P90 del plazo total. Toda cifra va con su `n`; con menos de 5 ítems el tramo dice «datos insuficientes» y no dibuja (P90 desde 10). La barra suma medianas y el total se mide ítem por ítem: la nota al pie lo dice. Rampa de un matiz en OKLab, nunca OKLCH. Sólo ítems cerrados (sesgo de supervivencia declarado). Cálculo en `lib/services/analytics-module/lead-time-shape.ts`. |
| `GroupedBarList` | Dos conteos de la **misma unidad** por categoría (ítems sin OC y OC por recibir, por faena) | Barras agrupadas como lista CSS: una fila por categoría, una barra y una cifra por serie, escala común. Si las series son de escala distinta no es este componente (A5b). |
| `DenseChart` | Reemplazo de un gráfico denso bajo 360 px | `<DenseChart fallback={<RankedList …/>}>`; `when` lo deja cuando los datos no son densos (≤ 6 segmentos). Ver «Responsive». |

### Reglas

- Cada gráfico tiene **nombre accesible** y una **alternativa en datos**.
- La respuesta va antes que el dibujo: una frase con la cifra que importa.
- Un gráfico sin datos no dibuja ejes en cero: explica el vacío y ofrece la acción.
- Un mes en curso o sin datos del proveedor se marca (parcial / hueco), nunca
  se dibuja como una caída.
- Torta sólo para 2–3 partes de un todo; en cualquier otro caso, barra.
- **Una tasa o un plazo nunca va sin su `n`** y, con muestra pequeña, dice «datos
  insuficientes» en vez de un número. Una frase-resumen es verdadera de lo que el
  gráfico muestra también en los estados parciales: el mes parcial y el mes sin datos
  del proveedor no compiten por «el mayor», y sin permiso de costos la frase habla sólo
  de lo que se ve («del gasto en compras»).
- **Una base de fecha por magnitud, dicha en pantalla.** El gasto en OC se fecha por
  **emisión** (`issuedAt` + `issuedOrderPredicate`) y con IVA en `/analitica`, `/reportes`
  y Finanzas del tablero; `lib/__tests__/analytics-finance-parity.test.ts` lo exige.

### Drill-down: indicador → gráfico → desglose → registros

Un gráfico no es un destino sino un paso: la regla J.3 de la auditoría («un gráfico
que no lleva a una acción ni a un subconjunto no se agrega») se cumple encadenando
cuatro niveles, cada uno con su primitiva y cada uno llevando al siguiente.

| Nivel | Qué responde | Primitiva | Cómo avanza al siguiente |
|---|---|---|---|
| 1. Indicador | «¿Cuánto hay y es grave?» | `KpiCard href`, `MetricBar` (A1: accionable) | El tile enlaza al **subconjunto**, no al total (`/mantencion/ot?estado=abiertas`) |
| 2. Gráfico | «¿Cómo se reparte o evoluciona?» | `ChartSection` (módulos) o `ChartFrame` (tablero) | `drillHref` a la lista que explica la cifra, o cada parte del gráfico es un enlace |
| 3. Desglose | «¿Cuál tramo, estado, mes o regla?» | `AgingBar`, `ShareBar`, `ComplianceCalendar`, `RankedList`, `StockCoverageStrip` | Cada segmento, celda o fila lleva a su subconjunto (`href` por parte) |
| 4. Registros | «¿Qué filas son?» | La tabla o lista de la **misma** pantalla (`DataTable`, bandeja) | Fin: la fila es la decisión (regla J.1: la tabla se queda) |

**Una dimensión = un parámetro de URL**, y el segmento del gráfico *es* el selector de
ese filtro (A5): no hay además un `Select` ni un tile con la misma cifra. Los nombres
que ya usa el código, y que un gráfico nuevo debe reutilizar antes de inventar otro:

| Parámetro | Filtra | Dónde está hoy |
|---|---|---|
| `?estado=` | Estado del dominio (ya en español, nunca el enum crudo) | `/mantencion/ot?estado=abiertas`, `/ti/activos?estado=disponible`, `/bodega/guias?estado=todos` |
| `?antiguedad=` | Tramo de antigüedad de lo pendiente (No vencida → … → Más de 90 días, en orden cronológico) | `AgingBar` en `/aprobaciones`; `approvalAgeHref` en `lib/approvals-age.ts` |
| `?regla=` | Regla de detección que originó un caso | Casos por regla de `/combustibles/revisar` |
| `?cobertura=` | Banda de cobertura de stock | `StockCoverageStrip` (`ShareBar`) de `/bodega` |
| `?mes=` (con `faena=`) | Una celda de un calendario de cumplimiento | `ComplianceCalendar` de `/prevencion/cgrd` (`hrefFor`, `clearHref`); la conciliación DTE usa `?periodo=YYYY-MM&vinculo=` (`dteListHref`) |
| `?celda=P4xC2` | Una celda de la matriz de riesgo | `RiskMatrix` en `/prevencion/miper/[id]` (`cellParam`, `hrefWithoutMatrixFilter`); se combina con `?clasificacion=` |

Reglas de URL, todas ya vigentes en los componentes de arriba:

- **El filtro de la misma pantalla reemplaza y no salta:** `replace: true, scroll: false`.
  Las primitivas lo traen con `inPlace` (`AgingBar`, `ShareBar`) o
  `linkNavigation={{ scroll: false, replace: true }}` (`ComplianceCalendar`); en un manejador es
  `router.replace(url, { scroll: false })`. Es el patrón «Navigation and scroll preservation» de
  `AGENTS.md`. Un enlace a **otra** pantalla (la lista del módulo) es un `Link` normal: ahí sí hay
  entrada de historial.
- **Elegir la parte vigente otra vez quita el filtro** (`approvalAgeHref(path, params, "")`,
  `clearHref`). Un segmento sin elementos no enlaza, salvo que sea el activo.
- **Se conserva el resto de los filtros y se descarta `page`:** al cambiar el conjunto, el número de
  página deja de significar algo.
- **El gráfico cuenta lo mismo que lista la tabla:** mismo alcance de permisos, mismos filtros, sin
  ampliarlo. Si el usuario no puede abrir la lista de destino, el elemento no lleva `href` (el Pareto
  de `/analitica` no enlaza a las OC de un proveedor sin permiso para abrirlas).
- **Nunca un enlace dentro de `role="img"`** (axe `nested-interactive`): el dibujo es imagen y los
  enlaces van en la leyenda, la lista o «Ver datos» que lo acompañan. El clic del puntero sobre una
  barra es una comodidad; el camino por teclado y por lector de pantalla es siempre un enlace real.

### Movimiento

- **`useChartMotion()`** (`components/ui/chart-interactions.tsx`) es el único lugar que decide la
  animación de entrada de un gráfico de recharts: **≤ 200 ms** (`CHART_ENTRY_MS`) y apagada con
  `prefers-reduced-motion` (`useReducedMotion`; recharts anima por JS y no lee los tokens
  `--duration-*`). Cada serie (`Bar`, `Line`, `Area`, `Scatter`, `Pie`) esparce el resultado:
  `<Bar {...motion} />`.
- **Prohibido** un `isAnimationActive={false}` fijo (deja sin entrada a quien no pidió reducir el
  movimiento) y un `animationDuration` propio (eran 900, 460 y 420 ms según la pantalla).
- El deslizamiento del tooltip entre puntos (`useTooltipProps`, 220 ms) no es una entrada y queda aparte.
- Las pruebas que leen el SVG ya terminado (alturas, formas, rótulos) corren con la preferencia
  «reducir movimiento» activa (`matchMedia` simulado): es el estado final al que llega la animación.
- Los gráficos que no son de recharts (`RankedList`, `DebtAgingChart`, el medidor radial) animan con
  `motion-safe:` en CSS y respetan el mismo tope: la duración sale de `CHART_ENTRY_MS`
  (`lib/chart-motion.ts`, que `chart-interactions.tsx` re-exporta; vive aparte porque esa pieza es
  `"use client"` y un componente de servidor no puede leer un valor desde allí) y va en línea
  (`animationDuration`), ya que Tailwind no ve un número interpolado en una clase. Las filas de un
  ranking y los tramos de la antigüedad entran juntos, sin escalonado; en el medidor las 41 marcas se
  reparten el tope (cada una se enciende en la mitad y el resto va en el retardo), así que el barrido
  completo no pasa de 200 ms.

### Responsive: bajo 360 px los gráficos densos pasan a lista

Bajo **360 px de ancho de pantalla** (un teléfono chico en vertical) un gráfico denso deja de leerse:
los puntos de una dispersión miden 3 px, ocho paneles de una serie pequeña no se comparan a la vista y
las etiquetas de veinte barras se cortan. Lo que no cabe **no se dibuja más chico: se reemplaza** por
su equivalente textual.

- **Un solo mecanismo:** `DenseChart` (`components/charts/dense-chart.tsx`).
  `<DenseChart fallback={…}>gráfico</DenseChart>` monta el gráfico en pantallas de 360 px o más y,
  en las más angostas, sólo el `fallback` con una línea que explica por qué. No renderiza las dos
  versiones escondiendo una con CSS: un `ResponsiveContainer` dentro de un `display:none` mide 0 y
  recharts avisa por consola.
- **Es una consulta de pantalla, no de contenedor** (`NARROW_CHART_QUERY`, `max-width: 359.98px`, vía
  `useMediaQuery`): la tarjeta que contiene el gráfico mide ~290 px incluso en un teléfono de 375 px,
  y una regla por contenedor reemplazaría gráficos en casi todos los móviles.
- **El reemplazo:** un `RankedList` cuando hay una medida que ordenar (litros por faena, gasto por
  proveedor; conserva el `href` de cada fila), o una tabla cuando son pares de valores. Nunca un
  gráfico más chico. Un gráfico que ya es una `<table>` (`ComplianceCalendar`, `RiskMatrix`) no se
  reemplaza: ya es su propia alternativa.
- **Qué es «denso»:**
  - todo `ScatterChart` (lo exige la guarda);
  - los *small multiples* (`EvolutionByVehicleChart`);
  - los rankings de ~8 barras o más con etiqueta larga (patentes, faenas, proveedores);
  - una columna apilada con **más de 6 segmentos** (`OverviewMonthlyChart` pasa
    `when={series.length > 6}`: con 6 o menos el gráfico cabe y se queda).
- Parte en «ancho» también en el servidor y en la hidratación: en una pantalla angosta el cambio llega
  al montar.

### Guarda: `components/__tests__/chart-guard.test.ts`

Como `modal-alto-estable.test.ts` con los modales: un escaneo estático (sobre el AST, no sobre
texto) de todo `.tsx` bajo `app/` o `components/` que importa un valor de `recharts`, en cada
`npm run test:fast`. Falla con la ruta y la línea del gráfico que no cumple:

1. **Sin literales de color** (hex, `rgb(`, `hsl(`, `oklch(`…) en cadenas; también en
   `lib/chart-palette.ts` y en todo `components/charts/`. Usa `CHART_COLORS` / `CHART_SERIES` o
   `var(--color-*)`.
2. **Nombre accesible** en cada raíz (`BarChart`, `LineChart`, `AreaChart`, `ComposedChart`,
   `PieChart`, `ScatterChart`…): `aria-label` / `aria-labelledby` / `title` en la propia raíz, un
   ancestro con `role` + `aria-label` (el `ChartContainer role="img"`), o `ChartSection` /
   `ChartFrame` **importados**. Un `<div aria-label>` sin rol no cuenta.
3. **Movimiento:** `useChartMotion()` esparcido en cada serie.
4. **Densos:** todo `ScatterChart` dentro de `<DenseChart>`, y los archivos de la lista `DENSAS` del
   test (rankings, small multiples, apiladas) siguen usándolo.

Las reglas se eligieron con el criterio de `scripts/migration-sql-checks.mjs`: entran sólo las
objetivas y sin falsos positivos (el detector se prueba con muestras sintéticas en el mismo archivo).
La deuda previa vive en listas `*_CONGELADO` con su razón: pueden conservarla, no sumar, y ningún
archivo nuevo entra; el test avisa de las entradas ya limpias. Hoy hay una sola, los dos selectores
`[stroke='#ccc']` de `components/ui/chart.tsx`, que apuntan al atributo por defecto de recharts para
sobrescribirlo. Si una regla te bloquea, arregla el gráfico; ampliar una lista es la última salida.

### Exportar a Excel («Ver datos»)

La tabla de «Ver datos» se descarga como **`.xlsx`** (regla de exportación de `AGENTS.md`: nunca CSV)
con el botón de siempre, `ExportButton`, sin un mecanismo de descarga propio.

- **Opt-in y con el permiso de exportar del módulo.** `data={{ …, excel: { permission } }}` en
  `ChartSection` (o `excel` en `ChartDataTable`). Quien ve una cifra no recibe por eso la descarga: cada
  módulo separa `*:export` de `*:view`. Quien dibuja el gráfico pasa `excel` sólo si
  `can(session, permission)`; sin `excel` no hay botón. Los permisos válidos son los de exportación
  general (`CHART_EXPORT_PERMISSIONS` en `lib/reports/chart-data-export.ts`: `combustibles:export`,
  `analytics:export`, `billing:export`, `mant:export`, `ti:export`, los `prevention:*:export`…), no
  `combustibles:export_sensitive` ni los de datos personales.
- **Lo que va a Excel es lo que se lee.** Las celdas son `ReactNode`: un enlace exporta su texto, un
  número conserva su tipo y el texto sale con su formato de pantalla (`chartCellValue`,
  `components/charts/chart-cell-text.ts`). Una celda cuyo texto lo produce un componente por dentro
  (no está en sus `children`) sale vacía: entrega el texto como `children`.
- **El servidor no recalcula nada.** `exportChartDataAction` (`app/(app)/chart-data-export-action.ts`)
  recibe la tabla del navegador, exige `requirePermission(permission)`, valida forma y tamaño
  (`chartDataExportSchema`: ≤ 2000 filas, ≤ 40 columnas) y arma el libro con el constructor común
  (`buildXlsxBuffer`: encabezado en negrita, fila congelada, filtros, textos que empiezan como fórmula
  neutralizados). Queda en la bitácora (`export`, `chart_data_export`).
- **El libro dice que es una copia de la pantalla.** La hoja «Metadatos» (quién, cuándo, alcance de
  faena) lleva una nota «Copia de la tabla «Ver datos»…, tal como se mostraba en pantalla», porque el
  contenido lo trajo el navegador y el servidor no lo certifica. Las salvedades del gráfico (el aviso de
  cobertura) viajan ahí con `excel.notes`: la hoja de datos se lee sin la pantalla que traía el aviso.
- **Nombre del archivo:** el título del gráfico más el día (`todayInChile`), `litros_por_mes_2026-11-03.xlsx`
  (`chartExportFilename`).

### Aviso de cobertura de datos

Antes de creer un gráfico de combustible hay que saber si el mes está completo (CHART-022). El mapa fuente
× mes de «Fuentes de datos» lo dice; `CoverageNotice` (`components/charts/coverage-notice.tsx`) lo dice
**donde se lee el número**, en una línea sobre el gráfico.

- **Una sola representación (A5).** Es el único lugar de una pantalla que dice «sin datos del proveedor»:
  no se repite en el subtítulo del gráfico, en el detalle de un tile ni en una nota al pie. El gráfico
  *marca* el hueco (columna tenue, línea cortada, «—»); el aviso lo *nombra*. Un mes sin datos es un
  hueco, **nunca un cero**: «el proveedor no informó» no es «no se cargó combustible».
- **Una sola redacción** (`coverageNoticeText`, `lib/combustibles/coverage-notice.ts`), la misma de la
  pantalla y de la hoja «Metadatos» de la exportación (`fleetProviderGapNotice` la reutiliza). «Sin datos
  del proveedor en sep-2026: las cifras de combustible de los últimos 6 meses no incluyen ese mes. El mes
  de nov-2026 todavía no está completo.» Un mes que es hueco y parcial a la vez se dice una vez, como
  hueco.
- **`subject` es obligatorio y dice qué cifras quedan cortas**, en plural y con la fuente a la vista
  («los totales de 12 meses», «las cargas de tarjeta Copec usadas en esta comparación»). La frase tiene
  que ser cierta de lo que *esa* pantalla muestra: un gráfico que mezcla terreno y tarjeta no puede decir
  «los litros no incluyen ese mes», sólo los de tarjeta.
- **De dónde salen los meses.** Hueco: `monthsWithoutProviderData` (sin transacciones aceptadas ni
  cobertura que cierre el mes), la misma vara de Analítica, el tablero, Flota y el rendimiento por mes.
  Parcial: el mes en curso (`isPartialMonth`). `getFuelProviderCoverageGaps`
  (`lib/combustibles/coverage-notice-data.ts`) lo calcula para una ventana de meses con el alcance de
  faena de la sesión; el tablero lo toma de `getFuelMonthlyTrend` (`providerGap`, `partial`).
- **Sin meses, no hay aviso** (la ausencia es la buena noticia). El enlace «Ver cobertura de las
  fuentes» sólo se ofrece a quien puede abrir «Fuentes de datos» (`fuelSourcesHref(session)`); a quien
  no, el aviso queda sin enlace en vez de apuntar a `/forbidden`.
- **Dónde va:** una vez por pantalla o por sección, sobre las cifras que advierte (`/flota`,
  `DomainSection coverage` del tablero, `/combustibles/consumo/litros`, la comparación de motor en vacío,
  la ficha del equipo). Los textos del aviso usan tokens `-ink` (regla 8) y el ícono es decorativo.

## Accesibilidad

- Skip link "Saltar al contenido" (sr-only hasta foco).
- `aria-current="page"` en el ítem activo; `aria-label` con conteo en badges.
- `role="alert"` en errores de formulario; `aria-invalid` en campos; `aria-busy`
  en botones loading; `aria-sort` en cabeceras ordenables.
- Foco: `:focus-visible` con outline 2px `--color-primary`, offset 2px, aplicado
  de forma consistente.
- Contraste: texto sobre bg ~15:1; tokens `subtle`/`faint` calibrados a WCAG AA
  ≥ 4.5:1. Targets táctiles de 44×44px en mobile.

---

## Estados de UI

Cada pantalla contempla:

| Estado | Componente |
|---|---|
| Carga inicial | `loading.tsx` por ruta |
| Carga parcial | `<Skeleton>` / `loading` en DataTable |
| Vacío | `<EmptyState>` (significado + CTA) |
| Error | `<ErrorState>` (causa + reintentar) |
| Sin permisos | `<EmptyState>` descriptivo / `/forbidden` |
| Éxito | Toast (Sonner) |
| Loading button | `loading` en `<Button>` |

---

## Reglas de densidad de pantalla (A1–A6)

Cada pantalla pasa el **test de los 5 segundos**: qué es, en qué estado está el
trabajo, qué acción se espera. Resumen (detalle en [AGENTS.md](AGENTS.md)):

- **A1** — Máx. 4 tiles de KPI accionables sobre el contenido; secundarios en una
  tira compacta (`MetricBar`), no en tarjetas.
- **A2** — 4–6 filtros primarios + "Más filtros (N)" en Collapsible/Sheet con
  contador; chips removibles de filtros activos.
- **A3** — La página **es la lista**; crear/registrar se dispara desde
  `PageHeader.actions` (Dialog/Sheet), no un formulario permanente.
- **A4** — Empty states en lenguaje de usuario + CTA real.
- **A5** — Una dimensión = una representación (no pestañas *y* select *y* tile del
  mismo estado). Corolario: una cifra no puede ser tile **y** alerta a la vez.
- **A5b** — Un gráfico = una unidad por eje. Dos magnitudes de escala distinta
  (litros y cargas, conteos y dinero) exigen eje doble o dos tarjetas. Si
  consultas un campo, dibújalo o no lo consultes.
- **A6** — Controles y vocabulario consistentes: `DatePicker` del sistema (no
  `<input type="date">`), enums mapeados a label + `Badge`, siglas con tooltip.

---

## Guía para contribuir

1. **Tokens, no hardcodes**: siempre `var(--color-*)` o clases del tema.
2. **Respetar los acentos**: naranja signal solo para pendientes; verde para
   acciones; amber para realces.
3. **Tipografía**: Exo para títulos (`text-h1/2/3`, `text-display`), Myriad para
   UI/body, mono para datos (excepción: las cifras de KPI del tablero van en
   Myriad `tabular-nums`).
4. **Transiciones de color, no de escala** — excepción ya existente: `Button`
   usa `active:scale-[0.98]` (`motion-safe`). No repetir el patrón en
   componentes nuevos sin justificarlo.
5. **Estados completos**: loading, empty y error en toda pantalla.
6. **Accesibilidad primero**: labels, aria, focus rings, reduced motion.
7. **Layout del shell**: usar `PageHeader` (sin `<h1>` propio) y `PageContainer`
   (sin wrappers de padding extra). Ver [STYLING.md](STYLING.md) y [AGENTS.md](AGENTS.md).
8. **Mobile**: proveer `renderMobileCard` en tablas con `DataTable`.
