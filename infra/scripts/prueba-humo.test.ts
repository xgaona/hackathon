// Pruebas de las funciones puras de prueba-humo.mjs, sin llamadas a AWS.
// El script es un módulo ES (.mjs) y Jest corre en CommonJS: se evalúa en un proceso de Node aparte.
// Importarlo no ejecuta la demo, porque main() solo corre cuando el script se invoca directamente.
import { execFileSync } from 'child_process';
import * as path from 'path';
import { pathToFileURL } from 'url';

const SCRIPT = pathToFileURL(path.join(__dirname, 'prueba-humo.mjs')).href;

/** Llama a una función exportada del script con argumentos JSON y devuelve su resultado o su error. */
function llamar(funcion: string, ...args: unknown[]): { valor?: unknown; error?: string } {
  const codigo = `
    const m = await import(${JSON.stringify(SCRIPT)});
    try {
      const valor = m[${JSON.stringify(funcion)}](...${JSON.stringify(args)});
      process.stdout.write(JSON.stringify({ valor }));
    } catch (e) {
      process.stdout.write(JSON.stringify({ error: e.message }));
    }`;
  const salida = execFileSync(process.execPath, ['--input-type=module', '-e', codigo], { encoding: 'utf8' });
  return JSON.parse(salida);
}

describe('prueba-humo: leerArgumentos', () => {
  it('sin argumentos no activa la investigación', () => {
    expect(llamar('leerArgumentos', [])).toEqual({ valor: { investigacion: false } });
  });

  it('--investigacion la activa', () => {
    expect(llamar('leerArgumentos', ['--investigacion'])).toEqual({ valor: { investigacion: true } });
  });

  it('rechaza argumentos desconocidos', () => {
    expect(llamar('leerArgumentos', ['--otro']).error).toMatch(/--otro/);
  });
});

describe('prueba-humo: salidasPorNombre', () => {
  it('convierte las salidas del stack en un objeto por nombre', () => {
    const salidas = [
      { OutputKey: 'ApiUrl', OutputValue: 'https://api.example.invalid/api/' },
      { OutputKey: 'UserPoolClientId', OutputValue: 'cliente-syn' },
      { OutputValue: 'sin clave' },
    ];
    expect(llamar('salidasPorNombre', salidas)).toEqual({
      valor: { ApiUrl: 'https://api.example.invalid/api/', UserPoolClientId: 'cliente-syn' },
    });
  });

  it('tolera una respuesta que no es lista', () => {
    expect(llamar('salidasPorNombre', null)).toEqual({ valor: {} });
  });
});

describe('prueba-humo: formatearSalida', () => {
  it('muestra status, títulos citados y resumen de la acción pendiente', () => {
    const respuesta = {
      status: 'AWAITING_CONFIRMATION',
      reply: 'Voy a reservar el puesto P-15. ¿Confirmas?',
      citations: [{ title: 'Política de viajes corporativos' }, { title: '' }],
      pendingAction: { summary: { puesto: 'P-15', fecha: 'jueves 26 de noviembre de 2026 (2026-11-26)' } },
    };
    const lineas = llamar('formatearSalida', '7.3 Aclaración de fecha', respuesta).valor as string[];
    expect(lineas).toEqual([
      '\n7.3 Aclaración de fecha',
      'status: AWAITING_CONFIRMATION',
      'reply: Voy a reservar el puesto P-15. ¿Confirmas?',
      'fuentes: Política de viajes corporativos',
      'acción pendiente:',
      '  puesto: P-15',
      '  fecha: jueves 26 de noviembre de 2026 (2026-11-26)',
    ]);
  });

  it('muestra los researchSteps con encontrado o no encontrado', () => {
    const respuesta = {
      status: 'ANSWERED',
      researchSteps: [
        { subpregunta: '¿Con cuánta anticipación?', encontrado: true, documentos: ['Política de viajes corporativos'] },
        { subpregunta: '¿Cuánto de viáticos?', encontrado: false, documentos: [] },
      ],
    };
    const lineas = llamar('formatearSalida', '8. Investigación compuesta', respuesta).valor as string[];
    expect(lineas).toContain('Cómo lo investigó:');
    expect(lineas).toContain('  - ¿Con cuánta anticipación?: encontrado (Política de viajes corporativos)');
    expect(lineas).toContain('  - ¿Cuánto de viáticos?: no encontrado');
  });

  it('no incluye campos que no sean status, reply, fuentes, acción o pasos', () => {
    const respuesta = { status: 'ANSWERED', token: 'no-debe-salir', correlationId: 'c-1' };
    const texto = (llamar('formatearSalida', 'x', respuesta).valor as string[]).join('\n');
    expect(texto).not.toContain('no-debe-salir');
    expect(texto).not.toContain('c-1');
  });
});
