import type { APIGatewayProxyEvent } from 'aws-lambda';
import { crearHandler, limpiarParaVoz, MAX_BYTES_AUDIO, MAX_CARACTERES, type DependenciasVoz } from './handler';

function evento(ruta: string, cuerpo: unknown): APIGatewayProxyEvent {
  return { path: `/v1/voz/${ruta}`, body: JSON.stringify(cuerpo), isBase64Encoded: false } as APIGatewayProxyEvent;
}

function simulado(): DependenciasVoz & { textos: string[]; audios: number } {
  const estado = {
    textos: [] as string[],
    audios: 0,
    async transcribir() {
      estado.audios += 1;
      return ' ¿Cuántos días antes pido un viaje? ';
    },
    async sintetizar(texto: string) {
      estado.textos.push(texto);
      return Buffer.from('mp3');
    },
  };
  return estado;
}

describe('canal de voz', () => {
  it('transcribe audio válido y devuelve el texto sin espacios de sobra', async () => {
    const deps = simulado();
    const r = await crearHandler(deps)(evento('transcribir', { audio: Buffer.alloc(3200).toString('base64') }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ texto: '¿Cuántos días antes pido un viaje?' });
  });

  it('audio vacío o de más de 15 s → 400 sin llamar a Transcribe', async () => {
    const deps = simulado();
    const h = crearHandler(deps);
    expect((await h(evento('transcribir', { audio: '' }))).statusCode).toBe(400);
    const largo = Buffer.alloc(MAX_BYTES_AUDIO + 2).toString('base64');
    expect((await h(evento('transcribir', { audio: largo }))).statusCode).toBe(400);
    expect(deps.audios).toBe(0);
  });

  it('sintetiza texto limpio y truncado', async () => {
    const deps = simulado();
    const r = await crearHandler(deps)(evento('sintetizar', { texto: `**Hola** [1] ${'a'.repeat(3000)}` }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).audio).toBe(Buffer.from('mp3').toString('base64'));
    expect(deps.textos[0].startsWith('Hola a')).toBe(true);
    expect(deps.textos[0].length).toBe(MAX_CARACTERES);
  });

  it('un fallo de AWS responde 503 y no registra texto ni audio', async () => {
    const logs: string[] = [];
    const espia = jest.spyOn(console, 'log').mockImplementation((m: string) => logs.push(m));
    const r = await crearHandler({
      transcribir: async () => '',
      sintetizar: async () => {
        throw new Error('ThrottlingException');
      },
    })(evento('sintetizar', { texto: 'Texto privado de la respuesta' }));
    espia.mockRestore();
    expect(r.statusCode).toBe(503);
    expect(logs.join('\n')).not.toContain('Texto privado');
  });

  it('limpiarParaVoz quita marcas de cita y markdown', () => {
    expect(limpiarParaVoz('## Título\n- *Uno* [DOC-SYN-0002]')).toBe('Título - Uno');
  });
});
