# Evaluación de base de datos persistente para Familia AKT

Fecha de revisión: 2026-10-23

## Hallazgo principal

La aplicación actual guarda el estado completo en archivos (data/state.json) y los cierres en data/history/. Render Free no conserva esos archivos tras reinicios o despliegues, y su Postgres gratuito vence a los 30 días. No usar ese servicio como origen oficial de datos.

La aplicación no puede conectarse a PostgreSQL solo con configurar una URL: hoy el servidor hace lecturas y escrituras síncronas sobre JSON. Migrar a una base de datos exige adaptar los puntos de lectura/escritura, cambiar a operaciones asíncronas y probar todos los flujos. Esta adaptación no se debe improvisar directamente en producción.

## Opciones investigadas

### Neon Free (PostgreSQL)

- Plan gratuito publicado sin fecha de vencimiento fija.
- Límite publicado: 0,5 GB por proyecto, 100 CU-horas por proyecto al mes y cómputo que escala a cero tras 5 minutos de inactividad.
- La documentación consultada indica historial de restauración de 6 horas; no debe confundirse con una copia de seguridad independiente.
- Puede servir para una prueba técnica y una migración piloto. Antes de usarlo con datos operativos, configurar exportaciones automáticas independientes y probar una restauración real.

Fuentes: https://neon.com/pricing y https://neon.com/docs/introduction/restore

### Supabase Free (PostgreSQL)

- 500 MB de base de datos en el plan gratuito.
- El proyecto puede pausarse tras una semana con poca actividad.
- No incluye copias de seguridad automáticas en el plan gratuito; se deben gestionar exportaciones externas.
- La pausa por inactividad puede afectar la disponibilidad, aunque no equivale por sí sola a borrar los datos.

Fuentes: https://supabase.com/pricing y https://supabase.com/docs/guides/platform/free-project-pausing

### Render Free

- El disco de un servicio web gratuito es efímero y no admite discos persistentes.
- La base de datos Postgres gratuita vence a los 30 días y no tiene respaldos.
- No es adecuada para ser la única fuente de los registros de canastas/entregas.

Fuente: https://render.com/docs/free

## Recomendación

1. Mantener Railway intacto como sistema actual hasta terminar una migración ensayada.
2. Hacer un prototipo de persistencia con PostgreSQL en una rama separada, usando una base de prueba y datos ficticios. Neon Free es una candidata razonable para ese prototipo, no una garantía de producción gratuita.
3. Añadir exportación independiente y documentada, comprobar recuperación y revisar límites/condiciones vigentes antes de elegir el proveedor definitivo.
4. Solo después de que las pruebas de roles, entregas, catálogos, estándares, cierres e históricos pasen, planear un corte controlado con comparación de conteos y opción de vuelta atrás.

## Criterios obligatorios de aceptación

- Login y permisos de Admin, Mesanín, Supervisor y Patinador.
- Alta/edición de tareas y catálogos sin borrar registros omitidos accidentalmente.
- Entregas parciales y completas, incluyendo metadatos de canastas físicas y confirmaciones.
- Cierre de jornada e historial conservados después de reinicios y nuevos despliegues.
- Exportar e importar una copia de prueba y comparar conteos y hashes.
- Validar estándares: CR4 150 = 110 unidades; CR4 125 = 270 unidades; VOGE/VOGI 180 = 62 unidades por referencia; CH = 300 unidades por referencia. Preservar información de canastas y referencias de CR4 125.
- No mover los datos reales ni cambiar usuarios al nuevo host hasta que todas las pruebas estén aprobadas.

## Límites de seguridad

- No cancelar ni modificar Railway.
- No borrar, reiniciar ni reemplazar datos de producción.
- No ejecutar reiniciarDiaNKD().
- No tocar Cloudflare ni D1.
- No desplegar esta rama a producción sin revisión y autorización explícita.
