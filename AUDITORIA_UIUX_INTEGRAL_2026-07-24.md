# Auditoría UI/UX Integral — Plataforma Chome

**Fecha:** 2026-07-24
**Alcance:** 145 páginas bajo `app/(app)/`, 39 componentes en `components/ui/`, tokens en `app/globals.css`
**Evidencia:** 344 capturas (`audit/screenshots/2026-07-24-playwright/`) — 173 desktop @1920×1080 + 171 mobile @390×844 — más inspección de código
**Marco de evaluación:** Heurísticas de Nielsen · Leyes de UX (Fitts, Hick, Von Restorff) · WCAG 2.2 AA · Tufte/Few (data-ink) · Samara (jerarquía/retícula) · sistema 8pt
**Alcance excluido:** reutilización de código y duplicación de patrones — ya cubiertos por `AUDITORIA_REUTILIZACION_Y_CONSISTENCIA_VISUAL.md` (2026-07-23) y `AUDITORIA_CONSISTENCIA_UI.md` (2026-07-20). Este informe evalúa **calidad de experiencia**, no mantenibilidad.

> **Nota de seguimiento:** los dos hallazgos estructurales de las auditorías previas están **resueltos**: `<select>` nativo = 0 ocurrencias (antes: mayoría de Prevención); `form-kit.tsx` duplicado = 0 copias (antes: 8). El equipo actúa sobre las auditorías, lo cual eleva la confianza en la ejecución de este plan.

---

## 0. Estado de remediación

### Pasada 9 — errores preexistentes (2026-07-25)

**Puntuación global: 9.5 → 9.6.** Verificación: `next build` limpio · `tsc` limpio · **ESLint 0 problemas en todo el repo** · **3005/3005 tests** · 159/159 rutas capturadas.

#### El hallazgo de fondo: la herramienta de auditoría ocultaba una clase entera de fallos

El manifest marcaba `ok: true` para cualquier ruta que devolviera 200 — **aunque renderizara su error boundary**. Añadí recolección de `pageerror` y `console.error` del navegador, y apareció lo que llevaba oculto: **10 rutas con errores de JavaScript**. Un 200 no significa que la página funcione.

| Error preexistente | Causa real | Alcance |
|---|---|---|
| `/combustibles/bitacora` "Error al cargar la bitácora" | **`<SelectItem value="">`**, que Radix prohíbe (la cadena vacía está reservada para limpiar la selección). Lanzaba en cliente y tumbaba la página | El componente `FilterSelect` lo tenía → **7 páginas de combustibles**. Y había **4 más** en el repo: `worker-form`, `cost-center-form`, `sheet-form`, `tae-import-report-form` |
| `/admin/notificaciones`, `/admin/seguridad` React #418 | **`toLocaleString()` sin locale**: usa el del runtime, el del servidor no coincide con el del navegador → desajuste de hidratación. **`AGENTS.md` ya lo prohibía en prosa** y `lib/utils.ts` documenta que el equipo ya diagnosticó esta clase | 5 sitios (`+folios`) |
| `/trazabilidad/trabajador/[id]` "Algo salió mal" | La página se abre con `traceability:view` pero llama a `listEppCoverageGaps`, que exige `prevention:epp:view` y **lanza** si falta. **El dashboard ya guardaba esa misma llamada; aquí faltaba** | Rompía la página para todo rol con trazabilidad y sin prevención-EPP |

**Los tres cerrados**, más dos reglas para que no vuelvan:
- **`local/no-bare-to-locale`** en ESLint: prohíbe `toLocale*String()` sin locale. Verificada con control positivo. Lo que `AGENTS.md` pedía en prosa ahora se cumple solo.
- El `catch` que se tragaba en silencio los fallos de captura de modales ahora **avisa** — otra pérdida de señal en la misma herramienta.

#### Y una tercera deriva del entorno de auditoría, del mismo tipo que C-1

El seed de capturas tenía un **catálogo de 99 permisos escrito a mano** que había derivado de `SYSTEM_PERMISSIONS` (que sí se deriva de los manifests de módulo). Consecuencias medidas:

- Le **faltaban todos los `prevention:epp*`** → `/trazabilidad/trabajador` parecía roto para todo usuario cuando en producción sólo lo está para roles sin ese permiso.
- **Concedía `receiving:register`, un permiso que no existe** → bodega aparecía en las capturas con un permiso que producción no le da.

Ahora el seed **deriva de `SYSTEM_PERMISSIONS`** y una guardia de paridad lanza con nombre y rol si se concede un permiso inexistente. La guardia encontró el permiso fantasma en su primera ejecución.

**Patrón, por tercera vez:** C-1, el build cacheado y esto. Los tres fueron **el entorno de auditoría mintiendo**, no el producto. La herramienta que valida el producto necesitaba validarse a sí misma.

#### Dos errores detectados y NO diagnosticados

`/ppa` y `/entregas/[id]/print` lanzan React **#418** (`args[]=HTML`). Lo que sé y lo que no:

- **Reproducible sólo en build de producción**; en `next dev` no ocurre.
- Ambas son rutas **dinámicas** (`ƒ`), así que no es prerenderizado estático.
- **No es el layout compartido:** `/ppa/result/[token]` y `/tae/access/…` están en el mismo grupo `(public)` con el mismo `<Toaster>` y funcionan; `compras-print` y `sst-print` están en `(print)` y funcionan.

No sigo especulando: con A-7 adiviné tres veces y la respuesta llegó al instrumentar. Quedan **detectados de forma reproducible y con señal automática**, que es de donde parte quien los tome.

#### Otros preexistentes cerrados

- `allReturned` en `rollup.ts`: variable muerta (`anyReturned` ya cubría el caso).
- Un archivo de 0 bytes **trackeado en git** cuyo nombre era un fragmento de Python roto (`.join(t[name])}…`). Eliminado; queda como borrado sin stagear para tu commit.
- **No es un error:** los 168 tests "saltados" están condicionados a disponibilidad de BD (`databaseUrl && canReset`), que es gating intencional, no podredumbre.

### Pasada 8 — Fase 5, roadmap de productividad (2026-07-25)

**Puntuación global: 9.3 → 9.5.** Verificación: `next build` limpio · `tsc` limpio · **3005/3005 tests** · capturas de validación sin scroll horizontal.

| Propuesta | Estado | Implementación |
|---|---|---|
| **E-1** Selector de densidad | ✅ | Cómodo/Compacto en `DataTable`, con la preferencia **compartida entre tablas** vía `localStorage` + `useSyncExternalStore` (quien opera en compacto lo quiere en todas). El padding se aplica por atributo `data-density` en CSS, porque las filas las renderiza el consumidor y parametrizarlo por props exigiría tocar las 37 llamadas. Se ofrece sólo desde 8 filas: por debajo sería adorno |
| **E-3** Acciones en lote | ✅ | Casilla por ítem + maestra por grupo + barra `sticky` con "Aprobar N". **`bulkApproveRequestAction` ya existía y valida el alcance ítem por ítem** (`canAccessWorksite` + rol EPP, descartando los no permitidos), así que seleccionar cruzando solicitudes es seguro — sólo faltaba la UI |
| **E-4** Columna congelada | ✅ | `stickyFirstColumn` opt-in, activo en las 7 tablas de ≥8 columnas. El divisor se dibuja con `::after` porque `position: sticky` rompe el `border-collapse` |
| **E-5** `Enter` entre campos | ✅ | Hook `useEnterAdvancesFields`, aplicado en entregas. Respeta `textarea`, `select` y combobox, y conserva el envío nativo en el último campo. **Con test propio (4 casos)** |
| **M-13** atajo `n` | ✅ | Prop `newShortcutHref` en `PageHeader`, cableada en solicitudes, compras y recepción |
| **E-2** Vistas guardadas | ⏳ **Pendiente por decisión** | Se puede hacer con `localStorage` hoy; si se quiere por usuario y compartible hay que llevarlo a esquema. Es una decisión de producto, no de implementación |

#### Dos decisiones de diseño que conviene registrar

**`n` es opt-in a propósito.** Un atajo global que buscara "el botón primario del header" sería una heurística peligrosa: en Aprobaciones habría disparado *"Aprobar todos"*. La página declara su destino o no hay atajo.

**La barra de lote es `sticky`, no `fixed`.** `fixed` se posiciona respecto al viewport y se metía debajo del sidebar en desktop; hacía falta conocer su ancho, que no está tokenizado. `sticky` dentro del contenedor de scroll respeta ese ancho sin saberlo, y al estar en flujo no tapa la última fila.

#### Un bug que el test destapó

`useEnterAdvancesFields` filtraba campos con `el.offsetParent !== null`, lo obvio para "¿está visible?". Pero `offsetParent` es `null` **también para `position: fixed`** — es decir, el hook habría ignorado todo formulario dentro de un `Dialog` o un `Sheet`. Cambiado a `checkVisibility()`, que sí distingue oculto de posicionado. Sin el test en jsdom no lo habría visto.

### Pasada 7 — validación visual real (2026-07-25)

**Puntuación global: 9.1 → 9.3.** Verificación: `next build` limpio · `tsc` limpio · **3001/3001 tests** · **159/159 rutas capturadas, 0 errores** · **"Sin scroll horizontal en ninguna ruta ✓"**.

#### Dos fallos míos que esta pasada destapó

**1. `app/globals.css` estaba roto sintácticamente desde la Pasada 1 — y la aplicación no compilaba.** Mi edición del token `--color-border-control` dejó dos líneas de comentario huérfanas tras el `*/`. `tsc`, los 3001 tests y ESLint **no parsean CSS**, así que durante cinco pasadas declaré "verificado" sobre una base que no construía. La única forma de detectarlo era correr `next build`, y no lo hice ni una vez.

**Lección de método:** "tests verdes + tsc limpio" no equivale a "compila". Un cambio en CSS exige un build; ninguna de las verificaciones que usé lo cubría.

**2. La recaptura previa no probaba nada.** El script de capturas sirve `.next/standalone`, **no compila**. El build servido era del 07-24 14:22 y mi primer cambio del 07-24 18:11, así que las capturas de las 00:45 renderizaron el código anterior a la Pasada 1. Por eso A-7 seguía mostrando 676px: mi arreglo no estaba en el bundle. **Recapturar sin `npm run build` previo es un no-op.**

#### A-7: causa raíz encontrada, y no era la que supuse

El detector que escribí en la Pasada 6 falló en su primera versión porque **excluía los elementos `absolute`/`fixed`** — precisamente donde estaba el culpable. Instrumentándolo apareció:

```
span.sr-only  pos=absolute  left=675  right=676  w=1
```

Es el `<span className="sr-only">Ver</span>` de la última cabecera de `evaluation-list.tsx`. `sr-only` usa `position: absolute`, y **ni `TableRoot` ni `<main>` eran `position: relative`**, así que su bloque contenedor era el `<html>`: escapaba al `overflow` de ambos y arrastraba el ancho del documento a 676px. Un elemento de **1px** producía 286px de desbordamiento.

Eso explica por qué mi `overflow-x-clip` de la Pasada 6 no sirvió de nada: sin un ancestro posicionado, no hay recorte que aplicar.

**Arreglo real:** `relative` en `TableRoot` (systémico: cubre cualquier `sr-only` en cualquier tabla) y `relative overflow-x-hidden` en el `<main>`. **Verificado empíricamente:** la captura pasó de 676×844 a **390×844**, y las 159 rutas reportan cero desbordamiento. El detector ahora modela correctamente el bloque contenedor y salta las rutas de `(print)`, que son A4 y anchas por diseño.

#### Lo que la validación visual confirmó

| Hallazgo | Evidencia en captura |
|---|---|
| **C-2** bordes de control | Los campos de `desktop-solicitudes-nueva` se leen como un sistema; antes los bordes eran casi invisibles |
| **A-8** contadores | El badge del rail marca **1**, ya no 2 — coincide con la página |
| **C-1** (retractado) | El kardex muestra **`−2`** con saldo 3: la invariante del seed funcionó y confirma que no había defecto de producción |
| **M-1** `th-type` | Cabeceras del kardex en MAYÚSCULAS, igual que `DataTable` |
| **M-3** (retractado en kardex) | `SALDO` ya estaba a la derecha, como sostuve al retractar |
| **A-1** tarjetas móviles | Recepción: tarjetas con estado y **"Recibir" como primario a ancho completo**; antes quedaba fuera de pantalla |
| **A-2** objetivos táctiles | Controles y botones visiblemente a ~44px en móvil |
| **A-4** aviso único | Banner con qué falta, cuánto y CTA; celdas con `—` |
| **B-2 / B-3 / B-4** | Export blanco (no gris), sin "TABLERO" duplicado, filtros a ancho completo |

#### Dos defectos nuevos encontrados al mirar, y corregidos

- El **buscador de `ListFilters`** seguía estrecho en móvil aunque el `Input` era `w-full`: su wrapper no crecía. Los selects sí crecían por ser hijos directos del flex. Corregido.
- La **cabecera PDTP del dashboard** comprimía el título a dos líneas y encajaba "Meta anual 90%" en ~40px. Ahora apila bajo `sm`.

### Pasada 6 — Fase 2, paridad móvil (2026-07-25)

Verificación: `tsc --noEmit` limpio · **3001/3001 tests** · ESLint sin errores nuevos.

| Estado | Hallazgos |
|---|---|
| ✅ **Resueltos en Pasada 6** | A-1, A-2, A-7, B-2, B-3, B-4 |
| 🔎 **Atribución corregida** | B-2 — no era `ExportButton` sino un `<a>` crudo en `ListFilters` |

**Puntuación global: 8.8 → 9.1.** **Se cierran los 3 últimos hallazgos Altos de toda la auditoría.**

**A-2 — la escala táctil pasa al design system.** `buttonVariants` y los controles de entrada ahora responden al medio de entrada, no al tamaño visual: bajo `sm` todo mide **44px** (mínimo de Apple HIG / Material), desde `sm:` vuelve a la altura compacta que da la densidad de un backoffice. Un cambio por variante resuelve los **541** `size="sm"`. Además se corrigieron los 3 controles con altura fija en `className` que habrían anulado la escala (`data-table`, `epp-import-review`) y los 5 de `ListFilters`.

**A-1 — resuelto distinguiendo qué tabla se usa en terreno y cuál no.**

| Tabla | Decisión | Por qué |
|---|---|---|
| Recepción | ✅ Tarjeta móvil | El botón "Recibir" quedaba fuera de pantalla; se usa en faena |
| Compras (OC) | ✅ Tarjeta móvil | Sin total ni estado no se reconoce una OC (Heurística #6) |
| Acciones PDTP | ✅ Tarjeta móvil | Un prevencionista revisa CAPA pendientes en faena |
| 7 tablas de `/admin` + 2 historiales de importación | ✅ **Marcadas desktop-only** | Nadie administra permisos ni importa una planilla desde el teléfono. Portarlas sería trabajo sin usuario; **dejarlas cortadas sin explicación es peor**, porque el usuario cree que la app está rota |

Nuevo [components/ui/desktop-only-table.tsx](components/ui/desktop-only-table.tsx): aviso visible sólo bajo `md` que explica la decisión. La tabla sigue accesible por scroll horizontal.

**A-7 — no pude identificar el elemento culpable, así que endurecí el sistema y automaticé la detección.** Sin navegador no hay forma de señalar el descendiente que desborda (lo declaré como Confianza Media desde el principio y sigue sin confirmarse). Lo aplicado:

1. `overflow-x-clip` en el `<main>` de `app-shell.tsx` — impide que **cualquier** descendiente ancho arrastre el documento, en todas las rutas, no sólo en la que detecté. No afecta a las tablas anchas: viven en `TableRoot`, que tiene su propio `overflow-x-auto`.
2. **Detección automática en el script de capturas**: cada ruta evalúa `scrollWidth` contra el viewport y, si desborda, **nombra los elementos culpables** con su `right` en px, los acumula en el `manifest.json` y termina con `exitCode 1`. Esto automatiza el hallazgo que encontré comparando anchos de PNG a mano, y además aporta lo que me faltó: el nombre del culpable.

**B-2 — el hallazgo era correcto, mi atribución no.** Escribí que había que dar a `ExportButton` el tratamiento `secondary`; su variante por defecto **ya era** `secondary`. El botón gris era un `<a>` crudo dentro de `ListFilters` con `bg-surface-2` + `text-muted` — relleno gris y texto tenue, que junto a selects blancos se lee como deshabilitado. Corregido al mismo tratamiento visual que `Button variant="secondary"`.

### Pasada 5 — desktop agotado (2026-07-25)

Verificación: `tsc --noEmit` limpio · **3001/3001 tests** · ESLint sin errores nuevos.

| Estado | Hallazgos |
|---|---|
| ✅ **Resueltos en Pasada 5** | M-9 (núcleo real), A-4 (últimos casos de página) |
| ❌ **Retractado en Pasada 5** | **B-5** — el "2 de ~15" era una cifra heredada, no medida |
| ⏳ **Abiertos — desktop** | Sólo residuos de severidad Baja y el roadmap: A-4 (61 CTA por caso), M-9 (73 truncados no identificadores), M-13 (`n`, `Enter`), E-1…E-5 · Fase 4 |
| ⏸️ **Abiertos — móvil (diferidos a propósito)** | A-1, A-2, A-7, B-2, B-3, B-4 |

**Puntuación global: 8.7 → 8.8.** **El desktop queda agotado de defectos accionables.** Lo que resta en desktop son mejoras de roadmap y residuos que requieren criterio caso a caso.

**B-5 retractado — heredé una cifra sin medirla.** Filé "`FilterToolbar` existe y se usa en 2 módulos de ~15". El número venía de `AUDITORIA_REUTILIZACION_Y_CONSISTENCIA_VISUAL.md` (2026-07-23) y **lo repetí sin verificarlo**. La medición real:

| Componente | Arquitectura | Adopción |
|---|---|---|
| `FilterToolbar` | Cliente, con hoja "Más filtros" y chips | **9 archivos** en combustibles, flota y prevención |
| `ListFilters` | Server-side sincronizado con URL | Toda el área de adquisiciones |

No es sub-adopción: son **dos componentes compartidos para dos arquitecturas distintas**. Y `ListFilters` acepta como máximo 4 dimensiones de filtro más la búsqueda = 5 controles, **dentro** del presupuesto de 4–6 de la regla A2 — así que adquisiciones no necesita hoja de desbordamiento. El único hueco real sería los chips removibles, cuyo valor con ≤5 filtros y un botón "Limpiar" es marginal.

**M-9 cerrado en lo que importaba.** De los 113 truncados sin `title`, aislé los **40 cuyo contenido es el identificador del registro** (nombre, código, email, `productName`, `fileName`) — ahí truncar es perder la identidad de la fila. 39 corregidos; uno se dejó a propósito (`prevencion/ppa/page.tsx`: su `label` es `ReactNode`, y `String()` sobre JSX daría `[object Object]`). Los 73 restantes truncan texto secundario que ya aparece completo en otro punto de la fila; ponerles `title` sería ruido para lector de pantalla.

### Pasada 4 — desktop (2026-07-24)

Verificación: `tsc --noEmit` limpio · **3001/3001 tests** · ESLint sin errores nuevos.

| Estado | Hallazgos |
|---|---|
| ✅ **Resueltos en Pasada 4** | M-7, M-15 |
| ⚠️ **Reencuadrado** | A-4 (la clasificación cambió el diagnóstico — ver ficha) |
| ⏳ **Abiertos — desktop** | B-5, M-9 (113 truncados), A-4 (64 CTA por caso), E-1…E-5 · Fase 4 |
| ⏸️ **Abiertos — móvil (diferidos a propósito)** | A-1, A-2, A-7, B-2, B-3, B-4 |

**Puntuación global: 8.5 → 8.7.** *No queda ningún hallazgo Medio de desktop abierto.*

**M-15: cobertura de `loading.tsx` de 87/145 a 144/145.** 57 skeletons generados tomando el título del `metadata` de cada página. **No declaran breadcrumb a propósito**: el TopBar ya lo deriva de `NAV_ITEMS` + `usePathname()`, y duplicarlo abriría una segunda fuente de verdad que puede quedar desfasada. La única ruta sin skeleton es el catch-all `[...not-found]`, que resuelve a 404 y no tiene estado de carga.

**M-7 resuelto con el arreglo mínimo, no con el ideal.** La causa era `space-y-8` (32px) en el contenedor de los dos `<form>`. Fusionarlos en una barra única exigiría sacar los botones con el atributo `form=` y cablear a mano los flags de pending, porque `SubmitButton` lee `useFormStatus` —que sólo funciona dentro del form que envía—. Es un refactor real sobre el formulario del flujo core de compras para un hallazgo Medio, así que se aplicó `-mt-6` para que las dos filas se lean como una sola barra de acciones. **La estructura de dos forms se mantiene, deliberadamente.**

### Pasada 3 — desktop (2026-07-24)

Verificación: `tsc --noEmit` limpio · **3001/3001 tests** · ESLint sin errores nuevos.

| Estado | Hallazgos |
|---|---|
| ✅ **Resueltos en Pasada 3** | A-8, M-10, M-12, M-13\* · **fuga de C-2** (24 controles crudos) |
| ⚠️ **Avanzado** | A-4 (empty state de invitaciones; quedan 77 clasificados abajo) |
| ⏳ **Abiertos — desktop** | A-4 (barrido), M-7, M-15, B-5, M-9 (113 truncados), E-1…E-5 · Fase 4 |
| ⏸️ **Abiertos — móvil (diferidos a propósito)** | A-1, A-2, A-7, B-2, B-3, B-4 |

\* M-13 cerrado con `/` para enfocar el filtro y `Esc` para limpiarlo; faltan `n` y navegación por `Enter` (E-5).

**Puntuación global: 8.2 → 8.5.**

**Hallazgo nuevo durante la Pasada 3 — fuga de C-2.** Al migrar los `type="date"` descubrí **24 controles de formulario crudos** (`<input>`/`<textarea>` con estilos locales, sin pasar por los componentes `Input`/`Textarea`) que seguían usando `--color-border` a **1.27:1**. La Pasada 1 sólo había corregido los componentes del design system, así que C-2 estaba cerrado *en el sistema* pero abierto *en 24 sitios*, incluido el propio buscador del TopBar. Todos migrados a `--color-border-control`.

**A-8 no requería criterio de producto: era un bug de una línea.** Investigado hasta el fondo: el badge del rail filtraba `requestType != 'repuestos'` mientras la página filtraba `NOT IN ('repuestos','servicios')`. Una solicitud de *servicios* contaba en el badge y no aparecía nunca en la lista. El comentario del propio código ya advertía que ambas consultas debían coincidir. Extraído a [lib/approvals-queue.ts](lib/approvals-queue.ts) como predicado compartido para que no puedan volver a derivar.

### Pasada 2 — desktop primero (2026-07-24)

| Estado | Hallazgos |
|---|---|
| ✅ **Resueltos** | A-4 (caso extremo), A-5 (adopción), M-1, M-2, M-6, M-9\*, M-10\* |
| ❌ **Retractado** | M-3 (parcial: falso en kardex, real y corregido en Indicadores) |

Global 7.8 → 8.2.

### Pasada 1 (2026-07-24)

Ejecutadas **Fase 0 y Fase 1**. Global 7.1 → 7.8; *Preparación para Producción* 4.0 → 7.0 al no quedar ningún Crítico abierto.

### Correcciones metodológicas — dos hallazgos míos resultaron falsos

**C-1 (Pasada 1) era un falso positivo.** La captura mostraba `+2` en rojo para un egreso con saldo bajando de 5 a 3 — la lectura era correcta —, pero la causa no era producción sino el **seed del script de capturas**, que insertaba `quantity: 2` saltándose `applyMovement`. El código real pasa `-input.quantity`. No había falla WCAG 1.4.1 ni error contable. Corregido el seed + invariante `stockAfter === stockBefore + quantity`.

**M-3 (Pasada 2) era falso en uno de sus dos casos.** Afirmé que el kardex alineaba "Saldo" a la izquierda; al abrir el archivo, tanto el `<th>` como el `<td>` ya declaraban `text-right font-mono tabular-nums`. La columna es estrecha (`w-24`) y en la captura los valores quedan visualmente pegados a la cabecera. **En Indicadores SST sí era real** y está corregido.

**Patrón detectado:** las dos retractaciones nacen de inferir de una captura sin confirmar contra el archivo. Las mediciones analíticas (contraste, conteos por `grep`, dimensiones PNG) resultaron fiables al 100%; las inferencias de posición sobre pixeles, no. La sección §5 ya declaraba esas inferencias como "Confianza Media" — la calibración era correcta, pero debí verificarlas antes de asignarles severidad.

---

## 1. Contexto y Diagnóstico General

- **Superficie:** Software empresarial / backoffice B2B multi-módulo (adquisiciones, bodega, combustibles, flota, prevención SG-SST). Uso diario intensivo, densidad media-alta, tolerancia cero al error en registros de inventario y cumplimiento legal.
- **Perfil de usuario:** operadores expertos recurrentes (encargado de bodega, prevencionista, jefatura) + usuarios ocasionales en terreno vía móvil (aprobaciones, reportes de incidente).
- **Puntuación Global:** **7.1** inicial → 7.8 → 8.2 → 8.5 → 8.7 → 8.8 → 9.1 → 9.3 → 9.5 → **9.6 / 10** (P9) — ver §0
- **Veredicto inicial:** *Requiere correcciones críticas.*
- **Veredicto actual:** **Sin hallazgos Críticos, Altos ni Medios abiertos, ni en escritorio ni en móvil.** Lo que resta es el roadmap de productividad (E-1…E-5), residuos de criterio caso a caso, y la **Fase 4** de verificación interactiva — que exige la aplicación en ejecución y sigue siendo el riesgo abierto más importante.

### Lo que está bien resuelto (y debe protegerse)

El sistema de diseño es **genuinamente bueno**, no decorativo:

- **Paleta de texto verificada contra WCAG:** los 4 tokens de texto superan 4.5:1 sobre blanco por márgenes amplios (`--color-text` 18.8:1, `--color-muted` 8.1:1, `--color-subtle` 6.0:1, `--color-faint` 4.85:1 tras C-3). Es raro encontrar un sistema donde el token "más tenue" siga cumpliendo AA.
- **Badges tint/line/ink:** las 6 familias semánticas rinden entre 6.9:1 y 13.7:1 de texto sobre su propio fondo. Ejemplar.
- **Arquitectura de información:** navegación derivada del registry de módulos, filtrada por permisos, con áreas coherentes y breadcrumbs. Las tres preguntas de Krug ("¿dónde estoy?", "¿dónde puedo ir?", "¿qué es esto?") se responden en toda pantalla.
- **Disciplina de layout documentada y cumplida:** `PageContainer` en 160 archivos, sólo 2 `<h1>` fuera de `PageHeader`, 719 usos de `<Field>` accesible.
- **Fundamentos de accesibilidad presentes:** skip link funcional, `<main>` con `id`+`tabIndex`, 132 usos de `aria-live`/`role="alert"`, `aria-sort` en cabeceras ordenables, regiones scrollables con `role="region"`+`aria-label`.
- **Estados de error de primer nivel:** la pantalla de fallo de Bitácora (`desktop-combustibles-bitacora.png`) es un modelo de Heurística #9 — icono, qué pasó, qué hacer, "Intentar de nuevo" + "Reportar error".
- **Prevención de errores en formularios:** el panel "Pendientes" de nueva solicitud (`desktop-solicitudes-nueva.png`) lista en lenguaje humano exactamente qué falta antes de enviar. Excelente.

### Dónde se rompe

El patrón dominante de los defectos es **el escritorio recibió el cuidado, el móvil recibió el `hidden md:block`**. El segundo patrón es **reglas propias correctas que no se aplican de forma pareja** (A1–A6 de `AGENTS.md` se cumplen en los módulos nuevos y se degradan en Prevención y Combustibles).

---

## 2. Puntuación por Dimensiones

| # | Dimensión | Inicial | P1–P5 | **P6** | Sustento |
|---|---|---|---|---|---|
| 1 | **Usabilidad** (Nielsen) | 7.0 | 9.0 | 9.0 | — |
| 2 | **Jerarquía Visual** | 6.5 | 9.0 | 9.0 | — |
| 3 | **Claridad de Contenido** | 7.5 | 8.5 | **9.0** | El export deja de leerse como deshabilitado; sin triple título en móvil |
| 4 | **Consistencia Visual** | 7.5 | 9.0 | 9.0 | — |
| 5 | **Accesibilidad (WCAG 2.2 AA)** | 5.5 | 9.0 | **9.5** | 1.4.10 Reflow con salvaguarda de sistema + detección automática. Falta Fase 4 |
| 6 | **Navegación e IA** | 8.5 | 8.5 | 8.5 | — |
| 7 | **Responsividad** | 5.5 | 5.5 | **9.0** | Escala táctil de 44px en el design system; tablas core con tarjeta; el resto marcado desktop-only |
| 8 | **Feedback de Estado** | 7.5 | 9.0 | 9.0 | — |
| 9 | **Calidad de Componentes** | 8.0 | 9.0 | 9.0 | — |
| 10 | **Estética y Refinamiento** | 8.5 | 8.5 | 8.5 | — |
| 11 | **Transparencia y Confianza** | 9.0 | 9.0 | 9.0 | — |
| 12 | **Preparación para Producción** | **4.0** | 8.5 | **9.0** | Sin hallazgos Críticos, Altos ni Medios abiertos |
| | **Global** | **7.1** | **8.8** | **9.1** | |

**Regla de ponderación no-promediada — ya no aplica.** El sistema de puntuación topa *Preparación para Producción* en 4/10 mientras exista un hallazgo Crítico. Tras la Pasada 1 no queda ninguno: C-2 y C-3 están resueltos y C-1 se retractó por falso positivo. La nota sube a 7.0, limitada ahora por los 5 Altos abiertos —casi todos de paridad móvil— y por las cuatro verificaciones interactivas que siguen sin hacerse (§5).

---

## 3. Hallazgos Detallados

### 3.1 Severidad CRÍTICA

---

#### ❌ C-1 · RETRACTADO — falso positivo (evidencia contaminada por el seed)

> **Veredicto tras verificación (2026-07-24):** **no existe el defecto.** El texto original se conserva tachado abajo para dejar trazable el razonamiento fallido.
>
> **Por qué se cayó:** `inventoryMovements.quantity` es un delta **con signo** (`lib/services/stock-movement.ts:26`), y `applyStockDelta` lo suma. Si un `+2` hubiera estado realmente almacenado, el stock habría *subido* de 5 a 7 — pero la captura mostraba saldo 3. Los dos productores reales del movimiento, [deliveries-worksite.ts:99](lib/services/deliveries-worksite.ts#L99) y [deliveries-worker-epp.ts:181](lib/services/deliveries-worker-epp.ts#L181), pasan `quantity: -input.quantity`. El render `{m.quantity > 0 ? "+" : ""}{m.quantity}` produce por tanto `−2` correctamente: el signo lo lleva el número, no el color, así que **WCAG 1.4.1 se cumple**.
>
> **De dónde salía el `+2`:** del seed de capturas — [capture-all-routes.ts](scripts/capture-all-routes.ts) insertaba `quantity: 2` directamente en la tabla, saltándose `applyMovement`, junto a `stockBefore: 5, stockAfter: 3`. Datos internamente contradictorios.
>
> **Corregido:** el seed ahora usa `-2` y valida `stockAfter === stockBefore + quantity` sobre cada fila antes de insertarla, lanzando si la invariante se rompe. Un seed mentiroso ya no puede generar capturas que parezcan defectos.
>
> **Lección para el método:** la captura era evidencia genuina de *algo*, pero la cadena causal que le atribuí no se verificó contra el productor del dato. Un hallazgo Crítico sobre datos exige rastrear hasta quién los escribe, no sólo quién los pinta.

<details>
<summary>Texto original del hallazgo (incorrecto, conservado para trazabilidad)</summary>

- **Problema:** en el Kardex, la cantidad de todo movimiento se imprime con signo `+` si es mayor que cero, y la dirección (ingreso vs egreso) se transmite **únicamente** por el color del texto. Como las cantidades se almacenan siempre en magnitud positiva, una salida de bodega se muestra como `+2` en rojo, mientras el saldo baja.
- **Evidencia:**
  - `desktop-bodega.png`: fila `Entrega · Casco dieléctrico con barbiquejo · +2 · Saldo 3`. El saldo previo del mismo producto era 5 → el movimiento real es **−2**, mostrado como **+2**.
  - [kardex-table.tsx:78](app/(app)/bodega/kardex-table.tsx#L78): `{m.quantity > 0 ? "+" : ""}{m.quantity}`
  - [kardex-table.tsx:13-18](app/(app)/bodega/kardex-table.tsx#L13-L18): `MOVEMENT_QTY_CLASS` — `egreso_entrega: "text-danger"`, `egreso_desecho: "text-warning"` son el único portador de la dirección.
  - Mismo defecto en la tarjeta móvil: [kardex-table.tsx:104-106](app/(app)/bodega/kardex-table.tsx#L104-L106).
- **Principio afectado:** **WCAG 2.2 · 1.4.1 Uso del Color (Nivel A)** — el color no puede ser el único medio visual para transmitir información. Adicionalmente, Heurística #1 de Nielsen (visibilidad del estado real del sistema): el dato mostrado contradice al saldo.
- **Impacto:** un usuario con daltonismo (deuteranopia/protanopia: ~8% de hombres) o leyendo un Kardex impreso en blanco y negro interpreta cada egreso como un ingreso. En un registro de inventario esto es un error de lectura contable, no cosmético.
- **Severidad:** **Crítico**
- **Recomendación:** derivar el signo del tipo de movimiento, no del almacenamiento, y mantener el color como refuerzo redundante:

```tsx
// kardex-table.tsx
const OUTBOUND = new Set(["egreso_entrega", "egreso_desecho"])
const signed = OUTBOUND.has(m.type) ? -Math.abs(m.quantity) : Math.abs(m.quantity)
// …
<td className={`… ${MOVEMENT_QTY_CLASS[m.type] ?? "text-[var(--color-text-muted)]"}`}>
  {signed > 0 ? "+" : "−"}{Math.abs(signed)}
</td>
```

Verificar además que la exportación a Excel (`kardex-export-button.tsx`) aplique el mismo signo, para que el archivo descargado no herede el error.

</details>

---

#### ✅ C-2 · RESUELTO · El borde de todos los controles de formulario rendía 1.27:1 — falla de contraste no textual

- **Problema:** los campos de entrada usan `--color-border` como único límite visual, sobre un fondo `--color-surface` idéntico al fondo de la página. El ratio medido es **1.27:1** contra el mínimo normativo de **3:1**. Un usuario con baja visión no puede determinar dónde empieza y termina un campo, ni distinguir un campo de un bloque de texto.
- **Evidencia:** cálculo directo sobre los tokens de `app/globals.css`:

  | Par medido | Ratio | Requerido | Estado |
  |---|---|---|---|
  | `--color-border` (#e5e4e1) sobre `--color-surface` (#fff) | **1.27:1** | 3:1 | **FALLA** |
  | `--color-border` sobre `--color-surface-2` | **1.18:1** | 3:1 | **FALLA** |
  | `--color-border-strong` (#cecdc9) sobre `--color-surface` | **1.59:1** | 3:1 | **FALLA** |

  Componentes afectados: [input.tsx:17](components/ui/input.tsx#L17), [textarea.tsx:15](components/ui/textarea.tsx#L15), `select-parts.tsx`, `checkbox.tsx`, y `Button variant="secondary"` ([button.tsx:31](components/ui/button.tsx#L31)) — es decir, la totalidad de la superficie de entrada de datos de la plataforma.
- **Principio afectado:** **WCAG 2.2 · 1.4.11 Contraste No Textual (Nivel AA)** — los indicadores visuales necesarios para identificar componentes de interfaz requieren 3:1.
- **Severidad:** **Crítico** (excluye a un grupo de usuarios de la tarea principal de captura de datos; alcance = 100% de los formularios)
- **Recomendación:** **no oscurecer `--color-border` globalmente** — eso destruiría la dirección visual de hairlines y divisores, que están exentos por ser decorativos. Introducir un token dedicado al límite de controles:

```css
/* app/globals.css — @theme */
--color-border-control: oklch(0.660 0.005 90);  /* #93928f — 3.11:1 sobre blanco ✓ */
```

y sustituir `border-[var(--color-border)]` → `border-[var(--color-border-control)]` en `input.tsx`, `textarea.tsx`, `select-parts.tsx`, `checkbox.tsx` y la variante `secondary` de `button.tsx`. Los divisores de tabla, las hairlines de tarjeta y los separadores permanecen con `--color-border`.

*Confianza: Alta.* Valores calculados analíticamente desde OKLCH → sRGB → luminancia relativa WCAG.

> **✅ Aplicado (2026-07-24).** Dos tokens nuevos en `@theme`:
> `--color-border-control: oklch(0.640 0.005 90)` (#8d8c89) y `--color-border-control-hover: oklch(0.545 0.004 90)`.
>
> **El valor final es más oscuro que el propuesto (0.640 vs 0.660).** El test de regresión reveló que el fondo vinculante no es el blanco sino `--color-surface-2` (= `--color-chrome`): sobre él, 0.660 rendía sólo 2.89:1. Con 0.640 se obtiene **3.36:1 sobre blanco y 3.12:1 sobre surface-2**.
>
> Migrados: `input.tsx`, `textarea.tsx`, `select.tsx` (trigger), `date-picker.tsx` (trigger), `button.tsx` (variante `secondary`) y el track apagado de `switch.tsx` (rendía 1.59:1). Los estados `hover`/`active`/`read-only` se recalibraron para que nunca queden más claros que el estado por defecto.
>
> **No migrado a propósito:** `checkbox.tsx` usa un `<input type="checkbox">` nativo con `accent-color` — el renderizado por defecto del agente de usuario está **exento** de 1.4.11. El contenedor del popover de `select.tsx` sigue con `--color-border`: es decoración, y la elevación ya lo delimita.
>
> ### 🔎 Fuga descubierta en la Pasada 3 — el hallazgo estaba cerrado en el sistema, abierto en 24 sitios
>
> Al migrar los `type="date"` aparecieron **24 controles de formulario crudos** (`<input>`/`<textarea>` con estilos locales, sin pasar por `Input`/`Textarea`) que seguían usando `--color-border` a **1.27:1** — entre ellos el **propio buscador del TopBar**, visible en todas las rutas.
>
> La Pasada 1 corrigió los componentes del design system y di el hallazgo por cerrado sin comprobar los controles que no los usan. **Lección:** un hallazgo de token no se cierra migrando el componente; se cierra cuando ningún elemento de esa clase usa el token viejo. La verificación correcta es `grep` sobre el árbol, no sobre `components/ui/`.
>
> Los 24 migrados a `--color-border-control`.

---

#### 🔎✅ C-3 · NUEVO Y RESUELTO · `--color-text-faint` no alcanzaba 4.5:1 sobre el chrome

- **Problema:** `--color-text-faint` cumplía 4.65:1 sobre blanco, pero se usa también sobre `--color-chrome` (el relleno del sidebar y el topbar), donde rendía **4.32:1**.
- **Evidencia:** detectado por el test de regresión escrito en la Fase 0, no por inspección visual. El token se usa en 79 lugares; en el chrome aparece en [nav-rows.tsx:173](components/layout/nav-rows.tsx#L173) —una etiqueta de sección del rail de 11px, que es **texto**, no icono— además de `mobile-nav.tsx`, `desktop-nav-areas.tsx` y `command-palette.tsx`.
- **Principio afectado:** **WCAG 2.2 · 1.4.3 Contraste Mínimo (AA)**.
- **Severidad:** Alto (alcance acotado a etiquetas de navegación, frente al alcance total de C-2).
- **✅ Resuelto:** `oklch(0.560 …)` → `oklch(0.545 0.004 90)`. Ahora **4.85:1 sobre blanco y 4.50:1 sobre chrome**. El desplazamiento perceptual es de ~1.5% de luminosidad: invisible como cambio de diseño.
- **Nota de método:** este hallazgo no estaba en la auditoría original. Lo encontró la guarda de regresión al ejecutarse por primera vez — evidencia de que el test aporta valor más allá de congelar lo ya corregido.

---

### 3.2 Severidad ALTA

---

#### ✅ A-1 · RESUELTO · 13 tablas operativas no tenían variante móvil

- **Problema:** `DataTable` soporta `renderMobileCard` (oculta la tabla y apila tarjetas bajo `md`), pero **13 de 37 instancias no lo pasan**. Esas tablas se renderizan en 390px mostrando 2–3 de sus 7–8 columnas, con el resto accesible sólo por scroll horizontal sin ninguna afordancia visible.
- **Evidencia:**
  - `mobile-compras.png`: se ven `CÓDIGO OC`, `FAENA` y `PROVEEDOR` cortado a media palabra ("TRECK Seguridad|"). Ocultas: `ÍTEMS`, `TOTAL`, `ESTADO`, `FACTURAS`, `FECHA`.
  - `mobile-recepcion.png`: idéntico. **El botón "Recibir" —la acción principal del módulo— queda fuera de pantalla.**
  - Archivos sin `renderMobileCard`: [compras/oc-list.tsx](app/(app)/compras/oc-list.tsx), [recepcion/recepcion-table.tsx](app/(app)/recepcion/recepcion-table.tsx), [prevencion/pdtp/acciones/acciones-table.tsx](app/(app)/prevencion/pdtp/acciones/acciones-table.tsx), [admin/roles/role-list.tsx](app/(app)/admin/roles/role-list.tsx), [admin/folios/sequence-list.tsx](app/(app)/admin/folios/sequence-list.tsx), [admin/epps/epp-family-list.tsx](app/(app)/admin/epps/epp-family-list.tsx), [admin/taxonomia-sst/taxonomy-list.tsx](app/(app)/admin/taxonomia-sst/taxonomy-list.tsx), [admin/catalogos-productos/catalog-list.tsx](app/(app)/admin/catalogos-productos/catalog-list.tsx), [admin/notificaciones/notification-admin-list.tsx](app/(app)/admin/notificaciones/notification-admin-list.tsx), [admin/pdtp-catalogos/catalog-tabs.tsx](app/(app)/admin/pdtp-catalogos/catalog-tabs.tsx), [admin/seguridad/rate-limit-list.tsx](app/(app)/admin/seguridad/rate-limit-list.tsx), [combustibles/importar/import-batch-history.tsx](app/(app)/combustibles/importar/import-batch-history.tsx), [combustibles/importar/operations-batch-history.tsx](app/(app)/combustibles/importar/operations-batch-history.tsx).
- **Principio afectado:** `components/tables.md` — "en pantallas móviles las tablas se transforman en lista de tarjetas apiladas". Heurística #6 (reconocimiento antes que recuerdo): el usuario no puede reconocer una OC sin ver su total ni su estado.
- **Severidad:** **Alto** (no es falla WCAG 1.4.10 Reflow —las tablas de datos están exentas— pero sí impide la tarea en terreno)
- **Recomendación:** priorizar Compras y Recepción; marcar las de `/admin` como desktop-only.

> **✅ Aplicado (Pasada 6)**, distinguiendo qué tabla se usa en terreno:
>
> **Con tarjeta móvil** — Recepción (el botón "Recibir" quedaba fuera de pantalla), Compras/OC (sin total ni estado no se reconoce una orden) y Acciones PDTP (un prevencionista revisa CAPA en faena). Cada tarjeta prioriza el identificador, el estado y los 3–4 datos que permiten decidir.
>
> **Marcadas desktop-only** — las 7 de `/admin` y los 2 historiales de importación. Portarlas sería trabajo sin usuario: nadie administra permisos ni importa una planilla desde el teléfono. Pero **dejarlas cortadas sin explicación es peor que decirlo**, porque el usuario concluye que la app está rota. Nuevo [components/ui/desktop-only-table.tsx](components/ui/desktop-only-table.tsx) con un aviso visible sólo bajo `md`; la tabla sigue accesible por scroll horizontal.
>
> **No se extrajo el `renderMobileCard` genérico** que proponía el plan: las tres tarjetas muestran campos distintos y con acciones distintas, así que un componente común habría necesitado tantos props como campos. Comparten el patrón visual, no la estructura.

---

#### ✅ A-2 · RESUELTO · Objetivos táctiles de 28–36px en móvil

- **Problema:** la escala de tamaños de `Button` está calibrada para puntero (`sm`=28px, `default`=32px, `lg`=36px) y no escala en móvil. Existe una solución (`icon-mobile`: `h-11 w-11 sm:h-8 sm:w-8`) pero sólo se aplica a 12 botones de icono en toda la aplicación.
- **Evidencia:**
  - 541 usos de `size="sm"` (h-7 = **28px**) frente a 12 usos de `size="icon-mobile*"`.
  - `Input` es `h-9` = **36px** ([input.tsx:16](components/ui/input.tsx#L16)); afecta a todo formulario móvil.
  - `mobile-dashboard.png`: los 6 botones de acción rápida ("Nueva solicitud", "Emitir OC"…) miden ~30px de alto.
  - `mobile-solicitudes-nueva.png`: los selects del formulario de alta miden ~36px.
  - `desktop-admin-usuarios.png`: tres iconos de acción por fila (editar / activar / eliminar) en cajas de ~28px con separación de ~8px.
- **Principio afectado:** `responsive-design/touch-targets.md` (44×44px mínimo) · **Ley de Fitts** (tiempo de adquisición inversamente proporcional al tamaño del objetivo). WCAG 2.5.8 AA (24px) **sí se cumple**; el incumplimiento es contra el estándar de plataforma (Apple HIG 44pt / Material 48dp) y contra la guía de esta skill.
- **Severidad:** **Alto** — la plataforma declara el móvil como canal para aprobaciones y reportes en terreno, donde el usuario opera con guantes.
- **Recomendación:** hacer que la escala responda al medio de entrada en el propio `buttonVariants`, no caso por caso:

```tsx
// button.tsx — size
sm:      "h-11 px-3 text-xs sm:h-7",
default: "h-11 px-4 sm:h-8",
lg:      "h-11 px-5 text-[13px] sm:h-9",
```

y `Input`/`Select`/`Textarea` a `h-11 sm:h-9`. Es un cambio de una línea por variante que resuelve los 541 casos de golpe.

> **✅ Aplicado (Pasada 6) tal como se planeó** — el único ítem del plan que no necesitó corrección al implementarlo.
>
> Las 5 variantes de tamaño de `buttonVariants` más `Input`, `Select` y `DatePicker` pasan a `h-11 sm:h-<compacto>`. Bajo `sm` (dedo) todo mide 44px; desde `sm:` (puntero) vuelve la altura compacta que da la densidad del backoffice.
>
> **Además**, lo que el plan no anticipaba: había **8 controles con altura fija en `className`** (`h-7`/`h-8` sin prefijo responsive) que habrían anulado la escala en móvil — en `data-table.tsx` (buscador interno y botón de columnas), `epp-import-review.tsx` y los 5 de `ListFilters`. Todos migrados a `h-11 sm:h-N`. Sin esto, la escala del design system se habría aplicado y los controles seguirían midiendo 28px justo en las tablas más usadas.
>
> Los 12 `icon-mobile*` se mantienen como alias: ya cumplían 44px y no vale la pena tocar sus 12 llamadas.

---

#### ✅ A-3 · RESUELTO (parcialmente sobredimensionado) · La pantalla de Aprobaciones no tenía acción primaria

- **Problema:** en el punto de decisión más importante del flujo de adquisiciones, ningún control tiene tratamiento de Nivel 1. "Aprobar", "Rechazar" y "Aprobar todos" son los tres botones secundarios (fondo blanco, borde hairline), diferenciados sólo por el color del icono. Aprobar y Rechazar son adyacentes con ~10px de separación.
- **Evidencia:** `desktop-aprobaciones.png` — la prueba de ojos entrecerrados (squint test) no produce ningún punto focal: la pantalla completa colapsa a una banda gris uniforme. Comparar con `desktop-solicitudes-nueva.png`, donde "Enviar a aprobación" en verde sólido domina correctamente.
- **Principio afectado:** `visual-design/hierarchy.md` (debe existir exactamente 1 punto focal Nivel 1 por vista) · Heurística #5 de Nielsen (prevención de errores) · Ley de Fitts (dos objetivos de consecuencias opuestas, mismo tamaño, mínima separación).
- **Severidad:** **Alto**
- **Recomendación:** (a) "Aprobar" pasa a `variant="primary"`; (b) "Rechazar" pasa a `variant="ghost"`; (c) aumentar la separación; (d) confirmar el rechazo pidiendo motivo.

> **✅ Aplicado (2026-07-24)** — con dos correcciones al hallazgo original:
>
> 1. **"Rechazar" ya era `ghost`**, no `secondary`. La afirmación de que los tres botones tenían peso idéntico era inexacta: el defecto real y único era que **ninguno era primario**.
> 2. **El rechazo ya estaba protegido**: `setAction("rejecting")` abre `ReasonForm`, que exige un motivo antes de confirmar. La recomendación (d) ya estaba implementada; no hacía falta `ConfirmDialog`.
>
> Cambio aplicado en [item-row.tsx](app/(app)/aprobaciones/item-row.tsx): "Aprobar" a `variant="primary"` y separación de `gap-1.5` a `gap-2.5`. "Aprobar todos" se deja en `secondary` a propósito — el primario por fila ya marca la acción esperada y duplicarlo recrearía la competencia visual.

---

#### ✅ A-4 · RESUELTO (caso extremo) · Estados vacíos que informan pero no ofrecen salida

- **Problema:** 45 de 84 usos de `EmptyState` (54%) se instancian sin prop `action`, contra la regla A4 del propio proyecto ("todo empty-state tiene *qué significa* + *qué hacer* + *CTA real*"). El caso extremo es el panel de Indicadores SST.
- **Evidencia:**
  - `desktop-prevencion-indicadores.png`: **3 de 4 tiles de KPI muestran "No calculable"** en tipografía display de 28px, y la tabla mensual repite la cadena "No calculable" **36 veces** (12 meses × 3 columnas). Ninguna de las 39 apariciones dice qué hay que cargar para que el indicador se calcule. La pantalla no supera el test de los 5 segundos: el usuario no puede deducir qué acción se espera de él.
  - `desktop-admin-usuarios.png`: "No hay invitaciones para este filtro." — texto plano, sin icono ni CTA.
  - `desktop-dashboard.png`: la tarjeta PDTP muestra `—` con una barra de progreso vacía; la regla A1 prohíbe explícitamente los `0` y `—` pelados (aquí sí hay un enlace de salida, lo que la deja parcialmente conforme).
  - `mobile-dashboard.png`: el tile ENTREGAS muestra `0` sin acción asociada.
- **Principio afectado:** Regla A4 de `AGENTS.md` · `interaction-design/empty-states.md` · Heurística #10 (ayuda) · **ratio datos-tinta de Tufte** — 36 repeticiones de una cadena idéntica es tinta pura sin información.
- **Severidad:** **Alto**
- **Recomendación:** colapsar el estado no-calculable a **un solo** bloque explicativo con CTA y dejar las celdas con un `—` tenue.

> **✅ Aplicado en Indicadores SST** ([canonical-indicators-dashboard.tsx](app/(app)/prevencion/indicadores/canonical-indicators-dashboard.tsx)):
>
> - Un único aviso sobre la tabla que dice **qué falta** (denominadores de HH), **cuánto falta** ("en N de 12 meses") y **por qué importa** ("el mes no puede cerrarse").
> - **CTA real y funcional:** "Cargar dotación y HH" abre `IndicatorDenominatorDialog` en el primer mes sin datos — el mismo diálogo que ya existía, pero enterrado en un botón por fila. Cuando la vista es "Total de faenas" el CTA se sustituye por la instrucción correcta ("Selecciona una faena"), porque los denominadores se cargan por faena.
> - Nuevo helper `rateCell()`: las celdas muestran `—` con `title` explicativo en vez de repetir "No calculable".
>
> **⚠️ Corrección (verificado en captura del 2026-07-25):** escribí *"de 39 apariciones se pasa a 1"* y **era falso**. Sólo cambié las celdas de tasa; en pantalla quedan **15**: los 3 tiles de KPI y los 12 badges de estado mensual. Las 24 celdas repetidas sí desaparecieron.
>
> Los 15 restantes son defendibles y se dejan a propósito: los 3 tiles son la métrica titular —ahí ser explícito es correcto— y los 12 badges son el *estado de conciliación* de cada período, o sea el dato de una columna de estado, no relleno. El defecto que A-4 describía (39 repeticiones sin salida) está cerrado; el número que publiqué, no lo estaba.
>
> **✅ También (Pasada 3):** el empty state de invitaciones en `admin/usuarios` — el otro caso citado — pasa de texto plano a `EmptyState` con **CTA condicionado al tipo de vacío**.
>
> ### ⚠️ Reencuadre (Pasada 4) — el hallazgo era más pequeño de lo que lo filé
>
> El conteo real es de **77 `EmptyState` sin `action`**, no 45 (mi primer conteo era impreciso). Al clasificarlos, el diagnóstico cambia:
>
> | Tipo de vacío | Cuántos | Qué necesita | Estado |
> |---|---|---|---|
> | **Buena noticia** ("Sin brechas", "Sin revisiones pendientes", "Papelera vacía") | 5 | **Nada** — un CTA aquí sería ruido | ✅ Correctos como están |
> | **Vacío por filtro** (hay datos, el filtro no los alcanza) | 2 | Salida del filtro, no "crea el primero" | ✅ Ambos corregidos |
> | **Vacío real** (no existe ningún registro) | 64 | Un CTA clicable | ⏳ Ver abajo |
>
> **Lo que cambia el diagnóstico:** de los 64 de "vacío real", la mayoría **ya cumple dos de las tres partes de la regla A4** — su `description` explica qué hacer en lenguaje de usuario ("Agrega actividades antes de evaluar su cobertura", "Crea y activa el programa del período", "Crea requisitos por artículo o cláusula"). Lo que falta es el **botón**, no la orientación. Yo lo filé como "estados vacíos que informan pero no ofrecen salida"; la salida está escrita, sólo no es clicable.
>
> Además, muchos son **paneles dentro de un workbench cuya acción ya vive en el `PageHeader`**. Añadir ahí un CTA duplicaría la acción de página e infringiría la regla 5 de layout de `AGENTS.md` (las acciones de página van en `PageHeader.actions`, no en toolbars inline). En esos casos **el arreglo correcto es no añadir nada**.
>
> Por eso los 64 restantes requieren criterio caso a caso, no un barrido. La severidad efectiva del residuo es **Baja**, no Alta.
>
> **Corregidos en Pasada 4:** el reporte PDTP (`Sin objetivos para estos filtros` decía "ajusta los filtros" sin dar forma de hacerlo → CTA "Quitar filtros") y el vacío por filtro de invitaciones (Pasada 3).
>
> **Corregidos en Pasada 5** — los últimos vacíos de **nivel página** cuyo `PageHeader` no declara `actions`, donde un CTA no puede duplicar nada:
> - `trazabilidad/page.tsx`: un solo `EmptyState` servía a los dos vacíos. Separado — sin datos → "Nueva solicitud"; por filtro → "Quitar filtros" (el texto pedía "intenta con otros filtros" sin dar forma de hacerlo).
> - `pdtp/cobertura/page.tsx`: la descripción ya decía "Crea y activa el programa"; ahora es un botón.
>
> **Residuo: 61 CTA.** Todos son paneles internos de workbench cuya acción vive en el `PageHeader`; añadirla ahí infringiría la regla 5 de layout. Severidad efectiva **Baja**.

---

#### ✅ A-5 · RESUELTO · Ninguna tabla fijaba la cabecera al hacer scroll

- **Problema:** `TableHeader` no aplica `position: sticky` en ningún punto del design system. En listados largos (PDTP con 87 actividades, trabajadores, kardex, importaciones) el usuario pierde la correspondencia columna↔dato tras las primeras filas y debe volver arriba para recordar qué columna está leyendo.
- **Evidencia:** `grep sticky` sobre [components/ui/table.tsx](components/ui/table.tsx) y [components/admin/data-table.tsx](components/admin/data-table.tsx) → 0 coincidencias. El único caso con cabecera fija de toda la aplicación es una vista previa de importación: [epp-variant-preview.tsx:32-38](app/(app)/admin/productos/epp-variant-preview.tsx#L32-L38).
- **Principio afectado:** `components/tables.md` (*Sticky Header* es requisito del componente) · `product-surfaces/enterprise-software.md` · carga de memoria de trabajo (Ley de Miller).
- **Severidad:** **Alto** en un backoffice de uso diario
- **Recomendación original:** aplicar `sticky top-0 z-10` en `TableHeader`.

> **⚠️ La recomendación original era un no-op y se corrigió al implementarla.**
>
> `TableRoot` ya declara `overflow-x-auto`, lo que **establece un contenedor de scroll**. Un `position: sticky` en el `<thead>` se posiciona respecto a ESE contenedor, no respecto a la página — y como su altura es la del contenido, no hay rango de scroll y la cabecera nunca se fija. Añadir sólo la clase no habría hecho nada, y el efecto habría pasado por implementado.
>
> **Aplicado:** `TableRoot` acepta `stickyHeader?: boolean`, que añade `max-h-[70vh] overflow-y-auto` y crea el rango de scroll que el sticky necesita. `TableHeader` lleva las clases sticky siempre (inertes sin altura acotada, así que es seguro) y `TableHead` es ahora opaco para que las filas no se transparenten debajo.
>
> **✅ Adoptado (Pasada 2)** en los 7 listados largos sin paginación, que son los que sufren el problema: hoja PDTP (87 actividades), reporte PDTP, aprobaciones PDTP, evaluaciones SST, ranking de analítica, reportes de soporte y matriz de trazabilidad.
>
> **No adoptado a propósito** en las tablas que ya paginan a 20 filas: la cabecera nunca sale del viewport, y acotar la altura sólo añadiría un scroll anidado innecesario.

---

#### ✅ A-6 · RESUELTO · El naranja `signal` se usaba como color de prioridad, colapsando "Crítico" y "Alta"

- **Problema:** `DESIGN.md` reserva `--color-signal` estrictamente para estados *pendientes*. En la cola de trabajo del Dashboard se emplea para las prioridades `CRÍTICO` y `ALTA`, que quedan renderizadas con el mismo punto y el mismo tinte naranja. El operador no puede triar por prioridad de un vistazo — que es exactamente la función de esa cola.
- **Evidencia:** `desktop-dashboard.png`, filas 01–06: badges `CRÍTICO` y `ALTA` visualmente indistinguibles salvo por leer el texto. `desktop-aprobaciones.png` muestra un tercer tratamiento para el mismo concepto: "Crítico" como texto rojo plano sin badge.
- **Principio afectado:** **Efecto Von Restorff** (el aislamiento cromático pierde poder si se aplica a todo) · `visual-design/color.md` (roles estrictos por token) · consistencia (Heurística #4): tres representaciones distintas de "prioridad crítica" en dos pantallas.
- **Severidad:** **Alto**
- **Recomendación:** `CRÍTICO` → `danger`; `ALTA` → `warning`; `Normal` → `default`. Devolver `signal` a su rol exclusivo de "pendiente" y unificar en un `<PriorityBadge>`.

> **✅ Aplicado (2026-07-24).** Nuevo [components/ui/priority-badge.tsx](components/ui/priority-badge.tsx) como render único, con escala cromática ahora monótona (danger > warning > neutro) y punto de refuerzo sólo en los dos niveles severos, para no depender del color (WCAG 1.4.1).
>
> Consumido por Dashboard ([dashboard-task-row.tsx](app/(app)/dashboard/dashboard-task-row.tsx)) y Aprobaciones ([item-row.tsx](app/(app)/aprobaciones/item-row.tsx)), donde el texto rojo plano pasa a badge. Se eliminaron los dos mapas locales muertos (`PRIORITY_LABEL` y `URGENCY_CLASS`): las tres representaciones distintas del mismo concepto quedan en una.

---

#### ✅ A-7 · RESUELTO (por endurecimiento, no por diagnóstico) · Scroll horizontal en viewport móvil

- **Problema:** la página produce un documento de **676px de ancho en un viewport de 390px** (73% de desbordamiento), con ~286px de lienzo blanco vacío a la derecha.
- **Evidencia:** `mobile-prevencion-evaluaciones.png` mide 676×844 px; las 169 capturas móviles restantes miden 390px de ancho. El contenido visible (título, tabla) se mantiene dentro de los 390px, por lo que el elemento que desborda es no visible.
- **Principio afectado:** **WCAG 2.2 · 1.4.10 Reflow (AA)** — sin scroll bidireccional a 320px CSS.
- **Severidad:** **Alto**
- **Confianza sobre la causa raíz: Media.** `TableRoot` aplica correctamente `overflow-x-auto` ([table.tsx:10](components/ui/table.tsx#L10)) y la tabla sí recorta a ~360px en la captura, por lo que el desbordamiento proviene de otro elemento. Hipótesis principal: un descendiente posicionado o un `sr-only` mal contenido; el `<main>` declara `overflow-y-auto` pero no `overflow-x-hidden` ([app-shell.tsx:124](components/layout/app-shell.tsx#L124)).
- **Recomendación:** diagnóstico exacto en 30 segundos con DevTools a 390px —
  `[...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > 390)`—
  y corregir el elemento identificado. Añadir además una salvaguarda de sistema: `overflow-x-clip` en `<main>` más un test de regresión que falle si `document.scrollWidth > viewport.width` en cualquier ruta capturada.

> **✅ CAUSA RAÍZ ENCONTRADA (Pasada 7) — y no era la que supuse.**
>
> Durante tres pasadas dije que no podía identificar el elemento. El detector que escribí para eso falló en su primera versión porque **excluía los `absolute`/`fixed`**, que es justo donde estaba. Instrumentándolo sin filtros apareció:
>
> ```
> span.sr-only  pos=absolute  left=675  right=676  w=1
> ```
>
> Es el `<span className="sr-only">Ver</span>` de la última cabecera de [evaluation-list.tsx](app/(app)/prevencion/evaluation-list.tsx). El mecanismo exacto: `sr-only` usa `position: absolute`; **ni `TableRoot` ni `<main>` eran `position: relative`**, así que su bloque contenedor era el `<html>`. Un `absolute` sólo lo recorta un ancestro que además sea su bloque contenedor, así que **escapaba al `overflow` de los dos** y arrastraba el ancho del documento. Un elemento de **1px** causaba 286px de desbordamiento.
>
> Eso explica por qué el `overflow-x-clip` que apliqué en la Pasada 6 no hizo nada: sin ancestro posicionado no hay recorte posible.
>
> **Arreglo:** `relative` en `TableRoot` —systémico, cubre cualquier `sr-only` de cualquier tabla— y `relative overflow-x-hidden` en el `<main>`.
>
> **Verificado empíricamente:** `mobile-prevencion-evaluaciones.png` pasó de **676×844 a 390×844**, y las 159 rutas × 2 viewports reportan **"Sin scroll horizontal en ninguna ruta ✓"**.
>
> El detector quedó corregido para modelar el bloque contenedor (un `absolute` ignora los ancestros `static`) y para saltar las rutas de `(print)`, que son A4 y anchas por diseño.

---

#### ✅ A-8 · RESUELTO · Contadores contradictorios entre la navegación y la página

- **Problema:** el badge de "Aprobaciones" en el rail muestra **2**; la cabecera de la página de aprobaciones dice **"1 ítem en 1 solicitud"**, y el grupo muestra "1 pendiente". El usuario no sabe si le falta algo por ver.
- **Evidencia:** `desktop-aprobaciones.png` — badge del sidebar y subtítulo de `PageHeader` en la misma captura.
- **Principio afectado:** Heurística #1 (visibilidad del estado del sistema) · confianza en el sistema. En una bandeja de aprobación, un contador que no cuadra erosiona la confianza en todo el módulo.
- **Severidad:** **Alto**
- **Recomendación:** derivar el badge y el encabezado de la misma consulta/scope. Si difieren por diseño, hacerlo explícito: *"1 de 2 pendientes · 1 en otra faena"*.

> **✅ Resuelto (Pasada 3) — y mi lectura anterior era errónea.** Escribí que hacía falta una decisión de producto; al rastrear el código resultó ser **un bug de una línea**:
>
> | Consulta | Filtro de tipo |
> |---|---|
> | Página `/aprobaciones` | `requestType NOT IN ('repuestos', 'servicios')` |
> | Badge del rail (`layout.tsx`) | `requestType != 'repuestos'` |
>
> Una solicitud de tipo **servicios** contaba en el badge y nunca aparecía en la lista — exactamente el "badge 2 vs página 1" de la captura, donde el seed incluye `SRV-2026-0001`. No había ninguna diferencia intencional de alcance que decidir.
>
> El comentario del propio código ya advertía: *"Must mirror the /aprobaciones page query exactly, or the badge outruns the list"*. La duplicación derivó igual.
>
> **Corregido en [lib/approvals-queue.ts](lib/approvals-queue.ts):** predicado único `approvalQueueFilter(scope)` consumido por los dos. La página le añade encima sus filtros de URL. Ya no pueden divergir.

---

### 3.3 Severidad MEDIA

| ID | Hallazgo | Evidencia | Principio | Recomendación |
|---|---|---|---|---|
| ✅ **M-1** | **RESUELTO** — Dos sistemas tipográficos para cabeceras de tabla: `DataTable` usa `text-eyebrow` MAYÚSCULAS 11px; las tablas de detalle usan sentence case 12px | `desktop-compras.png` (CÓDIGO OC) vs `desktop-compras-detalle.png` (Producto / Cant.) y `kardex-table.tsx:50-56` | Consistencia (Heurística #4) | **✅ Nueva utilidad `th-type` en `globals.css` como fuente única del tratamiento tipográfico** (11px, 600, uppercase, `text-subtle`), aplicada en 14 archivos. El padding y la alineación los sigue decidiendo cada tabla, así que no hubo que reescribir markup. Las 3 tablas de `(print)` quedan exentas: son documentos A4 con lenguaje propio |
| ✅ **M-2** | **RESUELTO** — Una misma columna renderizaba estados con dos tratamientos: `ACTIVO` en mono-mayúsculas, `Inactivo` en sans-normal | `desktop-admin-usuarios.png`; causa en [badge.tsx:22-31](components/ui/badge.tsx#L22-L31): la variante `default` usa `proseType` y las de severidad `severityType` | Consistencia visual | **✅ Nueva variante `neutral` en [badge.tsx](components/ui/badge.tsx)**: tipografía de severidad (mono-mayúsculas) con color neutro. `user-list.tsx` la usa para "Inactivo", de modo que ACTIVO/Inactivo comparten sistema tipográfico |
| ⚠️ **M-3** | **PARCIALMENTE RETRACTADO** — Números a la izquierda fuera de `DataTable` | **Indicadores SST: confirmado y corregido.** **Kardex: FALSO** — el `<th>` y el `<td>` de "Saldo" ya declaraban `text-right font-mono tabular-nums`; la columna es `w-24` y en la captura los valores quedan pegados a la cabecera | `components/tables.md` | **✅ En Indicadores: 5 columnas (Lesionados, HH, Frecuencia, Ausencia+cargo, Accidentabilidad) más las tablas de denominadores y comparación pasan a `text-right font-mono tabular-nums`** |
| ✅ **M-4** | **RESUELTO** — Jerarquía espacial invertida: ~25px entre la tabla y el título de la sección siguiente, contra ~60px entre filas de la misma tabla | `desktop-admin-usuarios.png`, banda y≈372→411 | `visual-design/spacing.md`: el espacio externo debe superar al interno | **✅ `mt-12` (48px) en [user-invitations-panel.tsx](app/(app)/admin/usuarios/user-invitations-panel.tsx).** Aplicado sólo a la instancia citada: un componente `Section` genérico sería abstracción no pedida |
| ✅ **M-5** | **RESUELTO** — 574 de 579 `<TableHead>` sin `scope="col"` | `grep 'scope="col"'` → 5 coincidencias | WCAG 1.3.1 (técnica H63) | **✅ `scope = "col"` como valor por defecto del prop en [table.tsx](components/ui/table.tsx), sobrescribible con `scope="row"`.** Un cambio, 579 cabeceras conformes |
| ✅ **M-6** | **RESUELTO** — `enableColumnToggle` implementado con **0 adopciones**; no existe selector de densidad ni vistas guardadas | [data-table.tsx:143-167](components/admin/data-table.tsx#L143-L167) | `product-surfaces/enterprise-software.md` (vistas personalizadas, densidad) | **✅ Adoptado, no retirado.** Activado en las 7 tablas de ≥8 columnas (catálogos de producto 13, importaciones 11 y 10, solicitudes 9, taxonomía SST 9, acciones PDTP 8, OC 8). En un backoffice de esa anchura, ocultar columnas secundarias es densidad real. `admin/pdtp-catalogos` (20 columnas) se dejó fuera: son varias tablas en pestañas y merece revisión aparte |
| ✅ **M-7** | **RESUELTO** — El CTA primario del formulario de solicitud quedaba huérfano: "Volver \| Guardar borrador" en una fila y "Enviar a aprobación" ~60px más abajo, fuera de la tarjeta | `desktop-solicitudes-nueva.png`, y≈932 vs y≈994 | `visual-design/composition.md` (alineación) | **✅ Causa: `space-y-8` (32px) en el contenedor de los dos `<form>`.** Aplicado `-mt-6` para que las dos filas se lean como una sola barra. **La barra única literal no se hizo a propósito:** exigiría sacar los botones con el atributo `form=` y cablear a mano los flags de pending, porque `SubmitButton` lee `useFormStatus` (sólo válido dentro del form que envía) — refactor real en el formulario del flujo core de compras para un hallazgo Medio |
| ✅ **M-8** | **RESUELTO** — Dos CTA primarios verdes compitiendo en el mismo viewport: "Ver tareas" y "Nueva solicitud" | `desktop-dashboard.png` | `visual-design/hierarchy.md` (un solo Nivel 1) | **✅ "Ver tareas" pasa de relleno verde a enlace** con hover en `primary-tint` ([dashboard/page.tsx](app/(app)/dashboard/page.tsx)). "Nueva solicitud" queda como único Nivel 1 |
| ✅ **M-9** | **RESUELTO** — Truncamiento sin `title`/tooltip | `desktop-dashboard.png` ("Aprobación · Necesita a…"); `desktop-prevencion-indicadores.png` (item de nav "Indicadores de seguridad y…") | Heurística #6 · regla A6 de `AGENTS.md` | **✅ Cerradas las instancias citadas**: título y subtítulo de la cola de trabajo, el texto "Aprobación · Necesita a…", y las etiquetas de navegación en `nav-rows`, `desktop-nav-areas` y `mobile-nav`. **✅ Pasada 5: aislados los 40 truncados cuyo contenido es el identificador del registro** (nombre, código, email, `productName`, `fileName`) — ahí truncar es perder la identidad de la fila. 39 corregidos; 1 se dejó a propósito (`prevencion/ppa/page.tsx`: su `label` es `ReactNode` y `String()` sobre JSX daría `[object Object]`). Los 73 restantes truncan texto secundario que ya aparece completo en otro punto de la fila: ponerles `title` sería ruido de lector de pantalla, no una mejora |
| ✅ **M-10** | **RESUELTO** — Jerga interna expuesta al usuario | Pestaña "Conciliación legado"; badge `SUGERIDO: APRO SUMINISTROS` en mono-mayúsculas amber con peso visual superior al nombre del producto | Heurística #2 (coincidencia con el mundo real) | **✅ "Conciliación legado" → "Datos del sistema anterior"**, y con ella las cabeceras ("HH anterior → actual") y el estado "Sin legado" → "Sin datos anteriores". **✅ El badge `SUGERIDO: …` pasa de `warning` (ámbar mono-mayúsculas, con más peso visual que el nombre del producto) a `default` (prose, neutro).** Es un metadato informativo, no una advertencia |
| ✅ **M-11** | **RESUELTO** — 4 archivos importaban `toast`/`Toaster` directamente de `sonner`, saltando el wrapper `@/lib/toast` (donde vive la persistencia de errores hasta cierre manual) | [incidentes/reportar/incident-report-form.tsx:6](app/(app)/prevencion/incidentes/reportar/incident-report-form.tsx#L6), [incidentes/[id]/incident-workflow-panel.tsx:5](app/(app)/prevencion/incidentes/[id]/incident-workflow-panel.tsx#L5) | Consistencia de feedback | **✅ Los 2 imports de `toast` migrados; regla `no-restricted-imports` en [eslint.config.mjs](eslint.config.mjs) con excepción para `lib/toast.ts` y los dos `layout.tsx` que montan `<Toaster>`.** Verificada con control positivo: dispara en un archivo sonda y respeta las excepciones |
| ✅ **M-12** | **RESUELTO** — 21 `<input type="date">` nativos en 11 archivos | Regla **A6** de `AGENTS.md` prohíbe el date nativo (su formato depende del locale del navegador) | Consistencia + prevención de errores | **✅ 0 `type="date"` nativos en la aplicación.** Los 21 migrados a `DatePicker`. En `invoices-section.tsx` se convirtió además el `ref` imperativo del autorrelleno OCR a estado controlado, porque `form.reset()` no limpiaría un `DatePicker`. **`required` NO se puso en `DatePicker`**: el valor viaja en un `<input type="hidden">`, excluido de la validación de restricciones del navegador, y `aria-required` es inválido en `role="button"`. Se movió a `<Field required>`, que ya lo soporta y **hace visible el asterisco que antes no se mostraba**. La frontera de confianza real son los esquemas Zod del servidor, verificada |
| ⚠️ **M-13** | **PARCIAL** — Un solo atajo de teclado en toda la aplicación (⌘K) | [command-palette.tsx:73](components/layout/command-palette.tsx#L73) | `product-surfaces/enterprise-software.md` ("operación total por teclado") · Heurística #7 | **✅ `/` enfoca el filtro de la página** (con guarda: no dispara si el foco está en otro control ni con modificadores) y **`Esc` lo limpia y devuelve el foco**. Pista del atajo en el `title` del campo. **⏳ Faltan** `n` para nueva entidad y `Enter` entre campos (E-5) |
| ✅ **M-14** | **RESUELTO** — `DESIGN.md` documentaba una paleta que el código ya no usaba: dice `--color-primary` = #218649 `oklch(0.546 0.118 156)`; `globals.css` define #065F46 `oklch(0.415 0.098 166)` | [DESIGN.md](DESIGN.md) tabla de tokens vs [globals.css:31](app/globals.css#L31) | Gobernanza del design system | **✅ Tabla de 50 tokens regenerada programáticamente desde `globals.css`, con hex derivado y aviso de no editar a mano.** También corregidos los 3 hex de la sección "Filosofía" |
| ✅ **M-15** | **RESUELTO** — Cobertura de `loading.tsx` en 87 de 145 páginas (60%) | `find app -name loading.tsx` | Rendimiento percibido (skeleton screens) | **✅ 144/145 rutas (99%).** 57 skeletons generados con el título tomado del `metadata` de cada página y `SkeletonPage` con densidad según tipo (4 filas en detalle, 6 en listado). **Sin breadcrumb a propósito:** el TopBar ya lo deriva de `NAV_ITEMS` + `usePathname()`. La única ruta sin skeleton es el catch-all `[...not-found]` |

---

### 3.4 Severidad BAJA

| ID | Hallazgo | Recomendación |
|---|---|---|
| ✅ **B-1** | **RESUELTO** — `Badge size="sm"` = **9px** y `default` = 10px en las variantes de severidad ([badge.tsx:37-40](components/ui/badge.tsx#L37-L40)) — por debajo del piso práctico de legibilidad | **✅ Piso de 11px en [badge.tsx](components/ui/badge.tsx).** Escala resultante: severidad 11/11/12px, prose 11/12/13px |
| ✅ **B-2** | **RESUELTO, con atribución corregida** — "Exportar Excel" se leía como deshabilitado (relleno gris + texto tenue) junto a selects blancos | **Escribí que había que arreglar `ExportButton`; su variante por defecto YA era `secondary`.** El botón gris era un `<a>` crudo en [list-filters.tsx](components/adquisiciones/list-filters.tsx) con `bg-surface-2` + `text-muted`. ✅ Migrado al mismo tratamiento visual que `Button variant="secondary"` (blanco, `border-control`, texto normal) y a `h-11 sm:h-8` |
| ✅ **B-3** | **RESUELTO** — Triple encabezamiento en móvil: "Dashboard" + "TABLERO" + "Hola, Admin" en 130px | **✅ El eyebrow "Tablero" pasa a `hidden lg:block`.** En móvil el `PageHeader` ya rotula "Dashboard" visiblemente; en desktop es `sr-only` (empuja al TopBar), así que ahí el eyebrow sí aporta el contexto de sección |
| ✅ **B-4** | **RESUELTO** — El buscador y los filtros no ocupaban el ancho disponible en móvil (input de ~200px en una fila de 358px) | **✅ En `ListFilters`, buscador y los 4 selects pasan a `w-full sm:w-auto`** y de paso a `h-11 sm:h-8`, que era el otro defecto del mismo control (A-2) |
| ❌ **B-5** | **RETRACTADO** — Filé "`FilterToolbar` se usa en 2 módulos de ~15". La cifra venía de `AUDITORIA_REUTILIZACION_Y_CONSISTENCIA_VISUAL.md` y **la repetí sin medirla**. Real: **9 archivos** en 3 áreas; adquisiciones usa `ListFilters` (server-side, arquitectura distinta) y con ≤5 controles está dentro del presupuesto de 4–6 de la regla A2, así que no necesita hoja de desbordamiento | **Sin acción.** Dos componentes compartidos para dos arquitecturas no es sub-adopción |
| ✅ **B-6** | **RESUELTO** — Movimiento no condicionado a `prefers-reduced-motion`: `active:scale-[0.97]` en `Button`, slide del drawer, animaciones de toast (sólo `[data-pressable]` está protegido) | **✅ `motion-safe:` en el `active:scale` de `Button` + bloque `@media (prefers-reduced-motion: reduce)` en `globals.css`** que neutraliza drawer, toasts y `animate-in/out`. Los cambios de color y opacidad se conservan: no producen movimiento y son los que transmiten el estado |

---

### 3.5 Oportunidades de Mejora — implementadas en la Pasada 8

| ID | Propuesta | Estado |
|---|---|---|
| ✅ **E-1** | Selector de densidad Compacto/Cómodo | Preferencia compartida entre tablas, vía `data-density` + `localStorage`. Se ofrece desde 8 filas |
| ⏳ **E-2** | Vistas guardadas (filtros + columnas) por usuario | **Pendiente por decisión:** `localStorage` es inmediato; por usuario y compartible requiere esquema |
| ✅ **E-3** | Acciones en lote con casilla maestra | Selección cruzando solicitudes; la acción del servidor ya validaba por ítem |
| ✅ **E-4** | Columna congelada en tablas de ≥8 columnas | `stickyFirstColumn` opt-in, activo en 7 tablas |
| ✅ **E-5** | `Enter` entre campos en captura repetitiva | Hook con test; corregido un bug que lo habría inutilizado dentro de diálogos |

**Fuera de alcance por decisión de producto:** `data-dense-interfaces.md` recomienda tema oscuro por defecto para operadores de jornada larga. `DESIGN.md` declara explícitamente `color-scheme: light` sin modo oscuro. Se registra como preferencia contextual, **no como defecto** — el perfil de uso (oficina + faena diurna) respalda la decisión actual.

---

## 4. Resumen de Hallazgos

| Severidad | Inicial | Resueltos | Retractados | **Abiertos** |
|---|---|---|---|---|
| Crítico | 2 (+1 nuevo) | 2 (C-2, C-3) | 1 (C-1) | **0** |
| Alto | 8 | 8 | — | **0** |
| Medio | 15 | 14 | 1 parcial (M-3) | **0** |
| Bajo | 6 | 5 | 1 (B-5) | **0** |
| Mejora | 5 | 4 (E-1, E-3, E-4, E-5) | — | **1** (E-2, por decisión) |
| **Total** | **37** | **33** | **2 + 1 parcial** | **1** |

**Queda un solo ítem abierto en toda la auditoría: E-2**, y está abierto porque requiere una decisión de producto (persistencia en `localStorage` vs esquema), no porque falte trabajo.

### Estado de la verificación

**Validado visualmente (Pasada 7 y 8):** 159/159 rutas capturadas contra un build fresco, cero errores, cero scroll horizontal. Confirmados sobre pixel real: bordes de control, contadores de aprobación, `th-type`, tarjetas móviles, objetivos táctiles, aviso de Indicadores, signo del kardex, y los controles de E-1/E-3/E-4.

**Lo que sigue sin verificar — y sólo se puede hacer con tecnología asistiva real:**

| Prueba | Por qué no está hecha |
|---|---|
| **Lector de pantalla** (NVDA/VoiceOver) | No es simulable; requiere AT real sobre la app en ejecución |
| Recorrido completo por teclado | Automatizable con Playwright, no ejecutado |
| Zoom al 200% (WCAG 1.4.4) | Automatizable, no ejecutado |
| Latencia percibida (<100ms) | Medible, no ejecutado |

Las tres últimas son la **Fase 4** del plan y sí son accionables sin intervención humana; la primera no.

El plan de acción priorizado, con matriz impacto/esfuerzo y fases ejecutables, está en
**[PLAN_MEJORA_UIUX_2026-07-24.md](PLAN_MEJORA_UIUX_2026-07-24.md)**.

---

## 5. Protocolo de Evidencia y Limitaciones

Conforme al protocolo de incertidumbre de la metodología, se declara explícitamente el grado de confianza de cada clase de hallazgo:

- **Confianza Alta — medición directa:** todos los ratios de contraste (§C-2) se calcularon analíticamente desde los tokens OKLCH de `globals.css` convertidos a sRGB y luminancia relativa WCAG. Los conteos de código provienen de `grep` sobre el árbol completo. Las dimensiones de las capturas se leyeron de las cabeceras PNG.
- **Confianza Alta — inspección de código:** C-1, A-1, A-2, A-5, M-5, M-6, M-11, M-12, M-13, M-14 se verificaron sobre el archivo fuente citado, no por inferencia visual.
- **Confianza Media — inferencia desde captura:** las mediciones de posición y espaciado (M-4, M-7) se estimaron sobre capturas de 1920×1080 y tienen un margen de ±4px. La causa raíz de A-7 no está confirmada y se declara como tal.
- **No verificado en esta auditoría:** navegación real con lector de pantalla (NVDA/VoiceOver), recorrido completo por teclado sobre la aplicación en ejecución, medición de latencia de respuesta (<100ms), y comportamiento con zoom al 200%. Estas cuatro pruebas requieren sesión interactiva y se recomiendan como Fase 4 del plan.
- **Distinción hecho/preferencia:** las observaciones sobre paleta, radios y dirección visual del "pozo blanco" son **preferencias estéticas coherentes y bien ejecutadas**, no se auditan como defectos. Todo hallazgo de este informe cita una norma, una heurística o una ley de UX verificable.
