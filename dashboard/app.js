/* ═══════════════════════════════════════════════════════════════════════
   Dashboard de Saúde de Microsserviços — Lógica do cliente (JS puro)
   - Polling assíncrono de /services + /health (2s) e /events (5s)
   - Atualização de DOM sem refresh e sem piscar (reuso de elementos)
   - Controle remoto de intervalo via POST /api/control/interval
   - Gráficos históricos com Chart.js
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Configuração ───────────────────────────────────────────────────────
  // Quando servido pelo próprio Express (localhost:3000) usa a mesma origem.
  // Quando aberto como arquivo (file://) cai no servidor padrão.
  const API_BASE =
    location.origin && location.origin.startsWith('http')
      ? location.origin
      : 'http://localhost:3000';

  const POLL_MS = 2000; // tabela / stats / charts
  const EVENTS_MS = 5000; // feed de eventos
  const HISTORY_LEN = 30; // pontos de histórico nos gráficos
  const LAT_WARN = 50; // limite verde→amarelo
  const LAT_HIGH = 150; // limite amarelo→vermelho

  // Cores distintas para as linhas de latência por probe.
  const PALETTE = [
    '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa',
    '#22d3ee', '#fb923c', '#f87171', '#4ade80', '#e879f9',
    '#38bdf8', '#facc15', '#c084fc', '#2dd4bf',
  ];

  // Tipos de evento → ícone + classe CSS do feed.
  const EVENT_META = {
    NOVO_PROBE_DETECTADO: { icon: '🆕', cls: 'event-item--new', label: 'Novo probe detectado' },
    HEARTBEAT_MQTT: { icon: '💓', cls: 'event-item--beat', label: 'Heartbeat recebido' },
    PROBE_RECUPERADO: { icon: '✅', cls: 'event-item--recovered', label: 'Probe recuperado' },
    PROBE_INDISPONIVEL: { icon: '🚨', cls: 'event-item--down', label: 'Probe indisponível' },
  };
  // Eventos que representam um heartbeat efetivamente ingerido (para a coluna INGESTÕES).
  const INGEST_TYPES = ['NOVO_PROBE_DETECTADO', 'HEARTBEAT_MQTT', 'PROBE_RECUPERADO'];

  // ─── Estado em memória ────────────────────────────────────────────────────
  const state = {
    sortMode: 'status', // lat-asc | lat-desc | up-asc | up-desc | status
    cycle: 0,
    online: false,
    currentInterval: parseInt(localStorage.getItem('coletaIntervalMs') || '5000', 10),
    ingestCounts: {}, // probe_id -> nº de heartbeats vistos na janela de eventos
    rowMap: {}, // probe_id -> <tr>
    // Histórico para gráficos
    timeline: [], // labels (HH:MM:SS)
    latHistory: {}, // probe_id -> [latências alinhadas ao timeline]
    avgHistory: [], // latência média geral ao longo do tempo
    knownEventIds: new Set(),
  };

  // ─── Atalhos de DOM ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const els = {
    banner: $('error-banner'),
    bannerMsg: $('error-banner-msg'),
    connDot: $('conn-dot'),
    lastUpdate: $('last-update'),
    validationErrors: $('validation-errors'),
    statOnline: $('stat-online'),
    statOnlineHint: $('stat-online-hint'),
    statLatency: $('stat-latency'),
    statServerUptime: $('stat-server-uptime'),
    statServerSince: $('stat-server-since'),
    statIngests: $('stat-ingests'),
    currentInterval: $('current-interval'),
    intervalInput: $('interval-input'),
    applyBtn: $('apply-btn'),
    controlFeedback: $('control-feedback'),
    tableBody: $('table-body'),
    emptyRow: $('empty-row'),
    eventFeed: $('event-feed'),
    feedToggle: $('feed-toggle'),
    cycleCounter: $('cycle-counter'),
  };

  // ─── Helpers de formatação ────────────────────────────────────────────────
  function formatUptime(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (h > 0 || m > 0) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
  }

  function relativeTime(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '—';
    const diff = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (diff < 60) return `há ${diff}s`;
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    if (m < 60) return `há ${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `há ${h}h ${m % 60}m`;
  }

  function nowLabel() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function latClass(lat) {
    if (lat < LAT_WARN) return 'lat-low';
    if (lat < LAT_HIGH) return 'lat-mid';
    return 'lat-high';
  }

  // ─── Camada de rede ─────────────────────────────────────────────────────
  async function fetchJSON(path, options) {
    const res = await fetch(API_BASE + path, options);
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body.error || body.message || '';
      } catch (_) { /* corpo não-JSON */ }
      const err = new Error(detail || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function setOnline() {
    if (!state.online) {
      state.online = true;
      els.banner.hidden = true;
      els.connDot.className = 'conn-dot conn-dot--online';
    }
  }

  function setOffline(msg) {
    state.online = false;
    els.bannerMsg.textContent = msg || 'Servidor offline. Tentando reconectar...';
    els.banner.hidden = false;
    els.connDot.className = 'conn-dot conn-dot--offline';
  }

  // ─── E) Cards de estatísticas globais ─────────────────────────────────────
  function renderStats(health, services) {
    const online = services.filter((s) => s.status === 'ONLINE');
    const total = services.length;

    // 1. Probes online (verde se todos online, vermelho se algum down)
    const allUp = total > 0 && online.length === total;
    els.statOnline.innerHTML = `<span class="${allUp ? 'val-good' : total === 0 ? '' : 'val-bad'}">${online.length}</span>/${total}`;
    els.statOnlineHint.textContent =
      total === 0 ? 'nenhum probe conectado' : `${total - online.length} indisponível(is)`;

    // 2. Latência média (apenas probes online)
    if (online.length > 0) {
      const avg = online.reduce((a, s) => a + (Number(s.latencia) || 0), 0) / online.length;
      const r = Math.round(avg);
      els.statLatency.innerHTML = `<span class="${latValClass(r)}">${r}</span> ms`;
    } else {
      els.statLatency.textContent = '— ms';
    }

    // 3. Uptime do servidor
    els.statServerUptime.textContent = formatUptime(health.uptimeSeconds);
    if (health.serverStartedAt) {
      els.statServerSince.textContent = 'desde ' + new Date(health.serverStartedAt).toLocaleTimeString('pt-BR');
    }

    // 4. Total de ingestões MQTT
    els.statIngests.textContent = (health.totalIngestsReceived ?? 0).toLocaleString('pt-BR');

    // Erros de validação visíveis no cabeçalho
    const verr = health.totalValidationErrors || 0;
    els.validationErrors.textContent = `${verr} erro(s) de validação`;
    els.validationErrors.className =
      'validation-pill ' + (verr > 0 ? 'validation-pill--err' : 'validation-pill--ok');
  }

  function latValClass(lat) {
    if (lat < LAT_WARN) return 'val-good';
    if (lat < LAT_HIGH) return 'val-warn';
    return 'val-bad';
  }

  // ─── D) Ordenação (DOWN sempre no topo, automaticamente) ──────────────────
  function sortServices(services) {
    const mode = state.sortMode;
    return services.slice().sort((a, b) => {
      // Chave primária FIXA: probes DOWN sobem ao topo SEM depender do filtro.
      const aDown = a.status === 'DOWN' ? 0 : 1;
      const bDown = b.status === 'DOWN' ? 0 : 1;
      if (aDown !== bDown) return aDown - bDown;

      // Chave secundária: ordenação escolhida pelo usuário.
      switch (mode) {
        case 'lat-asc': return (a.latencia || 0) - (b.latencia || 0);
        case 'lat-desc': return (b.latencia || 0) - (a.latencia || 0);
        case 'up-asc': return (a.uptime || 0) - (b.uptime || 0);
        case 'up-desc': return (b.uptime || 0) - (a.uptime || 0);
        case 'status':
        default: return a.probe_id.localeCompare(b.probe_id);
      }
    });
  }

  // ─── A/B) Tabela com DOM diff (sem recriar, sem piscar) ───────────────────
  function buildRow(probeId) {
    const tr = document.createElement('tr');
    tr.dataset.probeId = probeId;
    tr.innerHTML = `
      <td class="cell-probe"></td>
      <td class="cell-status"><span class="badge"></span></td>
      <td class="cell-uptime"></td>
      <td class="cell-latency">
        <div class="lat-wrap">
          <span class="lat-value"></span>
          <span class="lat-bar-track"><span class="lat-bar-fill"></span></span>
        </div>
      </td>
      <td class="cell-heartbeat rel-time"></td>
      <td class="cell-ingests"></td>`;
    return tr;
  }

  // Atualiza o conteúdo de um nó só se mudou (evita repaint desnecessário).
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function renderTable(services) {
    const sorted = sortServices(services);

    if (sorted.length === 0) {
      els.emptyRow.hidden = false;
    } else {
      els.emptyRow.hidden = true;
    }

    const seen = new Set();
    sorted.forEach((svc) => {
      seen.add(svc.probe_id);
      let tr = state.rowMap[svc.probe_id];
      if (!tr) {
        tr = buildRow(svc.probe_id);
        state.rowMap[svc.probe_id] = tr;
      }

      const isDown = svc.status === 'DOWN';
      tr.classList.toggle('row-down', isDown);

      setText(tr.querySelector('.cell-probe'), svc.probe_id);

      const badge = tr.querySelector('.badge');
      badge.className = 'badge ' + (isDown ? 'badge--down' : 'badge--online');
      setText(badge, isDown ? '🔴 DOWN' : '🟢 ONLINE');

      setText(tr.querySelector('.cell-uptime'), formatUptime(svc.uptime));

      const lat = Number(svc.latencia) || 0;
      setText(tr.querySelector('.lat-value'), `${lat} ms`);
      const fill = tr.querySelector('.lat-bar-fill');
      // Escala visual: 0..LAT_HIGH preenche a barra; acima disso satura em 100%.
      const pct = Math.min(100, (lat / LAT_HIGH) * 100);
      fill.style.width = pct + '%';
      fill.className = 'lat-bar-fill ' + latClass(lat);

      const hb = tr.querySelector('.cell-heartbeat');
      hb.dataset.ts = svc.ultimo_heartbeat;
      setText(hb, relativeTime(svc.ultimo_heartbeat));

      setText(tr.querySelector('.cell-ingests'), String(state.ingestCounts[svc.probe_id] || 0));

      // Reanexa na ordem ordenada (move sem recriar — não pisca).
      els.tableBody.appendChild(tr);
    });

    // Remove linhas de probes que sumiram do estado.
    Object.keys(state.rowMap).forEach((id) => {
      if (!seen.has(id)) {
        state.rowMap[id].remove();
        delete state.rowMap[id];
      }
    });
  }

  // ─── F) Feed de eventos ───────────────────────────────────────────────────
  function renderEvents(events) {
    if (!events || events.length === 0) {
      if (!els.eventFeed.querySelector('.event-empty') && els.eventFeed.children.length === 0) {
        els.eventFeed.innerHTML = '<li class="event-empty">Sem eventos ainda.</li>';
      }
      return;
    }

    // Mostra os 15 mais recentes no topo (mais novo primeiro).
    const recent = events.slice(-15).reverse();
    els.eventFeed.innerHTML = '';
    recent.forEach((evt) => {
      const meta = EVENT_META[evt.type] || { icon: '•', cls: '', label: evt.type };
      const li = document.createElement('li');
      li.className = 'event-item ' + meta.cls;
      const ts = evt.occurredAt;
      li.innerHTML = `
        <span class="event-icon">${meta.icon}</span>
        <div class="event-body">
          <span class="event-probe">${escapeHtml(evt.probe_id)}</span>
          <span class="event-type">${escapeHtml(meta.label)}</span>
          <span class="event-time rel-time" data-ts="${escapeHtml(ts)}">${relativeTime(ts)}</span>
        </div>`;
      els.eventFeed.appendChild(li);
    });
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Conta heartbeats por probe na janela de eventos (coluna INGESTÕES).
  function computeIngestCounts(events) {
    const counts = {};
    events.forEach((evt) => {
      if (INGEST_TYPES.includes(evt.type)) {
        counts[evt.probe_id] = (counts[evt.probe_id] || 0) + 1;
      }
    });
    state.ingestCounts = counts;
  }

  // ─── G) Gráficos ──────────────────────────────────────────────────────────
  const charts = {};

  function initCharts() {
    if (typeof Chart === 'undefined') {
      console.warn('Chart.js não carregou (CDN indisponível). Gráficos desativados.');
      return;
    }
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = '#2d3148';
    Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";

    // 1. Latência por probe ao longo do tempo (linhas) + limiares tracejados.
    charts.latency = new Chart($('chart-latency'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          thresholdDataset('Limite 50ms', '#f59e0b'),
          thresholdDataset('Limite 150ms', '#ef4444'),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'latência (ms)' } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
        },
      },
    });

    // 2. Comparativo de uptime (barras horizontais).
    charts.uptime = new Chart($('chart-uptime'), {
      type: 'bar',
      data: { labels: [], datasets: [{ label: 'Uptime (s)', data: [], backgroundColor: [] }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { beginAtZero: true, title: { display: true, text: 'uptime (s)' } } },
        plugins: { legend: { display: false } },
      },
    });

    // 3. Latência média geral ao longo do tempo (linha com área).
    charts.avg = new Chart($('chart-avg'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Latência média (ms)',
          data: [],
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.18)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, title: { display: true, text: 'latência média (ms)' } } },
        plugins: { legend: { display: false } },
      },
    });
  }

  function thresholdDataset(label, color) {
    return {
      label,
      data: [],
      borderColor: color,
      borderDash: [6, 6],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
    };
  }

  // Avança o histórico um ponto e atualiza os três gráficos.
  function updateCharts(services) {
    if (!charts.latency) return;

    const label = nowLabel();
    state.timeline.push(label);

    const onlineLats = [];
    const present = new Set(services.map((s) => s.probe_id));

    // Latência por probe (null quando DOWN/ausente → cria gap na linha).
    services.forEach((svc) => {
      if (!state.latHistory[svc.probe_id]) {
        // Backfill com nulls para alinhar ao timeline existente.
        state.latHistory[svc.probe_id] = new Array(state.timeline.length - 1).fill(null);
      }
      const val = svc.status === 'ONLINE' ? Number(svc.latencia) || 0 : null;
      state.latHistory[svc.probe_id].push(val);
      if (val != null) onlineLats.push(val);
    });
    // Probes conhecidos mas ausentes neste ciclo → empurra null.
    Object.keys(state.latHistory).forEach((id) => {
      if (!present.has(id)) state.latHistory[id].push(null);
    });

    // Latência média geral.
    const avg = onlineLats.length
      ? Math.round(onlineLats.reduce((a, b) => a + b, 0) / onlineLats.length)
      : null;
    state.avgHistory.push(avg);

    // Mantém tudo limitado a HISTORY_LEN pontos.
    if (state.timeline.length > HISTORY_LEN) {
      state.timeline.shift();
      state.avgHistory.shift();
      Object.values(state.latHistory).forEach((arr) => arr.shift());
    }

    // ── Gráfico 1: latência por probe ──
    const c1 = charts.latency;
    c1.data.labels = state.timeline;
    // Limiares horizontais acompanham o comprimento do timeline.
    c1.data.datasets[0].data = state.timeline.map(() => LAT_WARN);
    c1.data.datasets[1].data = state.timeline.map(() => LAT_HIGH);
    // Garante um dataset por probe (preserva visibilidade alternada pela legenda).
    Object.keys(state.latHistory).forEach((id) => {
      let ds = c1.data.datasets.find((d) => d._probeId === id);
      if (!ds) {
        const color = PALETTE[Object.keys(state.latHistory).indexOf(id) % PALETTE.length];
        ds = {
          _probeId: id,
          label: id,
          data: [],
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          spanGaps: false,
        };
        c1.data.datasets.push(ds);
      }
      ds.data = state.latHistory[id];
    });
    c1.update('none');

    // ── Gráfico 2: uptime por probe (ordem alfabética estável) ──
    const ordered = services.slice().sort((a, b) => a.probe_id.localeCompare(b.probe_id));
    charts.uptime.data.labels = ordered.map((s) => s.probe_id);
    charts.uptime.data.datasets[0].data = ordered.map((s) => Number(s.uptime) || 0);
    charts.uptime.data.datasets[0].backgroundColor = ordered.map((s) =>
      s.status === 'DOWN' ? '#ef4444' : '#22c55e'
    );
    charts.uptime.update();

    // ── Gráfico 3: latência média geral ──
    charts.avg.data.labels = state.timeline;
    charts.avg.data.datasets[0].data = state.avgHistory;
    charts.avg.update('none');
  }

  // ─── C) Controle remoto de intervalo ──────────────────────────────────────
  function showFeedback(msg, ok) {
    els.controlFeedback.textContent = msg;
    els.controlFeedback.className = 'control-feedback ' + (ok ? 'control-feedback--ok' : 'control-feedback--err');
    els.controlFeedback.hidden = false;
    clearTimeout(showFeedback._t);
    showFeedback._t = setTimeout(() => { els.controlFeedback.hidden = true; }, 3000);
  }

  function setCurrentInterval(ms) {
    state.currentInterval = ms;
    localStorage.setItem('coletaIntervalMs', String(ms));
    els.currentInterval.textContent = ms + 'ms';
  }

  async function applyInterval() {
    const raw = els.intervalInput.value;
    const value = parseInt(raw, 10);

    // Validação no cliente ANTES de enviar (evita ida ao servidor com lixo).
    if (!Number.isFinite(value)) {
      showFeedback('⚠️ Informe um número válido em milissegundos.', false);
      return;
    }
    if (value < 1000 || value > 60000) {
      showFeedback('⚠️ O intervalo deve estar entre 1000ms (1s) e 60000ms (60s).', false);
      return;
    }

    els.applyBtn.disabled = true;
    try {
      const data = await fetchJSON('/api/control/interval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalo: value }),
      });
      setCurrentInterval(value);
      showFeedback('✅ ' + (data.message || `Intervalo de ${value}ms aplicado.`), true);
    } catch (err) {
      // Distingue erro de validação do servidor (HTTP 400) de servidor offline.
      if (err.status) {
        showFeedback(`❌ Falha ao aplicar (HTTP ${err.status}): ${err.message}`, false);
      } else {
        showFeedback('❌ Servidor offline — não foi possível enviar o comando.', false);
      }
    } finally {
      els.applyBtn.disabled = false;
    }
  }

  // ─── Ciclos de polling ────────────────────────────────────────────────────
  async function pollMain() {
    try {
      const [servicesRes, health] = await Promise.all([
        fetchJSON('/services'),
        fetchJSON('/health'),
      ]);
      const services = servicesRes.services || [];

      setOnline();
      state.cycle += 1;

      renderStats(health, services);
      renderTable(services);
      updateCharts(services);

      els.lastUpdate.textContent = `Última atualização: ${nowLabel()}`;
      els.cycleCounter.textContent = `ciclo #${state.cycle}`;
    } catch (err) {
      setOffline(`Servidor offline (${err.message}). Reconectando automaticamente...`);
    }
  }

  async function pollEvents() {
    try {
      // Busca uma janela maior (n=100) para contar ingestões por probe;
      // o feed visual mostra apenas os 15 mais recentes.
      const data = await fetchJSON('/events?n=100');
      const events = data.events || [];
      computeIngestCounts(events);
      renderEvents(events);
    } catch (err) {
      // Silencioso: o banner principal já sinaliza a queda do servidor.
    }
  }

  // Atualiza os "há X s" continuamente, mesmo entre as buscas.
  function refreshRelativeTimes() {
    document.querySelectorAll('.rel-time').forEach((node) => {
      if (node.dataset.ts) setText(node, relativeTime(node.dataset.ts));
    });
  }

  // ─── Bindings de UI ───────────────────────────────────────────────────────
  function bindControls() {
    // Botões de ordenação
    document.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.sortMode = btn.dataset.sort;
        document.querySelectorAll('.sort-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
        // Re-render imediato com os dados atuais (reusa o estado das linhas).
        renderTable(Object.values(state.rowMap).length ? collectServicesFromRows() : []);
      });
    });

    // Atalhos rápidos de intervalo
    document.querySelectorAll('.quick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        els.intervalInput.value = btn.dataset.ms;
      });
    });

    // Aplicar intervalo
    els.applyBtn.addEventListener('click', applyInterval);
    els.intervalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyInterval();
    });

    // Toggle do feed de eventos
    els.feedToggle.addEventListener('click', () => {
      const collapsed = els.eventFeed.classList.toggle('is-collapsed');
      els.feedToggle.textContent = collapsed ? 'Mostrar' : 'Ocultar';
      els.feedToggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  // Reconstrói uma lista de serviços a partir das linhas em DOM (para re-sort
  // imediato sem esperar o próximo poll). Lê os data-atributos preservados.
  function collectServicesFromRows() {
    return Object.values(state.rowMap).map((tr) => ({
      probe_id: tr.dataset.probeId,
      status: tr.querySelector('.badge').classList.contains('badge--down') ? 'DOWN' : 'ONLINE',
      latencia: parseInt(tr.querySelector('.lat-value').textContent, 10) || 0,
      uptime: parseUptimeLabel(tr.querySelector('.cell-uptime').textContent),
      ultimo_heartbeat: tr.querySelector('.cell-heartbeat').dataset.ts,
    }));
  }

  function parseUptimeLabel(label) {
    // "1h 2m 3s" -> segundos. Best-effort, só para reordenar localmente.
    let total = 0;
    const h = /(\d+)h/.exec(label); if (h) total += parseInt(h[1], 10) * 3600;
    const m = /(\d+)m/.exec(label); if (m) total += parseInt(m[1], 10) * 60;
    const s = /(\d+)s/.exec(label); if (s) total += parseInt(s[1], 10);
    return total;
  }

  // ─── Inicialização ──────────────────────────────────────────────────────
  function init() {
    setCurrentInterval(state.currentInterval);
    els.intervalInput.value = state.currentInterval;
    document.querySelectorAll('.sort-btn').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.sort === state.sortMode)
    );

    initCharts();
    bindControls();

    // Primeira carga imediata + ciclos.
    pollMain();
    pollEvents();
    setInterval(pollMain, POLL_MS);
    setInterval(pollEvents, EVENTS_MS);
    setInterval(refreshRelativeTimes, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
