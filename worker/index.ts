import { SalaRoom, type Env } from './SalaRoom';

export { SalaRoom };

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Crear nueva sala -> valida JSON y genera código corto
    if (request.method === 'POST' && url.pathname === '/api/salas') {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return Response.json({ error: 'Formato de datos inválido (JSON malformado).' }, { status: 400 });
      }

      if (!body || typeof body.title !== 'string' || body.title.trim().length < 2) {
        return Response.json({ error: 'Ingresá un nombre válido para la sala.' }, { status: 400 });
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateRoomCode();
        const stub = env.SALA_ROOM.getByName(code);
        const res = await stub.fetch('https://sala.internal/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, code })
        });
        if (res.status !== 409) {
          return res;
        }
      }
      return Response.json({ error: 'No se pudo generar un código libre' }, { status: 500 });
    }

    // Rutas de sala existente: /api/salas/:code y /api/salas/:code/ws
    const match = url.pathname.match(/^\/api\/salas\/([A-Za-z0-9]{4})(\/ws)?$/);
    if (match) {
      const code = match[1].toUpperCase();
      const isWs = Boolean(match[2]);
      const stub = env.SALA_ROOM.getByName(code);

      if (isWs) {
        return stub.fetch(new Request('https://sala.internal/ws', request));
      }

      if (request.method === 'GET') {
        return stub.fetch('https://sala.internal/state');
      }
    }

    // Todo lo demás lo sirve la app Svelte (Workers Static Assets)
    return env.ASSETS.fetch(request);
  }
};
