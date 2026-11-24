// Acciones en terceros: la IA propone, el Policy Engine autoriza y Step Functions ejecuta.
import Ajv, { type ValidateFunction } from 'ajv';
import type { EstadoInvocacion, InvokeRequest, InvokeResult } from '../comun/contrato';
import { esFechaValida, esPasada, fechaLegible } from './calendario';
import type { Estado } from './estado';
import { igualesSeguro, jsonCanonico, sha256Hex } from './hash';
import { log } from './registro';
import { evaluar, type Catalogo } from './politica';
import { MENSAJE_DENEGADO } from './respuesta';
import type { Contexto, PedidoEnCurso, Propuesta, Salida, Turno } from './tipos';

export interface ContextoAccion extends Contexto {
  catalogo: Catalogo;
  estado: Estado;
}

type Params = Record<string, unknown>;

const PISOS_VALIDOS = [2, 3, 4];
const MIN_PUESTO = 1;
const MAX_PUESTO = 40;
const VIGENCIA_PENDIENTE_MS = 15 * 60 * 1000;
const ESTADOS_INVOCACION: EstadoInvocacion[] = ['OK', 'NOT_FOUND', 'DENIED', 'CONFLICT', 'FAILED', 'UNAVAILABLE'];

export const MENSAJE_ESCALADO =
  'El servicio no está respondiendo en este momento. Si es urgente, te recomiendo contactar a soporte.';

const ajv = new Ajv({ strict: false });
const validadores = new Map<string, ValidateFunction>();

function validadorDe(capabilityId: string, esquema: Record<string, unknown>): ValidateFunction {
  let v = validadores.get(capabilityId);
  if (!v) {
    v = ajv.compile(esquema);
    validadores.set(capabilityId, v);
  }
  return v;
}

// ---------------------------------------------------------------- limpieza de parámetros

/** Deja solo los parámetros que el catálogo declara y descarta los valores sin sentido. */
export function limpiarParams(params: Params, esquema: Record<string, unknown>): Params {
  const permitidos = Object.keys((esquema.properties as Record<string, unknown> | undefined) ?? {});
  const limpio: Params = {};
  for (const clave of permitidos) {
    const valor = params[clave];
    if (valor === undefined || valor === null || valor === '') continue;
    switch (clave) {
      case 'resource': {
        const r = typeof valor === 'string' ? valor.trim().toUpperCase() : '';
        const numero = Number(r.slice(2));
        if (/^P-\d{1,2}$/.test(r) && numero >= MIN_PUESTO && numero <= MAX_PUESTO) limpio.resource = r;
        break;
      }
      case 'floor': {
        const n = typeof valor === 'string' && /^\d+$/.test(valor.trim()) ? Number(valor) : valor;
        if (typeof n === 'number' && Number.isInteger(n)) limpio.floor = n;
        break;
      }
      case 'date':
        if (esFechaValida(valor)) limpio.date = valor;
        break;
      case 'kind':
        if (typeof valor === 'string') limpio.kind = valor.trim().toLowerCase();
        break;
      case 'status':
        if (typeof valor === 'string' && ['OPEN', 'ALL'].includes(valor.trim().toUpperCase())) {
          limpio.status = valor.trim().toUpperCase();
        }
        break;
      default:
        limpio[clave] = valor;
    }
  }
  return limpio;
}

/** El mensaje completa el pedido que quedó incompleto en el turno anterior. */
function completarConPedido(nuevos: Params, capabilityId: string, turnos: Turno[]): Params {
  const previo = turnos.length > 0 ? turnos[turnos.length - 1].accion : undefined;
  if (!previo || previo.capabilityId !== capabilityId) return nuevos;
  const base: Params = { ...previo.params };
  // Si nombra un puesto, el piso anterior ya no aplica.
  if ('resource' in nuevos) delete base.floor;
  return { ...base, ...nuevos };
}

// ---------------------------------------------------------------- reglas previas por capacidad

interface ResultadoReglas {
  params: Params;
  salida?: Salida;
}

function aclaracion(capabilityId: string, params: Params, reply: string): Salida {
  const accion: PedidoEnCurso = { capabilityId, params };
  return { status: 'NEEDS_CLARIFICATION', reply, turnoExtra: { accion } };
}

function reglasReserva(ctx: Contexto, capabilityId: string, entrada: Params): ResultadoReglas {
  const params: Params = { ...entrada };
  if (params.kind === 'sala') {
    return { params, salida: { status: 'DENIED', reply: 'Por ahora solo puedo reservar puestos de trabajo.' } };
  }
  params.kind = 'puesto';
  if (typeof params.floor === 'number' && !PISOS_VALIDOS.includes(params.floor)) {
    const { floor: _piso, ...sinPiso } = params;
    return {
      params,
      salida: aclaracion(capabilityId, sinPiso, 'Los pisos disponibles son el 2, el 3 y el 4. ¿En cuál quieres el puesto?'),
    };
  }
  const enPiso = typeof params.floor === 'number' ? ` en el piso ${params.floor}` : '';
  if (params.date === undefined) {
    return { params, salida: aclaracion(capabilityId, params, `¿Para qué día quieres el puesto${enPiso}?`) };
  }
  if (esPasada(params.date as string, ctx.deps.ahora())) {
    const { date: _fecha, ...sinFecha } = params;
    return {
      params,
      salida: aclaracion(capabilityId, sinFecha, `Esa fecha ya pasó. ¿Para qué día quieres el puesto${enPiso}?`),
    };
  }
  return { params };
}

const REGLAS_PREVIAS: Record<string, (ctx: Contexto, capabilityId: string, params: Params) => ResultadoReglas> = {
  'skkeda:booking.create': reglasReserva,
};

// ---------------------------------------------------------------- resúmenes de escrituras

interface Resumen {
  summary: Record<string, string>;
  reply: string;
}

export function resumenReserva(params: Params): Resumen {
  const piso = typeof params.floor === 'number' ? params.floor : undefined;
  const resource = typeof params.resource === 'string' ? params.resource : undefined;
  const fecha = fechaLegible(params.date as string);
  const summary: Record<string, string> = {};
  if (piso !== undefined) summary.piso = String(piso);
  summary.puesto = resource ?? (piso !== undefined ? `El primero libre del piso ${piso}` : 'El primero libre');
  summary.fecha = fecha;
  const que = resource ? `el puesto ${resource}` : piso !== undefined ? `el primer puesto libre del piso ${piso}` : 'el primer puesto libre';
  return { summary, reply: `Voy a reservar ${que} para el ${fecha}. ¿Confirmas?` };
}

const RESUMENES: Record<string, (params: Params) => Resumen> = {
  'skkeda:booking.create': resumenReserva,
  'skkeda:booking.cancel': (params) => ({
    summary: { accion: 'Cancelar la reserva', codigo: String(params.code) },
    reply: `Voy a cancelar la reserva ${String(params.code)}. ¿Confirmas?`,
  }),
};

function resumenGenerico(capabilityId: string, params: Params): Resumen {
  const summary: Record<string, string> = { accion: capabilityId };
  for (const [k, v] of Object.entries(params)) summary[k] = String(v);
  return { summary, reply: `Voy a ejecutar ${capabilityId}. ¿Confirmas?` };
}

// ---------------------------------------------------------------- acción pendiente

export async function crearPendiente(
  ctx: ContextoAccion,
  capabilityId: string,
  params: Params,
  resumen: Resumen,
): Promise<Salida> {
  const ahora = ctx.deps.ahora();
  const summaryHash = sha256Hex(jsonCanonico(resumen.summary));
  const pendingActionId = ctx.deps.nuevoId();
  await ctx.estado.guardarPendiente(ctx.conversationId, {
    pendingActionId,
    capabilityId,
    params,
    summary: resumen.summary,
    summaryHash,
    expiresAt: new Date(ahora.getTime() + VIGENCIA_PENDIENTE_MS).toISOString(),
    userId: ctx.identidad.userId,
  });
  return {
    status: 'AWAITING_CONFIRMATION',
    reply: resumen.reply,
    pendingAction: { pendingActionId, capabilityId, summary: resumen.summary, summaryHash },
  };
}

// ---------------------------------------------------------------- invocación por Step Functions

function sinteticoNoDisponible(correlationId: string): InvokeResult {
  return { correlationId, status: 'UNAVAILABLE', origin: 'mock' };
}

async function invocarUnaVez(ctx: Contexto, req: InvokeRequest): Promise<InvokeResult> {
  try {
    const r = await ctx.deps.sfn.startSyncExecution({ stateMachineArn: ctx.cfg.flujoArn, input: JSON.stringify(req) });
    if (r.status !== 'SUCCEEDED' || !r.output) return sinteticoNoDisponible(req.correlationId);
    const resultado = JSON.parse(r.output) as InvokeResult;
    if (!resultado || !ESTADOS_INVOCACION.includes(resultado.status)) return sinteticoNoDisponible(req.correlationId);
    return resultado;
  } catch {
    return sinteticoNoDisponible(req.correlationId);
  }
}

/** Solo la identidad del token viaja en el InvokeRequest. Un reintento ante los estados indicados. */
export async function invocar(
  ctx: Contexto,
  capabilityId: string,
  params: Params,
  reintentarEn: EstadoInvocacion[],
  idempotencyKey?: string,
): Promise<InvokeResult> {
  const req: InvokeRequest = {
    correlationId: ctx.correlationId,
    capabilityId,
    userId: ctx.identidad.userId,
    groups: ctx.identidad.grupos,
    params,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
  const primero = await invocarUnaVez(ctx, req);
  if (!reintentarEn.includes(primero.status)) return primero;
  return invocarUnaVez(ctx, req);
}

// ---------------------------------------------------------------- formato de lecturas

function texto(valor: unknown): string {
  return typeof valor === 'string' || typeof valor === 'number' ? String(valor) : '';
}

function items(r: InvokeResult): Record<string, unknown>[] {
  const lista = r.data?.items;
  return Array.isArray(lista) ? (lista as Record<string, unknown>[]) : [];
}

function formatearJira(r: InvokeResult, params: Params): string {
  const lista = items(r);
  const abiertas = params.status !== 'ALL';
  if (lista.length === 0) return abiertas ? 'No tienes tareas abiertas en Jira.' : 'No tienes tareas en Jira.';
  const tipo = abiertas ? ' abiertas' : '';
  const encabezado =
    lista.length === 1 ? `Tienes 1 tarea${abiertas ? ' abierta' : ''} en Jira:` : `Tienes ${lista.length} tareas${tipo} en Jira:`;
  const lineas = lista.map((t) => {
    const partes = [texto(t.key), texto(t.summary), texto(t.status), `prioridad ${texto(t.priority)}`];
    if (texto(t.due)) partes.push(`vence ${texto(t.due)}`);
    return `- ${partes.join(' · ')}`;
  });
  return [encabezado, ...lineas].join('\n');
}

function formatearReservas(r: InvokeResult): string {
  const lista = items(r);
  if (lista.length === 0) return 'No tienes reservas activas.';
  const encabezado = lista.length === 1 ? 'Tienes 1 reserva activa:' : `Tienes ${lista.length} reservas activas:`;
  const lineas = lista.map((b) => {
    const puesto = texto(b.resource ?? b.puesto);
    const piso = texto(b.floor);
    const fecha = esFechaValida(b.date) ? fechaLegible(b.date) : texto(b.date);
    const partes = [texto(b.code ?? b.bookingId), puesto ? `puesto ${puesto}${piso ? ` (piso ${piso})` : ''}` : '', fecha].filter(Boolean);
    return `- ${partes.join(' · ')}`;
  });
  return [encabezado, ...lineas].join('\n');
}

const FORMATOS_LECTURA: Record<string, (r: InvokeResult, params: Params) => string> = {
  'jira:issue.search': formatearJira,
  'skkeda:booking.list': (r) => formatearReservas(r),
};

// ---------------------------------------------------------------- flujo de ACCION

export async function manejarAccion(ctx: ContextoAccion, propuesta: Propuesta, turnos: Turno[]): Promise<Salida> {
  const capabilityId = propuesta.capabilityId ?? '';
  const veredicto = evaluar(capabilityId, ctx.identidad.grupos, ctx.catalogo);
  if (veredicto === 'DENY') {
    log('INFO', 'politica_deniega', { correlationId: ctx.correlationId, conversationId: ctx.conversationId, capabilityId, status: 'DENIED' });
    return { status: 'DENIED', reply: MENSAJE_DENEGADO };
  }
  const entrada = ctx.catalogo.get(capabilityId);
  if (!entrada) return { status: 'DENIED', reply: MENSAJE_DENEGADO };
  const esquema = entrada.capability.paramsSchema;

  let params = limpiarParams((propuesta.params as Params | undefined) ?? {}, esquema);
  params = completarConPedido(params, capabilityId, turnos);

  const reglas = REGLAS_PREVIAS[capabilityId]?.(ctx, capabilityId, params);
  if (reglas) {
    if (reglas.salida) return reglas.salida;
    params = reglas.params;
  }

  if (!validadorDe(capabilityId, esquema)(params)) {
    return { status: 'NEEDS_CLARIFICATION', reply: 'No entendí bien los datos de tu pedido. ¿Me los das de nuevo?' };
  }

  if (veredicto === 'ALLOW') return leer(ctx, capabilityId, params, entrada.connector.connectorId);

  const resumen = (RESUMENES[capabilityId] ?? ((p: Params) => resumenGenerico(capabilityId, p)))(params);
  return crearPendiente(ctx, capabilityId, params, resumen);
}

async function leer(ctx: ContextoAccion, capabilityId: string, params: Params, connectorId: string): Promise<Salida> {
  const r = await invocar(ctx, capabilityId, params, ['UNAVAILABLE', 'FAILED']);
  const result = { connectorId, sourceRef: r.sourceRef, origin: r.origin };
  switch (r.status) {
    case 'OK': {
      const formato = FORMATOS_LECTURA[capabilityId];
      const reply = formato ? formato(r, params) : 'Listo, ya hice la consulta.';
      return { status: 'ANSWERED', reply, origin: r.origin, result };
    }
    case 'DENIED':
      return { status: 'DENIED', reply: MENSAJE_DENEGADO };
    case 'NOT_FOUND':
      return { status: 'NO_ANSWER', reply: 'No encontré resultados para esa consulta.' };
    case 'CONFLICT':
      return { status: 'FAILED', reply: 'No pude completar la consulta. Inténtalo de nuevo en un momento.' };
    default:
      return { status: 'ESCALATED', reply: MENSAJE_ESCALADO };
  }
}

// ---------------------------------------------------------------- confirmación

export type ResultadoConfirmacion =
  | { http: { statusCode: number; code: string; message: string } }
  | { salida: Salida };

/** Piso de un puesto P-1 a P-40 (piso 2: 1-14, piso 3: 15-27, piso 4: 28-40). */
export function pisoDePuesto(resource: string): number | undefined {
  const n = Number(resource.slice(2));
  if (n >= 1 && n <= 14) return 2;
  if (n >= 15 && n <= 27) return 3;
  if (n >= 28 && n <= 40) return 4;
  return undefined;
}

function puestoDeAlternativa(alt: unknown): string | undefined {
  const crudo = typeof alt === 'string' ? alt : (alt as Record<string, unknown> | null)?.resource ?? (alt as Record<string, unknown> | null)?.id;
  const r = typeof crudo === 'string' ? crudo.trim().toUpperCase() : '';
  return /^P-\d{1,2}$/.test(r) ? r : undefined;
}

async function resolverResultado(
  ctx: ContextoAccion,
  pendiente: { capabilityId: string; params: Params },
  r: InvokeResult,
): Promise<Salida> {
  const connectorId = ctx.catalogo.get(pendiente.capabilityId)?.connector.connectorId ?? '';
  const d = r.data ?? {};
  const params = pendiente.params;

  switch (r.status) {
    case 'OK': {
      await ctx.estado.borrarPendiente(ctx.conversationId);
      const codigo = texto(r.sourceRef) || texto(d.code) || texto(d.bookingId);
      let reply: string;
      if (pendiente.capabilityId === 'skkeda:booking.create') {
        const puesto = texto(d.resource) || texto(params.resource);
        const piso = texto(d.floor) || texto(params.floor);
        const fecha = esFechaValida(d.date) ? d.date : esFechaValida(params.date) ? params.date : '';
        reply =
          `Listo. Reservé el puesto ${puesto}${piso ? ` (piso ${piso})` : ''}` +
          `${fecha ? ` para el ${fechaLegible(fecha)}` : ''}. Tu código de reserva es ${codigo}.`;
      } else if (pendiente.capabilityId === 'skkeda:booking.cancel') {
        reply = `Listo, cancelé la reserva ${texto(params.code)}.`;
      } else {
        reply = `Listo, la acción se completó.${codigo ? ` Referencia: ${codigo}.` : ''}`;
      }
      return { status: 'COMPLETED', reply, origin: r.origin, result: { connectorId, sourceRef: codigo || undefined, origin: r.origin } };
    }
    case 'CONFLICT': {
      if (r.error?.code === 'RESOURCE_TAKEN') {
        const alternativas = Array.isArray(d.alternatives) ? d.alternatives : [];
        const alternativa = alternativas.map(puestoDeAlternativa).find((a) => a !== undefined);
        if (alternativa && evaluar(pendiente.capabilityId, ctx.identidad.grupos, ctx.catalogo) === 'ALLOW_WITH_CONFIRMATION') {
          const piso = pisoDePuesto(alternativa);
          const nuevos: Params = { ...params, resource: alternativa, ...(piso !== undefined ? { floor: piso } : {}) };
          const ocupado = typeof params.resource === 'string' ? `El puesto ${params.resource} ya está ocupado ese día.` : 'Ese piso no tiene puestos libres ese día.';
          const resumen = resumenReserva(nuevos);
          const propuesta = await crearPendiente(ctx, pendiente.capabilityId, nuevos, {
            summary: resumen.summary,
            reply: `${ocupado} Te propongo el puesto ${alternativa}${piso !== undefined ? ` (piso ${piso})` : ''} para el ${resumen.summary.fecha}. ¿Lo confirmas?`,
          });
          return propuesta;
        }
        await ctx.estado.borrarPendiente(ctx.conversationId);
        return { status: 'FAILED', reply: 'Ese puesto ya está ocupado y no encontré otro libre para ese día. Puedes intentar con otra fecha.' };
      }
      await ctx.estado.borrarPendiente(ctx.conversationId);
      if (r.error?.code === 'DAILY_LIMIT') {
        return { status: 'FAILED', reply: 'Ya tienes un puesto reservado para ese día, así que no puedo hacer otra reserva.' };
      }
      return { status: 'FAILED', reply: 'No pude completar la acción por una regla del servicio. Inténtalo con otros datos.' };
    }
    case 'DENIED':
      await ctx.estado.borrarPendiente(ctx.conversationId);
      return { status: 'DENIED', reply: MENSAJE_DENEGADO };
    case 'NOT_FOUND':
      await ctx.estado.borrarPendiente(ctx.conversationId);
      return { status: 'FAILED', reply: 'No encontré lo que querías modificar.' };
    default:
      await ctx.estado.borrarPendiente(ctx.conversationId);
      return { status: 'FAILED', reply: 'No pude completar la acción. Inténtalo de nuevo en un momento.' };
  }
}

export async function confirmar(ctx: ContextoAccion, cuerpo: Record<string, unknown> | null): Promise<ResultadoConfirmacion> {
  const decision = cuerpo?.decision;
  const hash = cuerpo?.summaryHash;
  if ((decision !== 'CONFIRM' && decision !== 'CANCEL') || typeof hash !== 'string' || hash.length === 0) {
    return { http: { statusCode: 422, code: 'INVALID_PARAMETER', message: 'Se requieren summaryHash y decision (CONFIRM o CANCEL).' } };
  }
  const pendiente = await ctx.estado.leerPendiente(ctx.conversationId);
  if (!pendiente || pendiente.userId !== ctx.identidad.userId) {
    return { http: { statusCode: 404, code: 'NOT_FOUND', message: 'No hay una acción pendiente para confirmar.' } };
  }
  if (!igualesSeguro(hash, pendiente.summaryHash)) {
    return { http: { statusCode: 409, code: 'CONFIRMATION_MISMATCH', message: 'El resumen confirmado no coincide con la acción pendiente.' } };
  }
  if (decision === 'CANCEL') {
    await ctx.estado.borrarPendiente(ctx.conversationId);
    return { salida: { status: 'ANSWERED', reply: 'Listo, cancelé la acción. No hice ningún cambio.' } };
  }

  if (evaluar(pendiente.capabilityId, ctx.identidad.grupos, ctx.catalogo) !== 'ALLOW_WITH_CONFIRMATION') {
    await ctx.estado.borrarPendiente(ctx.conversationId);
    return { salida: { status: 'DENIED', reply: MENSAJE_DENEGADO } };
  }

  const clave = sha256Hex(ctx.identidad.userId + pendiente.pendingActionId + pendiente.summaryHash);
  const reservado = await ctx.estado.reservarIdemp(clave);
  if (!reservado) {
    const previo = await ctx.estado.leerIdemp(clave);
    if (previo?.estado === 'COMPLETO' && previo.salida) return { salida: previo.salida };
    return { salida: { status: 'FAILED', reply: 'Tu confirmación ya se está procesando. Revisa en unos segundos.' } };
  }

  const r = await invocar(ctx, pendiente.capabilityId, pendiente.params, ['UNAVAILABLE'], clave);
  if (r.status === 'UNAVAILABLE') {
    // No es un resultado definitivo: se libera la clave para poder reintentar.
    await ctx.estado.borrarIdemp(clave);
    return { salida: { status: 'ESCALATED', reply: MENSAJE_ESCALADO } };
  }
  const salida = await resolverResultado(ctx, pendiente, r);
  await ctx.estado.completarIdemp(clave, { resultado: r, salida, params: pendiente.params, summary: pendiente.summary });
  return { salida };
}
