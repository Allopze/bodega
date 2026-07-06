# Login Left Panel Redesign — B1 Ultra Minimal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el panel hero izquierdo del login por un diseño ultra-minimal (dirección B1): degradado radial verde, logo gigante tenue como marca de agua, textura de puntos, y solo el wordmark arriba + eyebrow abajo.

**Architecture:** Un solo archivo a modificar — `app/(auth)/login/page.tsx`. Se reescribe el bloque `<aside>` (líneas 20–89). Se mantienen íntegros el `<div>` del formulario derecho y todos los demás componentes. No se crean archivos nuevos ni se modifican tokens de diseño.

**Tech Stack:** Next.js 16 App Router · `next/image` · Tailwind CSS v4 · OKLCH design tokens (globals.css)

---

## File Map

| Archivo | Acción |
|---|---|
| `app/(auth)/login/page.tsx` | **Modificar** — reescribir el `<aside>` (líneas 20–89) |

---

### Task 1: Reemplazar el `<aside>` del login con el diseño B1

**Files:**
- Modify: `app/(auth)/login/page.tsx:18-89`

El nuevo `<aside>` tiene cuatro capas apiladas con `position:absolute`:

1. **Fondo** — degradado radial inline (como ya se hacía con `style`).
2. **Textura de puntos** — `div aria-hidden` con `background-image` de puntos.
3. **Marca de agua** — `Image` gigante (`chome_logo_white.svg`, 420×420) a baja opacidad, anclada abajo-derecha.
4. **Contenido** (`z-10`) — wordmark arriba, eyebrow abajo. Igual que hoy pero sin el ledger, titular, regla vertical ni footer.

- [ ] **Step 1: Abrir el archivo y localizar el bloque `<aside>`**

```
app/(auth)/login/page.tsx  líneas 20–89
```

Confirma visualmente que empieza en `<aside` y termina justo antes de `{/* ── Login form (right) */}`.

- [ ] **Step 2: Reemplazar el bloque `<aside>` completo**

Sustituir **todo el `<aside>…</aside>`** (líneas 20–89) por:

```tsx
{/* ── Brand hero — B1 Ultra Minimal ── */}
<aside
  className="hidden lg:flex lg:flex-col justify-between relative overflow-hidden"
  style={{
    background:
      "radial-gradient(120% 90% at 80% 8%, oklch(0.31 0.13 154) 0%, oklch(0.18 0.08 154) 70%)",
  }}
>
  {/* Capa 1 — textura de puntos */}
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 z-0"
    style={{
      backgroundImage:
        "radial-gradient(rgba(255,255,255,.10) 1px, transparent 1px)",
      backgroundSize: "16px 16px",
      opacity: 0.5,
    }}
  />

  {/* Capa 2 — marca de agua: logo gigante tenue */}
  <Image
    src="/chome_logo_white.svg"
    alt=""
    aria-hidden
    width={420}
    height={420}
    unoptimized
    style={{ width: 420, height: 420 }}
    className="pointer-events-none absolute -right-16 -bottom-20 opacity-[0.055] z-0 select-none"
  />

  {/* Zona superior — wordmark */}
  <div className="relative z-10 px-12 pt-12">
    <div className="flex items-center gap-3">
      <Image
        src="/chome_logo_white.svg"
        alt="Chome"
        width={36}
        height={36}
        unoptimized
        style={{ width: 36, height: 36 }}
        className="shrink-0"
      />
      <div>
        <p className="font-sans font-semibold text-base leading-tight tracking-tight text-white">
          Chome
        </p>
        <p className="text-[10px] font-mono uppercase tracking-wider text-white/45 leading-tight mt-0.5">
          Plataforma Chome
        </p>
      </div>
    </div>
  </div>

  {/* Zona inferior — solo eyebrow */}
  <div className="relative z-10 px-12 pb-12">
    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
      Plataforma Chome
    </p>
  </div>
</aside>
```

**Elementos eliminados respecto al original:**
- Líneas de horizonte 33%/66% (`div aria-hidden` con dos `div border-t`)
- Regla vertical (`div h-10 w-px bg-white/30`)
- Eyebrow "Sistema interno"
- Titular "Control total del abastecimiento."
- `<dl>` con el ledger 01/02/03
- Footer "Uso exclusivo del personal autorizado"

- [ ] **Step 3: Verificar que los imports existentes siguen siendo suficientes**

Al inicio del archivo hay:
```tsx
import Image from "next/image"
import { Suspense } from "react"
import { BrandMark } from "@/components/layout/brand-mark"
import { getUserCount } from "@/lib/auth/bootstrap"
import { LoginForm } from "./login-form"
```

El nuevo `<aside>` usa `Image` (ya importado). No se requieren nuevos imports. `BrandMark` sigue siendo usado en el panel derecho (móvil), así que **no eliminarlo**.

- [ ] **Step 4: Arrancar el servidor de desarrollo y abrir `/login`**

```bash
npm run dev
```

Abrir `http://localhost:3000/login` en el navegador a **≥ 1024px de ancho**.

Confirmar visualmente:
- ✅ Degradado radial verde (más oscuro en el centro-izquierda, más vivo arriba-derecha)
- ✅ Textura de puntos tenue sobre el fondo
- ✅ Logo gigante semitransparente visible abajo-derecha (apenas perceptible, ~5% opacidad)
- ✅ Logo 36×36 + "Chome" + "Plataforma Chome" en la esquina superior izquierda
- ✅ Solo el eyebrow "SOLICITUDES Y BODEGA" en la zona inferior
- ❌ Ausencia del ledger numerado (01/02/03)
- ❌ Ausencia del titular "Control total del abastecimiento."
- ❌ Ausencia de la regla vertical blanca

Verificar también en **< 1024px**: el `<aside>` debe estar oculto (`hidden`) y la card del formulario se ve igual que antes.

- [ ] **Step 5: Commit**

```bash
git add app/(auth)/login/page.tsx
git commit -m "redesign: login left panel — B1 ultra minimal (marca de agua + textura)"
```

---

## Notas de troubleshooting

**La marca de agua no se ve:**
- Confirma que `opacity-[0.055]` está aplicado. Si Tailwind no reconoce el valor arbitrario, usa `style={{ opacity: 0.055 }}` en su lugar.
- Verifica que la imagen no está siendo recortada antes de aparecer: el `overflow-hidden` del `<aside>` debe cortar el exceso, no ocultarla entera. El ancla `-right-16 -bottom-20` desplaza la imagen *afuera* del borde, que es el efecto deseado.

**El degradado radial se ve igual que el lineal anterior:**
- Asegúrate de que el `style` inline reemplazó completamente el antiguo. El degradado antiguo era `linear-gradient(145deg, ...)`.

**TypeScript se queja de `aria-hidden` en `<div>`:**
- Es atributo HTML estándar; debería compilar sin problemas. Si aparece error, usa `aria-hidden={true}`.
