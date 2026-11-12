# Plan de migración segura de Familia AKT Control de Canastas

## Objetivo
Evaluar una alternativa de alojamiento sin costo recurrente sin interrumpir la aplicación actual, conservar todos los datos y mantener la interfaz, roles y funciones existentes.

## Restricciones no negociables
- No cancelar ni modificar el proyecto o servicio de Railway durante la preparación.
- No borrar, reiniciar ni reemplazar el volumen ni los archivos de producción.
- No ejecutar la función de reinicio de jornada.
- No cambiar a una URL nueva hasta que las pruebas de aceptación y la comparación de datos sean satisfactorias.
- No usar Cloudflare ni D1 para esta migración.
- No incluir datos de producción, contraseñas ni secretos en GitHub.

## Hallazgos del código actual
- La aplicación usa Node.js y un servidor HTTP propio; el comando de inicio es `node server.js`.
- El estado principal se guarda en `data/state.json`.
- Los cierres de jornada se archivan como archivos JSON dentro de `data/history/`.
- El cliente lee `GET /api/state` y persiste cambios con `PUT /api/state`.
- El estado incluye, como mínimo, usuarios, tareas activas, catálogo LPN y entregas libres.
- El endpoint de cierre de jornada archiva las tareas y conserva pendientes/parciales para el siguiente turno.
- La aplicación tiene sincronización local de respaldo en el navegador; no debe confundirse con una copia de seguridad completa del servidor.

## Riesgos que deben resolverse antes de migrar
1. Un alojamiento gratuito con disco efímero puede perder el estado al reiniciar o desplegar. No se debe usar como destino definitivo con el almacenamiento actual.
2. El histórico de `data/history/` debe exportarse y verificarse; migrar solo `state.json` no es suficiente.
3. El servidor actual expone el estado completo en `GET /api/state`, incluyendo el objeto de usuarios. Antes de una migración pública se debe corregir el control de acceso y dejar de devolver credenciales al cliente, conservando la compatibilidad con el inicio de sesión.
4. El `PUT /api/state` acepta una instantánea de estado desde el cliente. Se deben probar concurrencia, integridad y errores de escritura antes de cambiar el almacenamiento.
5. Debe existir un procedimiento de exportación, importación, conteo y comparación de datos antes del cambio de URL.

## Arquitectura candidata
Mantener la aplicación Node.js y reemplazar el almacenamiento de archivos por una base de datos PostgreSQL administrada en un plan gratuito, solo después de verificar sus límites, disponibilidad y condiciones vigentes. La base de datos debe almacenar el estado completo y los archivos de historial (o registros equivalentes) con una estrategia de respaldo y restauración. No se debe asumir que un plan gratuito es permanente ni que sus límites actuales permanecerán iguales.

## Plan por etapas
1. **Preparación aislada:** mantener estos cambios en una rama independiente; no desplegar a producción.
2. **Diseño de datos:** definir cómo guardar el estado completo y cada archivo histórico, incluyendo fecha, metadatos y tareas archivadas.
3. **Adaptador de almacenamiento:** implementar una capa que permita probar el backend PostgreSQL sin modificar el comportamiento de la aplicación.
4. **Pruebas automáticas:** verificar lectura/escritura, cargas parciales, guardado de usuarios/tareas/catálogos/entregas, cierre de jornada, restauración y concurrencia.
5. **Migración de ensayo:** importar una copia de respaldo no sensible en una base separada y comparar conteos y hashes; no usar datos reales en repositorios.
6. **Pruebas funcionales:** verificar inicio de sesión, roles, captura de canastas, estándares CR4 150 (110 unidades), CR4 125 (270 unidades), VOGE/VOGI 180 (62 unidades por referencia), CH (300 por referencia), historial y entregas libres.
7. **Aceptación y reversión:** documentar cómo volver al servicio actual sin pérdida. Mantener Railway operativo y sin tocarlo.
8. **Cambio controlado:** solo tras aprobación explícita del usuario, pruebas satisfactorias y verificación de respaldos.

## Criterios para considerar lista la migración
- Todos los datos activos y el histórico se han contado y comparado.
- No hay credenciales ni secretos expuestos en respuestas públicas o registros.
- Las pruebas de escritura y cierre de jornada pasan.
- La base de datos y el alojamiento no requieren un método de pago obligatorio para el uso previsto; se han explicado límites y posibles pausas.
- Railway continúa disponible como retorno y no se ha eliminado ni alterado su volumen.
- El usuario ha recibido la nueva URL y ha aprobado el cambio después de probarla.

## Estado
Este documento registra el análisis inicial. No contiene datos de producción y no realiza cambios en Railway ni en la base de datos productiva.
