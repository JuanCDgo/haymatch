<script lang="ts">
  import {
    Check,
    X,
    Trophy,
    Plus,
    Dices,
    RotateCcw,
    Sparkles,
    Layers
  } from 'lucide-svelte';
  import type { RoomSnapshot, RoomOption } from '../types';

  interface Props {
    snapshot: RoomSnapshot;
    onVote: (optionId: number, vote: 0 | 1) => void;
    onAddOption: (category: string, title: string) => void;
    onTiebreak: () => void;
  }

  let { snapshot, onVote, onAddOption, onTiebreak }: Props = $props();

  let subView = $state<'votar' | 'podio'>('votar');
  let showAddForm = $state(false);
  let newCategory = $state('Bebida');
  let newTitle = $state('');
  let reviewingAll = $state(false);
  let reviewIndex = $state(0);

  const CATEGORIES = ['Bebida', 'Parrilla', 'Comida', 'Acompañamiento', 'Postre', 'Música', 'Lugar', 'Plan'];

  const unvotedOptions = $derived(
    snapshot.options.filter((o) => snapshot.myVotes[o.id] === undefined)
  );

  const currentCard = $derived<RoomOption | null>(
    reviewingAll
      ? snapshot.options[reviewIndex] ?? null
      : unvotedOptions[0] ?? null
  );

  const currentCardNumber = $derived(() => {
    if (!currentCard) return snapshot.options.length;
    const idx = snapshot.options.findIndex((o) => o.id === currentCard.id);
    return idx >= 0 ? idx + 1 : 1;
  });

  const rankedOptions = $derived(
    [...snapshot.options].sort((a, b) => {
      if (b.yesCount !== a.yesCount) return b.yesCount - a.yesCount;
      if (a.noCount !== b.noCount) return a.noCount - b.noCount;
      return a.id - b.id;
    })
  );

  const topYes = $derived(rankedOptions.length > 0 ? rankedOptions[0].yesCount : 0);

  const topTied = $derived(
    topYes > 0 ? rankedOptions.filter((o) => o.yesCount === topYes) : []
  );

  const hasTie = $derived(topTied.length >= 2);

  const unanimousMatch = $derived(
    snapshot.participants.length >= 2
      ? rankedOptions.find((o) => o.yesCount >= snapshot.participants.length) ?? null
      : null
  );

  const leader = $derived(topYes > 0 ? rankedOptions[0] : null);

  function handleVote(vote: 0 | 1) {
    if (!currentCard) return;
    onVote(currentCard.id, vote);
    if (reviewingAll) {
      if (reviewIndex + 1 < snapshot.options.length) {
        reviewIndex += 1;
      } else {
        reviewingAll = false;
        reviewIndex = 0;
      }
    }
  }

  function startReview() {
    reviewingAll = true;
    reviewIndex = 0;
    subView = 'votar';
  }

  function submitNewOption(e: Event) {
    e.preventDefault();
    if (newTitle.trim().length < 2) return;
    onAddOption(newCategory, newTitle.trim());
    newTitle = '';
    showAddForm = false;
  }

  function quorumPercent(opt: RoomOption): number {
    const totalPeople = Math.max(1, snapshot.participants.length);
    return Math.min(100, Math.round((opt.totalVotes / totalPeople) * 100));
  }

  function yesPercent(opt: RoomOption): number {
    if (opt.totalVotes === 0) return 0;
    return Math.round((opt.yesCount / opt.totalVotes) * 100);
  }
</script>

<div class="match-wrap">
  <!-- Selector interno: Votar vs Podio + botón Proponer -->
  <div class="subbar">
    <div class="segmented">
      <button
        class="seg-btn"
        class:active={subView === 'votar'}
        onclick={() => (subView = 'votar')}
      >
        <Layers size={15} />
        <span>Tarjetas ({unvotedOptions.length})</span>
      </button>
      <button
        class="seg-btn"
        class:active={subView === 'podio'}
        onclick={() => (subView = 'podio')}
      >
        <Trophy size={15} />
        <span>Podio</span>
      </button>
    </div>

    <button
      class="btn-add-mini"
      onclick={() => (showAddForm = !showAddForm)}
      aria-expanded={showAddForm}
    >
      <Plus size={15} />
      <span>Proponer</span>
    </button>
  </div>

  <!-- Formulario desplegable para proponer una nueva opción en vivo -->
  {#if showAddForm}
    <form class="card stack add-form" onsubmit={submitNewOption}>
      <div class="section-head">
        <h3>Proponer nueva opción</h3>
        <button type="button" class="close-mini" onclick={() => (showAddForm = false)}>
          <X size={16} />
        </button>
      </div>
      <div class="add-grid">
        <div class="field">
          <label for="opt-cat">Categoría</label>
          <select id="opt-cat" bind:value={newCategory}>
            {#each CATEGORIES as cat}
              <option value={cat}>{cat}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="opt-title">¿Qué proponés?</label>
          <input
            id="opt-title"
            type="text"
            placeholder="Ej: Gancia con limón"
            bind:value={newTitle}
            maxlength="70"
            required
          />
        </div>
      </div>
      <button type="submit" class="btn-primary">Sumar a la sala en vivo</button>
    </form>
  {/if}

  <!-- Alerta de Match Unánime -->
  {#if unanimousMatch}
    <div class="match-banner">
      <div class="match-banner-icon">
        <Sparkles size={18} />
      </div>
      <div>
        <span class="match-label">HAY MATCH UNÁNIME</span>
        <strong>{unanimousMatch.title}</strong>
        <span class="match-sub">Todos los participantes votaron que sí ({unanimousMatch.yesCount})</span>
      </div>
    </div>
  {/if}

  {#if subView === 'votar'}
    <!-- DECK DE TARJETAS SÍ / NO -->
    {#if currentCard}
      <article class="card vote-card">
        <div class="card-top">
          <span class="cat-pill">{currentCard.category}</span>
          <span class="counter-pill">
            {currentCardNumber()} de {snapshot.options.length}
          </span>
        </div>

        <div class="card-body">
          <h2 class="option-title">{currentCard.title}</h2>
          <p class="proposed">Propuesto por <strong>{currentCard.proposedBy}</strong></p>

          {#if snapshot.myVotes[currentCard.id] !== undefined}
            <span class="prev-vote">
              Tu voto actual: <strong>{snapshot.myVotes[currentCard.id] === 1 ? 'Sí, va' : 'No va'}</strong>
            </span>
          {/if}
        </div>

        <div class="quorum-block">
          <div class="quorum-head">
            <span>QUÓRUM DE SALA</span>
            <span>{currentCard.totalVotes} de {Math.max(1, snapshot.participants.length)} ya votaron</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width: {quorumPercent(currentCard)}%"></div>
          </div>
        </div>
      </article>

      <!-- Botones ergonómicos para el pulgar (igual al boceto Stitch) -->
      <div class="vote-actions">
        <button class="btn-vote btn-no" onclick={() => handleVote(0)}>
          <X size={20} />
          <span>No va</span>
        </button>
        <button class="btn-vote btn-yes" onclick={() => handleVote(1)}>
          <Check size={20} />
          <span>Sí, va</span>
        </button>
      </div>
    {:else if snapshot.options.length === 0}
      <div class="card empty-box">
        <h3>Todavía no hay opciones</h3>
        <p class="muted">Tocá <strong>Proponer</strong> arriba para cargar la primera tarjeta y empezar a votar.</p>
      </div>
    {:else}
      <div class="card empty-box">
        <div class="done-badge">
          <Check size={22} />
        </div>
        <h3>¡Ya votaste todas las opciones!</h3>
        <p class="muted">
          Podés ver cómo va el podio en tiempo real o proponer nuevas ideas para el grupo.
        </p>
        <div class="done-actions">
          <button class="btn-primary" onclick={() => (subView = 'podio')}>
            <Trophy size={16} />
            <span>Ver Podio en vivo</span>
          </button>
          <button class="btn-secondary" onclick={startReview}>
            <RotateCcw size={15} />
            <span>Cambiar mis votos</span>
          </button>
        </div>
      </div>
    {/if}

    <!-- Barra compacta de líder en vivo (igual al boceto Stitch) -->
    {#if leader}
      <button class="leader-strip" onclick={() => (subView = 'podio')}>
        <div class="leader-left">
          <span class="leader-tag">{hasTie ? 'EMPATE EN LA PUNTA' : 'LIDERANDO AHORA'}</span>
          <strong>{leader.title}</strong>
        </div>
        <span class="leader-count">{leader.yesCount} votos</span>
      </button>
    {/if}
  {:else}
    <!-- PODIO EN VIVO + DESEMPATE -->
    {#if snapshot.tiebreak}
      <div class="tiebreak-card">
        <div class="tiebreak-head">
          <Dices size={18} />
          <span>DESEMPATE EN VIVO</span>
        </div>
        <h3>Ganó: {snapshot.tiebreak.title}</h3>
        <p class="muted">
          Sorteo ejecutado en el servidor por <strong>{snapshot.tiebreak.decidedBy}</strong> · Todos ven el mismo resultado.
        </p>
      </div>
    {/if}

    {#if hasTie}
      <div class="card tie-alert">
        <div>
          <strong>Hay empate en el primer puesto ({topYes} votos)</strong>
          <p class="muted">
            Empatan: {topTied.map((o) => o.title).join(' · ')}
          </p>
        </div>
        <button class="btn-primary" onclick={onTiebreak}>
          <Dices size={16} />
          <span>Desempatar en vivo</span>
        </button>
      </div>
    {/if}

    <section class="card stack">
      <div class="section-head">
        <h3>Podio en tiempo real</h3>
        <span class="muted">{snapshot.options.length} opciones</span>
      </div>

      {#if rankedOptions.length === 0}
        <p class="muted">Aún no hay opciones cargadas.</p>
      {:else}
        <ol class="podium-list">
          {#each rankedOptions as opt, index (opt.id)}
            <li class="podium-item" class:top={index === 0 && opt.yesCount > 0}>
              <div class="podium-row">
                <span class="rank-num">#{index + 1}</span>
                <div class="podium-info">
                  <div class="podium-title-line">
                    <strong>{opt.title}</strong>
                    <span class="cat-mini">{opt.category}</span>
                  </div>
                  <span class="muted small">
                    Sí: <strong>{opt.yesCount}</strong> · No: {opt.noCount} · {yesPercent(opt)}% a favor
                  </span>
                </div>
              </div>
              <div class="bar-track">
                <div class="bar-fill" style="width: {yesPercent(opt)}%"></div>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}
</div>

<style>
  .match-wrap {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .subbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .segmented {
    display: inline-flex;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 3px;
    gap: 3px;
  }

  .seg-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 9px;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .seg-btn.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .btn-add-mini {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 0.82rem;
    font-weight: 600;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }

  .btn-add-mini:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .add-form h3 {
    font-size: 0.95rem;
  }

  .add-grid {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 8px;
  }

  .close-mini {
    color: var(--text-secondary);
    padding: 4px;
  }

  .match-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
  }

  .match-banner-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--accent);
    color: var(--accent-text);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .match-banner > div {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .match-label {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent);
  }

  .match-sub {
    font-size: 0.78rem;
    color: var(--text-secondary);
  }

  .vote-card {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .cat-pill {
    font-size: 0.78rem;
    font-weight: 600;
    padding: 5px 11px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
  }

  .counter-pill {
    font-size: 0.78rem;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 8px;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 0;
  }

  .option-title {
    font-size: 1.55rem;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }

  .proposed {
    font-size: 0.88rem;
    color: var(--text-secondary);
  }

  .prev-vote {
    align-self: flex-start;
    margin-top: 4px;
    font-size: 0.78rem;
    padding: 4px 9px;
    border-radius: 8px;
    background: var(--bg-surface-2);
    color: var(--text-secondary);
  }

  .quorum-block {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .quorum-head {
    display: flex;
    justify-content: space-between;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: 0.04em;
  }

  .bar-track {
    width: 100%;
    height: 7px;
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

  .vote-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .btn-vote {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.08s ease, background 0.15s ease;
  }

  .btn-vote:active {
    transform: scale(0.98);
  }

  .btn-no {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--danger);
  }

  .btn-no:hover {
    border-color: var(--danger);
    background: var(--danger-soft);
  }

  .btn-yes {
    background: var(--accent);
    color: var(--accent-text);
  }

  .btn-yes:hover {
    background: var(--accent-hover);
  }

  .leader-strip {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    text-align: left;
  }

  .leader-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .leader-tag {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--accent);
  }

  .leader-count {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 5px 10px;
    border-radius: 8px;
    white-space: nowrap;
  }

  .empty-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 10px;
    padding: 26px 18px;
  }

  .done-badge {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .done-actions {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
  }

  .tie-alert {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-color: var(--accent);
  }

  .tiebreak-card {
    padding: 14px 16px;
    border-radius: 14px;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .tiebreak-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--accent);
  }

  .podium-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .podium-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 11px 12px;
    border-radius: 12px;
    background: var(--bg-surface-2);
    border: 1px solid var(--border-subtle);
  }

  .podium-item.top {
    border-color: var(--accent);
  }

  .podium-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .rank-num {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--accent);
    min-width: 26px;
  }

  .podium-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .podium-title-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .cat-mini {
    font-size: 0.7rem;
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
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
  }

  .muted {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .small {
    font-size: 0.76rem;
  }
</style>
