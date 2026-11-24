# Escenarios de mock por tercero (E-15)

Lista, por tercero, los escenarios de `X-Mock-Scenario` que deben soportar los mocks de `services/mocks/{daruma,skkeda,jira}` (E-32 y E-36). Complementa la tabla general de [`README.md`](./README.md) (sección "Escenarios de mock", líneas 26–40), que define el comportamiento de cada escenario.

Los tres contratos declaran el mismo conjunto de valores, con `ok` como valor por defecto: `ok`, `timeout`, `server_error`, `access_denied`, `conflict`, `rate_limited`, `stale_classification` (`daruma-v1.yaml` líneas 265–273, `skkeda-v1.yaml` líneas 386–394, `jira-v1.yaml` líneas 328–336). La cabecera solo existe en dev/test; en producción el adaptador nunca la envía (RS-17).

> La columna "Aplica a" sale de la tabla del README y de las respuestas declaradas en cada YAML. Antes de implementar un mock hay que confirmar el código de estado de cada operación contra el YAML correspondiente.

## Daruma (`daruma-v1.yaml`, SUPUESTO sin validar con el proveedor, solo lectura)

Operaciones: `documentSearch` (`GET /documents/search`), `documentGet` (`GET /documents/{documentId}`), `documentListGeneral` (`GET /knowledge/documents`), `healthGet`.

| Escenario | Aplica a | Respuesta esperada | Qué prueba |
|---|---|---|---|
| `ok` | todas | 200 con datos sintéticos (`DOC-SYN-0001`, `DOC-SYN-0002`, `DOC-SYN-0107`) | CU1 flujo feliz |
| `access_denied` | `documentGet`, `documentSearch` | 403 `ACCESS_DENIED`. EVA responde sin revelar si el documento existe | RF-15.3, RS-09 |
| `stale_classification` | `documentListGeneral` | Devuelve `DOC-SYN-0002` ahora como `RESTRICTED`. La ingesta lo retira del índice | RF-13.4, RS-16, CP-10 |
| `timeout` | todas | El mock espera 35 s. Daruma caído → EVA responde con lo indexado y avisa | RF-21, RNF-05 |
| `server_error` | todas | 500 `SOURCE_ERROR`; reintentos y cortocircuito | RF-21.3 |
| `rate_limited` | todas | 429 con `Retry-After: 2` | RF-21 |
| `conflict` | ninguna | Sin sentido en una API de solo lectura | n/a |

## Skkeda (`skkeda-v1.yaml`, SUPUESTO sin validar con el proveedor)

Operaciones: `siteList`, `spaceAvailability` (`GET /availability`), `bookingList`, `bookingCreate` (`POST /bookings`, idempotente), `bookingCancel` (`DELETE /bookings/{bookingId}`), `policyListGeneral` (`GET /knowledge/policies`), `healthGet`. Además declara la respuesta `503 Unavailable`.

| Escenario | Aplica a | Respuesta esperada | Qué prueba |
|---|---|---|---|
| `ok` | todas | 200/201 con datos sintéticos (`SITE-BOG-01`, `SITE-MED-01`) | CU2 flujo feliz |
| `conflict` | `bookingCreate` | 409 con `alternatives` (espacios libres) | RF-18.5 |
| `access_denied` | operaciones con identidad | 403 `ACCESS_DENIED` | RS-09 |
| `timeout` | todas | Espera 35 s; el cortocircuito `CB#skkeda` aísla solo a Skkeda | RF-21, RNF-05 |
| `server_error` | todas | 500 `SOURCE_ERROR`. En una escritura la acción sigue `PENDING` y el reintento usa la misma `Idempotency-Key` | RF-21.3, RF-09 |
| `rate_limited` | todas | 429 con `Retry-After: 2` | RF-21 |
| `stale_classification` | `policyListGeneral` | Un ítem antes `GENERAL` ahora `RESTRICTED` | RS-16 |

## Jira (`jira-v1.yaml`, subconjunto de la API REST v3)

Operaciones: `issueGet`, `issueSearch` (`GET /rest/api/3/search/jql`), `projectGet`, `issueCreate`, `issueTransitionsGet`, `issueTransition`, `issueComment`.

| Escenario | Aplica a | Respuesta esperada | Qué prueba |
|---|---|---|---|
| `ok` | todas | 200/201/204 con datos sintéticos | CU3 flujo feliz |
| `conflict` | `issueTransition` | 409 | RF-19 |
| `access_denied` | operaciones con identidad | 403 de Jira | RS-09 |
| `timeout` | todas | Espera 35 s | RF-21 |
| `server_error` | todas | 500; sin éxito declarado sin 201/204 | RF-19 |
| `rate_limited` | todas | 429 con `Retry-After: 2` | RF-21 |
| `stale_classification` | ninguna | Jira no se ingesta en el MVP | n/a |

## Cobertura en la demo local (`demo/`)

La demo no usa HTTP ni los contratos; imita los escenarios a nivel de lógica. Es referencia funcional, no cumple los contratos.

| Escenario del contrato | En la demo | Cómo se activa |
|---|---|---|
| `ok` | Sí | Por defecto |
| `conflict` (Skkeda `bookingCreate`) | Sí, con `alternatives` | Reservar `P-12` mañana (ocupado de origen) |
| `access_denied` (Daruma) | Sí, 403 que no revela existencia | `Abre DOC-SYN-003` como Ana |
| `timeout` | Parcial: devuelve 504 al instante en vez de esperar 35 s | Selector "Skkeda · timeout" |
| `server_error` | Sí (Skkeda y Jira), con cortocircuito tras 3 fallas | Selector "· error 500" |
| `rate_limited` | Sí, solo Skkeda | Selector "Skkeda · rate limit" |
| `stale_classification` | **No** (el criterio 7 de aceptación sigue sin evidencia) | — |

Diferencias a resolver al llevar la demo a `services/`:

1. La demo usa `X-Mock-Scenario: <conector>:<escenario>` (por ejemplo `skkeda:timeout`). El contrato usa solo el nombre del escenario, porque cada mock es un servicio aparte. Al implementar los mocks hay que adoptar el formato del contrato.
2. La demo no tiene `spaceAvailability`, `issueGet`, `projectGet`, `issueTransition` ni `issueComment`, que sí están en los contratos (necesarios para T-19 y T-20).
3. Los datos de la demo (`DOC-SYN-003`, `P-12`) no coinciden con los del contrato (`DOC-SYN-0107`, `SITE-BOG-01`).
4. Falta añadir `stale_classification` y un 403 en operaciones de Skkeda y Jira.
