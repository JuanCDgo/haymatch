<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Sun,
    Moon,
    Copy,
    Check,
    Share2,
    Flame,
    Wallet,
    Users,
    ArrowRight,
    Plus,
    LogOut
  } from 'lucide-svelte';
  import {
    getOrCreateClientId,
    getSavedNickname,
    saveNickname,
    getSavedTheme,
    saveTheme
  } from './lib/clientId';
  import { RoomSocket } from './lib/ws.svelte';
  import MatchTab from './lib/components/MatchTab.svelte';
  import VaquitaTab from './lib/components/VaquitaTab.svelte';
  import { formatARS } from './lib/money';
  import type { RoomSnapshot, VaquitaMode } from './lib/types';

  const clientId = getOrCreateClientId();
  const socket = new RoomSocket();

  let theme = $state<'dark' | 'light'>(getSavedTheme());
  let activeRoomCode = $state<string | null>(null);
  let activeTab = $state<'match' | 'vaquita'>('match');
  let nickname = $state(getSavedNickname());
  let pendingNickname = $state(getSavedNickname());
  let needsNickname = $state(false);

  // Formulario de ingreso por código
  let joinCode = $state('');
  let joinError = $state('');

  // Formulario de creación de sala
  let createTitle = $state('Asado Fin de Año');
  let createTemplate = $state<'asado' | 'juntada' | 'peliculas' | 'libre'>('asado');
  let createOrganizer = $state(getSavedNickname());
  let createPin = $state('');
  let createVaquita = $state(true);
  let createVaquitaMode = $state<VaquitaMode>('cuotas');
  let createGoal = $state(30);
  let createDeposit = $state(10000);
  let createTotal = $state(30000);
  let createDeadline = $state('30/11');
  let createAlias = $state('');
  let creating = $state(false);
  let createError = $state('');

  // Estado UI
  let copiedCode = $state(false);
  let showPresence = $state(false);
  let loadingRoom = $state(false);
  let roomLoadError = $state('');
  let previewTitle = $state('');

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    saveTheme(theme);
  }

  function getRoomCodeFromUrl(): string | null {
    const m = location.pathname.match(/^\/sala\/([A-Za-z0-9]{4})$/i);
    return m ? m[1].toUpperCase() : null;
  }

  async function enterRoom(code: string) {
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(clean)) {
      joinError = 'El código debe tener 4 letras o números.';
      return;
    }

    joinError = '';
    roomLoadError = '';
    loadingRoom = true;

    try {
      const res = await fetch(`/api/salas/${clean}`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = err.error || 'No encontramos esa sala.';
        joinError = msg;
        roomLoadError = msg;
        loadingRoom = false;
        return;
      }

      const initial = (await res.json()) as RoomSnapshot;
      previewTitle = initial.room.title;
      activeRoomCode = clean;

      if (location.pathname.toUpperCase() !== `/SALA/${clean}`) {
        history.pushState({}, '', `/sala/${clean}`);
      }

      if (nickname.trim()) {
        needsNickname = false;
        socket.connect(clean, clientId, nickname.trim());
      } else {
        needsNickname = true;
      }
    } catch {
      joinError = 'No pudimos conectar con el servidor.';
    } finally {
      loadingRoom = false;
    }
  }

  async function handleCreateRoom(e: Event) {
    e.preventDefault();
    createError = '';

    if (!createTitle.trim()) {
      createError = 'Poné un nombre para la sala.';
      return;
    }
    if (!createOrganizer.trim()) {
      createError = 'Poné tu nombre o apodo.';
      return;
    }
    if (createPin.trim().length < 4) {
      createError = 'Elegí un PIN de organizador de al menos 4 dígitos.';
      return;
    }

    creating = true;
    try {
      const res = await fetch('/api/salas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createTitle.trim(),
          template: createTemplate,
          organizerName: createOrganizer.trim(),
          organizerClientId: clientId,
          pin: createPin.trim(),
          vaquitaEnabled: createVaquita,
          vaquitaMode: createVaquitaMode,
          goalPeople: Number(createGoal) || 30,
          depositAmount: Number(createDeposit) || 10000,
          totalAmount: Number(createTotal) || 30000,
          deadlineText: createDeadline.trim() || '30/11',
          aliasMp: createAlias.trim()
        })
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        createError = err.error || 'No se pudo crear la sala.';
        return;
      }

      const created = (await res.json()) as RoomSnapshot;
      nickname = createOrganizer.trim();
      pendingNickname = nickname;
      saveNickname(nickname);
      await enterRoom(created.room.code);
    } catch {
      createError = 'Error de conexión al crear la sala.';
    } finally {
      creating = false;
    }
  }

  function confirmNickname(e: Event) {
    e.preventDefault();
    if (!pendingNickname.trim() || !activeRoomCode) return;
    nickname = pendingNickname.trim();
    saveNickname(nickname);
    needsNickname = false;
    socket.connect(activeRoomCode, clientId, nickname);
  }

  function leaveRoom() {
    socket.disconnect();
    activeRoomCode = null;
    needsNickname = false;
    history.pushState({}, '', '/');
  }

  async function copyRoomCode() {
    if (!activeRoomCode) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/sala/${activeRoomCode}`);
      copiedCode = true;
      setTimeout(() => (copiedCode = false), 1800);
    } catch {
      // Fallback silencioso
    }
  }

  function shareOnWhatsApp() {
    const snap = socket.snapshot;
    if (!snap) return;
    const roomUrl = `${location.origin}/sala/${snap.room.code}`;
    // Cero emojis para garantizar cero rombos en WhatsApp Web / Desktop
    const lines = [
      `*${snap.room.title}*`,
      `Entra a la sala de HayMatch para votar en vivo y ver la organizacion:`,
      `• Codigo de sala: *${snap.room.code}*`,
      `• Link directo:`,
      roomUrl
    ];
    if (snap.room.vaquitaEnabled) {
      if (snap.room.vaquitaMode === 'cuotas') {
        lines.push(
          `• Sena: *${formatARS(snap.room.depositAmount)}* (hasta ${snap.room.deadlineText}) · Total: *${formatARS(snap.room.totalAmount)}*`
        );
      } else {
        lines.push(`• Modo Vaquita: *Division de gastos en vivo*`);
      }
    }
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  onMount(() => {
    saveTheme(theme);
    const codeFromUrl = getRoomCodeFromUrl();
    if (codeFromUrl) {
      enterRoom(codeFromUrl);
    }

    const onPop = () => {
      const code = getRoomCodeFromUrl();
      if (code) {
        enterRoom(code);
      } else {
        socket.disconnect();
        activeRoomCode = null;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      socket.disconnect();
    };
  });
</script>

<div class="app-shell">
  {#if !activeRoomCode}
    <!-- PANTALLA DE INICIO -->
    <header class="topbar">
      <div class="brand">
        <span class="brand-name">HayMatch</span>
        <span class="brand-tag">En vivo</span>
      </div>
      <button class="icon-btn" onclick={toggleTheme} aria-label="Cambiar tema">
        {#if theme === 'dark'}
          <Sun size={18} />
        {:else}
          <Moon size={18} />
        {/if}
      </button>
    </header>

    <main class="content">
      <section class="hero">
        <h1>Decidan en grupo sin dar mil vueltas.</h1>
        <p>Creá una sala, pasá el link por WhatsApp y voten en tiempo real con vaquita incluida.</p>
      </section>

      <!-- Entrar a sala existente -->
      <section class="card stack">
        <div class="section-head">
          <h2>Entrar con código</h2>
          <span class="muted">Sin registro</span>
        </div>
        <form
          class="join-row"
          onsubmit={(e) => {
            e.preventDefault();
            enterRoom(joinCode);
          }}
        >
          <input
            type="text"
            maxlength="4"
            placeholder="Ej: ASAD"
            bind:value={joinCode}
            class="code-input"
            aria-label="Código de sala"
          />
          <button type="submit" class="btn-primary join-btn" disabled={loadingRoom}>
            <span>Entrar</span>
            <ArrowRight size={16} />
          </button>
        </form>
        {#if joinError}
          <p class="error-banner">{joinError}</p>
        {/if}
      </section>

      <!-- Crear nueva sala -->
      <form class="card stack" onsubmit={handleCreateRoom}>
        <div class="section-head">
          <h2>Crear nueva sala</h2>
          <Plus size={16} />
        </div>

        <div class="field">
          <label for="room-title">Nombre del evento o juntada</label>
          <input id="room-title" type="text" bind:value={createTitle} maxlength="60" required />
        </div>

        <div class="grid-2">
          <div class="field">
            <label for="org-name">Tu apodo</label>
            <input
              id="org-name"
              type="text"
              placeholder="Ej: Juan"
              bind:value={createOrganizer}
              maxlength="40"
              required
            />
          </div>
          <div class="field">
            <label for="org-pin">PIN Organizador</label>
            <input
              id="org-pin"
              type="password"
              inputmode="numeric"
              placeholder="4 dígitos"
              bind:value={createPin}
              maxlength="12"
              required
            />
          </div>
        </div>

        <div class="field">
          <label for="template">Plantilla inicial de opciones</label>
          <select id="template" bind:value={createTemplate}>
            <option value="asado">Asado (bebidas, parrilla, ensaladas, truco)</option>
            <option value="juntada">Juntada rápida (pizza, empanadas, birra)</option>
            <option value="peliculas">Noche de películas</option>
            <option value="libre">Sala vacía (cargamos todo nosotros)</option>
          </select>
        </div>

        <label class="toggle-row">
          <input type="checkbox" bind:checked={createVaquita} />
          <span>Activar pestaña de Vaquita y Señas</span>
        </label>

        {#if createVaquita}
          <div class="vaquita-box">
            <div class="field">
              <label for="v-mode">¿Cómo manejan la plata?</label>
              <select id="v-mode" bind:value={createVaquitaMode}>
                <option value="cuotas">Cuota y Señas (monto fijo por persona)</option>
                <option value="gastos">Dividir gastos (cada uno carga lo que compró)</option>
              </select>
            </div>

            {#if createVaquitaMode === 'cuotas'}
              <div class="grid-2">
                <div class="field">
                  <label for="v-goal">Meta personas</label>
                  <input id="v-goal" type="number" min="2" max="500" bind:value={createGoal} />
                </div>
                <div class="field">
                  <label for="v-deadline">Fecha límite seña</label>
                  <input id="v-deadline" type="text" bind:value={createDeadline} placeholder="30/11" />
                </div>
              </div>
              <div class="grid-2">
                <div class="field">
                  <label for="v-deposit">Seña (ARS $)</label>
                  <input id="v-deposit" type="number" min="0" step="500" bind:value={createDeposit} />
                </div>
                <div class="field">
                  <label for="v-total">Total por persona (ARS $)</label>
                  <input id="v-total" type="number" min="0" step="500" bind:value={createTotal} />
                </div>
              </div>
              <div class="field">
                <label for="v-alias">Alias Mercado Pago / Banco (opcional)</label>
                <input id="v-alias" type="text" bind:value={createAlias} placeholder="ej. asado.fin.ano" />
              </div>
            {:else}
              <p class="muted small">
                Cada participante carga lo que compró (carne, bebida, hielo) y la app calcula automáticamente quién le transfiere a quién.
              </p>
            {/if}
          </div>
        {/if}

        {#if createError}
          <p class="error-banner">{createError}</p>
        {/if}

        <button type="submit" class="btn-primary" disabled={creating}>
          {creating ? 'Creando sala...' : 'Crear sala en vivo'}
        </button>
      </form>
    </main>
  {:else if needsNickname}
    <!-- INGRESO RÁPIDO CON APODO -->
    <header class="topbar">
      <button class="brand-back" onclick={leaveRoom}>HayMatch</button>
      <button class="icon-btn" onclick={toggleTheme} aria-label="Cambiar tema">
        {#if theme === 'dark'}
          <Sun size={18} />
        {:else}
          <Moon size={18} />
        {/if}
      </button>
    </header>

    <main class="content center-box">
      <form class="card stack" onsubmit={confirmNickname}>
        <span class="code-badge">SALA #{activeRoomCode}</span>
        <h2>{previewTitle || 'Te invitaron a una sala'}</h2>
        <p class="muted">Poné cómo te dicen en el grupo para entrar en vivo.</p>
        <div class="field">
          <label for="guest-name">Tu nombre o apodo</label>
          <input
            id="guest-name"
            type="text"
            placeholder="Ej: Martín G."
            bind:value={pendingNickname}
            maxlength="40"
            required
          />
        </div>
        <button type="submit" class="btn-primary">Entrar a la sala</button>
      </form>
    </main>
  {:else}
    <!-- SALA EN VIVO (SPRINT 1) -->
    <header class="topbar room-top">
      <div class="room-top-left">
        <button class="brand-back" onclick={leaveRoom}>HayMatch</button>
        <button class="pill-live" onclick={() => (showPresence = !showPresence)} title="Ver conectados">
          <span class="live-dot"></span>
          {socket.snapshot ? `${socket.snapshot.onlineCount} en vivo` : 'Conectando...'}
        </button>
      </div>
      <div class="room-top-actions">
        <button class="icon-btn" onclick={shareOnWhatsApp} aria-label="Compartir por WhatsApp" title="Compartir por WhatsApp">
          <Share2 size={17} />
        </button>
        <button class="icon-btn" onclick={toggleTheme} aria-label="Cambiar tema" title="Cambiar tema">
          {#if theme === 'dark'}
            <Sun size={18} />
          {:else}
            <Moon size={18} />
          {/if}
        </button>
        <button class="icon-btn icon-btn-exit" onclick={leaveRoom} aria-label="Salir de la sala" title="Salir de la sala">
          <LogOut size={17} />
        </button>
      </div>
    </header>

    <main class="content room-content">
      {#if roomLoadError}
        <p class="error-banner">{roomLoadError}</p>
      {/if}

      {#if socket.snapshot}
        {@const snap = socket.snapshot}
        <section class="room-header-info">
          <div class="room-title-row">
            <h1>{snap.room.title}</h1>
            <button class="code-badge" onclick={copyRoomCode} title="Copiar link de la sala">
              <span>#{snap.room.code}</span>
              {#if copiedCode}
                <Check size={13} />
              {:else}
                <Copy size={13} />
              {/if}
            </button>
          </div>
          <p class="muted">
            Conectado como <strong>{nickname}</strong> ·
            {socket.connected ? 'WebSocket activo' : 'Reconectando...'}
          </p>
        </section>

        <!-- PANEL DESPLEGABLE DE CONECTADOS EN VIVO (tocando el badge verde arriba) -->
        {#if showPresence}
          <section class="card stack">
            <div class="section-head">
              <div class="inline-title">
                <Users size={16} />
                <h2>En la sala ({snap.participants.length})</h2>
              </div>
              <span class="muted">{snap.onlineCount} online ahora</span>
            </div>

            <ul class="presence-list">
              {#each snap.participants as person (person.clientId)}
                <li class="presence-item">
                  <span class="avatar" class:online={person.isOnline}>
                    {person.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div class="presence-info">
                    <span class="person-name">
                      {person.name}
                      {#if person.clientId === clientId}
                        <span class="you-tag">Vos</span>
                      {/if}
                    </span>
                    <span class="muted small">
                      {person.isOnline ? 'Conectado ahora' : 'Desconectado'}
                    </span>
                  </div>
                  <span class="status-dot" class:online={person.isOnline}></span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if activeTab === 'match'}
          <MatchTab
            snapshot={snap}
            onVote={(optionId, vote) => socket.send({ type: 'vote', optionId, vote })}
            onAddOption={(category, title) => socket.send({ type: 'add_option', category, title })}
            onTiebreak={() => socket.send({ type: 'tiebreak' })}
          />
        {:else}
          <VaquitaTab
            snapshot={snap}
            {clientId}
            authMessage={socket.authMessage}
            authLockedUntil={socket.authLockedUntil}
            onAuthOrganizer={(pin) => socket.send({ type: 'auth_organizer', pin })}
            onLogoutOrganizer={() => socket.send({ type: 'logout_organizer' })}
            onSetPayment={(targetClientId, status) =>
              socket.send({ type: 'set_payment', targetClientId, status })}
            onAddGuest={(name, status) => socket.send({ type: 'add_guest', name, status })}
            onUpdateAlias={(aliasMp) => socket.send({ type: 'update_alias', aliasMp })}
            onAddExpense={(description, amount) =>
              socket.send({ type: 'add_expense', description, amount })}
            onDeleteExpense={(expenseId) => socket.send({ type: 'delete_expense', expenseId })}
          />
        {/if}
      {:else}
        <section class="card">
          <p class="muted">Conectando a la habitación en vivo...</p>
        </section>
      {/if}
    </main>

    <!-- BOTTOM NAV (2 PESTAÑAS IGUAL AL BOCETO STITCH) -->
    <nav class="bottom-nav">
      <button
        class="nav-item"
        class:active={activeTab === 'match'}
        onclick={() => (activeTab = 'match')}
      >
        <Flame size={20} />
        <span>Match</span>
      </button>
      <button
        class="nav-item"
        class:active={activeTab === 'vaquita'}
        onclick={() => (activeTab = 'vaquita')}
      >
        <Wallet size={20} />
        <span>Vaquita</span>
      </button>
    </nav>
  {/if}
</div>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-page);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .brand,
  .room-top-left,
  .room-top-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .brand-name,
  .brand-back {
    font-weight: 700;
    font-size: 1.05rem;
    letter-spacing: -0.02em;
  }

  .brand-tag {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
  }

  .icon-btn {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
  }

  .icon-btn-exit:hover {
    border-color: var(--danger);
    color: var(--danger);
  }

  .content {
    flex: 1;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .room-content {
    padding-bottom: 88px;
  }

  .center-box {
    justify-content: center;
  }

  .hero h1 {
    font-size: 1.45rem;
    line-height: 1.2;
    letter-spacing: -0.02em;
    margin-bottom: 6px;
  }

  .hero p,
  .muted {
    color: var(--text-secondary);
    font-size: 0.88rem;
    line-height: 1.4;
  }

  .small {
    font-size: 0.76rem;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .section-head h2 {
    font-size: 0.98rem;
    font-weight: 600;
  }

  .inline-title {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .join-row {
    display: flex;
    gap: 8px;
  }

  .code-input {
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 700;
    text-align: center;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 12px;
    font-size: 1rem;
  }

  .join-btn {
    width: auto;
    padding: 12px 18px;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    padding: 4px 0;
  }

  .toggle-row input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }

  .vaquita-box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 12px;
    background: var(--bg-page);
    border: 1px solid var(--border-subtle);
  }

  .room-header-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .room-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .room-title-row h1 {
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .presence-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .presence-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
  }

  .avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.78rem;
    font-weight: 700;
    background: var(--bg-surface);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }

  .avatar.online {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
  }

  .presence-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .person-name {
    font-size: 0.9rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .you-tag {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--accent-soft);
    color: var(--accent);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border-subtle);
  }

  .status-dot.online {
    background: var(--accent);
  }

  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 480px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    background: var(--bg-surface);
    border-top: 1px solid var(--border-subtle);
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  }

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    padding: 4px 0;
  }

  .nav-item.active {
    color: var(--accent);
  }
</style>
