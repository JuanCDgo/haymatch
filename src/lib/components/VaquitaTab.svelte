<script lang="ts">
  import { onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import {
    QrCode,
    Copy,
    Check,
    Lock,
    Unlock,
    UserPlus,
    Download,
    Plus,
    Trash2,
    ArrowRight,
    Share2,
    X
  } from 'lucide-svelte';
  import type { PaymentStatus, RoomSnapshot } from '../types';
  import { calculateExpenseSplit, formatARS, parseMoneyInput } from '../money';

  interface Props {
    snapshot: RoomSnapshot;
    clientId: string;
    authMessage: string;
    authLockedUntil: number;
    onAuthOrganizer: (pin: string) => void;
    onLogoutOrganizer: () => void;
    onSetPayment: (targetClientId: string, status: PaymentStatus) => void;
    onAddGuest: (name: string, status: PaymentStatus) => void;
    onUpdateAlias: (aliasMp: string) => void;
    onAddExpense: (description: string, amount: number) => void;
    onDeleteExpense: (expenseId: number) => void;
  }

  let {
    snapshot,
    clientId,
    authMessage,
    authLockedUntil,
    onAuthOrganizer,
    onLogoutOrganizer,
    onSetPayment,
    onAddGuest,
    onUpdateAlias,
    onAddExpense,
    onDeleteExpense
  }: Props = $props();

  // Estado UI Modo Cuotas
  let filter = $state<'todos' | 'completo' | 'seno' | 'pendiente'>('todos');
  let showQrModal = $state(false);
  let qrDataUrl = $state('');
  let copiedAlias = $state(false);

  // Estado UI Modo Organizador
  let showPinModal = $state(false);
  let pinInput = $state('');
  let nowTick = $state(Date.now());
  let guestName = $state('');
  let guestStatus = $state<PaymentStatus>('seno');
  let editingAlias = $state(false);
  let aliasDraft = $state('');

  // Estado UI Modo Gastos
  let expenseDesc = $state('');
  let expenseAmountRaw = $state('');

  const timer = setInterval(() => {
    nowTick = Date.now();
  }, 1000);
  onDestroy(() => clearInterval(timer));

  const lockSecondsLeft = $derived(
    authLockedUntil > nowTick ? Math.ceil((authLockedUntil - nowTick) / 1000) : 0
  );

  // Si se autentica con éxito, cerramos el modal del PIN automáticamente
  $effect(() => {
    if (snapshot.isOrganizer && showPinModal) {
      showPinModal = false;
      pinInput = '';
    }
  });

  // Métricas Modo Cuotas
  const confirmedCount = $derived(
    snapshot.participants.filter((p) => p.status === 'seno' || p.status === 'completo').length
  );
  const fullCount = $derived(snapshot.participants.filter((p) => p.status === 'completo').length);
  const depositCount = $derived(snapshot.participants.filter((p) => p.status === 'seno').length);
  const pendingCount = $derived(snapshot.participants.filter((p) => p.status === 'pendiente').length);
  const totalCollected = $derived(
    snapshot.participants.reduce((sum, p) => sum + (p.paidAmount || 0), 0)
  );
  const estimatedGoalMoney = $derived(snapshot.room.goalPeople * snapshot.room.totalAmount);
  const progressPct = $derived(
    Math.min(100, Math.round((confirmedCount / Math.max(1, snapshot.room.goalPeople)) * 100))
  );

  const filteredParticipants = $derived(
    filter === 'todos'
      ? snapshot.participants
      : snapshot.participants.filter((p) => p.status === filter)
  );

  // Métricas Modo Gastos
  const split = $derived(calculateExpenseSplit(snapshot.participants, snapshot.expenses));

  async function openQrModal() {
    showQrModal = true;
    const payload = snapshot.room.aliasMp
      ? `ALIAS:${snapshot.room.aliasMp} | ${snapshot.room.title} | Sena ${formatARS(snapshot.room.depositAmount)}`
      : `${snapshot.room.title} | Sala ${snapshot.room.code}`;
    try {
      qrDataUrl = await QRCode.toDataURL(payload, {
        width: 220,
        margin: 2,
        color: { dark: '#121417', light: '#ffffff' }
      });
    } catch {
      qrDataUrl = '';
    }
  }

  async function copyAlias() {
    if (!snapshot.room.aliasMp) return;
    try {
      await navigator.clipboard.writeText(snapshot.room.aliasMp);
      copiedAlias = true;
      setTimeout(() => (copiedAlias = false), 1800);
    } catch {
      // ignore
    }
  }

  function handlePinSubmit(e: Event) {
    e.preventDefault();
    if (!pinInput.trim() || lockSecondsLeft > 0) return;
    onAuthOrganizer(pinInput.trim());
  }

  function handleAddGuest(e: Event) {
    e.preventDefault();
    if (guestName.trim().length < 2) return;
    onAddGuest(guestName.trim(), guestStatus);
    guestName = '';
  }

  function saveAliasEdit(e: Event) {
    e.preventDefault();
    onUpdateAlias(aliasDraft.trim());
    editingAlias = false;
  }

  function handleAddExpense(e: Event) {
    e.preventDefault();
    const parsed = parseMoneyInput(expenseAmountRaw);
    if (expenseDesc.trim().length < 2 || parsed <= 0) return;
    onAddExpense(expenseDesc.trim(), parsed);
    expenseDesc = '';
    expenseAmountRaw = '';
  }

  function shareSplitWhatsApp() {
    const lines = [
      `*${snapshot.room.title} - Reparto de Gastos*`,
      `• Total gastado: *${formatARS(split.totalSpent)}*`,
      `• Por persona (${snapshot.participants.length}): *${formatARS(split.perPerson)}*`,
      ``
    ];
    if (split.transfers.length === 0) {
      lines.push(`Estan todos a mano. Nadie le debe a nadie.`);
    } else {
      lines.push(`*Quien le transfiere a quien:*`);
      for (const t of split.transfers) {
        lines.push(`• ${t.from} -> *${t.to}*: *${formatARS(t.amount)}*`);
      }
    }
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function exportJsonBackup() {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `haymatch-${snapshot.room.code.toLowerCase()}-respaldo.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="vaquita-wrap">
  <!-- Barra superior de Vaquita: Modo Organizador + Respaldo JSON -->
  <div class="v-toolbar">
    {#if snapshot.isOrganizer}
      <button class="org-pill active" onclick={onLogoutOrganizer} title="Salir del modo organizador">
        <Unlock size={14} />
        <span>Organizador activo (Salir)</span>
      </button>
    {:else}
      <button class="org-pill" onclick={() => (showPinModal = true)}>
        <Lock size={14} />
        <span>Modo Organizador</span>
      </button>
    {/if}

    <button class="backup-btn" onclick={exportJsonBackup} title="Descargar respaldo JSON">
      <Download size={14} />
      <span>Respaldo</span>
    </button>
  </div>

  {#if snapshot.room.vaquitaMode === 'cuotas'}
    <!-- MODO 1: CUOTA Y SEÑAS (Estilo Boceto Stitch Modo Día) -->
    <section class="card stack">
      <div class="section-head">
        <h2>Estado de la Vaquita</h2>
        <span class="deadline-pill">Seña hasta {snapshot.room.deadlineText}</span>
      </div>

      <div class="progress-head">
        <span class="big-count">
          <strong>{confirmedCount}</strong> / {snapshot.room.goalPeople} confirmados
        </span>
        <span class="pct-label">{progressPct}%</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width: {progressPct}%"></div>
      </div>

      <div class="grid-2">
        <div class="metric">
          <span class="muted small">Seña requerida</span>
          <strong>{formatARS(snapshot.room.depositAmount)}</strong>
        </div>
        <div class="metric">
          <span class="muted small">Total por persona</span>
          <strong>{formatARS(snapshot.room.totalAmount)}</strong>
        </div>
        <div class="metric accent-metric">
          <span class="muted small">Total Recaudado</span>
          <strong>{formatARS(totalCollected)}</strong>
        </div>
        <div class="metric">
          <span class="muted small">Meta estimada</span>
          <strong>{formatARS(estimatedGoalMoney)}</strong>
        </div>
      </div>

      <button class="btn-primary" onclick={openQrModal}>
        <QrCode size={18} />
        <span>Pagar con Alias / QR</span>
      </button>

      {#if snapshot.room.aliasMp || snapshot.isOrganizer}
        <div class="alias-row">
          {#if editingAlias && snapshot.isOrganizer}
            <form class="alias-edit-form" onsubmit={saveAliasEdit}>
              <input type="text" bind:value={aliasDraft} placeholder="ej. asado.fin.ano" maxlength="60" />
              <button type="submit" class="mini-btn-accent">Guardar</button>
            </form>
          {:else}
            <div class="alias-info">
              <span class="muted small">Alias Mercado Pago / Banco</span>
              <strong>{snapshot.room.aliasMp || 'Sin alias cargado'}</strong>
            </div>
            <div class="alias-actions">
              {#if snapshot.room.aliasMp}
                <button class="mini-btn" onclick={copyAlias}>
                  {#if copiedAlias}
                    <Check size={14} />
                    <span>Copiado</span>
                  {:else}
                    <Copy size={14} />
                    <span>Copiar</span>
                  {/if}
                </button>
              {/if}
              {#if snapshot.isOrganizer}
                <button
                  class="mini-btn"
                  onclick={() => {
                    aliasDraft = snapshot.room.aliasMp;
                    editingAlias = true;
                  }}
                >
                  Editar
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Panel rápido del Organizador para cargar compañeros que confirmaron por WhatsApp -->
    {#if snapshot.isOrganizer}
      <form class="card stack org-add-card" onsubmit={handleAddGuest}>
        <div class="section-head">
          <div class="inline-title">
            <UserPlus size={15} />
            <h3>Cargar compañero manualmente</h3>
          </div>
        </div>
        <div class="guest-form-row">
          <input
            type="text"
            placeholder="Nombre y apellido"
            bind:value={guestName}
            maxlength="40"
            required
          />
          <select bind:value={guestStatus} aria-label="Estado inicial">
            <option value="seno">Señó</option>
            <option value="completo">Pagó todo</option>
            <option value="pendiente">Pendiente</option>
          </select>
          <button type="submit" class="mini-btn-accent">Sumar</button>
        </div>
      </form>
    {/if}

    <!-- Lista de Participantes y Pagos (UI Limpia sin badges redundantes de "Al día") -->
    <section class="stack">
      <div class="section-head">
        <h3>Participantes y Pagos</h3>
        <span class="muted small">{snapshot.participants.length} anotados</span>
      </div>

      <div class="filter-row">
        <button class="filter-pill" class:active={filter === 'todos'} onclick={() => (filter = 'todos')}>
          Todos {snapshot.participants.length}
        </button>
        <button class="filter-pill" class:active={filter === 'completo'} onclick={() => (filter = 'completo')}>
          Completos {fullCount}
        </button>
        <button class="filter-pill" class:active={filter === 'seno'} onclick={() => (filter = 'seno')}>
          Señados {depositCount}
        </button>
        <button class="filter-pill" class:active={filter === 'pendiente'} onclick={() => (filter = 'pendiente')}>
          Pendientes {pendingCount}
        </button>
      </div>

      <ul class="people-list">
        {#each filteredParticipants as person (person.clientId)}
          {@const remaining = Math.max(0, snapshot.room.totalAmount - person.paidAmount)}
          <li class="card person-card">
            <div class="person-main">
              <span class="avatar" class:debt={person.status === 'pendiente'}>
                {person.name.slice(0, 2).toUpperCase()}
              </span>
              <div class="person-meta">
                <strong>{person.name}</strong>
                {#if person.status === 'completo'}
                  <span class="muted small">Pagó {formatARS(person.paidAmount)}</span>
                {:else if person.status === 'seno'}
                  <span class="muted small">
                    Señó {formatARS(person.paidAmount)} · Resta {formatARS(remaining)}
                  </span>
                {:else}
                  <span class="debt-sub">Seña pendiente</span>
                {/if}
              </div>

              {#if person.status === 'pendiente'}
                <span class="debt-badge">Debe {formatARS(snapshot.room.depositAmount)}</span>
              {:else if person.status === 'seno'}
                <span class="neutral-badge">Señó</span>
              {:else}
                <span class="paid-text">{formatARS(person.paidAmount)}</span>
              {/if}
            </div>

            {#if snapshot.isOrganizer}
              <div class="org-controls">
                <button
                  class="state-btn"
                  class:selected={person.status === 'pendiente'}
                  onclick={() => onSetPayment(person.clientId, 'pendiente')}
                >
                  Pendiente
                </button>
                <button
                  class="state-btn"
                  class:selected={person.status === 'seno'}
                  onclick={() => onSetPayment(person.clientId, 'seno')}
                >
                  Señó ({formatARS(snapshot.room.depositAmount)})
                </button>
                <button
                  class="state-btn"
                  class:selected={person.status === 'completo'}
                  onclick={() => onSetPayment(person.clientId, 'completo')}
                >
                  Completo
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <!-- MODO 2: DIVIDIR GASTOS REALES -->
    <section class="card stack">
      <div class="section-head">
        <h2>Reparto de Gastos</h2>
        <button class="mini-btn" onclick={shareSplitWhatsApp}>
          <Share2 size={14} />
          <span>WhatsApp</span>
        </button>
      </div>

      <div class="grid-2">
        <div class="metric accent-metric">
          <span class="muted small">Total gastado</span>
          <strong>{formatARS(split.totalSpent)}</strong>
        </div>
        <div class="metric">
          <span class="muted small">Por persona ({snapshot.participants.length})</span>
          <strong>{formatARS(split.perPerson)}</strong>
        </div>
      </div>

      <form class="stack expense-form" onsubmit={handleAddExpense}>
        <div class="expense-grid">
          <input
            type="text"
            placeholder="¿Qué compraste? Ej: Carne"
            bind:value={expenseDesc}
            maxlength="60"
            required
          />
          <input
            type="text"
            inputmode="decimal"
            placeholder="Monto ($)"
            bind:value={expenseAmountRaw}
            required
          />
        </div>
        <button type="submit" class="btn-primary">
          <Plus size={16} />
          <span>Cargar mi gasto</span>
        </button>
      </form>
    </section>

    <!-- Quién le transfiere a quién -->
    <section class="card stack">
      <div class="section-head">
        <h3>Quién le transfiere a quién</h3>
      </div>
      {#if split.transfers.length === 0}
        <p class="muted">
          {split.totalSpent === 0
            ? 'Carguen los gastos de la juntada para calcular el reparto automático.'
            : 'Están todos a mano. Nadie le debe a nadie.'}
        </p>
      {:else}
        <ul class="transfer-list">
          {#each split.transfers as t}
            <li class="transfer-item">
              <div class="transfer-names">
                <strong>{t.from}</strong>
                <ArrowRight size={14} />
                <strong>{t.to}</strong>
              </div>
              <span class="transfer-amount">{formatARS(t.amount)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Historial de gastos -->
    <section class="card stack">
      <div class="section-head">
        <h3>Gastos cargados ({snapshot.expenses.length})</h3>
      </div>
      {#if snapshot.expenses.length === 0}
        <p class="muted">Todavía no se cargó ningún gasto.</p>
      {:else}
        <ul class="expense-list">
          {#each snapshot.expenses as exp (exp.id)}
            <li class="expense-item">
              <div>
                <strong>{exp.description}</strong>
                <span class="muted small">Pagó {exp.paidByName}</span>
              </div>
              <div class="expense-right">
                <strong>{formatARS(exp.amount)}</strong>
                {#if snapshot.isOrganizer || exp.paidByClientId === clientId}
                  <button
                    class="del-btn"
                    onclick={() => onDeleteExpense(exp.id)}
                    aria-label="Borrar gasto"
                    title="Borrar gasto"
                  >
                    <Trash2 size={15} />
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<!-- MODAL QR / ALIAS -->
{#if showQrModal}
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pagar con Alias o QR">
    <div class="card modal-card stack">
      <div class="section-head">
        <h3>Transferir seña o cuota</h3>
        <button class="close-btn" onclick={() => (showQrModal = false)} aria-label="Cerrar">
          <X size={18} />
        </button>
      </div>

      <div class="qr-box">
        {#if qrDataUrl}
          <img src={qrDataUrl} alt="Código QR de pago" width="210" height="210" />
        {:else}
          <p class="muted">Generando QR...</p>
        {/if}
      </div>

      <div class="qr-details">
        <span class="muted small">Alias destino</span>
        <strong>{snapshot.room.aliasMp || 'Pedile el Alias al organizador'}</strong>
        <span class="muted small">
          Seña: {formatARS(snapshot.room.depositAmount)} · Total: {formatARS(snapshot.room.totalAmount)}
        </span>
      </div>

      {#if snapshot.room.aliasMp}
        <button class="btn-primary" onclick={copyAlias}>
          {#if copiedAlias}
            <Check size={16} />
            <span>Alias copiado</span>
          {:else}
            <Copy size={16} />
            <span>Copiar Alias</span>
          {/if}
        </button>
      {/if}
    </div>
  </div>
{/if}

<!-- MODAL PIN ORGANIZADOR -->
{#if showPinModal}
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Modo Organizador">
    <form class="card modal-card stack" onsubmit={handlePinSubmit}>
      <div class="section-head">
        <h3>Ingresar como Organizador</h3>
        <button type="button" class="close-btn" onclick={() => (showPinModal = false)} aria-label="Cerrar">
          <X size={18} />
        </button>
      </div>
      <p class="muted">
        Ingresá el PIN que definiste al crear la sala para marcar señas, cargar invitados y editar el Alias.
      </p>
      <div class="field">
        <label for="org-pin-login">PIN de Organizador</label>
        <input
          id="org-pin-login"
          type="password"
          inputmode="numeric"
          placeholder="••••"
          bind:value={pinInput}
          disabled={lockSecondsLeft > 0}
          required
        />
      </div>

      {#if lockSecondsLeft > 0}
        <p class="error-banner">
          Bloqueo de seguridad activo. Volvé a intentar en <strong>{lockSecondsLeft}s</strong>.
        </p>
      {:else if authMessage}
        <p class="error-banner">{authMessage}</p>
      {/if}

      <button type="submit" class="btn-primary" disabled={lockSecondsLeft > 0}>
        Desbloquear panel
      </button>
    </form>
  </div>
{/if}

<style>
  .vaquita-wrap,
  .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .v-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .org-pill,
  .backup-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 11px;
    border-radius: 10px;
    font-size: 0.78rem;
    font-weight: 600;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }

  .org-pill.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .section-head h2,
  .section-head h3 {
    font-size: 0.98rem;
    font-weight: 600;
  }

  .inline-title {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .deadline-pill {
    font-size: 0.74rem;
    font-weight: 600;
    padding: 4px 9px;
    border-radius: 8px;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .progress-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .big-count {
    font-size: 0.95rem;
    color: var(--text-secondary);
  }

  .big-count strong {
    font-size: 1.45rem;
    color: var(--text-primary);
  }

  .pct-label {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--accent);
  }

  .bar-track {
    width: 100%;
    height: 8px;
    border-radius: 999px;
    background: var(--bg-surface-2);
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
    transition: width 0.25s ease;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .metric {
    padding: 11px 12px;
    border-radius: 12px;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .metric strong {
    font-size: 1.08rem;
  }

  .accent-metric {
    background: var(--accent-soft);
    border-color: var(--accent);
  }

  .accent-metric strong {
    color: var(--accent);
  }

  .alias-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
  }

  .alias-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .alias-info strong {
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .alias-actions {
    display: flex;
    gap: 6px;
  }

  .alias-edit-form {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .alias-edit-form input {
    flex: 1;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 0.88rem;
  }

  .mini-btn,
  .mini-btn-accent {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 7px 10px;
    border-radius: 8px;
    font-size: 0.78rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .mini-btn {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
  }

  .mini-btn-accent {
    background: var(--accent);
    color: var(--accent-text);
  }

  .org-add-card {
    border-color: var(--accent);
  }

  .guest-form-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 6px;
  }

  .guest-form-row input,
  .guest-form-row select {
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 0.85rem;
  }

  .filter-row {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .filter-pill {
    padding: 6px 11px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .filter-pill.active {
    background: var(--text-primary);
    color: var(--bg-page);
    border-color: var(--text-primary);
  }

  .people-list,
  .transfer-list,
  .expense-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .person-card {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .person-main {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.78rem;
    font-weight: 700;
    background: var(--accent-soft);
    color: var(--accent);
    flex-shrink: 0;
  }

  .avatar.debt {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .person-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .debt-sub {
    font-size: 0.76rem;
    color: var(--danger);
  }

  .debt-badge {
    font-size: 0.74rem;
    font-weight: 700;
    padding: 5px 9px;
    border-radius: 8px;
    background: var(--danger-soft);
    color: var(--danger);
    white-space: nowrap;
  }

  .neutral-badge {
    font-size: 0.74rem;
    font-weight: 600;
    padding: 5px 9px;
    border-radius: 8px;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    white-space: nowrap;
  }

  .paid-text {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .org-controls {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--border-subtle);
  }

  .state-btn {
    padding: 7px 6px;
    border-radius: 8px;
    font-size: 0.74rem;
    font-weight: 600;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .state-btn.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }

  .expense-grid {
    display: grid;
    grid-template-columns: 1fr 120px;
    gap: 8px;
  }

  .expense-grid input {
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 0.9rem;
  }

  .transfer-item,
  .expense-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
  }

  .transfer-names {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.88rem;
  }

  .transfer-amount {
    font-weight: 700;
    color: var(--accent);
  }

  .expense-item > div:first-child {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .expense-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .del-btn {
    color: var(--text-secondary);
    padding: 4px;
  }

  .del-btn:hover {
    color: var(--danger);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 50;
  }

  .modal-card {
    width: 100%;
    max-width: 380px;
    padding: 18px;
  }

  .close-btn {
    color: var(--text-secondary);
    padding: 4px;
  }

  .qr-box {
    display: flex;
    justify-content: center;
    padding: 14px;
    background: #ffffff;
    border-radius: 14px;
  }

  .qr-details {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 3px;
  }

  .muted {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .small {
    font-size: 0.76rem;
  }
</style>
