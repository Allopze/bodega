# Styling — Plataforma Chome

Stack: **Next.js 16 + Tailwind CSS v4** (`@import "tailwindcss"` en
`app/globals.css`). Referencia visual completa: [DESIGN.md](DESIGN.md).

---

## Tokens de diseño

Todos los tokens viven en `app/globals.css` dentro del bloque `@theme`:

| Grupo | Prefijo | Ejemplos |
| --- | --- | --- |
| Colores | `--color-*` | `--color-primary` (verde #005c3f), `--color-signal` (naranja #e78400), `--color-accent` (amber #ffd53f), `--color-chrome`, `--color-surface`, `--color-text-muted` |
| Tipografía | `--font-*`, `--text-*`, `--leading-*` | `--font-display` (Exo), `--font-sans` (Myriad Pro), `--font-mono` (Geist Mono) |
| Radios | `--radius-*` | `--radius-sm` 6px · `--radius` 8px · `--radius-md` 10px · `--radius-lg` 12px · `--radius-xl` 16px · `--radius-2xl` 20px |
| Sombras | `--shadow-*` | `--shadow-card`, `--shadow-md`, `--shadow-lg`, `--shadow-well` (pozo principal) |
| Motion | `--duration-*`, `--ease-*` | `--duration-fast` 140ms · `--ease-drawer` |

**Sintaxis Tailwind v4:** usa la forma canónica `bg-surface-2`,
`text-(--color-text-muted)`, `rounded-(--radius)` — no `var()` explícito en las
clases. Siempre claro: `color-scheme: light`, sin dark mode.

---

## Layout del shell autenticado

El shell es un **chrome tintado edge-to-edge** (`bg-(--color-chrome)`) con un
**pozo blanco** de contenido. El sidebar va al ras (parte izquierda de la "L"); el
`<main>` es el pozo (`bg-(--color-surface)`, esquina sup-izq redondeada en
desktop) y es el scroll container.

```
[chrome gris  bg-(--color-chrome)  h-[100dvh]]
┌─ DesktopNav ─┐ ┌──────────── main = pozo blanco ────────────────┐
│  rail +      │ │ bg-(--color-surface) · lg:rounded-tl-[36px]      │
│  panel       │ │ overflow-y-auto                                  │
│  (al ras)    │ │  ┌────────────────────────────────────────────┐ │
│              │ │  │ TopBar  sticky top-0  h-[3.5rem]            │ │
│              │ │  ├────────────────────────────────────────────┤ │
│              │ │  │ <PageContainer>  ← controla ancho/padding   │ │
│              │ │  │   <PageHeader />                            │ │
│              │ │  │   {contenido}                              │ │
│              │ │  └────────────────────────────────────────────┘ │
└──────────────┘ └────────────────────────────────────────────────┘
```

**Archivos clave:**
- Shell: `components/layout/app-shell.tsx`
- Navegación desktop: `components/layout/desktop-nav.tsx` (+ `desktop-nav-areas.tsx`)
- Navegación mobile: `components/layout/mobile-nav.tsx`
- TopBar: `components/layout/top-bar.tsx`
- Command palette (⌘K): `components/layout/command-palette.tsx`
- Áreas / árbol de nav: `components/layout/areas.ts` + `nav-items.ts`

---

## PageContainer — el único punto de ancho/padding

`components/ui/page-container.tsx` — **usa siempre este componente** en lugar de
poner `max-w-*` o `px-*` directamente en las páginas.

```tsx
import { PageContainer } from "@/components/ui/page-container"

<PageContainer>{children}</PageContainer>                 // wide (default)
<PageContainer width="form">{children}</PageContainer>     // formularios angostos
<PageContainer width="workbench">{children}</PageContainer> // detalle con panel lateral
<PageContainer width="full">{children}</PageContainer>     // scroll horizontal propio
```

| Variant | Tope | Uso |
| --- | --- | --- |
| `wide` (default) | `max-w-440` / 1760px | Listas, dashboards, tablas |
| `form` | `max-w-4xl` / 896px | Formularios compactos, lectura angosta |
| `workbench` | `max-w-352` / 1408px | Vistas de detalle con resumen lateral |
| `full` | sin tope | Tablas que necesitan scroll horizontal propio |

Padding base: `px-4 md:px-8 py-2 md:py-3`.

---

## Utilidades tipográficas

Definidas en `app/globals.css` como `@utility`:

| Clase | Uso |
| --- | --- |
| `text-display` | Exo 700, 28px — login/hero |
| `text-h1` | Exo 700, 22px — títulos de página (`PageHeader`) |
| `text-h2` | Exo 600, 17px — sección dentro de página |
| `text-h3` | Exo 600, 15px — sub-sección |
| `text-eyebrow` | Myriad 600, 11px uppercase — etiqueta sobre título |
| `text-sub` | Myriad 13px muted — descripción bajo título |

Datos numéricos siempre en `font-mono tabular-nums`. El cuerpo usa Myriad Pro con
`font-feature-settings: "ss01", "cv11"`.

---

## Reglas de página (obligatorias)

Toda página autenticada vive bajo `app/(app)/` y la envuelve el AppShell. Reglas
completas en [AGENTS.md](AGENTS.md); lo esencial:

1. **NO** agregar un `<input>` de búsqueda propio: el TopBar ya provee una
   búsqueda global (`searchQuery` vía `useSafeShellHeader`). Excepción:
   `ROUTES_WITH_OWN_SEARCH` en `top-bar.tsx` (búsqueda server-side).
2. **Siempre** usar `<PageHeader>` para el título — nunca un `<h1>` propio (causa
   doble título; el header es `lg:sr-only` y empuja título/acciones al TopBar).
3. **Siempre** envolver el contenido en `<PageContainer>` con el `width` correcto.
4. **No** añadir wrappers de padding extra alrededor de `PageContainer`.
5. Botones de acción de página (crear, importar, exportar) van en
   `PageHeader.actions`, no en toolbars inline.

---

## Cómo agregar una nueva página

1. Crea `app/(app)/tu-modulo/page.tsx`.
2. Envuelve el return en `<PageContainer>` (wide/form/workbench según tipo).
3. Usa `<PageHeader title="..." />` como primer hijo del container.
4. Espaciado entre secciones con `space-y-*` / `gap-*` **dentro** del container.

```tsx
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"

export default async function MiPagina() {
  return (
    <PageContainer>
      <PageHeader title="Mi página" description="..." />
      {/* contenido — sin wrappers con padding */}
    </PageContainer>
  )
}
```
