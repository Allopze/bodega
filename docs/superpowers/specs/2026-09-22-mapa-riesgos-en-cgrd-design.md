# Mapa de riesgos: traslado desde MIPER a Gestión de Riesgos de Desastres

Fecha: 2026-09-22 · Estado: **aprobado, sin implementar**
Decisión de dominio de Prevención: el mapa de riesgos pertenece al módulo CGRD.

## 1. Qué se mueve y qué no

Se mueve la **ubicación**: ruta de página, ruta de API, entrada de navegación y
capítulo del manual. No se mueve el **modelo**: tablas, servicio, prefijo de
storage y permisos quedan exactamente como están.

| Se mueve | Se queda |
|---|---|
| `/prevencion/miper/mapa` → `/prevencion/cgrd/mapa` | Tablas `prevention_risk_map_layouts` / `prevention_risk_map_markers` |
| `/api/prevencion/miper/mapa` → `/api/prevencion/cgrd/mapa` | `lib/services/prevention-risk-map.ts` (nombre y firmas) |
| Entrada de nav, del grupo "Programa" a hija de CGRD | Prefijo de storage `storage/risk-map/` |
| Capítulo del manual, del 04 al 17 | Permisos `prevention:risk:view` / `prevention:risk:edit` |

Renombrar las tablas está **prohibido** en este cambio: son tablas publicadas y
reescribir una migración aplicada es el incidente DAT-002 que `db/migrations/README.md`
documenta. El nombre `risk_map` sigue describiendo el instrumento con precisión.

## 2. Por qué el código dice hoy lo contrario

`modules/prevention/manifest.ts:383` y `app/(app)/prevencion/miper/mapa/page.tsx:13`
afirman que el mapa es el instrumento del **DS 44 art. 62**, distinto de la matriz
IPER (art. 7), y que por eso vive junto a la MIPER. Esa afirmación normativa **sigue
siendo cierta y no se borra**: lo que cambia es dónde se aloja la pantalla.

Prevención determinó que el usuario que consulta el mapa lo hace en el contexto de
gestión de riesgo de desastres. Los comentarios que hoy justifican la ubicación
anterior deben **reescribirse**, no dejarse en pie contradiciendo la ruta nueva.
Un comentario que contradice la estructura es cómo esta decisión se revierte sola
dentro de seis meses.

## 3. Hechos del sistema que la implementación no puede romper

Verificados sobre el código, no supuestos:

1. **Los marcadores son datos de la MIPER.** `prevention_risk_map_markers.risk_entry_id`
   es `NOT NULL` con FK `restrict` a `prevention_risk_entries`
   (`db/schema/prevention/risk-legal.ts:195-208`). Un marcador solo puede apuntar a
   una entrada de matriz **publicada** de la misma faena.
2. **Hay triple defensa sobre esa regla**: validación al crear
   (`lib/services/prevention-risk-map.ts:125-131`), filtro `status='published'` en
   lectura (`:206-209`), y reapuntado al publicar una revisión —
   `repointRiskMapMarkers` (`lib/services/prevention-risk-legal.ts:430-489`) conserva
   x/y/label si el peligro sobrevive por identidad `processId|taskId|positionId|hazardCode`,
   y borra el marcador con historia `orphaned` si desapareció.
3. **Acredita la certificación CPHS.** Requisito Oro `risk_map`
   (`lib/prevention/cphs-certification.ts:353-360`), que se cumple con
   `riskMapActive && riskMapMarkerCount > 0`. Es por datos, así que el traslado de
   ruta no lo afecta — pero tampoco debe afectarlo por accidente.
4. **Un plano activo por faena**, garantizado por unique parcial en BD
   (`prevention_risk_map_layout_active_unique`). Subir uno nuevo archiva el anterior.
5. **El GC de planos huérfanos** (`lib/services/pdtp/evidence-gc.ts:208-236`, cron
   `app/api/cron/pdtp-evidence-gc/route.ts`) barre `storage/risk-map/` sin filtrar por
   `status`: un plano archivado sigue siendo evidencia. No se toca.

Consecuencia operativa a aceptar: dentro de CGRD, el mapa aparecerá **vacío** en una
faena sin MIPER publicada, y su contenido lo gobierna el ciclo de firmas de la MIPER,
no el del CGRD. Eso es correcto y debe quedar visible en la copy de la pantalla.

## 4. Permisos: se mantienen los de MIPER

El mapa sigue exigiendo `prevention:risk:view` para ver y `prevention:risk:edit` para
subir plano y colocar o quitar marcadores. **No se crea ningún permiso nuevo y no se
migra RBAC.**

Razón: los marcadores son entradas de la MIPER. Migrar el mapa a `prevention:cgrd:*`
ampliaría la superficie de datos — `admin_contrato` tiene `cgrd:view`
(`modules/prevention/manifest.ts:715`) pero **no** `risk:view`, así que ganaría lectura
de peligros y niveles de riesgo de la matriz IPER que hoy no puede ver.

**Consecuencia aceptada:** `admin_contrato` entra a `/prevencion/cgrd` y no ve la
entrada "Mapa de riesgos". La navegación se la oculta por permiso; no recibe un 403.
Esto es deliberado: si más adelante se decide que ese rol debe ver el mapa, la
corrección es otorgarle `prevention:risk:view`, no mover el permiso de la pantalla.

## 5. Navegación

En `modules/prevention/manifest.ts`:

- Se **elimina** la entrada de las líneas 382-391 (label "Mapa de riesgos", grupo
  "Programa"). El grupo "Programa" queda con Matriz IPER y Requisitos legales.
- Se **agrega** como `children` de "Gestión de riesgos de desastres" (línea 493-500,
  grupo "Cumplimiento del programa"), con el mismo patrón que usa Inspecciones:

```
{
  label: "Gestión de riesgos de desastres",
  href: "/prevencion/cgrd",
  iconName: "Mountains",
  group: "Cumplimiento del programa",
  permissions: ["prevention:cgrd:view"],
  children: [
    {
      // DS 44 art. 62. Los marcadores son peligros de la MIPER publicada de la
      // faena (art. 7): el instrumento es distinto, el dato es compartido.
      label: "Mapa de riesgos",
      href: "/prevencion/cgrd/mapa",
      permissions: ["prevention:risk:view"],
    },
  ],
},
```

El hijo lleva un permiso distinto del padre, que es exactamente lo que produce el
comportamiento de la sección 4. El patrón ya existe en el mismo manifest: la entrada
"Aprobaciones" (`modules/prevention/manifest.ts:352-356`) es hija de PDTP y exige
`prevention:pdtp:approve` mientras su padre exige `prevention:pdtp:view`.

Breadcrumbs de la página: Inicio → Prevención → Gestión de riesgos de desastres →
Mapa de riesgos.

## 6. Archivos

| De | A |
|---|---|
| `app/(app)/prevencion/miper/mapa/page.tsx` | `app/(app)/prevencion/cgrd/mapa/page.tsx` |
| `app/(app)/prevencion/miper/risk-map-panel.tsx` | `app/(app)/prevencion/cgrd/mapa/risk-map-panel.tsx` |
| `app/(app)/prevencion/miper/risk-map-data.ts` | `app/(app)/prevencion/cgrd/mapa/risk-map-data.ts` |
| `app/api/prevencion/miper/mapa/route.ts` | `app/api/prevencion/cgrd/mapa/route.ts` |
| `app/api/prevencion/miper/mapa/[name]/route.ts` | `app/api/prevencion/cgrd/mapa/[name]/route.ts` |
| `addRiskMapMarkerAction` / `removeRiskMapMarkerAction` (`miper/actions.ts:155-165`) | `app/(app)/prevencion/cgrd/mapa/actions.ts` |

`risk-map-data.ts` sigue importando `getRiskDashboard` de
`lib/services/prevention-risk-legal` y `listRiskMapsForScope` de
`lib/services/prevention-risk-map`. Esos servicios no se mueven ni se renombran.

Las dos acciones movidas dejan de usar el `REVALIDATE = "/prevencion/miper"` de
`miper/actions.ts:34` y revalidan `/prevencion/cgrd/mapa`. Conservan
`guardPermission("prevention:risk:edit")` y la revalidación de
`/prevencion/pdtp/cobertura`.

### Por qué la API también se mueve

`lib/services/module-toggles.ts:157` ya declara el mapa como submódulo propio, con el
par `submoduleHref: "/prevencion/miper/mapa"` ↔ `prefix: "/api/prevencion/miper/mapa"`.
Mover solo la UI dejaría ese par descuadrado: el submódulo de MIPER (línea 158, prefijo
`/api/prevencion/miper`) pasaría a cubrir la API de una pantalla alojada en CGRD, y
apagar MIPER rompería el mapa del CGRD sin que nada lo explique. La entrada 157 se
actualiza a `/prevencion/cgrd/mapa` ↔ `/api/prevencion/cgrd/mapa`.

Mover la API es seguro: la URL de la imagen se construye en el cliente en tiempo de
render (`risk-map-panel.tsx:139`, a partir del nombre de archivo). En la base de datos
solo vive `image_path`, relativo al prefijo de storage, que no cambia. Ninguna fila
guarda una URL de API.

El endpoint conserva íntegros sus guards: detección de MIME por bytes
(`validateFileBuffer`), límite de 10 MB, compensación por borrado de archivo si falla
el registro en BD, anti-path-traversal, guard IDOR contra `prevention_risk_map_layouts`
y el header `X-Plano-Estado: vigente|archivado`.

`lib/services/module-toggles.ts:220` (`prevention:risk:*` → `/prevencion/miper`) es el
destino de fallback del conjunto de permisos de riesgo, cuyo grueso sigue siendo la
MIPER. No se toca.

## 7. Compatibilidad de enlaces

Redirect permanente en `next.config.ts` (bloque `redirects()`, línea 63), siguiendo el
precedente de `/prevencion/biblioteca`:

```
{ source: "/prevencion/miper/mapa", destination: "/prevencion/cgrd/mapa", permanent: true },
```

Debe declararse **antes** de cualquier patrón que capture `/prevencion/miper/:path*`.
Hoy no existe ninguno, pero el orden importa si se agrega después.

## 8. Verificación

Puertas obligatorias antes de dar el cambio por hecho: `npm run typecheck`,
`npm run lint`, `npm run test:fast`, `npm run test:pglite`, `npm run test:e2e`.
Sin migración de BD, así que `db:verify-migrations` no aplica más allá de seguir verde.

Tests existentes a actualizar — ninguno se elimina:

| Test | Qué cambia |
|---|---|
| `e2e/prevencion-miper-risk-map.spec.ts` | Renombrar a `e2e/prevencion-cgrd-risk-map.spec.ts`; `goto("/prevencion/cgrd/mapa")`. El flujo completo (subir plano, clic, colocar marcador, quitar) se conserva tal cual, incluido `MINIMAL_PNG` |
| `lib/__tests__/navigation.test.ts:177` | El desempate por prefijo más largo pasa a ser `/prevencion/cgrd` vs `/prevencion/cgrd/mapa`; se elimina el caso de `miper` vs `miper/mapa` |
| `lib/__tests__/miper-ui-contract.test.ts:27-33,115-120` | Leen el fuente del panel por ruta; actualizar la ruta. Considerar moverlos a un archivo de contrato propio del mapa, ya que dejan de ser contrato de la MIPER |
| `app/api/prevencion/miper/mapa/route.test.ts` | Mover junto a la ruta; el `revalidatePath` esperado pasa de `/prevencion/miper` a `/prevencion/cgrd/mapa` |
| `lib/__tests__/risk-map-gc.test.ts:159-196` | Hace GET contra la ruta de la API; actualizar el import y la URL. Los asserts de `X-Plano-Estado` y `Cache-Control` no cambian |
| `lib/__tests__/module-toggles.test.ts` | Par href/prefijo de la entrada 157 |
| `lib/routing/__tests__/not-found-suggestion.test.ts` | Sugerencia para la ruta vieja |
| `scripts/capture-all-routes.ts` | Ruta registrada para captura |

Test nuevo, obligatorio: **el redirect de `/prevencion/miper/mapa` responde y aterriza
en `/prevencion/cgrd/mapa`**. Sin él, la mudanza rompe bookmarks en silencio y ningún
test falla.

Verificación en navegador, exigida por el contrato del repo para un cambio visible:
entrar con un rol que tenga `prevention:risk:view`, comprobar que la entrada aparece
bajo CGRD y que el flujo de plano y marcadores funciona en la ruta nueva; y entrar con
`admin_contrato` para confirmar que la entrada no aparece y que no hay 403 en `/prevencion/cgrd`.

## 9. Documentación

- `docs/manual-prevencion/parte-1-programa-y-planificacion/04-miper-mapa-riesgos.md:66-78`
  ("El Mapa de Riesgos en Terreno") se traslada al capítulo 17
  (`parte-4-gobernanza-y-seguimiento/17-gestion-riesgo-desastres-cgrd.md`), con la ruta
  nueva. En el capítulo 04 queda un puntero explícito al 17, porque los marcadores
  siguen saliendo de la matriz IPER y quien lee sobre la MIPER necesita saberlo.
- El capítulo 17 declara hoy solo las actividades PDTP N° 79/80/81. El mapa **no**
  acredita ninguna actividad PDTP; el capítulo debe decirlo para no sugerir que sí.
- Ese mismo capítulo 04 describe el mapa con zonificación por áreas y una función de
  descarga que **no existen** en la implementación (es un plano raster con marcadores
  puntuales, sin polígonos ni descarga). Esa desalineación es previa a este cambio y
  **no se corrige aquí**; se anota como deuda para no confundir corrección de texto
  con corrección de producto.

## 10. Deuda declarada, fuera de alcance

**Colisión de nombres.** Dentro de CGRD, "Mapa de riesgos" queda junto a la "Matriz
GRD" de amenazas (incendio de interfase, aluvión, sismo, corte de energía). Un usuario
puede abrir el mapa esperando ver esas amenazas ubicadas sobre el plano, y encontrará
peligros operacionales de la MIPER. Este cambio no lo resuelve. Las salidas posibles,
cuando Prevención decida: precisar la descripción de la pantalla, renombrar la entrada
a algo como "Mapa de riesgos (art. 62)", o dar a la matriz GRD su propia capa de
marcadores sobre el mismo plano — lo último exigiría volver polimórfico
`prevention_risk_map_markers.risk_entry_id`, que hoy es `NOT NULL` hacia la MIPER.

## 11. Fuera de alcance, explícito

- Renombrar tablas, columnas, servicios o el prefijo de storage.
- Crear o migrar permisos.
- Agregar capas, polígonos, zonificación, descarga del mapa o cualquier librería de
  mapas (el repo no tiene ninguna y el overlay es CSS puro, deliberadamente).
- Vincular el mapa a amenazas de la matriz GRD.
- Corregir la desalineación manual↔código descrita en la sección 9.
