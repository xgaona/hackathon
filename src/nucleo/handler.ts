// Punto de entrada de la API /v1 (contrato-mvp.md §2). El CDK de infra/ apunta a este archivo.
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { RespuestaConversacion } from '../comun/contrato';
import { crearDependenciasReales, leerConfig, type Config, type Dependencias } from './dependencias';
import { crearEstado } from './estado';
import { extraerIdentidad } from './identidad';
import { clasificar } from './intencion';
import { cargarCatalogo } from './politica';
import { codigoDeError, log } from './registro';
import { confirmar, manejarAccion } from './acciones';
import { buscarDocumentos, buscarPasajes } from './recuperacion';
import {
  MENSAJE_BLOQUEADO,
  MENSAJE_ERROR,
  MENSAJE_SIN_FUENTE,
  responderConocimiento,
  respuestaSaludo,
  revisarEntrada,
  textoDocumentos,
} from './respuesta';
import { sha256Hex } from './hash';
import type { Contexto, Identidad, Propuesta, Salida, Turno } from './tipos';

const CABECERAS = { 'content-type': 'application/json' };

function responder(statusCode: number, cuerpo: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CABECERAS, body: JSON.stringify(cuerpo) };
}

function errorHttp(statusCode: number, code: string, message: string, correlationId: string): APIGatewayProxyResult {
  return responder(statusCode, { error: { code, message, correlationId } });
}

function parsearCuerpo(event: APIGatewayProxyEvent): Record<string, unknown> | null {
  if (!event.body) return null;
  try {
    const crudo = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const valor: unknown = JSON.parse(crudo);
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Los turnos que se guardan: toda respuesta menos las bloqueadas y las fallidas. */
const ESTADOS_SIN_TURNO = new Set(['BLOCKED', 'FAILED']);

export function crearManejador(deps: Dependencias, cfg: Config) {
  const estado = crearEstado(deps, cfg.tabla);
  const catalogo = cargarCatalogo();

  async function guardarTurno(ctx: Contexto, pregunta: string, salida: Salida): Promise<void> {
    if (ESTADOS_SIN_TURNO.has(salida.status)) return;
    const turno: Omit<Turno, 'n'> = {
      userId: ctx.identidad.userId,
      pregunta,
      respuesta: salida.reply,
      knowledgeIds: [...new Set((salida.citations ?? []).map((c) => c.documentId))],
      ...(salida.turnoExtra?.preguntaOriginal ? { preguntaOriginal: salida.turnoExtra.preguntaOriginal } : {}),
      ...(salida.turnoExtra?.accion ? { accion: salida.turnoExtra.accion } : {}),
    };
    try {
      await estado.guardarTurno(ctx.conversationId, turno);
    } catch (error) {
      // El turno es contexto, no seguridad: se registra y se responde igual.
      log('ERROR', 'turno_no_guardado', { correlationId: ctx.correlationId, conversationId: ctx.conversationId, codigo: codigoDeError(error) });
    }
  }

  function aRespuesta(ctx: Contexto, salida: Salida): RespuestaConversacion {
    const { turnoExtra: _turnoExtra, ...resto } = salida;
    return { conversationId: ctx.conversationId, correlationId: ctx.correlationId, ...resto };
  }

  async function procesarMensaje(
    event: APIGatewayProxyEvent,
    identidad: Identidad,
    correlationId: string,
  ): Promise<APIGatewayProxyResult> {
    const cuerpo = parsearCuerpo(event);
    const mensaje = typeof cuerpo?.message === 'string' ? cuerpo.message.trim() : '';
    if (!cuerpo || mensaje.length === 0) {
      return errorHttp(422, 'INVALID_PARAMETER', 'El mensaje es obligatorio.', correlationId);
    }
    let conversationId =
      typeof cuerpo.conversationId === 'string' && cuerpo.conversationId.trim() ? cuerpo.conversationId.trim() : deps.nuevoId();
    const ctx: Contexto = { deps, cfg, identidad, correlationId, conversationId };

    if (await revisarEntrada(deps, cfg, mensaje)) {
      log('INFO', 'entrada_bloqueada', { correlationId, conversationId, status: 'BLOCKED' });
      return responder(200, aRespuesta(ctx, { status: 'BLOCKED', reply: MENSAJE_BLOQUEADO }));
    }

    const { turnos, ajena } = await estado.leerTurnos(conversationId, identidad.userId);
    if (ajena) {
      // Una conversación de otra persona no se usa: se empieza una nueva.
      conversationId = deps.nuevoId();
      ctx.conversationId = conversationId;
    }

    const salida = await despachar(ctx, mensaje, ajena ? [] : turnos);
    await guardarTurno(ctx, mensaje, salida);
    log('INFO', 'mensaje_procesado', { correlationId, conversationId, status: salida.status, documentIds: salida.citations?.map((c) => c.documentId) });
    return responder(200, aRespuesta(ctx, salida));
  }

  async function despachar(ctx: Contexto, mensaje: string, turnos: Turno[]): Promise<Salida> {
    const propuesta = await clasificar(ctx, catalogo, mensaje, turnos);
    log('INFO', 'intencion', { correlationId: ctx.correlationId, conversationId: ctx.conversationId, etapa: propuesta.tipo, capabilityId: propuesta.capabilityId });
    switch (propuesta.tipo) {
      case 'PREGUNTA':
        return responderPregunta(ctx, propuesta.consulta?.trim() || mensaje);
      case 'SALUDO':
        return { status: 'ANSWERED', reply: respuestaSaludo(mensaje) };
      case 'BUSCAR_DOCUMENTO':
        return responderBusqueda(ctx, propuesta.consulta?.trim() || mensaje);
      case 'ACCION':
        return responderAccion(ctx, propuesta, turnos);
      default:
        // Las demás ramas se agregan en las tareas siguientes.
        return { status: 'FAILED', reply: MENSAJE_ERROR };
    }
  }

  async function responderAccion(ctx: Contexto, propuesta: Propuesta, turnos: Turno[]): Promise<Salida> {
    try {
      return await manejarAccion({ ...ctx, catalogo, estado }, propuesta, turnos);
    } catch (error) {
      log('ERROR', 'accion_fallida', { correlationId: ctx.correlationId, conversationId: ctx.conversationId, capabilityId: propuesta.capabilityId, codigo: codigoDeError(error) });
      return { status: 'FAILED', reply: MENSAJE_ERROR };
    }
  }

  async function responderBusqueda(ctx: Contexto, tema: string): Promise<Salida> {
    try {
      const documentos = await buscarDocumentos(ctx, tema);
      if (documentos.length === 0) {
        return { status: 'NO_ANSWER', reply: `No encontré ningún documento sobre "${tema}" en las fuentes a las que tengo acceso.` };
      }
      return {
        status: 'ANSWERED',
        reply: textoDocumentos(documentos),
        origin: 'index',
        citations: documentos.map((d) => ({ documentId: d.documentId, title: d.title, updatedAt: d.updatedAt, origin: 'index' as const })),
      };
    } catch (error) {
      log('ERROR', 'busqueda_fallida', { correlationId: ctx.correlationId, conversationId: ctx.conversationId, codigo: codigoDeError(error) });
      return { status: 'FAILED', reply: MENSAJE_ERROR };
    }
  }

  async function responderPregunta(ctx: Contexto, consulta: string): Promise<Salida> {
    try {
      const pasajes = await buscarPasajes(ctx, consulta);
      if (pasajes.length === 0) return { status: 'NO_ANSWER', reply: MENSAJE_SIN_FUENTE };
      const r = await responderConocimiento(ctx, consulta, pasajes);
      if (!r.ok) return { status: 'NO_ANSWER', reply: MENSAJE_SIN_FUENTE };
      return { status: 'ANSWERED', reply: r.texto, origin: 'index', citations: r.citas };
    } catch (error) {
      log('ERROR', 'conocimiento_fallido', { correlationId: ctx.correlationId, conversationId: ctx.conversationId, codigo: codigoDeError(error) });
      return { status: 'FAILED', reply: MENSAJE_ERROR };
    }
  }

  async function procesarConfirmacion(
    event: APIGatewayProxyEvent,
    identidad: Identidad,
    correlationId: string,
    conversationId: string,
  ): Promise<APIGatewayProxyResult> {
    const ctx: Contexto = { deps, cfg, identidad, correlationId, conversationId };
    const cuerpo = parsearCuerpo(event);
    const resultado = await confirmar({ ...ctx, catalogo, estado }, cuerpo);
    if ('http' in resultado) {
      const { statusCode, code, message } = resultado.http;
      log('INFO', 'confirmacion_rechazada', { correlationId, conversationId, codigo: code });
      return errorHttp(statusCode, code, message, correlationId);
    }
    const { salida } = resultado;
    await guardarTurno(
      ctx,
      cuerpo?.decision === 'CANCEL' ? 'Cancelo la acción pendiente' : 'Confirmo la acción pendiente',
      salida,
    );
    log('INFO', 'confirmacion_procesada', {
      correlationId,
      conversationId,
      status: salida.status,
      capabilityId: salida.pendingAction?.capabilityId,
    });
    return responder(200, aRespuesta(ctx, salida));
  }

  return async function manejador(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const correlationId = deps.nuevoId();
    try {
      const identidad = extraerIdentidad(event);
      if (!identidad) return errorHttp(401, 'UNAUTHENTICATED', 'Token ausente o inválido.', correlationId);
      const usuarioHash = sha256Hex(identidad.userId).slice(0, 12);
      log('INFO', 'peticion', { correlationId, usuarioHash });

      const ruta = event.resource ?? event.path ?? '';
      if (event.httpMethod === 'POST' && /^\/v1\/conversations\/?$/.test(ruta)) {
        return await procesarMensaje(event, identidad, correlationId);
      }
      const confirmacion = /^\/v1\/conversations\/([^/]+)\/confirm\/?$/.exec(event.path ?? '') ?? /^\/v1\/conversations\/\{id\}\/confirm$/.exec(ruta);
      if (event.httpMethod === 'POST' && confirmacion) {
        const id = event.pathParameters?.id ?? confirmacion[1];
        if (!id || id === '{id}') return errorHttp(422, 'INVALID_PARAMETER', 'Falta el identificador de la conversación.', correlationId);
        return await procesarConfirmacion(event, identidad, correlationId, id);
      }
      return errorHttp(404, 'NOT_FOUND', 'Ruta no encontrada.', correlationId);
    } catch (error) {
      log('ERROR', 'error_no_controlado', { correlationId, codigo: codigoDeError(error) });
      return responder(200, {
        conversationId: '',
        correlationId,
        status: 'FAILED',
        reply: MENSAJE_ERROR,
      } satisfies RespuestaConversacion);
    }
  };
}

let manejadorReal: ((event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>) | undefined;

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  manejadorReal ??= crearManejador(crearDependenciasReales(), leerConfig(process.env));
  return manejadorReal(event);
}
