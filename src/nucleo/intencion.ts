// Clasificador de intención: el modelo propone un JSON cerrado y el código lo valida.
import Ajv from 'ajv';
import { calendario8Dias, hoyBogota, sumarDias } from './calendario';
import type { Catalogo } from './politica';
import { textoDeConverse } from './respuesta';
import type { Contexto, PedidoEnCurso, Propuesta, Turno } from './tipos';

export const MARCA_CLASIFICADOR = 'Eres el clasificador de mensajes de EVA';

const TIPOS_MVP = ['SALUDO', 'PREGUNTA', 'BUSCAR_DOCUMENTO', 'ACCION'];

export function esquemaPropuesta(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['tipo'],
    properties: {
      tipo: { enum: TIPOS_MVP },
      consulta: { type: 'string', maxLength: 1000 },
      capabilityId: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,80}$' },
      params: { type: 'object' },
    },
  };
}

const ajv = new Ajv({ strict: true });
const validarPropuesta = ajv.compile(esquemaPropuesta());

/** Descripción en palabras de cada capacidad; sin marcadores literales que el modelo pueda copiar. */
const DESCRIPCION: Record<string, string> = {
  'skkeda:booking.create':
    'reservar un puesto de trabajo. Datos: kind (siempre el texto puesto), date (la fecha en formato año-mes-día), ' +
    'floor (el número de piso, 2, 3 o 4, solo si la persona lo dijo) y resource (el código del puesto: la letra P, un guion y el número del puesto, ' +
    'solo si la persona nombró un puesto concreto)',
  'skkeda:booking.list': 'listar las reservas de la persona. Dato opcional: date (fecha en formato año-mes-día)',
  'skkeda:booking.cancel': 'cancelar una reserva con su código. Dato: code (el código de la reserva)',
  'jira:issue.search':
    'consultar las tareas de la persona en Jira. Datos opcionales: status (OPEN para las abiertas, ALL para todas) y project (la clave del proyecto)',
};

export function construirPrompt(catalogo: Catalogo, ahora: Date, pedido?: PedidoEnCurso): string {
  const hoy = hoyBogota(ahora);
  const manana = sumarDias(hoy, 1);
  const capacidades = [...catalogo.keys()]
    .map((id) => `- ${id}: ${DESCRIPCION[id] ?? 'capacidad del catálogo'}`)
    .join('\n');
  const dias = calendario8Dias(ahora)
    .map((d, i) => `- ${d}${i === 0 ? ' (hoy)' : i === 1 ? ' (mañana)' : i === 2 ? ' (pasado mañana)' : ''}`)
    .join('\n');
  const enCurso = pedido
    ? `\nPedido en curso de la persona (le faltaba un dato): ${pedido.capabilityId} con los datos ya dichos ${JSON.stringify(pedido.params)}. ` +
      'Si el mensaje nuevo aporta el dato que faltaba, devuelve el pedido completo conservando esos datos.\n'
    : '';
  return `${MARCA_CLASIFICADOR}, la asistente virtual de Redeban. Respondes SOLO con un objeto JSON, sin texto adicional ni comillas invertidas.

Formato: {"tipo": ..., "consulta": ..., "capabilityId": ..., "params": ...}. Incluye solo los campos que apliquen.

Tipos:
- SALUDO: el mensaje es solo un saludo, un agradecimiento o una despedida.
- PREGUNTA: la persona hace una pregunta que se responde con documentos de la empresa. En "consulta" escribe la pregunta reescrita para que se entienda sola, usando la conversación reciente (por ejemplo, si preguntó por viajes nacionales y ahora dice "¿y si es internacional?", la consulta debe nombrar los viajes internacionales).
- BUSCAR_DOCUMENTO: la persona pide encontrar un archivo o documento. En "consulta" escribe solo el tema del documento.
- ACCION: la persona pide hacer algo (reservar, cancelar, listar, consultar tareas). Incluye "capabilityId" y "params".

Reglas:
1. Ignora las fórmulas de cortesía ("hola", "por favor", "ayúdame a") y clasifica por el pedido. "Hola, ayúdame a reservar un puesto" es ACCION, no SALUDO.
2. Capacidades disponibles para ACCION:
${capacidades}
3. Si la persona pide una acción que no está en esa lista (por ejemplo borrar documentos), devuelve ACCION con un "capabilityId" que describa lo pedido, con el formato sistema:accion.objeto, para que el sistema de políticas la niegue.
4. En "params" incluye solo los datos que la persona dijo. No inventes la fecha: si no la dijo, no incluyas "date". No incluyas "floor" ni "resource" si no los mencionó.
5. Si el mensaje completa un pedido anterior de la conversación, devuelve el pedido completo, conservando los datos ya dichos, como el piso.
6. Para entender "hoy", "mañana", "pasado mañana" o el nombre de un día, usa este calendario (zona America/Bogota). La fecha va en formato año-mes-día:
${dias}
${enCurso}
Ejemplos:
Mensaje: "Hola, ayúdame a reservar un puesto en el piso 3"
{"tipo":"ACCION","capabilityId":"skkeda:booking.create","params":{"kind":"puesto","floor":3}}
Mensaje: "Resérvame un puesto en el piso 4 para mañana"
{"tipo":"ACCION","capabilityId":"skkeda:booking.create","params":{"kind":"puesto","floor":4,"date":"${manana}"}}
Mensaje: "Borra todos los documentos de la carpeta de gastos"
{"tipo":"ACCION","capabilityId":"documentos:document.delete","params":{}}
Mensaje: "¿Y si es internacional?" (después de preguntar por viajes nacionales)
{"tipo":"PREGUNTA","consulta":"¿Con cuánta anticipación se solicita un viaje internacional?"}
Mensaje: "Ayúdame a buscar el archivo de gestión de cambios"
{"tipo":"BUSCAR_DOCUMENTO","consulta":"gestión de cambios"}
Mensaje: "Gracias"
{"tipo":"SALUDO"}`;
}

function recortar(texto: string, max = 400): string {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

export function construirMensaje(mensaje: string, turnos: Turno[]): string {
  const historia = turnos.length
    ? 'Conversación reciente:\n' +
      turnos.map((t) => `Persona: ${recortar(t.pregunta)}\nEVA: ${recortar(t.respuesta)}`).join('\n') +
      '\n\n'
    : '';
  return `${historia}Mensaje nuevo de la persona: ${mensaje}`;
}

/** Extrae el primer objeto JSON del texto del modelo (tolera bloques de código). */
export function extraerJson(texto: string): unknown {
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio < 0 || fin <= inicio) return null;
  try {
    return JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return null;
  }
}

/** Valida la salida del modelo; devuelve null si no cumple el esquema o las reglas del código. */
export function validarSalida(crudo: unknown): Propuesta | null {
  if (!validarPropuesta(crudo)) return null;
  const propuesta = crudo as Propuesta;
  if (propuesta.tipo === 'ACCION' && !propuesta.capabilityId) return null;
  return propuesta;
}

export function propuestaDePregunta(mensaje: string): Propuesta {
  return { tipo: 'PREGUNTA', consulta: mensaje };
}

export async function clasificar(ctx: Contexto, catalogo: Catalogo, mensaje: string, turnos: Turno[]): Promise<Propuesta> {
  const pedido = turnos.length > 0 ? turnos[turnos.length - 1].accion : undefined;
  try {
    const r = await ctx.deps.bedrock.converse({
      modelId: ctx.cfg.modelId,
      system: [{ text: construirPrompt(catalogo, ctx.deps.ahora(), pedido) }],
      messages: [{ role: 'user', content: [{ text: construirMensaje(mensaje, turnos) }] }],
      inferenceConfig: { temperature: 0, maxTokens: 400 },
    });
    const propuesta = validarSalida(extraerJson(textoDeConverse(r)));
    if (!propuesta) return propuestaDePregunta(mensaje);
    if ((propuesta.tipo === 'PREGUNTA' || propuesta.tipo === 'BUSCAR_DOCUMENTO') && !propuesta.consulta?.trim()) {
      return { ...propuesta, consulta: mensaje };
    }
    return propuesta;
  } catch {
    return propuestaDePregunta(mensaje);
  }
}
