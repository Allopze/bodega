# Revisión UI/UX — Evaluaciones SST

> Revisión de la UI/UX del módulo **Evaluaciones SST** (`app/(app)/prevencion/`) a nivel de código, contra el sistema de diseño real del proyecto (tokens OKLCH de `app/globals.css`, primitivas de `components/ui/`, convención de toast de `lib/toast`, íconos Phosphor) y contra criterios de diseño (consistencia de tokens, reuso de primitivas, formato de datos, accesibilidad y craft de interacción).
>
> **Fecha:** 2026-06-18 · **Alcance:** solo documentación de hallazgos (no se modificó código del módulo).

## Resumen

El módulo **funciona y tiene varios aciertos**. Los hallazgos son de **consistencia con el design system, reuso de primitivas, formato de datos y accesibilidad de teclado**, no de funcionalidad rota grave.

**Aciertos a conservar:**

- Autoguardado con feedback de estado (guardando / guardado / error).
- `aria-pressed` en todos los toggles; `role="group"` con `aria-label` en los grupos.
- Foco programático al primer campo inválido en el formulario de creación.
- Fade de scroll a la derecha que insinúa más tabs en viewports angostos.
- Uso correcto de `<Field>`, `<EmptyState>` y `<Badge>` en la lista y el formulario.

**Conteo:** 15 hallazgos — 3 bugs visibles (A), 4 de tokens (B), 4 de reuso (C), 5 de UX (D), 3 de accesibilidad (E).

**Archivos revisados:** `page.tsx` · `evaluation-list.tsx` · `nueva/page.tsx` · `nueva-evaluacion-form.tsx` · `[id]/page.tsx` · `[id]/evaluation-detail.tsx` · `[id]/checklist-section.tsx` · `[id]/followups-panel.tsx` · `[id]/action-plan-panel.tsx` · `lib/sst/badges.ts` · `lib/sst/date.ts`. Referencia: `app/globals.css`, `components/ui/{badge,card,table,field}.tsx`.

---

## A. Bugs / defectos visibles

### A1 — Clases de color inexistentes en la lista

`app/(app)/prevencion/evaluation-list.tsx:66,68,71,74,77,92`

`text-foreground` y `text-muted-foreground` **no están definidos** en `@theme` (verificado: no existe `--color-foreground` ni `--color-muted-foreground` en todo el repo; solo este archivo los usa). En Tailwind v4 no generan regla de color, así que el texto hereda el color del padre (`--color-text`, casi negro). Resultado: las celdas "atenuadas" (tipo, fecha, faena, "—") se ven **casi negras en vez de gris**, perdiendo la jerarquía visual buscada.

**Fix:** usar el vocabulario real del sistema → `text-text-muted` / `text-text-subtle` y `text-(--color-text)` para el nombre. Es el mismo cambio que ya usa el resto del módulo.

### A2 — El Acta de Cierre muestra el enum crudo del motivo

`app/(app)/prevencion/[id]/evaluation-detail.tsx:436`

Renderiza `{evaluation.motivo}` literal (ej. `post_incidente_persona`) en vez de la etiqueta legible. Las etiquetas existen en `MOTIVO_OPTIONS` (`nueva-evaluacion-form.tsx:41`) pero no se reusan.

**Fix:** mover `MOTIVO_OPTIONS` / un `MOTIVO_LABELS` a un módulo compartido (p. ej. `lib/sst/badges.ts` o `lib/sst/labels.ts`) y mapear en ambos lados. El acta mostraría "Post incidente — persona".

### A3 — Fechas en ISO crudo, no localizadas

`evaluation-list.tsx:75` · `evaluation-detail.tsx:218` · `followups-panel.tsx:91`

Se muestra `YYYY-MM-DD` directo. Ya existe `formatDateDisplay()` en `lib/sst/date.ts:56` que devuelve `dd/mm/aaaa` (y parsea como fecha local, evitando el desfase UTC documentado ahí).

**Fix:** envolver con `formatDateDisplay(...)`. Mantener `tabular-nums` donde ya está.

---

## B. Violaciones de tokens / design system

### B1 — Colores Tailwind hardcodeados en vez de tokens semánticos

`lib/sst/badges.ts:17-64` · `evaluation-detail.tsx:224-261,443-448` · `action-plan-panel.tsx:144-149`

Se usan paletas crudas `emerald/rose/amber/blue/slate-100/700/800` para resultado, estado y estado de plan, ignorando los tokens OKLCH del sistema (`--color-success/-warning/-danger/-info` con `-tint/-line/-ink`) y la primitiva `<Badge>`. **Caso crítico:** la etiqueta "Seguimiento" usa `bg-purple-100 text-purple-700` (`evaluation-detail.tsx:233`) — el morado **no está en la paleta Chome** y rompe la coherencia cromática del producto.

**Fix:** mapear a `<Badge variant=...>`:

- `habilitado_autonomo` → `success` · `habilitado_restricciones` → `warning` · `no_habilitado` → `danger` · `requiere_reforzamiento` → `info`
- estado `cerrado` → `default`/`outline` (neutro) · plan `cerrado` → `success`, `en_proceso` → `warning`, `pendiente` → `default`
- "Seguimiento" → `signal` (o `info`/`accent`), nunca morado.

Refactorizar `badges.ts` para devolver un `variant` de `<Badge>` en vez de strings de clases crudas.

### B2 — Botones-toggle con colores crudos

`checklist-section.tsx:38-48` · `followups-panel.tsx:134-142`

`StatusButton` y el toggle "¿Cumple?" usan `emerald-500` / `rose-500` / `slate-500` literales. (Nota: los chips de cargo en `nueva-evaluacion-form.tsx:297-302` **sí** usan tokens `--color-primary` correctamente — son la plantilla a seguir.)

**Fix:** positivo → token success, negativo → token danger, neutro → surface/border. Idealmente extraer un único componente `SegmentedToggle` reutilizado por checklist, "¿cumple?" y chips de cargo.

### B3 — Callout de advertencia con ámbar crudo

`evaluation-detail.tsx:312-316`

`bg-amber-50 border-amber-200 text-amber-700 text-amber-600` en el aviso de cierre inmutable.

**Fix:** tokens `--color-warning-tint` / `-line` / `-ink` (el ícono `Warning` de Phosphor ya está).

### B4 — Carácter `✓` literal en estado de autoguardado

`evaluation-detail.tsx:279`

`Guardado ✓ {ts}` usa un glifo suelto en vez de un ícono del set.

**Fix:** ícono Phosphor `<Check size={12} />` (o `CheckCircle`), alineado con el `<CheckCircle>` que ya usa followups.

---

## C. Reuso de componentes / consistencia (DRY)

### C1 — Pills reimplementadas a mano en el detalle

`evaluation-detail.tsx:224-236,256-261,443-448`

`<span className="text-xs ... rounded-full border">` en vez de `<Badge>`, que la lista sí usa. Padding/tamaños divergen (`px-2 py-0.5` vs `px-3 py-1`).

**Fix:** reemplazar por `<Badge>` con las variantes de B1.

### C2 — Superficie de tarjeta repetida 6× a mano

`evaluation-detail.tsx:206,416,430,501,514` (+ ítems en `checklist-section.tsx:254`)

`<div className="rounded-(--radius-xl) border border-(--color-border) bg-(--color-surface) p-5">` repetido. Además `rounded-(--radius-xl)` es **no-op** (todos los radios = 0 salvo `--radius-full`), señal de que se asumió esquinas redondeadas.

**Fix:** usar `<Card>/<CardHeader>/<CardContent>` o un wrapper local `Section`. Quitar las clases `rounded-*` no-op. Además los ítems del checklist son **tarjetas anidadas dentro de la tarjeta del tab** — preferir separadores (`divide-y`/`border-t`) para los ítems en vez de caja-dentro-de-caja.

### C3 — Tabla del plan de acción hecha a mano

`action-plan-panel.tsx:121-168`

`<table>` crudo con `<th>/<td>` propios en vez de las primitivas `TableRoot/Table/TableHead/TableCell` que usa la lista.

**Fix:** reusar primitivas de `components/ui/table.tsx` (admite filas editables); unifica los estilos de tabla del módulo.

### C4 — Diálogo de cierre con labels a mano

`evaluation-detail.tsx:337-371`

`<label>` + `<Textarea>` manual en vez de `<Field>`, que el formulario de creación usa correctamente y cablea `aria-*` solo.

**Fix:** envolver Restricciones/Observaciones en `<Field label helper>`.

---

## D. UX / interacción

### D1 — Sin `loading.tsx` en prevención

Falta en `app/(app)/prevencion/` y `app/(app)/prevencion/[id]/`

10 áreas (compras, aprobaciones, entregas, bodega, recepción, solicitudes…) tienen skeleton de carga; prevención no → navegación con pantalla en blanco mientras el server component consulta.

**Fix:** agregar `loading.tsx` con skeleton (reusar `components/ui/skeleton.tsx`) para la lista y el detalle.

### D2 — % de cumplimiento sin `tabular-nums`

`evaluation-detail.tsx:245-247`

El número grande se recalcula en vivo durante el autoguardado → la cifra "salta" de ancho.

**Fix:** `tabular-nums` (o `font-mono`) en el `<p className="text-2xl ...">`.

### D3 — Acción irreversible con peso visual débil

`evaluation-detail.tsx:302-305,377`

"Cerrar evaluación" deja el registro inmutable por ley (DS N°44/2024) pero es un botón `secondary` discreto, y el confirmar interno es `primary`. El borrado de ítems sí usa `variant="destructive"`.

**Fix:** dar más peso al cierre (p. ej. confirmar con `signal` / tratamiento de acción crítica) y mantener coherencia con cómo se tratan otras acciones irreversibles.

### D4 — Empty states inline pobres

`followups-panel.tsx:184-189` · `action-plan-panel.tsx:117-119`

Texto gris en itálica vs el `<EmptyState>` pulido que usa la lista.

**Fix:** usar `<EmptyState compact>` para coherencia (ícono + título + descripción).

### D5 — "Borrador" en azul; el sistema reserva naranja para pendientes

`lib/sst/badges.ts:35-38`

El comentario rector de `globals.css` dice "Signal orange reserved for pending states". Un borrador es conceptualmente un estado pendiente.

**Fix (criterio):** considerar `signal` para "Borrador" y neutro/`success` para "Cerrado". Confirmar con diseño antes de cambiar el significado del color.

---

## E. Accesibilidad

### E1 — Toggles a mano sin foco visible de teclado

`checklist-section.tsx:50-59,204-219` · `followups-panel.tsx:128-146` · `nueva-evaluacion-form.tsx:291-306`

Los `<button>` propios usan `transition-colors`/`hover:` pero no tienen `:focus-visible` ring; el usuario de teclado no ve dónde está el foco (las primitivas del sistema sí lo tienen).

**Fix:** añadir `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary) focus-visible:ring-offset-2` (o la utilidad equivalente del sistema).

### E2 — Estado seleccionado solo por color

Checklist y "¿cumple?"

`aria-pressed` cubre lector de pantalla (bien), pero el único diferenciador visual del activo es el relleno emerald/rose — débil para daltónicos.

**Fix:** añadir afordancia no-cromática al activo (peso, borde más marcado o ícono check).

### E3 (menor) — Sin feedback táctil de pulsación

Toggles custom

`:active { transform: scale(0.97) }` da sensación de respuesta física. Pulido opcional.

---

## Apéndice: archivos a tocar si se aprueban los fixes

- `lib/sst/badges.ts` — devolver variantes de `<Badge>` en vez de clases crudas; mover `MOTIVO_LABELS`.
- `app/(app)/prevencion/evaluation-list.tsx` — tokens de texto, `formatDateDisplay`.
- `app/(app)/prevencion/[id]/evaluation-detail.tsx` — `<Badge>`, `<Card>`, tokens warning, fecha, `tabular-nums`, `Check`, motivo legible, `<Field>` en diálogo.
- `app/(app)/prevencion/[id]/checklist-section.tsx` — tokens en toggles, foco visible, (opc.) separadores en vez de tarjetas anidadas.
- `app/(app)/prevencion/[id]/followups-panel.tsx` — tokens, fecha, foco visible, `<EmptyState>`.
- `app/(app)/prevencion/[id]/action-plan-panel.tsx` — primitivas Table, `<Badge>`, `<EmptyState>`.
- `app/(app)/prevencion/loading.tsx` y `app/(app)/prevencion/[id]/loading.tsx` — **nuevos** skeletons.
- Reuso: `components/ui/{badge,card,table,field,empty-state,skeleton}.tsx`, `lib/sst/date.ts:formatDateDisplay`, `lib/utils:cn`, tokens de `app/globals.css`.
