# Estado del Programa de Trabajo Preventivo 2026 después de las correcciones

> **Nota histórica (2026-09-22).** Este documento es anterior al retiro del modelo de
> cursos por persona (2026-09-19, migración `0310`), que dejó ocho actividades del
> programa (N°16, 37, 38, 51, 53, 57, 59 y 60) sin ningún instrumento vivo que las
> acredite. La afirmación "81/81 actividades vigentes conectadas" que sigue abajo
> **ya no refleja el estado actual** del programa: no la uses como evidencia de
> cobertura vigente. La Task 8 (2026-09-22) agregó instrumento a seis de esas ocho
> (N°16, 37, 51, 57, 59, 60) en `lib/prevention/training-occurrences-catalog.ts`; las
> N°38 y N°53 quedan pendientes de una decisión de Prevención (ver el informe de esa
> tarea). Se conserva el resto del documento sin reescribir, como antecedente
> histórico de la revisión del 10 de septiembre de 2026.

**Dirigido a:** Jefatura del Departamento de Prevención de Riesgos  
**Fecha de revisión:** 10 de septiembre de 2026  
**Programa revisado:** Programa de Trabajo Preventivo SG-SST 2026  
**Ambiente revisado:** desarrollo local

## Resumen ejecutivo

El Programa de Trabajo Preventivo 2026 quedó habilitado en desarrollo para probar su funcionamiento completo.

La revisión final confirma que las 81 actividades vigentes tienen un lugar definido donde realizarse y una forma válida de registrar su cumplimiento. Las 6 actividades retiradas se mantienen como antecedente histórico, pero no cuentan como trabajo pendiente.

La comprobación general terminó satisfactoriamente:

- 81 de 81 actividades vigentes están conectadas con su área de trabajo.
- No quedan actividades sin pauta, curso, plan u otro respaldo habilitado.
- No quedan cursos del programa sin una versión publicada que cumpla su duración mínima.
- Las seis faenas incluidas en el programa tienen sus instrumentos disponibles.
- No existen avisos pendientes o con error atribuibles a este programa.
- El contenido actual coincide con el programa aprobado; no se detectó una modificación posterior a las firmas.

Por lo anterior, el ambiente de desarrollo está apto para realizar pruebas integrales del programa. Este resultado no constituye por sí solo una autorización para trasladar los mismos datos a producción.

## Correcciones realizadas después de la segunda auditoría

### 1. Las pantallas muestran solamente las faenas del programa

El detalle, el reporte de gestión y la importación ya no ofrecen faenas ajenas al Programa 2026.

El usuario sigue viendo su faena habitual en el encabezado general del sistema, pero dentro del programa sólo puede seleccionar las seis faenas que realmente pertenecen a él:

- Biodiversa.
- Cholguan - Arauco.
- Horcones.
- Masisa.
- Santa Fe - Grúas.
- Teno - Arauco.

Esto evita abrir reportes o registrar información en una faena que no forma parte del programa.

### 2. Los avisos de otras faenas ya no se cargan al programa

Existía un aviso con error relacionado con Oficina Central. Esa faena no pertenece al Programa 2026, por lo que el aviso no debía aparecer como un problema del programa.

La corrección conserva el aviso como antecedente en su lugar de origen, pero lo excluye del resumen del Programa 2026. El programa ahora muestra cero avisos pendientes y cero avisos con error.

### 3. Se corrigió el botón “Más acciones”

La pantalla abría, pero el navegador advertía que debía reconstruir ese botón. El problema fue corregido.

Se realizaron tres cargas consecutivas del detalle y se abrió el menú. No aparecieron advertencias de reconstrucción, errores de pantalla, errores de consola ni solicitudes de red fallidas.

También quedó agregada una prueba automática para evitar que este problema reaparezca.

### 4. La capacitación de manejo a la defensiva quedó correctamente separada

La actividad N° 56 estaba vinculada por error al curso histórico `B-01`, que correspondía a una inducción corporativa de 60 minutos.

Se conservó íntegramente el curso histórico y sus antecedentes, pero se retiró únicamente el vínculo incorrecto con la actividad N° 56. Luego se creó el curso separado `PDTP-56`, “Manejo a la defensiva”, con duración mínima de 480 minutos.

En desarrollo se creó una versión denominada `DEV-2026-FIX`, de 480 minutos. Una persona la preparó y otra persona distinta la aprobó y publicó, respetando la separación de funciones.

El sistema también fue reforzado para que, en adelante, una versión publicada no se considere suficiente si dura menos que el mínimo exigido por su propio curso.

### 5. Se definió un padrón provisional para la actividad N° 56

La actividad N° 56 se mide por cobertura, pero todavía no existe una fuente automática confiable que identifique a todos los conductores y operadores de cada faena.

Para poder observar el comportamiento completo en desarrollo, se registró un padrón provisional de 1 persona por cada una de las seis faenas. Este valor es igual a la cantidad planificada y quedó acompañado de un motivo en la bitácora.

El sistema ahora reconoce un padrón manual como válido solamente cuando existe un valor positivo para cada faena donde la actividad aplica. Si falta una faena, volverá a mostrar el aviso correspondiente.

## Resultado de la comprobación final

La comprobación integral entregó el siguiente resultado:

| Aspecto revisado | Resultado |
|---|---:|
| Actividades vigentes | 81 |
| Actividades listas para operar | 81 |
| Actividades sin instrumento válido | 0 |
| Cursos sin versión publicada suficiente | 0 |
| Decisiones de cobertura pendientes | 0 |
| Faenas del programa sin plan de emergencia | 0 |
| Avisos pendientes del programa | 0 |
| Avisos con error del programa | 0 |
| Cambios posteriores a la firma detectados | No |

La distribución de responsabilidades también permanece resuelta:

- 76 actividades pueden ser registradas directamente por alguno de sus responsables.
- 5 actividades requieren que una persona prepare o ejecute el trabajo y otra lo revise, apruebe o firme.
- Esta separación es intencional y no representa una actividad bloqueada.

## Qué puede probar ahora la jefatura en desarrollo

Con el programa activo, se puede recorrer una muestra completa de los principales trabajos:

1. Abrir una actividad desde el programa.
2. Ir al área donde realmente se ejecuta, por ejemplo Inspecciones, Capacitación, Emergencias o Constancias.
3. Registrar una ejecución de prueba con su evidencia.
4. Completar la revisión o aprobación cuando corresponda.
5. Volver al programa y comprobar que el avance se actualizó en la faena correcta.
6. Descargar el reporte de gestión en Excel.

La planilla del programa debe utilizarse para planificar, supervisar y conciliar el avance. El trabajo se ejecuta en cada área especializada y vuelve al programa como cumplimiento acreditado.

## Pendientes de decisión de Prevención antes de producción

Los defectos de software encontrados en esta auditoría fueron corregidos. Sin embargo, siguen existiendo decisiones operativas que no deben resolverse automáticamente:

1. Revisar y reemplazar, cuando corresponda, los temarios de prueba de los cursos por contenidos oficiales aprobados por Prevención.
2. Confirmar el padrón real de conductores y operadores para la actividad N° 56 en cada faena. El valor actual de 1 persona es sólo provisional para desarrollo.
3. Ejecutar pruebas con usuarios que representen los cargos reales y con evidencia de prueba identificable.
4. Repetir la comprobación en el ambiente donde se pretenda operar antes de autorizar una puesta en producción.

## Respaldo y alcance

Antes de la última corrección se creó un respaldo recuperable de la base local de desarrollo en:

`/tmp/bodega-pdtp-before-fixes-2026-09-10.dump`

Todos los cambios de datos descritos en este documento se aplicaron únicamente en PostgreSQL local `127.0.0.1:5433`, base `bodega_dev`. No se realizó despliegue, cambio ni aprobación en producción.

## Conclusión

El Programa de Trabajo Preventivo 2026 puede recorrerse íntegramente desde los distintos submódulos de Prevención en el ambiente de desarrollo. La comprobación final no presenta bloqueos de instrumentos, cursos, cobertura, faenas, responsables, avisos ni firma.

La jefatura puede continuar con una prueba funcional representativa. Para un uso real, todavía debe validar el contenido oficial de las capacitaciones y reemplazar el padrón provisional de la actividad N° 56 por la nómina que corresponda a cada faena.
