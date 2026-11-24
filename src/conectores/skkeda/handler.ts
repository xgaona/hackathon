import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { EstadoInvocacion, InvokeRequest, InvokeResult } from '../../comun/contrato';

type Piso = 2 | 3 | 4;
type ComandoDynamo = GetCommand | QueryCommand | TransactWriteCommand;

interface ClienteDynamo {
  send(command: ComandoDynamo): Promise<unknown>;
}

interface LoggerSaneado {
  error(registro: {
    correlationId: string;
    capabilityId: string;
    status: 'UNAVAILABLE';
    code: 'SOURCE_UNAVAILABLE';
  }): void;
}

interface Dependencias {
  cliente: ClienteDynamo;
  tabla: string;
  logger: LoggerSaneado;
}

interface ErrorGuardado {
  code: string;
  message: string;
}

interface ResultadoGuardado {
  capabilityId: string;
  status: EstadoInvocacion;
  data?: Record<string, unknown>;
  error?: ErrorGuardado;
}

interface RegistroDiario {
  pk: string;
  sk: string;
  status: 'ACTIVE' | 'CANCELLED';
  date: string;
  code?: string;
  resource?: string;
  floor?: Piso;
  version: number;
  idempotency: Record<string, ResultadoGuardado>;
}

interface RegistroOcupacion {
  pk: string;
  sk: string;
  userId: string;
  code: string;
  floor: Piso;
  date: string;
  status: 'ACTIVE';
  version: number;
}

interface RegistroReserva {
  pk: string;
  sk: 'BK';
  userId: string;
  code: string;
  resource: string;
  floor: Piso;
  date: string;
  status: 'ACTIVE' | 'CANCELLED';
  version: number;
}

interface Alternativa {
  resource: string;
  floor: Piso;
}

interface DatosReserva {
  code: string;
  resource: string;
  floor: Piso;
  date: string;
}

interface ParametrosCrear {
  kind: 'puesto';
  date: string;
  resource?: string;
  floor?: Piso;
}

const CAPACIDAD_CREAR = 'skkeda:booking.create';
const CAPACIDAD_LISTAR = 'skkeda:booking.list';
const CAPACIDAD_CANCELAR = 'skkeda:booking.cancel';
const PUESTO_VIRTUAL = 'P-12';
const ESTADO_ACTIVO = 'ACTIVE';
const ESTADO_CANCELADO = 'CANCELLED';

const MENSAJES = {
  UNKNOWN_CAPABILITY: 'La capacidad solicitada no está disponible',
  INVALID_PARAMETER: 'Los parámetros de la solicitud no son válidos',
  MISSING_IDEMPOTENCY: 'La operación requiere una clave de idempotencia',
  RESOURCE_TAKEN: 'El puesto solicitado no está disponible',
  DAILY_LIMIT: 'Ya existe una reserva para la persona en esa fecha',
  NOT_FOUND: 'No se encontró una reserva activa',
  SOURCE_UNAVAILABLE: 'El servicio de reservas no está disponible',
} as const;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function tieneSoloClaves(params: Record<string, unknown>, permitidas: readonly string[]): boolean {
  return Object.keys(params).every((clave) => permitidas.includes(clave));
}

function esFechaValida(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [anioTexto, mesTexto, diaTexto] = valor.split('-');
  const anio = Number(anioTexto);
  const mes = Number(mesTexto);
  const dia = Number(diaTexto);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

function numeroDePuesto(resource: string): number | undefined {
  const coincidencia = /^P-(\d{1,2})$/.exec(resource);
  if (!coincidencia) return undefined;
  const numero = Number(coincidencia[1]);
  return numero >= 1 && numero <= 40 ? numero : undefined;
}

export function pisoDe(resource: string): Piso | undefined {
  const numero = numeroDePuesto(resource);
  if (numero === undefined) return undefined;
  if (numero <= 14) return 2;
  if (numero <= 27) return 3;
  return 4;
}

function esPiso(valor: unknown): valor is Piso {
  return valor === 2 || valor === 3 || valor === 4;
}

function puestosDelPiso(piso: Piso): string[] {
  const inicio = piso === 2 ? 1 : piso === 3 ? 15 : 28;
  const fin = piso === 2 ? 14 : piso === 3 ? 27 : 40;
  return Array.from({ length: fin - inicio + 1 }, (_, indice) => `P-${inicio + indice}`);
}

function codigoReserva(date: string, resource: string): string {
  return `BK-SYN-${date.replaceAll('-', '')}-${resource.replace('-', '')}`;
}

function fechaDelCodigo(code: string): string | undefined {
  const coincidencia = /^BK-SYN-(\d{4})(\d{2})(\d{2})-P(?:[1-9]|[1-3]\d|40)$/.exec(code);
  if (!coincidencia) return undefined;
  const fecha = `${coincidencia[1]}-${coincidencia[2]}-${coincidencia[3]}`;
  return esFechaValida(fecha) ? fecha : undefined;
}

function errorResultado(
  solicitud: InvokeRequest,
  status: EstadoInvocacion,
  code: keyof typeof MENSAJES,
  data?: Record<string, unknown>,
): InvokeResult {
  return {
    correlationId: solicitud.correlationId,
    status,
    origin: 'mock',
    ...(data === undefined ? {} : { data }),
    error: {
      code,
      message: MENSAJES[code],
      correlationId: solicitud.correlationId,
    },
  };
}

function resultadoExitoso(solicitud: InvokeRequest, data: Record<string, unknown>): InvokeResult {
  return {
    correlationId: solicitud.correlationId,
    status: 'OK',
    origin: 'mock',
    data,
  };
}

function guardarForma(resultado: InvokeResult, capabilityId: string): ResultadoGuardado {
  return {
    capabilityId,
    status: resultado.status,
    ...(resultado.data === undefined ? {} : { data: structuredClone(resultado.data) }),
    ...(resultado.error === undefined
      ? {}
      : { error: { code: resultado.error.code, message: resultado.error.message } }),
  };
}

function reproducirResultado(solicitud: InvokeRequest, guardado: ResultadoGuardado): InvokeResult {
  return {
    correlationId: solicitud.correlationId,
    status: guardado.status,
    origin: 'mock',
    ...(guardado.data === undefined ? {} : { data: structuredClone(guardado.data) }),
    ...(guardado.error === undefined
      ? {}
      : {
          error: {
            ...guardado.error,
            correlationId: solicitud.correlationId,
          },
        }),
  };
}

function esCancelacionCondicional(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TransactionCanceledException' || error.name === 'ConditionalCheckFailedException')
  );
}

async function enviar<T>(cliente: ClienteDynamo, command: ComandoDynamo): Promise<T> {
  return (await cliente.send(command)) as T;
}

async function leerDia(
  deps: Dependencias,
  userId: string,
  date: string,
): Promise<RegistroDiario | undefined> {
  const salida = await enviar<{ Item?: RegistroDiario }>(
    deps.cliente,
    new GetCommand({
      TableName: deps.tabla,
      Key: { pk: `SKKEDA-USR#${userId}`, sk: date },
      ConsistentRead: true,
    }),
  );
  return salida.Item;
}

async function leerReserva(
  deps: Dependencias,
  code: string,
): Promise<RegistroReserva | undefined> {
  const salida = await enviar<{ Item?: RegistroReserva }>(
    deps.cliente,
    new GetCommand({
      TableName: deps.tabla,
      Key: { pk: `SKKEDA-BK#${code}`, sk: 'BK' },
      ConsistentRead: true,
    }),
  );
  return salida.Item;
}

async function consultarOcupaciones(deps: Dependencias, date: string): Promise<Set<string>> {
  const salida = await enviar<{ Items?: RegistroOcupacion[] }>(
    deps.cliente,
    new QueryCommand({
      TableName: deps.tabla,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `SKKEDA#${date}` },
      ConsistentRead: true,
    }),
  );
  const ocupados = new Set(
    (salida.Items ?? [])
      .filter((item) => item.status === ESTADO_ACTIVO)
      .map((item) => item.sk),
  );
  ocupados.add(PUESTO_VIRTUAL);
  return ocupados;
}

function alternativasDisponibles(ocupados: Set<string>, pisoPreferido: Piso): Alternativa[] {
  const pisos: Piso[] = [pisoPreferido, ...([2, 3, 4] as Piso[]).filter((piso) => piso !== pisoPreferido)];
  return pisos
    .flatMap((piso) => puestosDelPiso(piso))
    .filter((resource) => !ocupados.has(resource))
    .slice(0, 5)
    .map((resource) => ({ resource, floor: pisoDe(resource) as Piso }));
}

function validarCrear(params: Record<string, unknown>): ParametrosCrear | undefined {
  if (!tieneSoloClaves(params, ['kind', 'date', 'resource', 'floor'])) return undefined;
  if (params.kind !== 'puesto' || !esFechaValida(params.date)) return undefined;

  const resource = params.resource;
  const floor = params.floor;
  if (resource === undefined && floor === undefined) return undefined;
  if (resource !== undefined && (typeof resource !== 'string' || pisoDe(resource) === undefined)) {
    return undefined;
  }
  if (floor !== undefined && !esPiso(floor)) return undefined;
  if (typeof resource === 'string' && esPiso(floor) && pisoDe(resource) !== floor) return undefined;

  return {
    kind: 'puesto',
    date: params.date,
    ...(typeof resource === 'string' ? { resource } : {}),
    ...(esPiso(floor) ? { floor } : {}),
  };
}

function itemDiarioConResultado(
  userId: string,
  date: string,
  previo: RegistroDiario | undefined,
  idempotencyKey: string,
  capabilityId: string,
  resultado: InvokeResult,
): RegistroDiario {
  return {
    pk: `SKKEDA-USR#${userId}`,
    sk: date,
    status: previo?.status ?? ESTADO_CANCELADO,
    date,
    ...(previo?.code === undefined ? {} : { code: previo.code }),
    ...(previo?.resource === undefined ? {} : { resource: previo.resource }),
    ...(previo?.floor === undefined ? {} : { floor: previo.floor }),
    version: (previo?.version ?? 0) + 1,
    idempotency: {
      ...(previo?.idempotency ?? {}),
      [idempotencyKey]: guardarForma(resultado, capabilityId),
    },
  };
}

function condicionVersionada(
  previo: { version: number } | undefined,
  estadoEsperado?: 'ACTIVE' | 'CANCELLED',
): {
  ConditionExpression: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
} {
  if (previo === undefined) return { ConditionExpression: 'attribute_not_exists(pk)' };
  return {
    ConditionExpression: estadoEsperado
      ? '#version = :version AND #status = :status'
      : '#version = :version',
    ExpressionAttributeNames: {
      '#version': 'version',
      ...(estadoEsperado === undefined ? {} : { '#status': 'status' }),
    },
    ExpressionAttributeValues: {
      ':version': previo.version,
      ...(estadoEsperado === undefined ? {} : { ':status': estadoEsperado }),
    },
  };
}

async function persistirResultadoDiario(
  deps: Dependencias,
  solicitud: InvokeRequest,
  date: string,
  previo: RegistroDiario | undefined,
  resultado: InvokeResult,
): Promise<InvokeResult> {
  const idempotencyKey = solicitud.idempotencyKey as string;
  let actual = previo;

  for (let intento = 0; intento < 5; intento += 1) {
    const guardado = actual?.idempotency[idempotencyKey];
    if (guardado !== undefined) return reproducirResultado(solicitud, guardado);

    const item = itemDiarioConResultado(
      solicitud.userId,
      date,
      actual,
      idempotencyKey,
      solicitud.capabilityId,
      resultado,
    );
    try {
      await enviar(
        deps.cliente,
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: deps.tabla,
                Item: item,
                ...condicionVersionada(actual),
              },
            },
          ],
        }),
      );
      return resultado;
    } catch (error) {
      if (!esCancelacionCondicional(error)) throw error;
      actual = await leerDia(deps, solicitud.userId, date);
    }
  }

  throw new Error('No fue posible persistir el resultado idempotente');
}

function itemDiarioActivo(
  solicitud: InvokeRequest,
  previo: RegistroDiario | undefined,
  datos: DatosReserva,
  resultado: InvokeResult,
): RegistroDiario {
  return {
    pk: `SKKEDA-USR#${solicitud.userId}`,
    sk: datos.date,
    status: ESTADO_ACTIVO,
    date: datos.date,
    code: datos.code,
    resource: datos.resource,
    floor: datos.floor,
    version: (previo?.version ?? 0) + 1,
    idempotency: {
      ...(previo?.idempotency ?? {}),
      [solicitud.idempotencyKey as string]: guardarForma(resultado, CAPACIDAD_CREAR),
    },
  };
}

async function transaccionCrear(
  deps: Dependencias,
  solicitud: InvokeRequest,
  previoDia: RegistroDiario | undefined,
  previaReserva: RegistroReserva | undefined,
  datos: DatosReserva,
  resultado: InvokeResult,
): Promise<void> {
  const ocupacion: RegistroOcupacion = {
    pk: `SKKEDA#${datos.date}`,
    sk: datos.resource,
    userId: solicitud.userId,
    code: datos.code,
    floor: datos.floor,
    date: datos.date,
    status: ESTADO_ACTIVO,
    version: 1,
  };
  const reserva: RegistroReserva = {
    pk: `SKKEDA-BK#${datos.code}`,
    sk: 'BK',
    userId: solicitud.userId,
    code: datos.code,
    resource: datos.resource,
    floor: datos.floor,
    date: datos.date,
    status: ESTADO_ACTIVO,
    version: (previaReserva?.version ?? 0) + 1,
  };

  await enviar(
    deps.cliente,
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: deps.tabla,
            Item: ocupacion,
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
        {
          Put: {
            TableName: deps.tabla,
            Item: itemDiarioActivo(solicitud, previoDia, datos, resultado),
            ...condicionVersionada(previoDia, previoDia === undefined ? undefined : ESTADO_CANCELADO),
          },
        },
        {
          Put: {
            TableName: deps.tabla,
            Item: reserva,
            ...condicionVersionada(
              previaReserva,
              previaReserva === undefined ? undefined : ESTADO_CANCELADO,
            ),
          },
        },
      ],
    }),
  );
}

async function conflictoRecurso(
  deps: Dependencias,
  solicitud: InvokeRequest,
  date: string,
  pisoPreferido: Piso,
  dia: RegistroDiario | undefined,
): Promise<InvokeResult> {
  const ocupados = await consultarOcupaciones(deps, date);
  const resultado = errorResultado(solicitud, 'CONFLICT', 'RESOURCE_TAKEN', {
    alternatives: alternativasDisponibles(ocupados, pisoPreferido),
  });
  return persistirResultadoDiario(deps, solicitud, date, dia, resultado);
}

async function crearReserva(
  deps: Dependencias,
  solicitud: InvokeRequest,
  params: ParametrosCrear,
): Promise<InvokeResult> {
  const idempotencyKey = solicitud.idempotencyKey as string;
  let dia = await leerDia(deps, solicitud.userId, params.date);
  const guardado = dia?.idempotency[idempotencyKey];
  if (guardado !== undefined) return reproducirResultado(solicitud, guardado);

  if (dia?.status === ESTADO_ACTIVO) {
    const resultado = errorResultado(solicitud, 'CONFLICT', 'DAILY_LIMIT');
    return persistirResultadoDiario(deps, solicitud, params.date, dia, resultado);
  }

  let ocupados = await consultarOcupaciones(deps, params.date);
  const pisoPreferido =
    params.resource === undefined ? (params.floor as Piso) : (pisoDe(params.resource) as Piso);
  const candidatos =
    params.resource === undefined ? puestosDelPiso(pisoPreferido) : [params.resource];
  const maximoIntentos = params.resource === undefined ? candidatos.length : 3;
  let indiceCandidato = 0;
  let intentosTransaccion = 0;

  while (indiceCandidato < candidatos.length && intentosTransaccion < maximoIntentos) {
    const resource = candidatos[indiceCandidato];
    if (ocupados.has(resource)) {
      if (params.resource !== undefined) {
        return conflictoRecurso(deps, solicitud, params.date, pisoPreferido, dia);
      }
      indiceCandidato += 1;
      continue;
    }

    const code = codigoReserva(params.date, resource);
    const reservaPrevia = await leerReserva(deps, code);
    if (reservaPrevia?.status === ESTADO_ACTIVO) {
      ocupados.add(resource);
      if (params.resource !== undefined) {
        return conflictoRecurso(deps, solicitud, params.date, pisoPreferido, dia);
      }
      indiceCandidato += 1;
      continue;
    }

    const datos: DatosReserva = {
      code,
      resource,
      floor: pisoDe(resource) as Piso,
      date: params.date,
    };
    const resultado = resultadoExitoso(solicitud, { ...datos });
    intentosTransaccion += 1;

    try {
      await transaccionCrear(deps, solicitud, dia, reservaPrevia, datos, resultado);
      return resultado;
    } catch (error) {
      if (!esCancelacionCondicional(error)) throw error;

      dia = await leerDia(deps, solicitud.userId, params.date);
      const repetido = dia?.idempotency[idempotencyKey];
      if (repetido !== undefined) return reproducirResultado(solicitud, repetido);
      if (dia?.status === ESTADO_ACTIVO) {
        const limite = errorResultado(solicitud, 'CONFLICT', 'DAILY_LIMIT');
        return persistirResultadoDiario(deps, solicitud, params.date, dia, limite);
      }

      ocupados = await consultarOcupaciones(deps, params.date);
      if (ocupados.has(resource)) {
        if (params.resource !== undefined) {
          return conflictoRecurso(deps, solicitud, params.date, pisoPreferido, dia);
        }
        indiceCandidato += 1;
      }
    }
  }

  if (indiceCandidato >= candidatos.length) {
    return conflictoRecurso(deps, solicitud, params.date, pisoPreferido, dia);
  }
  throw new Error('Se agotaron los reintentos de reserva');
}

async function listarReservas(
  deps: Dependencias,
  solicitud: InvokeRequest,
  date: string | undefined,
): Promise<InvokeResult> {
  const salida = await enviar<{ Items?: RegistroDiario[] }>(
    deps.cliente,
    new QueryCommand({
      TableName: deps.tabla,
      KeyConditionExpression: date === undefined ? 'pk = :pk' : 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': `SKKEDA-USR#${solicitud.userId}`,
        ...(date === undefined ? {} : { ':sk': date }),
      },
      ConsistentRead: true,
    }),
  );

  const bookings = (salida.Items ?? [])
    .filter(
      (item): item is RegistroDiario & Required<Pick<RegistroDiario, 'code' | 'resource' | 'floor'>> =>
        item.status === ESTADO_ACTIVO &&
        item.code !== undefined &&
        item.resource !== undefined &&
        item.floor !== undefined,
    )
    .map((item) => ({
      date: item.date,
      resource: item.resource,
      floor: item.floor,
      code: item.code,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return resultadoExitoso(solicitud, { bookings });
}

async function resultadoNoEncontrado(
  deps: Dependencias,
  solicitud: InvokeRequest,
  date: string,
  dia: RegistroDiario | undefined,
): Promise<InvokeResult> {
  const resultado = errorResultado(solicitud, 'NOT_FOUND', 'NOT_FOUND');
  return persistirResultadoDiario(deps, solicitud, date, dia, resultado);
}

async function cancelarReserva(
  deps: Dependencias,
  solicitud: InvokeRequest,
  code: string,
  date: string,
): Promise<InvokeResult> {
  const idempotencyKey = solicitud.idempotencyKey as string;
  let dia = await leerDia(deps, solicitud.userId, date);
  const repetido = dia?.idempotency[idempotencyKey];
  if (repetido !== undefined) return reproducirResultado(solicitud, repetido);

  const reserva = await leerReserva(deps, code);
  if (reserva?.status !== ESTADO_ACTIVO || reserva.userId !== solicitud.userId) {
    return resultadoNoEncontrado(deps, solicitud, date, dia);
  }
  if (dia?.status !== ESTADO_ACTIVO || dia.code !== code) {
    throw new Error('Estado de reserva inconsistente');
  }

  const resultado = resultadoExitoso(solicitud, { code });
  const diaCancelado: RegistroDiario = {
    ...dia,
    status: ESTADO_CANCELADO,
    version: dia.version + 1,
    idempotency: {
      ...dia.idempotency,
      [idempotencyKey]: guardarForma(resultado, CAPACIDAD_CANCELAR),
    },
  };
  const reservaCancelada: RegistroReserva = {
    ...reserva,
    status: ESTADO_CANCELADO,
    version: reserva.version + 1,
  };

  try {
    await enviar(
      deps.cliente,
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: deps.tabla,
              Key: { pk: `SKKEDA#${date}`, sk: reserva.resource },
              ConditionExpression:
                '#code = :code AND #userId = :userId AND #status = :status AND #version = :version',
              ExpressionAttributeNames: {
                '#code': 'code',
                '#userId': 'userId',
                '#status': 'status',
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':code': code,
                ':userId': solicitud.userId,
                ':status': ESTADO_ACTIVO,
                ':version': 1,
              },
            },
          },
          {
            Put: {
              TableName: deps.tabla,
              Item: diaCancelado,
              ConditionExpression: '#code = :code AND #status = :status AND #version = :version',
              ExpressionAttributeNames: {
                '#code': 'code',
                '#status': 'status',
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':code': code,
                ':status': ESTADO_ACTIVO,
                ':version': dia.version,
              },
            },
          },
          {
            Put: {
              TableName: deps.tabla,
              Item: reservaCancelada,
              ConditionExpression:
                '#userId = :userId AND #status = :status AND #version = :version',
              ExpressionAttributeNames: {
                '#userId': 'userId',
                '#status': 'status',
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':userId': solicitud.userId,
                ':status': ESTADO_ACTIVO,
                ':version': reserva.version,
              },
            },
          },
        ],
      }),
    );
    return resultado;
  } catch (error) {
    if (!esCancelacionCondicional(error)) throw error;
    dia = await leerDia(deps, solicitud.userId, date);
    const resultadoConcurrente = dia?.idempotency[idempotencyKey];
    if (resultadoConcurrente !== undefined) {
      return reproducirResultado(solicitud, resultadoConcurrente);
    }
    const reservaActual = await leerReserva(deps, code);
    if (reservaActual?.status !== ESTADO_ACTIVO || reservaActual.userId !== solicitud.userId) {
      return resultadoNoEncontrado(deps, solicitud, date, dia);
    }
    throw error;
  }
}

async function procesar(deps: Dependencias, solicitud: InvokeRequest): Promise<InvokeResult> {
  if (
    solicitud.capabilityId !== CAPACIDAD_CREAR &&
    solicitud.capabilityId !== CAPACIDAD_LISTAR &&
    solicitud.capabilityId !== CAPACIDAD_CANCELAR
  ) {
    return errorResultado(solicitud, 'DENIED', 'UNKNOWN_CAPABILITY');
  }
  if (!esObjeto(solicitud.params)) {
    return errorResultado(solicitud, 'FAILED', 'INVALID_PARAMETER');
  }

  if (solicitud.capabilityId === CAPACIDAD_CREAR) {
    if (!solicitud.idempotencyKey) {
      return errorResultado(solicitud, 'FAILED', 'MISSING_IDEMPOTENCY');
    }
    const params = validarCrear(solicitud.params);
    if (params === undefined) return errorResultado(solicitud, 'FAILED', 'INVALID_PARAMETER');
    return crearReserva(deps, solicitud, params);
  }

  if (solicitud.capabilityId === CAPACIDAD_LISTAR) {
    if (!tieneSoloClaves(solicitud.params, ['date'])) {
      return errorResultado(solicitud, 'FAILED', 'INVALID_PARAMETER');
    }
    const date = solicitud.params.date;
    if (date !== undefined && !esFechaValida(date)) {
      return errorResultado(solicitud, 'FAILED', 'INVALID_PARAMETER');
    }
    return listarReservas(deps, solicitud, date);
  }

  if (!solicitud.idempotencyKey) {
    return errorResultado(solicitud, 'FAILED', 'MISSING_IDEMPOTENCY');
  }
  if (!tieneSoloClaves(solicitud.params, ['code'])) {
    return errorResultado(solicitud, 'FAILED', 'INVALID_PARAMETER');
  }
  const code = solicitud.params.code;
  if (typeof code !== 'string') {
    return errorResultado(solicitud, 'FAILED', 'INVALID_PARAMETER');
  }
  const date = fechaDelCodigo(code);
  if (date === undefined) return errorResultado(solicitud, 'FAILED', 'INVALID_PARAMETER');
  return cancelarReserva(deps, solicitud, code, date);
}

export function crearHandler(deps: Dependencias): (solicitud: InvokeRequest) => Promise<InvokeResult> {
  return async (solicitud: InvokeRequest): Promise<InvokeResult> => {
    try {
      return await procesar(deps, solicitud);
    } catch {
      deps.logger.error({
        correlationId: solicitud.correlationId,
        capabilityId: solicitud.capabilityId,
        status: 'UNAVAILABLE',
        code: 'SOURCE_UNAVAILABLE',
      });
      return errorResultado(solicitud, 'UNAVAILABLE', 'SOURCE_UNAVAILABLE');
    }
  };
}

const clienteProductivo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = crearHandler({
  cliente: clienteProductivo,
  tabla: process.env.TABLA_ESTADO ?? '',
  logger: console,
});
