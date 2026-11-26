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
  vaquitaMode: 'cuotas' | 'gastos';
  goalPeople: number;
  depositAmount: number;
  totalAmount: number;
  deadlineText: string;
  aliasMp: string;
}

interface TiebreakResult {
  optionId: number;
  title: string;
  category: string;
  decidedAt: string;
  decidedBy: string;
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

function randomHex(bytesLen: number): string {
  const bytes = new Uint8Array(bytesLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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
          vaquita_mode TEXT NOT NULL DEFAULT 'cuotas',
          goal_people INTEGER NOT NULL DEFAULT 30,
          deposit_amount INTEGER NOT NULL DEFAULT 10000,
          total_amount INTEGER NOT NULL DEFAULT 30000,
          deadline_text TEXT NOT NULL DEFAULT '30/11',
          alias_mp TEXT NOT NULL DEFAULT '',
          qr_image_data TEXT NOT NULL DEFAULT '',
          tiebreak_json TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS participants (
          client_id TEXT PRIMARY KEY,
          public_id TEXT NOT NULL UNIQUE,
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

        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          paid_by_client_id TEXT NOT NULL,
          paid_by_public_id TEXT NOT NULL DEFAULT '',
          paid_by_name TEXT NOT NULL,
          description TEXT NOT NULL,
          amount INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_attempts (
          client_id TEXT PRIMARY KEY,
          fails INTEGER NOT NULL DEFAULT 0,
          locked_until INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS organizer_sessions (
          client_id TEXT PRIMARY KEY,
          granted_at TEXT NOT NULL
        );
      `);

      // Migraciones suaves para salas creadas antes de /boost
      const metaCols = this.ctx.storage.sql
        .exec<{ name: string }>('PRAGMA table_info(room_meta)')
        .toArray();
      if (!metaCols.some((c) => c.name === 'tiebreak_json')) {
        this.ctx.storage.sql.exec('ALTER TABLE room_meta ADD COLUMN tiebreak_json TEXT DEFAULT NULL');
      }
      if (!metaCols.some((c) => c.name === 'vaquita_mode')) {
        this.ctx.storage.sql.exec("ALTER TABLE room_meta ADD COLUMN vaquita_mode TEXT NOT NULL DEFAULT 'cuotas'");
      }
      if (!metaCols.some((c) => c.name === 'qr_image_data')) {
        this.ctx.storage.sql.exec("ALTER TABLE room_meta ADD COLUMN qr_image_data TEXT NOT NULL DEFAULT ''");
      }

      const partCols = this.ctx.storage.sql
        .exec<{ name: string }>('PRAGMA table_info(participants)')
        .toArray();
      if (!partCols.some((c) => c.name === 'public_id')) {
        this.ctx.storage.sql.exec("ALTER TABLE participants ADD COLUMN public_id TEXT NOT NULL DEFAULT ''");
        const existing = this.ctx.storage.sql
          .exec<{ client_id: string }>('SELECT client_id FROM participants')
          .toArray();
        for (const row of existing) {
          this.ctx.storage.sql.exec(
            'UPDATE participants SET public_id = ? WHERE client_id = ?',
            `p_${randomHex(6)}`,
            row.client_id
          );
        }
      }

      const expCols = this.ctx.storage.sql
        .exec<{ name: string }>('PRAGMA table_info(expenses)')
        .toArray();
      if (!expCols.some((c) => c.name === 'paid_by_public_id')) {
        this.ctx.storage.sql.exec("ALTER TABLE expenses ADD COLUMN paid_by_public_id TEXT NOT NULL DEFAULT ''");
      }
    });
  }

  private roomExists(): boolean {
    const row = this.ctx.storage.sql
      .exec<{ cnt: number }>('SELECT COUNT(*) as cnt FROM room_meta WHERE id = 1')
      .one();
    return row.cnt > 0;
  }

  private isOrganizerClient(clientId?: string): boolean {
    if (!clientId) return false;
    const row = this.ctx.storage.sql
      .exec<{ cnt: number }>('SELECT COUNT(*) as cnt FROM organizer_sessions WHERE client_id = ?', clientId)
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

  private getMyVotes(clientId?: string): Record<number, 0 | 1> {
    const map: Record<number, 0 | 1> = {};
    if (!clientId) return map;
    const rows = this.ctx.storage.sql
      .exec<{ option_id: number; vote: number }>(
        'SELECT option_id, vote FROM votes WHERE client_id = ?',
        clientId
      )
      .toArray();
    for (const r of rows) {
      map[r.option_id] = r.vote === 1 ? 1 : 0;
    }
    return map;
  }

  private buildSnapshotFor(viewerClientId?: string) {
    const meta = this.ctx.storage.sql
      .exec<{
        code: string;
        title: string;
        created_at: string;
        vaquita_enabled: number;
        vaquita_mode: string;
        goal_people: number;
        deposit_amount: number;
        total_amount: number;
        deadline_text: string;
        alias_mp: string;
        qr_image_data: string;
        tiebreak_json: string | null;
      }>(
        'SELECT code, title, created_at, vaquita_enabled, vaquita_mode, goal_people, deposit_amount, total_amount, deadline_text, alias_mp, qr_image_data, tiebreak_json FROM room_meta WHERE id = 1'
      )
      .one();

    const onlineIds = this.getOnlineClientIds();

    const participantRows = this.ctx.storage.sql
      .exec<{
        client_id: string;
        public_id: string;
        name: string;
        status: string;
        paid_amount: number;
        joined_at: string;
      }>('SELECT client_id, public_id, name, status, paid_amount, joined_at FROM participants ORDER BY joined_at ASC')
      .toArray();

    const clientToPublic = new Map<string, string>();
    for (const p of participantRows) {
      clientToPublic.set(p.client_id, p.public_id);
    }

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

    const expenseRows = this.ctx.storage.sql
      .exec<{
        id: number;
        paid_by_client_id: string;
        paid_by_public_id: string;
        paid_by_name: string;
        description: string;
        amount: number;
        created_at: string;
      }>('SELECT id, paid_by_client_id, paid_by_public_id, paid_by_name, description, amount, created_at FROM expenses ORDER BY id DESC')
      .toArray();

    let tiebreak: TiebreakResult | null = null;
    if (meta.tiebreak_json) {
      try {
        tiebreak = JSON.parse(meta.tiebreak_json) as TiebreakResult;
      } catch {
        tiebreak = null;
      }
    }

    return {
      room: {
        code: meta.code,
        title: meta.title,
        createdAt: meta.created_at,
        vaquitaEnabled: meta.vaquita_enabled === 1,
        vaquitaMode: (meta.vaquita_mode === 'gastos' ? 'gastos' : 'cuotas') as 'cuotas' | 'gastos',
        goalPeople: meta.goal_people,
        depositAmount: meta.deposit_amount,
        totalAmount: meta.total_amount,
        deadlineText: meta.deadline_text,
        aliasMp: meta.alias_mp,
        qrImageData: meta.qr_image_data
      },
      // NUNCA enviamos client_id privado al navegador (prevención IDOR)
      participants: participantRows.map((p) => ({
        publicId: p.public_id,
        name: p.name,
        status: p.status as 'pendiente' | 'seno' | 'completo',
        paidAmount: p.paid_amount,
        joinedAt: p.joined_at,
        isOnline: onlineIds.has(p.client_id),
        isMe: Boolean(viewerClientId && p.client_id === viewerClientId),
        isManual: p.client_id.startsWith('manual-')
      })),
      onlineCount: onlineIds.size,
      options: optionRows.map((o) => ({
        id: o.id,
        category: o.category,
        title: o.title,
        proposedBy: o.proposed_by,
        yesCount: o.yes_count,
        noCount: o.no_count,
        totalVotes: o.yes_count + o.no_count
      })),
      expenses: expenseRows.map((e) => ({
        id: e.id,
        paidByPublicId: e.paid_by_public_id || clientToPublic.get(e.paid_by_client_id) || '',
        paidByName: e.paid_by_name,
        description: e.description,
        amount: e.amount,
        createdAt: e.created_at,
        isMine: Boolean(viewerClientId && e.paid_by_client_id === viewerClientId)
      })),
      myVotes: this.getMyVotes(viewerClientId),
      isOrganizer: this.isOrganizerClient(viewerClientId),
      tiebreak
    };
  }

  private broadcastSnapshot() {
    if (!this.roomExists()) return;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const att = ws.deserializeAttachment() as WsAttachment | null;
        const payload = this.buildSnapshotFor(att?.clientId);
        ws.send(JSON.stringify({ type: 'snapshot', payload }));
      } catch {
        // Ignore stale sockets
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
      const salt = randomHex(16);
      const pinHash = await hashPin((body.pin || '1234').trim(), salt);
      const vaquitaMode = body.vaquitaMode === 'gastos' ? 'gastos' : 'cuotas';

      this.ctx.storage.sql.exec(
        `INSERT INTO room_meta (
          id, code, title, created_at, organizer_pin_hash, organizer_salt,
          vaquita_enabled, vaquita_mode, goal_people, deposit_amount, total_amount, deadline_text, alias_mp, qr_image_data, tiebreak_json
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL)`,
        body.code,
        body.title.trim().slice(0, 60),
        now,
        pinHash,
        salt,
        body.vaquitaEnabled ? 1 : 0,
        vaquitaMode,
        Math.max(2, Math.min(500, Math.round(body.goalPeople || 30))),
        Math.max(0, Math.round(body.depositAmount || 10000)),
        Math.max(0, Math.round(body.totalAmount || 30000)),
        (body.deadlineText || '30/11').trim().slice(0, 30),
        (body.aliasMp || '').trim().slice(0, 60)
      );

      if (body.organizerClientId && body.organizerName.trim()) {
        const cleanOrgId = body.organizerClientId.trim().slice(0, 64);
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO participants (client_id, public_id, name, status, paid_amount, joined_at)
           VALUES (?, ?, ?, 'pendiente', 0, ?)`,
          cleanOrgId,
          `p_${randomHex(6)}`,
          body.organizerName.trim().slice(0, 40),
          now
        );
        // Auto-autenticar al creador como organizador en su dispositivo
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO organizer_sessions (client_id, granted_at) VALUES (?, ?)`,
          cleanOrgId,
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

      return Response.json(this.buildSnapshotFor(body.organizerClientId), { status: 201 });
    }

    // 2. Estado inicial por HTTP (sin exponer client_id)
    if (request.method === 'GET' && url.pathname === '/state') {
      if (!this.roomExists()) {
        return Response.json({ error: 'No encontramos esa sala. Revisá el código.' }, { status: 404 });
      }
      return Response.json(this.buildSnapshotFor(undefined));
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
    let data: {
      type?: string;
      clientId?: string;
      name?: string;
      optionId?: number;
      vote?: number;
      category?: string;
      title?: string;
      pin?: string;
      targetPublicId?: string;
      status?: string;
      aliasMp?: string;
      qrImageData?: string;
      description?: string;
      amount?: number;
      expenseId?: number;
    };
    try {
      data = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Mensaje inválido' }));
      return;
    }

    // 1. Unirse a la sala (con fusión automática si ya fue cargado manualmente por el organizador)
    if (data.type === 'join' && data.clientId && data.name) {
      const cleanId = data.clientId.trim().slice(0, 64);
      const cleanName = data.name.trim().slice(0, 40);
      if (!cleanId || !cleanName) return;

      const existing = this.ctx.storage.sql
        .exec<{ client_id: string }>('SELECT client_id FROM participants WHERE client_id = ?', cleanId)
        .toArray();

      if (existing.length > 0) {
        this.ctx.storage.sql.exec(
          'UPDATE participants SET name = ? WHERE client_id = ?',
          cleanName,
          cleanId
        );
      } else {
        // Buscar si existe un invitado manual con el mismo nombre exacto (sin distinguir mayúsculas)
        const manualMatch = this.ctx.storage.sql
          .exec<{ client_id: string }>(
            "SELECT client_id FROM participants WHERE client_id LIKE 'manual-%' AND LOWER(TRIM(name)) = LOWER(?) LIMIT 1",
            cleanName
          )
          .toArray();

        if (manualMatch.length > 0) {
          // Vinculamos el registro manual al celular real conservando su estado de seña/pago
          this.ctx.storage.sql.exec(
            'UPDATE participants SET client_id = ?, name = ? WHERE client_id = ?',
            cleanId,
            cleanName,
            manualMatch[0].client_id
          );
        } else {
          this.ctx.storage.sql.exec(
            `INSERT INTO participants (client_id, public_id, name, status, paid_amount, joined_at)
             VALUES (?, ?, ?, 'pendiente', 0, ?)`,
            cleanId,
            `p_${randomHex(6)}`,
            cleanName,
            new Date().toISOString()
          );
        }
      }

      const attachment: WsAttachment = { clientId: cleanId, name: cleanName };
      ws.serializeAttachment(attachment);
      this.broadcastSnapshot();
      return;
    }

    const att = ws.deserializeAttachment() as WsAttachment | null;
    if (!att?.clientId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Primero ingresá a la sala con tu apodo.' }));
      return;
    }

    const isOrg = this.isOrganizerClient(att.clientId);

    // 2. Votar tarjeta
    if (data.type === 'vote' && typeof data.optionId === 'number' && (data.vote === 0 || data.vote === 1)) {
      const exists = this.ctx.storage.sql
        .exec<{ cnt: number }>('SELECT COUNT(*) as cnt FROM options WHERE id = ?', data.optionId)
        .one();
      if (exists.cnt === 0) return;

      this.ctx.storage.sql.exec(
        `INSERT INTO votes (option_id, client_id, vote)
         VALUES (?, ?, ?)
         ON CONFLICT(option_id, client_id) DO UPDATE SET vote = excluded.vote`,
        data.optionId,
        att.clientId,
        data.vote
      );
      this.ctx.storage.sql.exec('UPDATE room_meta SET tiebreak_json = NULL WHERE id = 1');
      this.broadcastSnapshot();
      return;
    }

    // 3. Proponer opción
    if (data.type === 'add_option' && typeof data.title === 'string') {
      const cleanTitle = data.title.trim().slice(0, 70);
      const cleanCat = (data.category || 'Idea').trim().slice(0, 24) || 'Idea';
      if (cleanTitle.length < 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'Escribí un nombre válido para la opción.' }));
        return;
      }

      const countRow = this.ctx.storage.sql
        .exec<{ cnt: number }>('SELECT COUNT(*) as cnt FROM options')
        .one();
      if (countRow.cnt >= 50) {
        ws.send(JSON.stringify({ type: 'error', message: 'Límite de 50 opciones por sala alcanzado.' }));
        return;
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO options (category, title, proposed_by, created_at) VALUES (?, ?, ?, ?)`,
        cleanCat,
        cleanTitle,
        att.name,
        new Date().toISOString()
      );
      this.broadcastSnapshot();
      return;
    }

    // 4. Desempate en servidor
    if (data.type === 'tiebreak') {
      const base = this.buildSnapshotFor(att.clientId);
      const maxYes = Math.max(0, ...base.options.map((o) => o.yesCount));
      if (maxYes === 0) {
        ws.send(JSON.stringify({ type: 'error', message: 'Todavía no hay votos positivos para desempatar.' }));
        return;
      }
      const tied = base.options.filter((o) => o.yesCount === maxYes);
      if (tied.length < 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'No hay empate en el primer puesto.' }));
        return;
      }

      const rand = new Uint32Array(1);
      crypto.getRandomValues(rand);
      const winner = tied[rand[0] % tied.length];

      const result: TiebreakResult = {
        optionId: winner.id,
        title: winner.title,
        category: winner.category,
        decidedAt: new Date().toISOString(),
        decidedBy: att.name
      };

      this.ctx.storage.sql.exec(
        'UPDATE room_meta SET tiebreak_json = ? WHERE id = 1',
        JSON.stringify(result)
      );
      this.broadcastSnapshot();
      return;
    }

    // 5. Autenticación de Organizador persistente + bloqueo anti-fuerza bruta (5 fallos -> 120s)
    if (data.type === 'auth_organizer' && typeof data.pin === 'string') {
      const nowMs = Date.now();
      const attemptRows = this.ctx.storage.sql
        .exec<{ fails: number; locked_until: number }>(
          'SELECT fails, locked_until FROM auth_attempts WHERE client_id = ?',
          att.clientId
        )
        .toArray();
      const attempt = attemptRows[0] ?? { fails: 0, locked_until: 0 };

      if (attempt.locked_until > nowMs) {
        ws.send(
          JSON.stringify({
            type: 'auth_result',
            ok: false,
            message: 'Demasiados intentos fallidos. Esperá antes de volver a probar.',
            lockedUntil: attempt.locked_until
          })
        );
        return;
      }

      const secret = this.ctx.storage.sql
        .exec<{ organizer_pin_hash: string; organizer_salt: string }>(
          'SELECT organizer_pin_hash, organizer_salt FROM room_meta WHERE id = 1'
        )
        .one();

      const candidateHash = await hashPin(data.pin.trim(), secret.organizer_salt);
      if (timingSafeEqual(candidateHash, secret.organizer_pin_hash)) {
        this.ctx.storage.sql.exec('DELETE FROM auth_attempts WHERE client_id = ?', att.clientId);
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO organizer_sessions (client_id, granted_at) VALUES (?, ?)',
          att.clientId,
          new Date().toISOString()
        );
        ws.send(JSON.stringify({ type: 'auth_result', ok: true }));
        this.broadcastSnapshot();
      } else {
        const nextFails = attempt.fails + 1;
        const lockedUntil = nextFails >= 5 ? nowMs + 120_000 : 0;
        this.ctx.storage.sql.exec(
          `INSERT INTO auth_attempts (client_id, fails, locked_until)
           VALUES (?, ?, ?)
           ON CONFLICT(client_id) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until`,
          att.clientId,
          lockedUntil > 0 ? 0 : nextFails,
          lockedUntil
        );
        ws.send(
          JSON.stringify({
            type: 'auth_result',
            ok: false,
            message:
              lockedUntil > 0
                ? '5 intentos fallidos. Bloqueado por 120 segundos.'
                : `PIN incorrecto (intento ${nextFails} de 5).`,
            lockedUntil: lockedUntil || undefined
          })
        );
      }
      return;
    }

    if (data.type === 'logout_organizer') {
      this.ctx.storage.sql.exec('DELETE FROM organizer_sessions WHERE client_id = ?', att.clientId);
      this.broadcastSnapshot();
      return;
    }

    // 6. Acciones exclusivas de Organizador (cerrojo en servidor usando publicId)
    if (data.type === 'set_payment' && data.targetPublicId && data.status) {
      if (!isOrg) {
        ws.send(JSON.stringify({ type: 'error', message: 'Solo el organizador puede modificar pagos.' }));
        return;
      }
      if (!['pendiente', 'seno', 'completo'].includes(data.status)) return;

      const meta = this.ctx.storage.sql
        .exec<{ deposit_amount: number; total_amount: number }>(
          'SELECT deposit_amount, total_amount FROM room_meta WHERE id = 1'
        )
        .one();

      const paidAmount =
        data.status === 'completo'
          ? meta.total_amount
          : data.status === 'seno'
            ? meta.deposit_amount
            : 0;

      this.ctx.storage.sql.exec(
        'UPDATE participants SET status = ?, paid_amount = ? WHERE public_id = ?',
        data.status,
        paidAmount,
        data.targetPublicId
      );
      this.broadcastSnapshot();
      return;
    }

    if (data.type === 'add_guest' && typeof data.name === 'string') {
      if (!isOrg) {
        ws.send(JSON.stringify({ type: 'error', message: 'Solo el organizador puede cargar invitados.' }));
        return;
      }
      const cleanName = data.name.trim().slice(0, 40);
      if (cleanName.length < 2) return;
      const status = data.status && ['pendiente', 'seno', 'completo'].includes(data.status) ? data.status : 'pendiente';
      const meta = this.ctx.storage.sql
        .exec<{ deposit_amount: number; total_amount: number }>(
          'SELECT deposit_amount, total_amount FROM room_meta WHERE id = 1'
        )
        .one();
      const paidAmount =
        status === 'completo' ? meta.total_amount : status === 'seno' ? meta.deposit_amount : 0;

      const guestId = `manual-${randomHex(6)}`;
      this.ctx.storage.sql.exec(
        `INSERT INTO participants (client_id, public_id, name, status, paid_amount, joined_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        guestId,
        `p_${randomHex(6)}`,
        cleanName,
        status,
        paidAmount,
        new Date().toISOString()
      );
      this.broadcastSnapshot();
      return;
    }

    if (data.type === 'remove_guest' && typeof data.targetPublicId === 'string') {
      if (!isOrg) {
        ws.send(JSON.stringify({ type: 'error', message: 'Solo el organizador puede quitar invitados.' }));
        return;
      }
      const target = this.ctx.storage.sql
        .exec<{ client_id: string }>('SELECT client_id FROM participants WHERE public_id = ?', data.targetPublicId)
        .toArray();
      if (target.length === 0 || target[0].client_id === att.clientId) return;
      this.ctx.storage.sql.exec('DELETE FROM participants WHERE public_id = ?', data.targetPublicId);
      this.broadcastSnapshot();
      return;
    }

    if (data.type === 'update_alias' && typeof data.aliasMp === 'string') {
      if (!isOrg) {
        ws.send(JSON.stringify({ type: 'error', message: 'Solo el organizador puede editar el Alias.' }));
        return;
      }
      this.ctx.storage.sql.exec(
        'UPDATE room_meta SET alias_mp = ? WHERE id = 1',
        data.aliasMp.trim().slice(0, 60)
      );
      this.broadcastSnapshot();
      return;
    }

    if (data.type === 'update_qr_image' && typeof data.qrImageData === 'string') {
      if (!isOrg) {
        ws.send(JSON.stringify({ type: 'error', message: 'Solo el organizador puede subir el QR.' }));
        return;
      }
      const img = data.qrImageData.trim();
      if (img && (!img.startsWith('data:image/') || img.length > 220_000)) {
        ws.send(JSON.stringify({ type: 'error', message: 'La imagen QR es inválida o demasiado pesada.' }));
        return;
      }
      this.ctx.storage.sql.exec('UPDATE room_meta SET qr_image_data = ? WHERE id = 1', img);
      this.broadcastSnapshot();
      return;
    }

    // 7. Gastos (Modo 'gastos' — dividir gastos reales)
    if (data.type === 'add_expense' && typeof data.description === 'string' && typeof data.amount === 'number') {
      const desc = data.description.trim().slice(0, 60);
      const amount = Math.round(data.amount);
      if (desc.length < 2 || !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
        ws.send(JSON.stringify({ type: 'error', message: 'Ingresá una descripción y un monto válido.' }));
        return;
      }
      const me = this.ctx.storage.sql
        .exec<{ public_id: string }>('SELECT public_id FROM participants WHERE client_id = ?', att.clientId)
        .toArray();
      const myPubId = me[0]?.public_id || '';
      this.ctx.storage.sql.exec(
        `INSERT INTO expenses (paid_by_client_id, paid_by_public_id, paid_by_name, description, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        att.clientId,
        myPubId,
        att.name,
        desc,
        amount,
        new Date().toISOString()
      );
      this.broadcastSnapshot();
      return;
    }

    if (data.type === 'delete_expense' && typeof data.expenseId === 'number') {
      const rows = this.ctx.storage.sql
        .exec<{ paid_by_client_id: string }>('SELECT paid_by_client_id FROM expenses WHERE id = ?', data.expenseId)
        .toArray();
      if (rows.length === 0) return;
      if (!isOrg && rows[0].paid_by_client_id !== att.clientId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Solo el autor o el organizador puede borrar este gasto.' }));
        return;
      }
      this.ctx.storage.sql.exec('DELETE FROM expenses WHERE id = ?', data.expenseId);
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
