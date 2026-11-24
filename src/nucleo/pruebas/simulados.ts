// Simulados para las pruebas del núcleo. Ningún archivo de producción importa este módulo.
import type { RetrieveCommandInput } from '@aws-sdk/client-bedrock-agent-runtime';
import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import type { InvokeRequest, InvokeResult } from '../../comun/contrato';
import type { ClienteAgente, ClienteBedrock, ClienteDdb, ClienteSfn, Dependencias } from '../dependencias';
import { MARCA_CLASIFICADOR } from '../intencion';
import { MARCA_REFORMULACION } from '../investigacion';
import { MARCA_RESPUESTA } from '../respuesta';

/** Reloj que avanza 1 ms por lectura: los turnos quedan ordenados y la fecha sigue siendo martes 24 de noviembre de 2026. */
export function crearReloj(): () => Date {
  const base = new Date('2026-11-24T15:00:00-05:00').getTime();
  let tick = 0;
  return () => new Date(base + tick++);
}

// ---------------------------------------------------------------- DynamoDB en memoria

type Item = Record<string, unknown>;

export interface DdbMemoria extends ClienteDdb {
  items: Map<string, Item>;
}

export function crearDdbMemoria(): DdbMemoria {
  const items = new Map<string, Item>();
  const clave = (k: Record<string, unknown>) => `${String(k.pk)}|${String(k.sk)}`;
  return {
    items,
    async get(e) {
      return { Item: items.get(clave(e.Key as Record<string, unknown>)) } as never;
    },
    async put(e) {
      const item = e.Item as Item;
      const condicion = e.ConditionExpression;
      if (condicion?.includes('attribute_not_exists(pk)')) {
        const previo = items.get(clave(item));
        const limite = e.ExpressionAttributeValues?.[':ahora'] as number | undefined;
        const vencido = previo !== undefined && limite !== undefined && typeof previo.ttl === 'number' && previo.ttl < limite;
        if (previo && !vencido) {
          const error = new Error('condición no cumplida');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
      }
      items.set(clave(item), { ...item });
      return {};
    },
    async query(e) {
      const valores = e.ExpressionAttributeValues ?? {};
      const encontrados = [...items.values()]
        .filter((i) => i.pk === valores[':pk'] && String(i.sk).startsWith(String(valores[':sk'])))
        .sort((a, b) => String(a.sk).localeCompare(String(b.sk)));
      if (e.ScanIndexForward === false) encontrados.reverse();
      return { Items: e.Limit ? encontrados.slice(0, e.Limit) : encontrados } as never;
    },
    async delete(e) {
      items.delete(clave(e.Key as Record<string, unknown>));
      return {};
    },
  };
}

// ---------------------------------------------------------------- Bedrock

export interface BedrockSimulado extends ClienteBedrock {
  colaClasificador: string[];
  colaRespuestas: string[];
  colaReformulaciones: string[];
  llamadasConverse: ConverseCommandInput[];
  llamadasGuardrail: { fuente: string; texto: string }[];
  intervenirEntrada: (texto: string) => boolean;
  intervenirSalida: (texto: string) => boolean;
  /** Número de llamadas de Converse de cada tipo. */
  contar(tipo: 'clasificador' | 'respuesta'): number;
}

export function crearBedrockSimulado(): BedrockSimulado {
  const sim: BedrockSimulado = {
    colaClasificador: [],
    colaRespuestas: [],
    colaReformulaciones: [],
    llamadasConverse: [],
    llamadasGuardrail: [],
    intervenirEntrada: (t) => /ignora tus instrucciones/i.test(t),
    intervenirSalida: () => false,
    contar(tipo) {
      const marca = tipo === 'clasificador' ? MARCA_CLASIFICADOR : MARCA_RESPUESTA;
      return sim.llamadasConverse.filter((c) => c.system?.[0]?.text?.startsWith(marca)).length;
    },
    async converse(entrada) {
      sim.llamadasConverse.push(entrada);
      const sistema = entrada.system?.[0]?.text ?? '';
      const cola = sistema.startsWith(MARCA_CLASIFICADOR)
        ? sim.colaClasificador
        : sistema.startsWith(MARCA_REFORMULACION)
          ? sim.colaReformulaciones
          : sim.colaRespuestas;
      const texto = cola.shift();
      if (texto === undefined) throw new Error('Sin respuesta programada en el simulado');
      return { output: { message: { role: 'assistant', content: [{ text: texto }] } } } as never;
    },
    async applyGuardrail(entrada) {
      const texto = (entrada.content?.[0] as { text?: { text?: string } } | undefined)?.text?.text ?? '';
      const fuente = String(entrada.source);
      sim.llamadasGuardrail.push({ fuente, texto });
      const interviene = fuente === 'INPUT' ? sim.intervenirEntrada(texto) : sim.intervenirSalida(texto);
      return { action: interviene ? 'GUARDRAIL_INTERVENED' : 'NONE' } as never;
    },
  };
  return sim;
}

// ---------------------------------------------------------------- Knowledge Base

export interface ResultadoKb {
  texto: string;
  score: number;
  documentId: string;
  title: string;
  updatedAt: string;
  classification?: string;
}

export interface AgenteSimulado extends ClienteAgente {
  llamadas: RetrieveCommandInput[];
  responder: (consulta: string) => ResultadoKb[] | Promise<ResultadoKb[]>;
}

export function crearAgenteSimulado(): AgenteSimulado {
  const sim: AgenteSimulado = {
    llamadas: [],
    responder: () => [],
    async retrieve(entrada) {
      sim.llamadas.push(entrada);
      const resultados = await sim.responder(entrada.retrievalQuery?.text ?? '');
      return {
        retrievalResults: resultados.map((r) => ({
          content: { text: r.texto },
          score: r.score,
          metadata: {
            classification: r.classification ?? 'GENERAL',
            documentId: r.documentId,
            title: r.title,
            updatedAt: r.updatedAt,
          },
        })),
      } as never;
    },
  };
  return sim;
}

// ---------------------------------------------------------------- Step Functions: Skkeda y Jira de mentira

const RANGO_PISO: Record<number, [number, number]> = { 2: [1, 14], 3: [15, 27], 4: [28, 40] };

function pisoDe(puesto: string): number {
  const n = Number(puesto.slice(2));
  return Number(Object.keys(RANGO_PISO).find((p) => n >= RANGO_PISO[Number(p)][0] && n <= RANGO_PISO[Number(p)][1]));
}

export interface SfnSimulado extends ClienteSfn {
  invocaciones: InvokeRequest[];
  /** Reservas realmente creadas (no cuenta las repetidas por idempotencia). */
  ejecuciones: number;
  /** Número de ejecuciones que devolverán un fallo técnico antes de funcionar. */
  fallos: number;
}

export function crearSfnSimulado(): SfnSimulado {
  const reservas = new Map<string, Map<string, string>>();
  const porClave = new Map<string, InvokeResult>();
  const sim: SfnSimulado = {
    invocaciones: [],
    ejecuciones: 0,
    fallos: 0,
    async startSyncExecution(entrada) {
      const req = JSON.parse(String(entrada.input)) as InvokeRequest;
      sim.invocaciones.push(req);
      if (sim.fallos > 0) {
        sim.fallos--;
        return { status: 'FAILED' } as never;
      }
      const resultado = ejecutar(req);
      return { status: 'SUCCEEDED', output: JSON.stringify(resultado) } as never;
    },
  };

  const ok = (req: InvokeRequest, data: Record<string, unknown>, sourceRef?: string): InvokeResult => ({
    correlationId: req.correlationId,
    status: 'OK',
    origin: 'mock',
    data,
    sourceRef,
  });

  function ocupado(fecha: string, puesto: string): boolean {
    return puesto === 'P-12' || (reservas.get(fecha)?.has(puesto) ?? false);
  }

  function libres(fecha: string, pisoPrimero?: number): string[] {
    const todos = Array.from({ length: 40 }, (_, i) => `P-${i + 1}`).filter((p) => !ocupado(fecha, p));
    if (pisoPrimero === undefined) return todos;
    return [...todos.filter((p) => pisoDe(p) === pisoPrimero), ...todos.filter((p) => pisoDe(p) !== pisoPrimero)];
  }

  function ejecutar(req: InvokeRequest): InvokeResult {
    if (req.capabilityId === 'jira:issue.search') {
      const tareas = [
        { key: 'EVA-SYN-101', summary: 'Actualizar guía de onboarding', status: 'En curso', priority: 'Alta', due: '2026-11-27' },
        { key: 'EVA-SYN-102', summary: 'Revisar la matriz de accesos', status: 'Por hacer', priority: 'Media', due: '2026-12-02' },
        { key: 'TI-SYN-210', summary: 'Documentar el cambio de firewall', status: 'Por hacer', priority: 'Baja', due: '2026-12-10' },
      ];
      return ok(req, { items: tareas });
    }
    if (req.capabilityId === 'skkeda:booking.list') {
      const items: Record<string, unknown>[] = [];
      for (const [fecha, mapa] of reservas) {
        for (const [puesto, usuario] of mapa) {
          if (usuario === req.userId) items.push({ code: `BK-SYN-${fecha.replace(/-/g, '')}-${puesto}`, resource: puesto, floor: pisoDe(puesto), date: fecha });
        }
      }
      return ok(req, { items });
    }
    if (req.capabilityId === 'skkeda:booking.create') {
      const previo = req.idempotencyKey ? porClave.get(req.idempotencyKey) : undefined;
      if (previo) return previo;
      const fecha = String(req.params.date);
      const pedido = typeof req.params.resource === 'string' ? req.params.resource : undefined;
      const piso = typeof req.params.floor === 'number' ? req.params.floor : undefined;
      const delDia = reservas.get(fecha) ?? new Map<string, string>();
      if ([...delDia.values()].includes(req.userId)) {
        return { correlationId: req.correlationId, status: 'CONFLICT', origin: 'mock', error: { code: 'DAILY_LIMIT', message: 'Ya tiene un puesto ese día', correlationId: req.correlationId } };
      }
      let puesto = pedido;
      if (!puesto && piso !== undefined) puesto = libres(fecha, piso).find((p) => pisoDe(p) === piso);
      if (!puesto && piso === undefined) puesto = libres(fecha)[0];
      if (!puesto || ocupado(fecha, puesto)) {
        // Piso lleno: alternativas de otros pisos. Puesto ocupado: primero los del mismo piso.
        const alternativas = libres(fecha, puesto ? pisoDe(puesto) : piso).slice(0, 5);
        return { correlationId: req.correlationId, status: 'CONFLICT', origin: 'mock', data: { alternatives: alternativas }, error: { code: 'RESOURCE_TAKEN', message: 'Ocupado', correlationId: req.correlationId } };
      }
      delDia.set(puesto, req.userId);
      reservas.set(fecha, delDia);
      sim.ejecuciones++;
      const codigo = `BK-SYN-${fecha.replace(/-/g, '')}-${puesto}`;
      const resultado = ok(req, { resource: puesto, floor: pisoDe(puesto), date: fecha, code: codigo }, codigo);
      if (req.idempotencyKey) porClave.set(req.idempotencyKey, resultado);
      return resultado;
    }
    return { correlationId: req.correlationId, status: 'DENIED', origin: 'mock' };
  }
  return sim;
}

// ---------------------------------------------------------------- conjunto completo

export interface Simulados {
  deps: Dependencias;
  ddb: DdbMemoria;
  bedrock: BedrockSimulado;
  agente: AgenteSimulado;
  sfn: SfnSimulado;
}

export function crearSimulados(): Simulados {
  const ahora = crearReloj();
  const ddb = crearDdbMemoria();
  const bedrock = crearBedrockSimulado();
  const agente = crearAgenteSimulado();
  const sfn = crearSfnSimulado();
  let n = 0;
  const deps: Dependencias = { bedrock, agente, sfn, ddb, ahora, nuevoId: () => `id-${String(++n).padStart(4, '0')}` };
  return { deps, ddb, bedrock, agente, sfn };
}
