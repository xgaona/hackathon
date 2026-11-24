// Canal de voz de EVA (opcional, solo con -c voz=true). La voz es entrada y salida: Transcribe convierte el
// audio en texto, el portal lo envía al mismo /v1/conversations y Polly lee la respuesta. No decide nada,
// no guarda audio ni texto y en los logs solo quedan correlationId, ruta, duración y código de error.
import { randomUUID } from 'crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  type AudioStream,
} from '@aws-sdk/client-transcribe-streaming';

export const FRECUENCIA_HZ = 16000;
export const MAX_SEGUNDOS = 15;
/** PCM 16 bits mono: 2 bytes por muestra. */
export const MAX_BYTES_AUDIO = FRECUENCIA_HZ * 2 * MAX_SEGUNDOS;
export const MAX_CARACTERES = 1500;
const TROZO_BYTES = 8192;
const VOZ = 'Lupe';
const IDIOMA = 'es-US';

export interface DependenciasVoz {
  transcribir(audio: Buffer): Promise<string>;
  sintetizar(texto: string): Promise<Buffer>;
}

const CABECERAS = { 'content-type': 'application/json' };

function responder(statusCode: number, cuerpo: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CABECERAS, body: JSON.stringify(cuerpo) };
}

function leerCuerpo(event: APIGatewayProxyEvent): Record<string, unknown> | null {
  if (!event.body) return null;
  try {
    const texto = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const valor = JSON.parse(texto);
    return valor && typeof valor === 'object' ? (valor as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Quita markdown, marcas de cita y espacios de sobra para que Polly lea solo el texto. */
export function limpiarParaVoz(texto: string): string {
  return texto
    .replace(/\[(?:\d+|DOC-[A-Z0-9-]+)\]/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_#`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CARACTERES);
}

function log(datos: Record<string, unknown>): void {
  console.log(JSON.stringify({ componente: 'voz', ...datos }));
}

export function crearHandler(deps: DependenciasVoz) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const correlationId = randomUUID();
    const inicio = Date.now();
    const ruta = event.path?.endsWith('/sintetizar') ? 'sintetizar' : 'transcribir';
    const cuerpo = leerCuerpo(event);
    try {
      if (ruta === 'transcribir') {
        const audioB64 = cuerpo?.audio;
        if (typeof audioB64 !== 'string' || !audioB64) {
          return responder(400, { error: { code: 'INVALID_AUDIO', message: 'Falta el audio', correlationId } });
        }
        const audio = Buffer.from(audioB64, 'base64');
        if (audio.length === 0 || audio.length > MAX_BYTES_AUDIO) {
          return responder(400, {
            error: { code: 'INVALID_AUDIO', message: `El audio debe durar hasta ${MAX_SEGUNDOS} s`, correlationId },
          });
        }
        const texto = (await deps.transcribir(audio)).trim();
        log({ correlationId, ruta, ms: Date.now() - inicio });
        return responder(200, { texto });
      }

      const texto = typeof cuerpo?.texto === 'string' ? limpiarParaVoz(cuerpo.texto) : '';
      if (!texto) {
        return responder(400, { error: { code: 'INVALID_TEXT', message: 'Falta el texto', correlationId } });
      }
      const audio = await deps.sintetizar(texto);
      log({ correlationId, ruta, ms: Date.now() - inicio });
      return responder(200, { audio: audio.toString('base64'), formato: 'mp3' });
    } catch (error) {
      log({ correlationId, ruta, ms: Date.now() - inicio, error: (error as Error)?.name ?? 'Error' });
      return responder(503, {
        error: { code: 'VOICE_UNAVAILABLE', message: 'No pude usar la voz', correlationId },
      });
    }
  };
}

async function* trozos(audio: Buffer): AsyncGenerator<AudioStream> {
  for (let i = 0; i < audio.length; i += TROZO_BYTES) {
    yield { AudioEvent: { AudioChunk: audio.subarray(i, i + TROZO_BYTES) } };
  }
}

function dependenciasReales(): DependenciasVoz {
  const polly = new PollyClient({});
  const transcribe = new TranscribeStreamingClient({});
  return {
    async transcribir(audio) {
      const salida = await transcribe.send(
        new StartStreamTranscriptionCommand({
          LanguageCode: IDIOMA,
          MediaEncoding: 'pcm',
          MediaSampleRateHertz: FRECUENCIA_HZ,
          AudioStream: trozos(audio),
        }),
      );
      const partes: string[] = [];
      for await (const evento of salida.TranscriptResultStream ?? []) {
        for (const resultado of evento.TranscriptEvent?.Transcript?.Results ?? []) {
          const alternativa = resultado.Alternatives?.[0]?.Transcript;
          if (!resultado.IsPartial && alternativa) partes.push(alternativa);
        }
      }
      return partes.join(' ');
    },
    async sintetizar(texto) {
      const salida = await polly.send(
        new SynthesizeSpeechCommand({ Engine: 'neural', VoiceId: VOZ, OutputFormat: 'mp3', Text: texto }),
      );
      if (!salida.AudioStream) throw new Error('SIN_AUDIO');
      return Buffer.from(await salida.AudioStream.transformToByteArray());
    },
  };
}

let handlerReal: ReturnType<typeof crearHandler> | undefined;

export const handler = (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  handlerReal ??= crearHandler(dependenciasReales());
  return handlerReal(event);
};
