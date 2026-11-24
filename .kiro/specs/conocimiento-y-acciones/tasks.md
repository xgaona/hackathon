# Plan de implementación

Ejecutar todas las tareas seguidas, sin pedir aprobación entre tareas. Después de cada tarea: `npm run build` y `npm run lint` pasan. `npm test` se corre en la tarea 4. Solo se tocan `src/conectores/`, `infra/scripts/evaluar-conocimiento.mjs` y `data/conocimiento/` (esta última solo en la tarea opcional 6).

- [ ] 1. Conector Skkeda con pisos
  - Reemplazar el stub de `src/conectores/skkeda/handler.ts` con `crearHandler(deps)`, `handler` y `pisoDe` según design.md.
  - `booking.create`: validar `date`, `resource` (`P-1`–`P-40`) y `floor` (2, 3, 4); exigir `idempotencyKey`; devolver el resultado guardado si la clave se repite; `DAILY_LIMIT`; ocupados del día más `P-12`; libres con el piso preferido primero; `RESOURCE_TAKEN` con hasta 5 alternativas (también si el piso pedido está lleno); `NO_AVAILABILITY`; código `BK-SYN-<AAAAMMDD>-<puesto sin guion>`; `TransactWriteCommand` con `attribute_not_exists(pk)` en el puesto y en el límite diario; `data` con `code`, `resource`, `floor`, `date`.
  - `booking.list` y `booking.cancel` según design.md.
  - Envolver todo en `try/catch` → `UNAVAILABLE`/`SKKEDA_ERROR`, log solo con `correlationId`, `capabilityId` y nombre del error.
  - Archivos: `src/conectores/skkeda/handler.ts`.
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 5.1, 5.2_

- [ ] 2. Mock de Jira de solo lectura
  - Reemplazar el stub de `src/conectores/jira/handler.ts`: las 4 tareas fijas de design.md, `status` `OPEN` (por defecto) o `ALL`, filtro por `project` sin distinguir mayúsculas, `data: { items, soloAbiertas }`, `sourceRef: "jira:mock"`, `origin: "mock"`.
  - Otra capacidad → `DENIED` con `UNKNOWN_CAPABILITY`.
  - Archivos: `src/conectores/jira/handler.ts`.
  - _Requisitos: 4.1, 4.2, 4.3_

- [ ] 3. Revisar el corpus del kit contra los conectores
  - Confirmar que `data/conocimiento/documentos/general/reserva-puestos-salas.md` dice los mismos rangos de piso que `pisoDe` y que `data/skkeda/catalogo.json` acepta `floor` 2, 3 y 4.
  - Confirmar que `restringido/` no tiene ningún archivo en `general/`.
  - Sin cambios de código si todo coincide; si no, avisar en lugar de cambiar el corpus.
  - _Requisitos: 1.2, 7.2_

- [ ] 4. Pruebas imprescindibles
  - `src/conectores/skkeda/handler.test.ts` con un DynamoDB simulado en memoria: `P-12` ocupado → `RESOURCE_TAKEN` con alternativas del piso 2 primero; `floor: 3` sin puesto → `P-15`; segunda reserva el mismo día → `DAILY_LIMIT`; misma `idempotencyKey` dos veces → mismo `code` y una sola reserva.
  - `src/conectores/jira/handler.test.ts`: sin `status` → 3 tareas y ninguna "Hecho".
  - Correr `npm run build`, `npm test` y `npm run lint`; corregir dentro de `src/conectores/` hasta que pasen.
  - _Requisitos: 1.2, 2.1, 2.2, 2.4, 3.2, 4.1_

- [ ]* 5. Script de evaluación de la base de conocimiento
  - Crear `infra/scripts/evaluar-conocimiento.mjs` según design.md: `KB_ID` o salida `KbId` del stack `eva-dev`, `Retrieve` con filtro `GENERAL`, top-1, top-3, `NO_ANSWER` correctos (ningún resultado ≥ 0,65), falla de seguridad si aparece `DOC-SYN-9001` o `DOC-SYN-9002`, sin imprimir pasajes, omitiendo `"tipo": "INVESTIGACION"`.
  - Verificación: `npm run evaluar` contra el stack desplegado (lo ejecuta Liz).
  - _Requisitos: 6.1, 6.2, 6.3_

- [ ]* 6. Ampliar el corpus (beneficios, uso de Teams) si sobra tiempo
  - Agregar `beneficios.md` (DOC-SYN-0010) y `teams-correo.md` (DOC-SYN-0011) en `data/conocimiento/documentos/general/` con su `.metadata.json`, título `#`, "Documento sintético para demostración" y 3 a 5 secciones `##` con cifras que no contradigan a los otros documentos.
  - Opcional: 1 pregunta por documento nuevo en `evaluacion.json`.
  - Avisar a Liz para redesplegar e ingestar.
  - _Requisitos: 7.1, 7.2, 7.3_
