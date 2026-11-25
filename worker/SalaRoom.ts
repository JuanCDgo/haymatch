import { DurableObject } from 'cloudflare:workers';

export interface Env {
  SALA_ROOM: DurableObjectNamespace<SalaRoom>;
  ASSETS: Fetcher;
}

interface WsAttachment {
  clientId: string;
  name: string;
}

interface CreateRoomPayload {
  code: string;
  title: string;
  organizerName: string;
  organizerClientId: string;
  pin: string;
  template: 'asado' | 'juntada' | 'peliculas' | 'libre';
  vaquitaEnabled: boolean;
  goalPeople: number;
  depositAmount: number;
  totalAmount: number;
  deadlineText: string;
  aliasMp: string;
}

const TEMPLATES: Record<string, Array<{ category: string; title: string }>> = {
  asado: [
    { category: 'Bebida', title: 'Fernet con Coca' },
    { category: 'Bebida', title: 'Cerveza tirada / latas' },
    { category: 'Bebida', title: 'Vino Malbec' },
    { category: 'Parrilla', title: 'Vacío y Entraña' },
    { category: 'Parrilla', title: 'Choripán y Morcilla de entrada' },
    { category: 'Acompañamiento', title: 'Ensalada rusa y criolla' },
    { category: 'Postre', title: 'Helado por kilo' },
    { category: 'Actividad', title: 'Torneo de Truco' }
  ],
  juntada: [
    { category: 'Comida', title: 'Pizza a la piedra' },
    { category: 'Comida', title: 'Empanadas surtidas' },
    { category: 'Comida', title: 'Hamburguesas caseras' },
    { category: 'Bebida', title: 'Birra artesanal' },
    { category: 'Bebida', title: 'Fernet con Coca' },
    { category: 'Plan', title: 'Juegos de mesa' }
  ],
  peliculas: [
    { category: 'Género', title: 'Comedia liviana' },
    { category: 'Género', title: 'Suspenso / Thriller' },
    { category: 'Género', title: 'Acción clásica' },
    { category: 'Género', title: 'Terror' },
    { category: 'Snack', title: 'Pochoclos dulces y salados' }
  ],
  libre: []
};

async function hashPin(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(saltHex),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class SalaRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          code TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          organizer_pin_hash TEXT NOT NULL,
          organizer_salt TEXT NOT NULL,
          vaquita_enabled INTEGER NOT NULL DEFAULT 1,
          goal_people INTEGER NOT NULL DEFAULT 30,
          deposit_amount INTEGER NOT NULL DEFAULT 10000,
          total_amount INTEGER NOT NULL DEFAULT 30000,
          deadline_text TEXT NOT NULL DEFAULT '30/11',
          alias_mp TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS participants (
          client_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pendiente',
          paid_amount INTEGER NOT NULL DEFAULT 0,
          joined_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS options (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          proposed_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS votes (
          option_id INTEGER NOT NULL,
          client_id TEXT NOT NULL,
          vote INTEGER NOT NULL CHECK (vote IN (0, 1)),
          PRIMARY KEY (option_id, client_id)
        );
      `);
    });
  }

  private roomExists(): boolean {
    const row = this.ctx.storage.sql
      .exec<{ cnt: number }>('SELECT COUNT(*) as cnt FROM room_meta WHERE id = 1')
      .one();
    return row.cnt > 0;
  }

  private getOnlineClientIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WsAttachment | null;
      if (att?.clientId) {
        ids.add(att.clientId);
      }
    }
    return ids;
  }

  private buildSnapshot() {
    const meta = this.ctx.storage.sql
      .exec<{
        code: string;
        title: string;
        created_at: string;
        vaquita_enabled: number;
        goal_people: number;
        deposit_amount: number;
        total_amount: number;
        deadline_text: string;
        alias_mp: string;
      }>('SELECT code, title, created_at, vaquita_enabled, goal_people, deposit_amount, total_amount, deadline_text, alias_mp FROM room_meta WHERE id = 1')
      .one();

    const onlineIds = this.getOnlineClientIds();

    const participantRows = this.ctx.storage.sql
      .exec<{
        client_id: string;
        name: string;
        status: string;
        paid_amount: number;
        joined_at: string;
      }>('SELECT client_id, name, status, paid_amount, joined_at FROM participants ORDER BY joined_at ASC')
      .toArray();

    const optionRows = this.ctx.storage.sql
      .exec<{
        id: number;
        category: string;
        title: string;
        proposed_by: string;
        yes_count: number;
        no_count: number;
      }>(`
        SELECT
          o.id,
          o.category,
          o.title,
          o.proposed_by,
          COALESCE(SUM(CASE WHEN v.vote = 1 THEN 1 ELSE 0 END), 0) AS yes_count,
          COALESCE(SUM(CASE WHEN v.vote = 0 THEN 1 ELSE 0 END), 0) AS no_count
        FROM options o
        LEFT JOIN votes v ON v.option_id = o.id
        GROUP BY o.id
        ORDER BY o.id ASC
      `)
      .toArray();

    return {
      room: {
        code: meta.code,
        title: meta.title,
        createdAt: meta.created_at,
        vaquitaEnabled: meta.vaquita_enabled === 1,
        goalPeople: meta.goal_people,
        depositAmount: meta.deposit_amount,
        totalAmount: meta.total_amount,
        deadlineText: meta.deadline_text,
        aliasMp: meta.alias_mp
      },
      participants: participantRows.map((p) => ({
        clientId: p.client_id,
        name: p.name,
        status: p.status as 'pendiente' | 'seno' | 'completo',
        paidAmount: p.paid_amount,
        joinedAt: p.joined_at,
        isOnline: onlineIds.has(p.client_id)
      })),
      onlineCount: onlineIds.size,
      options: optionRows.map((o) => ({
        id: o.id,
        category: o.category,
        title: o.title,
        proposedBy: o.proposed_by,
        yesCount: o.yes_count,
        noCount: o.no_count
      }))
    };
  }

  private broadcastSnapshot() {
    if (!this.roomExists()) return;
    const message = JSON.stringify({
      type: 'snapshot',
      payload: this.buildSnapshot()
    });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Ignore stale sockets; close handler will clean them up
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. Crear sala
    if (request.method === 'POST' && url.pathname === '/init') {
      if (this.roomExists()) {
        return Response.json({ error: 'Sala ya existente' }, { status: 409 });
      }
      const body = (await request.json()) as CreateRoomPayload;
      const now = new Date().toISOString();
      const salt = randomSalt();
      const pinHash = await hashPin(body.pin.trim() || '1234', salt);

      this.ctx.storage.sql.exec(
        `INSERT INTO room_meta (
          id, code, title, created_at, organizer_pin_hash, organizer_salt,
          vaquita_enabled, goal_people, deposit_amount, total_amount, deadline_text, alias_mp
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        body.code,
        body.title.trim().slice(0, 60),
        now,
        pinHash,
        salt,
        body.vaquitaEnabled ? 1 : 0,
        Math.max(2, Math.min(500, Math.round(body.goalPeople || 30))),
        Math.max(0, Math.round(body.depositAmount || 10000)),
        Math.max(0, Math.round(body.totalAmount || 30000)),
        (body.deadlineText || '30/11').trim().slice(0, 30),
        (body.aliasMp || '').trim().slice(0, 60)
      );

      if (body.organizerClientId && body.organizerName.trim()) {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO participants (client_id, name, status, paid_amount, joined_at)
           VALUES (?, ?, 'pendiente', 0, ?)`,
          body.organizerClientId,
          body.organizerName.trim().slice(0, 40),
          now
        );
      }

      const starter = TEMPLATES[body.template] ?? [];
      for (const item of starter) {
        this.ctx.storage.sql.exec(
          `INSERT INTO options (category, title, proposed_by, created_at) VALUES (?, ?, ?, ?)`,
          item.category,
          item.title,
          body.organizerName.trim().slice(0, 40) || 'Organizador',
          now
        );
      }

      return Response.json(this.buildSnapshot(), { status: 201 });
    }

    // 2. Estado inicial por HTTP
    if (request.method === 'GET' && url.pathname === '/state') {
      if (!this.roomExists()) {
        return Response.json({ error: 'No encontramos esa sala. Revisá el código.' }, { status: 404 });
      }
      return Response.json(this.buildSnapshot());
    }

    // 3. Conexión WebSocket en vivo
    if (url.pathname === '/ws') {
      if (!this.roomExists()) {
        return Response.json({ error: 'Sala no encontrada' }, { status: 404 });
      }
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Se esperaba conexión WebSocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;
    let data: { type?: string; clientId?: string; name?: string };
    try {
      data = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Mensaje inválido' }));
      return;
    }

    if (data.type === 'join' && data.clientId && data.name) {
      const cleanId = data.clientId.trim().slice(0, 64);
      const cleanName = data.name.trim().slice(0, 40);
      if (!cleanId || !cleanName) return;

      const now = new Date().toISOString();
      this.ctx.storage.sql.exec(
        `INSERT INTO participants (client_id, name, status, paid_amount, joined_at)
         VALUES (?, ?, 'pendiente', 0, ?)
         ON CONFLICT(client_id) DO UPDATE SET name = excluded.name`,
        cleanId,
        cleanName,
        now
      );

      const attachment: WsAttachment = { clientId: cleanId, name: cleanName };
      ws.serializeAttachment(attachment);
      this.broadcastSnapshot();
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      // already closed
    }
    this.broadcastSnapshot();
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      // ignore
    }
    this.broadcastSnapshot();
  }
}
