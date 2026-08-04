# PLAN FIX CREADOR DE CHECKLISTS PDTP — 2026-08-04

> Alcance: `app/(app)/prevencion/pdtp/[programId]/editar/checklist-builder.tsx` y
> `checklist-tab.tsx` (creador de plantillas de checklist por actividad del PDTP).
> Cubre los 12 hallazgos de la revisión UI/UX realizada el 2026-08-04.
> No modifica el flujo de llenado ni el servicio `lib/services/pdtp/checklists.ts`
> (semántica de versiones intacta — ver §Riesgos).

---

## 1. Hallazgos cubiertos

| # | Severidad | Hallazgo | Fix |
|---|-----------|----------|-----|
| F1 | 🔴 Alto | El editor visual es inaccesible al **crear** un checklist nuevo (solo se renderiza si `parsedDefinition` existe; sin plantilla el usuario ve JSON a mano) | Esqueleto inicial + editor visual como vista por defecto |
| F2 | 🔴 Alto | Borrar sección/ítem sin confirmación ni undo | `ConfirmDialog` (componente existente) |
| F3 | 🔴 Alto | Sin indicador de cambios sin guardar (guardado manual; navegar/recargar pierde todo) | Badge "Cambios sin guardar" + `beforeunload` |
| F4 | 🟠 Medio | El builder visual no edita metadata clave (`title`, `frequencySuggested`, `closingAct`, `legalFramework`, `tipo`) | Panel "Configuración" en el editor visual |
| F5 | 🟠 Medio | Roles mostrados en slug crudo (`prevencionista_faena`, …) — viola regla A6 | Labels en español |
| F6 | 🟠 Medio | Sin preview de cómo se verá al llenarlo | Toggle "Vista previa" con `ChecklistSectionPanel` |
| F7 | 🟡 Bajo | El handle de drag es un `<button>` que no hace nada al hacer clic/Enter | `<span aria-hidden draggable>` (vía accesible = botones ↑/↓) |
| F8 | 🟡 Bajo | Sin duplicar ítem/sección | Botón duplicar (helpers puros testeables) |
| F9 | 🟡 Bajo | Sin resumen del builder | Línea "N secciones · M ítems" + alerta de sección vacía |
| F10 | 🟡 Bajo | Foco perdido al borrar ítem/sección | Refocus al botón "Agregar" tras eliminar |
| F11 | 🟡 Bajo | Opciones "valor: etiqueta" fallan en silencio | Validación suave en línea (no bloqueante) |
| F12 | 🟡 Bajo | Sin "copiar desde otra actividad" | Selector client-side (datos ya disponibles en la página) |

---

## 2. Decisiones de diseño (importantes de leer antes de codear)

### D1 — Guardado: se mantiene manual, sin autosave
`savePdtpActivityChecklist` **desactiva la plantilla activa y crea una versión nueva en
cada guardado** (historial de versiones). Autosave (p.ej. `useDebouncedAutosave`)
inflaría el historial con cada tecleo. Por eso F3 se resuelve con **dirty indicator +
`beforeunload`**, no con autosave. Un autosave real requeriría primero un servicio de
upsert in-place (`updateActivePdtpActivityChecklist`) que está **fuera de alcance** de
este plan (riesgo de churn de versiones; documentar como follow-up si se pide).

### D2 — El esqueleto inicial NO pasa el schema completo
`pdtpChecklistDefinitionSchema` exige `sections.length >= 1` y ítems ≥ 1 por sección.
El esqueleto de F1 empieza con `sections: []` (válido para el *check loose* que ya usa
`checklist-tab.tsx`: `Array.isArray(parsed.sections)`), por lo que el toggle visual se
muestra desde el inicio. El botón "Guardar" se deshabilita hasta que haya ≥1 sección con
≥1 ítem (validación client-side con el mismo schema, compartido y seguro de importar).

### D3 — Validación client-side con el schema compartido
`pdtpChecklistDefinitionSchema` vive en `lib/validation/prevention-module/pdtp.ts`, que ya
se importa tanto en las Server Actions como en tests (`checklist-builder.test.ts`). Se puede
importar en el cliente sin problema: `import { pdtpChecklistDefinitionSchema } from "@/lib/validation/prevention"`.
Mejora los errores genéricos ("Revisa los campos marcados") por mensajes específicos y
deshabilita el save inválido. El server sigue siendo backstop.

---

## 3. Cambios por archivo

| Archivo | Cambio | Fase |
|---------|--------|------|
| `app/(app)/prevencion/pdtp/[programId]/editar/checklist-builder.tsx` | Helpers puros `buildSkeletonDefinition`, `duplicateItem`, `duplicateSection`, `validateOptionsText` (exportados); labels de roles; panel "Configuración"; resumen; handle de drag como `span aria-hidden`; duplicar; validación de opciones | 1, 2, 3 |
| `app/(app)/prevencion/pdtp/[programId]/editar/checklist-tab.tsx` | Esqueleto inicial al no haber plantilla + visual por defecto; `ConfirmDialog` en borrado con refocus; badge dirty + `beforeunload`; toggle "Vista previa"; "Copiar de otra actividad"; deshabilitar Guardar con pre-validación | 1, 2, 3 |
| `lib/services/pdtp/checklist-domain.ts` | `PDTP_BUILDER_ROLE_LABELS` (labels de roles del builder, slug→español) | 2 |
| `app/(app)/prevencion/pdtp/[programId]/editar/checklist-builder.test.ts` | Tests de los nuevos helpers puros | 1, 3 |
| `app/(app)/prevencion/pdtp/[programId]/editar/checklist-tab.test.tsx` (nuevo) | RTL: visual por defecto, confirmación al borrar, badge dirty, preview | 1, 2, 3 |

---

## 4. Fases de implementación

### Fase 1 — Intuitividad al crear + seguridad del borrado (F1, F2, F10, F7)
*Objetivo: que crear un checklist desde cero sea visual, y que borrar no sea irreversible.*

**F1 — Esqueleto inicial + vista visual por defecto** (`checklist-tab.tsx`)
1. Extraer `buildSkeletonDefinition(activity: { id, activity })` (exportada desde
   `checklist-builder.tsx`) que replique la forma de `ensureDefaultChecklist`:
   ```ts
   {
     code: `pdtp_${activity.id}`, version: "01", revisionDate: new Date().toISOString().slice(0,10),
     title: activity.activity, tipo: "nuevo", legalFramework: [], applicableTo: "",
     sections: [],   // vacío → el check loose ya lo acepta (D2)
     closingAct: { title: "Cierre de verificación",
       resultOptions: [
         { value: "conforme", label: "Conforme" },
         { value: "observacion", label: "Con observaciones" },
         { value: "no_conforme", label: "No conforme" },
       ], signatureRoles: ["prevencionista_faena"] },
   }
   ```
2. En `ChecklistEditor`, inicializar `raw` con el esqueleto cuando `!template`
   (hoy: `""`). Con eso `parsedDefinition` deja de ser `null`, el toggle
   visual/JSON aparece y el modo por defecto es **visual**.
3. Pre-validación client-side (D3): `const validation = pdtpChecklistDefinitionSchema.safeParse(parsedDefinition)`.
   - Si falla → deshabilitar "Guardar plantilla" y mostrar el primer error mapeado en
     español (p.ej. "Agrega al menos una sección con un ítem para poder guardar").
   - El builder ya tiene empty-state "Sin secciones. Agrega al menos una." → reforzar
     con un CTA visible del mismo estilo `EmptyState` compact.
4. Mantener "Usar plantilla por defecto (1 ítem)" como quick-start alternativo.

**F2 + F10 — Confirmación al borrar con refocus** (`checklist-tab.tsx` y builder)
1. En `SectionEditor` y `ItemEditor`: estado local `confirming: boolean`. El botón
   `Trash` abre `<ConfirmDialog variant="destructive">` (import de
   `@/components/ui/confirm-dialog`, props ya verificadas:
   `open/onOpenChange/title/description/confirmLabel/cancelLabel/variant/onConfirm/loading`).
   - Sección: descripción "Se eliminará la sección «{title}» y sus {N} ítems. Esta acción no se puede deshacer."
   - Ítem: descripción "Se eliminará el ítem «{label}». Esta acción no se puede deshacer."
2. Al confirmar, ejecutar el remove actual y **gestionar foco**:
   - Ítem → foco al botón "Agregar ítem" de esa sección (`id` estable:
     `cl-add-item-${section.id}`).
   - Sección → foco al botón "Agregar sección" (`id`: `cl-add-section`).
   - Última sección borrada → foco al botón "Agregar sección" igualmente.

**F7 — Handle de drag no-funcional como botón** (`checklist-builder.tsx`)
- Reemplazar `<button draggable …>` por `<span draggable aria-hidden="true"
  className="cursor-grab … active:cursor-grabbing">` (el `title`/`aria-label` pasan a ser
  innecesarios; la vía accesible de reordenar son los botones ↑/↓ ya existentes).

**Tests Fase 1**
- `checklist-builder.test.ts`: `buildSkeletonDefinition` produce un objeto con la forma
  mínima; `duplicateItem`/`duplicateSection` (si se mueven aquí en F3) — al menos el skeleton.
- `checklist-tab.test.tsx` (nuevo): "sin plantilla muestra el editor visual por defecto
  (no el textarea JSON)"; "el botón Guardar está deshabilitado con 0 secciones y se
  habilita al agregar una sección con un ítem"; "borrar sección exige confirmar y solo
  elimina tras confirmar".

---

### Fase 2 — Protección del trabajo + coherencia de lenguaje (F3, F5, F6, F9)
*Objetivo: no perder trabajo y que el editor hable el idioma del negocio.*

**F3 — Badge "Cambios sin guardar" + `beforeunload`** (`checklist-tab.tsx`)
1. `savedRawRef = useRef(raw inicial)`; `isDirty = template ? raw !== savedRawRef.current : raw !== skeletonRaw`.
   (Al guardar OK, `savedRawRef.current = raw`.)
2. Badge junto al botón "Guardar plantilla": "Cambios sin guardar" (estilo
   `--color-warning-*`), "Guardado" cuando `!isDirty`, reutilizando la convención visual
   de `autosaveStatusLabel` sin el autosave (D1).
3. `beforeunload` (efecto pequeño, mismo patrón que `use-debounced-autosave.ts`):
   ```ts
   useEffect(() => {
     function warn(e: BeforeUnloadEvent) { if (!isDirty) return; e.preventDefault(); e.returnValue = "" }
     window.addEventListener("beforeunload", warn)
     return () => window.removeEventListener("beforeunload", warn)
   }, [isDirty])
   ```

**F5 — Labels de roles** (`lib/services/pdtp/checklist-domain.ts` + builder)
1. Exportar en `checklist-domain.ts`:
   ```ts
   export const PDTP_BUILDER_ROLE_LABELS: Record<string, string> = {
     prevencionista_faena: "Prevencionista de faena",
     admin_contrato: "Supervisor de faena",
     jefe_faena: "Jefe de faena",
   }
   ```
2. En el builder, `ROLE_OPTIONS` pasa a `{ value, label }` y los checkboxes muestran
   `label` (fallback al slug si falta). También usar el mapa en los `signatureRoles`
   del panel "Configuración" (F4).

**F6 — Vista previa** (`checklist-tab.tsx`)
1. Toggle "Vista previa" (segundo toggle junto a visual/JSON, solo con `parsedDefinition`).
2. Render read-only usando el mismo componente del flujo de llenado:
   `import { ChecklistSectionPanel } from "@/app/(app)/prevencion/[id]/checklist-section"`
   (props verificadas: `section, responses, readOnly, onChange`). Pasar
   `responses={}` (mapa vacío por ítem), `readOnly`, `onChange` noop.
   - Encabezado de vista previa: título del checklist + aviso "Así lo verá quien llene la verificación".
   - Resumen del `closingAct` (título + opciones de resultado como Badge) debajo.

**F9 — Resumen del builder** (`checklist-builder.tsx`)
- Línea superior: `{sections.length} secciones · {items totales} ítems`, y alerta
  `--color-warning-*` si alguna sección tiene 0 ítems (bloquea el guardado por schema).

**Tests Fase 2**
- `checklist-tab.test.tsx`: "el badge de cambios sin guardar aparece tras editar y
  desaparece al guardar"; "la vista previa renderiza las secciones en read-only".
- `checklist-builder.test.ts`: label de roles resuelve slugs.

---

### Fase 3 — Completitud y pulido (F4, F8, F11, F12)
*Objetivo: cerrar huecos de contenido del editor visual y atajos de productividad.*

**F4 — Panel "Configuración" en el editor visual** (`checklist-builder.tsx`)
- `<details>` colapsable "Configuración de la plantilla" al inicio del builder, con:
  - Título (`definition.title`, Input) — inicializado desde `activity.activity`.
  - Tipo (`tipo`: Select `nuevo`/`seguimiento`).
  - Frecuencia sugerida (`frequencySuggested`, Input, libre, ej. "Mensual, por cada extintor.").
  - Marco legal (`legalFramework`: Textarea una por línea — misma UX que `optionsToText`).
  - Cierre (`closingAct`): título (Input), opciones de resultado (Textarea "valor: etiqueta",
    reutilizando `optionsToText`/`textToOptions`), roles de firma (checkboxes con
    `PDTP_BUILDER_ROLE_LABELS`).
  - `code`/`version`/`revisionDate` se muestran **solo lectura** (auto: `pdtp_<actividad>`,
    "01", hoy) — se mantienen editables en modo JSON avanzado para casos especiales.
- Campos que permanecen JSON-only (documentar en el helper del modo JSON):
  `subtitle`, `objective`, `evaluationCriteria`, `applicableTo`, `hasRestrictions`,
  `requiresPermission`, `weekNumber`, `placeholder`, `hasActionCorrectiva`.

**F8 — Duplicar ítem/sección** (`checklist-builder.tsx`)
- Helpers exportados:
  - `duplicateItem(item): ChecklistItem` → clon con `id: nanoid()`.
  - `duplicateSection(section): ChecklistSection` → clon profundo con ids nuevos en items.
- Botón `Copy` (Phosphor `Copy`) junto a `Trash` en cada editor; inserta después del original.

**F11 — Validación suave de opciones** (`checklist-builder.tsx`)
- `validateOptionsText(text): string[]` (exportada): devuelve líneas sin ":" y valores
  duplicados. Se muestra como aviso bajo el Textarea, no bloquea:
  "La línea «b» no tiene formato 'valor: etiqueta'; se usará el mismo texto como valor y etiqueta."

**F12 — Copiar desde otra actividad** (`checklist-tab.tsx`)
- En `ChecklistRow` sin plantilla: botón secundario "Copiar de otra actividad…".
- Dialog con Select de las demás actividades con plantilla activa (datos ya en la prop
  `checklists` de `ChecklistTab`). Al elegir: `setRaw(JSON.stringify({ ...def, code: pdtp_<id>, version: "01", revisionDate: hoy }))`,
  modo visual. **Sin nueva Server Action** (client-side puro).

**Tests Fase 3**
- `checklist-builder.test.ts`: `duplicateItem`/`duplicateSection` (nuevos ids, deep copy),
  `validateOptionsText` (línea sin ":", duplicados, ok).
- `checklist-tab.test.tsx`: "copiar de otra actividad siembra el JSON de la plantilla
  origen con code nuevo".

---

## 5. Validación

Por fase (o al final si se implementan juntas):

```bash
npm run typecheck                              # tsc --noEmit
npm run lint                                   # eslint
npx vitest run "app/(app)/prevencion/pdtp/[programId]/editar/"
npx vitest run lib/services/pdtp               # no romper servicio/tests de dominio
npm run test:fast                              # suite no-pglite completa (regresión)
```

Regresión explícita (no tocar): `lib/__tests__/pdtp-checklist-action-plan.test.ts`,
`lib/__tests__/prevention-pdtp.test.ts`, `execution-checklist-panel.test.tsx`,
`pdtp-obligations-workbench.test.tsx`, e2e `pdtp-flow.spec.ts` (llenado — sin cambios).

Verificación visual opcional: `npm run ss` (ruta `prevencion-pdtp-editar` ya capturada
en `scripts/capture-all-routes.ts`) para comparar antes/después.

---

## 6. Criterios de aceptación

1. **Crear**: con una actividad sin plantilla, el editor abre en **modo visual** con un
   esqueleto; "Guardar" está deshabilitado hasta haber ≥1 sección con ≥1 ítem, y el
   mensaje lo explica.
2. **Borrar**: eliminar sección/ítem exige confirmación explícita; tras confirmar, el
   foco queda en el botón "Agregar" correspondiente.
3. **Trabajo**: editar muestra "Cambios sin guardar"; recargar con cambios lanza
   advertencia del navegador.
4. **Lenguaje**: ningún slug de rol visible en el editor (todo label en español).
5. **Preview**: el toggle muestra el checklist como lo verá quien lo llene (read-only).
6. **Metadata**: título, tipo, frecuencia, marco legal, cierre (opciones y firmas) se
   editan sin abrir JSON.
7. **Atajos**: duplicar ítem/sección, copiar desde otra actividad y resumen de conteo
   funcionan; las opciones mal formateadas avisan sin bloquear.
8. **Calidad**: `typecheck`, `lint` y la suite de tests PDTP pasan.

---

## 7. Riesgos y decisiones abiertas

| Riesgo | Mitigación |
|--------|-----------|
| Autosave real → infla historial de versiones (`savePdtpActivityChecklist` crea versión nueva por guardado) | F3 resuelto con dirty indicator + `beforeunload` (D1). Follow-up: servicio `updateActivePdtpActivityChecklist` in-place si se pide autosave. |
| Importar `pdtpChecklistDefinitionSchema` en cliente | Ya es módulo compartido (lo usan actions y tests). No arrastra deps de servidor. |
| `ChecklistSectionPanel` import en el editor | Mismo árbol de app (`app/(app)/`), sin cliente/servidor cruzado. En tests RTL, mockear si es pesado (patrón ya usado en `evaluation-detail.test.tsx`). |
| Cambiar el handle de drag de `<button>` a `<span>` | El drag nativo funciona en spans; la vía de teclado (↑/↓ con `aria-label`) queda intacta. Verificar con prueba manual de drag en navegador. |
| `<details>` por actividad crece mucho | Fuera de alcance: mantener, pero el resumen (F9) y el preview (F6) mejoran la navegación. |
| Deshabilitar Guardar con pre-validación puede frustrar guardados parciales | Es el comportamiento buscado (schema exige secciones/ítems). El esqueleto + quick-start cubren el caso simple. |

## 8. Fuera de alcance

- Servicio `updateActivePdtpActivityChecklist` (autosave in-place) — D1.
- Inventario permanente de extintores/contenedores (selector real de sujetos) — plan aparte.
- Editor visual de `subtitle`/`objective`/`evaluationCriteria`/`applicableTo` — se dejan en JSON avanzado (documentado en F4).
- Auditoría de accesibilidad formal (axe-core) del editor — pendiente conocido del proyecto.
