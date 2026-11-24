# Plan de implementación

**Ejecutar todas las tareas seguidas, sin pedir aprobación entre tareas.** Después de cada tarea: `npm run build` y `npm run lint` pasan, y commit `feat(infra-y-portal): <qué> [tarea n]`. `npm test` solo en la tarea 6. Archivos permitidos: `infra/` y `src/portal/app.js`.

Despliegue: Liz despliega después de la tarea 1 (esqueleto), de la 2 (base de conocimiento + `ingestar.mjs`) y de la 3 (necesaria antes de probar el núcleo).

- [ ] 1. Esqueleto desplegable
  - En `infra/lib/eva-stack.ts`: User Pool `eva-dev-usuarios` y su cliente; secreto `eva/dev/usuario-prueba`; usuario `SYN-USR-0001` (`CfnUserPoolUser`, `messageAction: 'SUPPRESS'`); tabla `eva-dev-estado`.
  - Lambda `eva-dev-nucleo` con el stub actual de `src/nucleo/handler.ts`, la configuración común de Lambdas del diseño y `TABLA_ESTADO`.
  - API `eva-dev-api` (`stageName: 'api'`) con los dos `POST` y el autorizador de Cognito.
  - Portal: bucket privado, `Distribution` con OAC, comportamiento `v1/*` hacia la API, CSP del diseño y `BucketDeployment` de `src/portal` + `config.json`.
  - Salidas `PortalUrl`, `ApiUrl`, `UserPoolId` y `UserPoolClientId`.
  - `infra/scripts/usuario-prueba.mjs`: lee el secreto con el AWS CLI y fija la contraseña permanente sin imprimirla.
  - _Requisitos: 1.1, 1.2, 1.3, 5.3, 6.1, 6.2, 6.3_

- [ ] 2. Base de conocimiento e ingesta
  - Bucket `eva-dev-kb-<cuenta>` y `BucketDeployment` **solo** de `data/conocimiento/documentos/general` a `general/`.
  - `CfnVectorBucket` `eva-dev-vectores` + `CfnIndex` `eva-kb` (1024, `cosine`, `float32`, con las dos `nonFilterableMetadataKeys`).
  - Rol de la KB con los permisos del diseño; `CfnKnowledgeBase` `eva-dev-kb` con Titan v2 y `S3_VECTORS`; `CfnDataSource` con `inclusionPrefixes: ['general/']`.
  - Salidas `KbId` y `DataSourceId`.
  - `infra/scripts/ingestar.mjs`: `StartIngestionJob`, consulta cada 5 s hasta `COMPLETE` (máximo 10 min), imprime las estadísticas y sale con código 1 si termina en `FAILED`.
  - _Requisitos: 2.1, 2.2, 2.3, 2.4_

- [ ] 3. Guardrail, conectores, Step Functions y núcleo completo
  - `CfnGuardrail` `eva-dev-guardrail` exactamente como en la sección "Guardrail" del diseño (STANDARD, perfil `us.guardrail.v1:0`, MISCONDUCT LOW en la entrada, sin grounding) y `CfnGuardrailVersion` con `description`.
  - Lambdas `eva-dev-skkeda` (con `TABLA_ESTADO` y acceso a la tabla) y `eva-dev-jira` (sin permisos).
  - Máquina Express `eva-dev-transaccional` con `Choice` `skkeda:*` / `jira:*`, `Pass` DENIED con `UNKNOWN_CONNECTOR` y logs ERROR sin datos de ejecución.
  - Al núcleo se le suman:
    - las variables `KB_ID`, `FLUJO_TRANSACCIONAL_ARN`, `MODEL_ID`, `GUARDRAIL_ID` y `GUARDRAIL_VERSION`;
    - `TITULOS_SECCION`, con la función `titulosSeccion`;
    - `INVESTIGACION_ACTIVA`, desde el contexto `investigacion`;
    - los permisos exactos de la tabla de permisos del diseño, sin `lambda:InvokeFunction`.
  - _Requisitos: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 5.1, 5.2_

- [ ] 4. Lógica del portal (`src/portal/app.js`)
  - Carga de `config.json`; ingreso con `InitiateAuth` y token en memoria; `#usuario-activo`; vuelta al ingreso ante un `401`.
  - Envío de mensajes con `conversationId`; burbujas con `#plantilla-mensaje`; fuentes, "Cómo lo investigué" y resumen con Confirmar y Cancelar; llamada a `/confirm` con los botones deshabilitados; mensajes de error del diseño.
  - Sugerencias de la demo (lista del diseño) como botones en `#sugerencias`. Solo `textContent` y el atributo `hidden`. No cambiar los id de `index.html`.
  - _Requisitos: 7.1, 7.2, 7.3, 7.4_

- [ ] 5. Prueba de humo
  - [ ] 5.1 `infra/scripts/prueba-humo.mjs`:
    - lee las salidas y el secreto con el AWS CLI e inicia sesión con `InitiateAuth`;
    - comprueba el `401` sin token;
    - ejecuta las preguntas 1 a 7 de `producto.md`, con "El jueves" en la misma conversación del piso 3;
    - confirma las reservas, comprueba que reconfirmar devuelve `404` y cancela al final los códigos `BK-…` creados;
    - imprime una tabla PASA/FALLA y sale con código 1 si algo falla.
    - _Requisitos: 8.1, 8.2, 8.3_
  - [ ]* 5.2 Con `--investigacion`: suma las preguntas 8 y 9 y muestra los `researchSteps`.
    - _Requisitos: 8.3_

- [ ] 6. Prueba del stack y cierre
  - Crear `infra/lib/eva-stack.test.ts`, una sola suite con `new App({ context: { 'aws:cdk:bundling-stacks': [] } })`, que verifique:
    - los nombres `eva-dev-*` de la tabla, las Lambdas, la máquina, la API, la KB y el guardrail;
    - que la política del núcleo no tenga `lambda:InvokeFunction` ni `"*"` como acción;
    - que el `CfnDataSource` tenga `inclusionPrefixes: ['general/']`;
    - que el guardrail tenga `tierName: 'STANDARD'` y no tenga `contextualGroundingPolicyConfig`.
  - Correr `npm run build`, `npm run lint`, `npm test` y `npm run synth`; los cuatro deben pasar.
  - _Requisitos: 2.3, 3.1, 3.3, 5.2_
