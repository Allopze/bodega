# Reportes y trazabilidad

## 1. Módulo de Reportes

La pantalla `Reportes` centraliza resúmenes y métricas operacionales de la plataforma.

- Revisa métricas de `Solicitudes`, `Ítems solicitados`, `Órdenes de compra`, `Recepciones` y `OC pendientes`.
- Usa los bloques de estados para ver solicitudes, ítems y OC por estado.
- Exporta reportes a Excel con los botones `Ítems sin OC`, `Gasto por faena` u `OC por estado`.

---

## 2. Módulo de Trazabilidad por Ítem

La pantalla `Trazabilidad` muestra la ruta completa de un producto o insumo dentro del sistema.

- Sirve para entender de dónde salió un producto y por cuáles etapas avanzó.
- Permite filtrar por faena, estado o buscar un ítem específico.

### Cómo usar la trazabilidad de ítems

1. Entra a `Reportes > Trazabilidad`.
2. Usa los filtros de faena y estado.
3. Si hay alertas en el flujo, puedes pulsar `Ver solo alertas`.
4. Abre el detalle del ítem desde la matriz para consultar:
   - Quién solicitó el ítem.
   - En qué Orden de Compra quedó asignado.
   - Fecha y folio de recepción en bodega.
   - Fecha de entrega final al usuario o faena.
5. Presiona `Exportar Excel` para descargar la matriz completa.

---

## 3. Trazabilidad por Trabajador (`/trazabilidad/trabajador/[workerId]`)

La vista de `Trazabilidad por Trabajador` consolida el expediente histórico de entregas y dotación recibida por una persona específica.

### Qué información incluye

- **Historial de EPP entregados**: Cascos, calzado de seguridad, vestimenta de trabajo, arneses y protectores recibidos.
- **Fechas y folios de cargo**: Registro de cada acta de entrega firmada por el trabajador.
- **Firma y acuse de recibo**: Evidencia del cumplimiento de la entrega según normativa de seguridad.
- **Estado de reposición**: Próximas fechas recomendadas de recambio de EPP según la matriz del cargo.
