# Preflight seguro: proteger datos y corregir API antes de migrar

## Estado y límites
- Trabajo de preparación únicamente en esta rama; no desplegar automáticamente desde ella.
- No modificar ni cancelar Railway, no tocar Cloudflare/D1 y no borrar/restablecer datos.
- No copiar datos reales, contraseñas, sesiones ni archivos de producción a pruebas.
- La app actual persiste estado e historial en archivos JSON. En un host efímero no se puede asumir persistencia entre reinicios/despliegues.
- El cliente actual descarga el estado completo y compara credenciales en el navegador. El API de estado permite lectura y escritura sin autenticación. No usar la URL pública para probar endpoints que puedan revelar datos.

## Bloqueos para uso real
1. **Autenticación en servidor:** todas las rutas de estado, guardado y cierre de jornada deben requerir una sesión validada en el servidor. El cliente no debe recibir contraseñas ni hashes exportables con los usuarios.
2. **Autorización por rol:** validar en servidor qué usuarios pueden leer, editar o cerrar jornadas; no confiar en el rol enviado por el navegador.
3. **Protección de sesión y solicitudes:** cookies HttpOnly, Secure y SameSite; protección CSRF para operaciones mutables; límites de intentos de inicio de sesión.
4. **Validación de datos:** limitar tamaño del cuerpo, validar esquema y campos, manejar errores sin exponer secretos. No permitir que un cliente reemplace arbitrariamente todo el estado compartido.
5. **Persistencia duradera:** migrar el estado activo y el historial a almacenamiento persistente respaldado (base de datos administrada o disco persistente verificado). El disco local temporal de un servicio web no basta.
6. **Integridad y recuperación:** exportación/backup verificable antes de cualquier migración, importación idempotente, conteos y comprobación de registros. No hacer la migración real hasta comparar origen y destino.
7. **Credenciales expuestas:** cambiar las credenciales predeterminadas conocidas y retirar credenciales de demostración de la pantalla pública; no incluir secretos en el repositorio.

## Pruebas obligatorias con datos ficticios
- Inicio de sesión válido e inválido; usuario no autenticado recibe 401 en cada ruta privada.
- Usuario con rol insuficiente recibe 403 al intentar guardar o cerrar jornada.
- No se filtran campos de contraseña/hash al navegador ni a logs.
- Dos clientes concurrentes no sobrescriben silenciosamente cambios ajenos.
- Crear tarea, registrar entrega completa y parcial, y cerrar jornada; validar estados y archivo histórico.
- Reiniciar/re-desplegar el entorno de prueba y confirmar que tareas, entregas, catálogos, estándares e historial siguen presentes.
- Probar backup y restauración y comparar conteos/checksums antes y después.
- Revisar los estándares existentes: CR4 150 = 110 unidades; CR4 125 = 270 unidades; VOGE/VOGI 180 = 62 por referencia; CH = 300 por referencia. Preservar la información de canastas/referencias CR4 125.

## Orden de ejecución
1. Implementar cambios en una rama aislada y añadir pruebas automatizadas.
2. Ejecutar pruebas estáticas y funcionales en entorno aislado con datos sintéticos.
3. Desactivar cualquier despliegue automático de esta rama; no publicar hasta revisión.
4. Verificar persistencia y seguridad en Render con datos ficticios únicamente.
5. Preparar plan de respaldo y migración de datos reales sin ejecutarlo.
6. Solo después de revisión explícita, decidir el cambio de hosting. Mantener Railway intacto hasta completar la verificación y aceptación.

## Criterio de aceptación
No poner datos reales ni cambiar el sistema principal hasta que todas las pruebas anteriores pasen, la persistencia esté confirmada y exista un respaldo restaurable. Esta lista no afirma que esos cambios estén implementados; registra los requisitos de salida.
