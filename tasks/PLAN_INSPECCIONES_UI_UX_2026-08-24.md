# Plan de remediación UI/UX — Inspecciones

Fecha: 2026-08-24  
Fuente: `AUDITORIA_UI_UX_INSPECCIONES.md`  
Estado: en ejecución

## Resultado esperado

El flujo debe permitir que un prevencionista identifique lo urgente, cree una inspección en la faena correcta, la ejecute desde un teléfono sin desplazamiento horizontal, adjunte respaldo en el orden natural del trabajo y entienda con claridad quién ejecuta, quién revisa y qué falta para cerrar.

## Cortes de implementación

1. **Bandeja fiel a la tarea**
   - Unificar filtros de lista, resumen, paginación y Excel.
   - Exponer búsqueda móvil estable y una vista real de vencidas.
   - Priorizar vencidas y renombrar el estado operativo pendiente de revisión.
   - Reemplazar la tabla móvil por tarjetas con estado y siguiente acción.

2. **Creación segura**
   - Eliminar selecciones silenciosas de plantilla/faena.
   - Limpiar el sujeto al cambiar de faena y aclarar el origen del sujeto.
   - Mantener la confirmación visible en formularios móviles largos.
   - Reducir acciones secundarias que compiten con “Nueva inspección”.

3. **Ejecución móvil y continuidad**
   - Convertir el checklist móvil en tarjetas/secciones navegables.
   - Acercar guardado/cierre al lugar de trabajo mediante acciones persistentes.
   - Hacer coherentes progreso, cumplimiento, confirmación de guardado y bloqueos.
   - Incorporar evidencia al gesto de respuesta o conservarla localmente hasta guardar.
   - Nombrar con precisión el alcance real de la cola sin conexión.

4. **Reporte de Equipos y revisión segregada**
   - Mostrar primero la planilla física y admitir imagen/PDF en un visor correcto.
   - Evitar recarga completa al cargar el documento.
   - Explicar el traspaso por jefe de faena y la revisión por prevencionista.
   - Ocultar o explicar anticipadamente la auto-revisión imposible.
   - Hacer persistente y comprensible la geolocalización capturada.

5. **Hallazgos y CAPA operacionales**
   - Quitar bloqueos duplicados y permitir saltar al ítem pendiente.
   - Exigir responsable CAPA y mostrar gravedad y fecha de compromiso.
   - Corregir la condición del encabezado de acciones.

6. **Plantillas y programación comprensibles**
   - Alinear publicación/incorporación/aprobación con el ciclo real.
   - Resolver el estado ambiguo “Aprobada / Definición retirada”.
   - Crear alternativas móviles para ambas tablas y filtros útiles.
   - Reemplazar números PDTP libres por selección con nombre.
   - Hacer que “Ejecutar ahora” abra o identifique la ejecución creada.
   - Confirmar activación/detención, evitar contradicciones de periodicidad y mostrar contexto de sujeto/riesgo.
   - Mover acciones globales al encabezado y retirar lenguaje técnico.

7. **Entrada diaria, regresiones y evidencia**
   - Incorporar inspecciones a Inicio de Prevención.
   - Corregir tokens/contrastes residuales.
   - Añadir regresiones unitarias, de integración y E2E móvil.
   - Ejecutar TypeScript, ESLint, pruebas focalizadas, React Doctor y el script oficial de capturas.
   - Revisar las capturas nuevas y actualizar auditoría y to-do con evidencia final.

## Criterios de cierre

- Los 34 hallazgos quedan trazados en `tasks/TODO_INSPECCIONES_UI_UX_2026-08-24.md`.
- No existe scroll horizontal para realizar la tarea principal a 390 px.
- Lista, resumen, paginación y Excel responden al mismo conjunto de filtros.
- El prevencionista ve qué requiere ejecución, qué requiere revisión y quién debe actuar.
- La carga de planilla y evidencia no destruye borradores locales.
- Las acciones destructivas o de cambio de ciclo explican su efecto antes de confirmar.
- Las capturas oficiales de escritorio y móvil son revisadas después de la implementación.

## Fuera de alcance

- Cambiar las reglas de negocio, segregación de funciones o cálculo normativo que no sea necesario para corregir su representación UX.
- Desplegar o probar en producción.
- Crear un rol de mecánico: el Reporte de Equipos continúa siendo transcrito por el jefe de faena y revisado separadamente por Prevención.
