# Styling — Chome Solicitudes y Bodega

Stack: **Next.js 15 + Tailwind CSS v4** (`@import "tailwindcss"` en `app/globals.css`).

---

## Tokens de diseño

Todos los tokens viven en `app/globals.css` dentro del bloque `@theme`:

| Grupo | Prefijo | Ejemplos |
| --- | --- | --- |
| Colores | `--color-*` | `--color-primary`, `--color-bg`, `--color-surface`, `--color-text-muted` |
| Tipografía | `--font-*`, `--text-*`, `--leading-*` | `--font-display` (Exo), `--font-sans` (Myriad Pro) |
| Radios | `--radius-*` | `--radius` 10px · `--radius-lg` 16px · `--radius-2xl` 24px |
| Sombras | `--shadow-*` | `--shadow-card` (panel flotante), `--shadow-md`, `--shadow-lg` |
| Motion | `--duration-*`, `--ease-*` | `--duration-fast` 120ms · `--ease-drawer` |

**Sintaxis Tailwind v4:** usa la forma canónica `bg-surface-2`, `text-(--color-text-muted)`, `rounded-(--radius)` — no `var()` explícito en las clases.

---

## Layout del shell autenticado

```
[canvas gris bg-bg  p-3 en desktop]
┌─ sidebar ─┐ ┌─────────────── panel main ───────────────────┐
│  w-60      │ │ TopBar  h-[3.25rem]                           │
│ (colaps.   │ │   chip de faena (desktop) · bell · avatar     │
│ → 4.75rem) │ ├───────────────────────────────────────────────┤
│            │ │ <main overflow-y-auto bg-bg>                   │
│            │ │   <PageContainer>   ← controla ancho/padding  │
│            │ │     <PageHeader />                             │
│            │ │     {contenido}                                │
│            │ │   </PageContainer>                             │
└────────────┘ └───────────────────────────────────────────────┘
```

**Archivos clave:**
- Shell: `components/layout/app-shell.tsx`
- TopBar: `components/layout/top-bar.tsx`
- Sidebar: `components/layout/sidebar.tsx`

---

## PageContainer — el único punto de ancho/padding

`components/ui/page-container.tsx` — **usa siempre este componente** en lugar de poner clases de `max-w-*` o `px-*` directamente en las páginas.

```tsx
import { PageContainer } from "@/components/ui/page-container"

// Tablas, dashboards, listas (default):
<PageContainer>{children}</PageContainer>

// Formularios y vistas de detalle:
<PageContainer width="form">{children}</PageContainer>

// Sin límite de ancho (casos excepcionales):
<PageContainer width="full">{children}</PageContainer>
```

| Variant | Tope | Uso |
| --- | --- | --- |
| `wide` (default) | `max-w-440` / 1760px | Páginas de lista, dashboard, tablas |
| `form` | `max-w-4xl` / 896px | Formularios y páginas de detalle |
| `full` | sin tope | Casos excepcionales con scroll horizontal propio |

Padding base: `px-4 md:px-8 py-4 md:py-6`.

---

## Utilidades tipográficas

Definidas en `app/globals.css` como `@utility`:

| Clase | Uso |
| --- | --- |
| `text-display` | Exo 700, 28px — login/hero |
| `text-h1` | Exo 700, 22px — títulos de página (`PageHeader`) |
| `text-h2` | Exo 600, 17px — sección dentro de página |
| `text-h3` | Exo 600, 15px — sub-sección |
| `text-eyebrow` | Sans 600, 11px uppercase — etiqueta sobre título |
| `text-sub` | Sans 13px muted — descripción bajo título |

---

## Patrones de ritmo vertical

- **Entre secciones en una página:** `space-y-6`
- **PageHeader:** `pb-4 mb-5` (ya incluido en el componente)
- **Evitar** `space-y-5` sueltos (unificado a 6)

---

## Cómo agregar una nueva página

1. Crea el archivo bajo `app/(app)/tu-modulo/page.tsx`.
2. Envuelve el return en `<PageContainer>` (wide o form según tipo).
3. Usa `<PageHeader title="..." />` como primer hijo del container.
4. Sigue el ritmo `space-y-6` entre secciones.

```tsx
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"

export default async function MiPagina() {
  return (
    <PageContainer>
      <PageHeader title="Mi página" description="..." />
      {/* contenido */}
    </PageContainer>
  )
}
```
