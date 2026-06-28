// Armazenamento em memória + funções de exportação com estruturas internas
const { withLock } = require('./lock');
const { saveSnapshot, loadSnapshot } = require('./persistence');

// ─── Configuração ───────────────────────────────────────────────────────────
// Tempo sem heartbeat após o qual um probe é considerado DOWN.
const STALE_TIMEOUT_MS = parseInt(process.env.PROBE_TIMEOUT_MS || '15000', 10);

// ─── Estrutura de Dados ────────────────────────────────────────────────────
const probes = new Map();

/** @type {Array<object>} Eventos recentes (máximo de 100) */
const recentEvents = [];
const MAX_EVENTS = 100; // Bloqueia o consumo infinito de memória do servidor

/** @type {Map<string, number>} probe_id -> contagem de heartbeats recebidos */
const ingestCount = new Map();

// Estatísticas globais do servidor (usado pela rota /health)
const globalStats = {
  totalIngestsReceived: 0,
  totalValidationErrors: 0,
  serverStartedAt: new Date(),
};

// ─── Persistência: restauração no boot ──────────────────────────────────────
// Restaura o estado salvo em disco (se existir) ANTES do servidor começar a receber novas mensagens 
// MQTT. Deve ser chamado uma única vez, no startup.

function restoreFromDisk() {
  const snapshot = loadSnapshot();
  if (!snapshot) {
    console.log('[Persistência] Nenhum snapshot anterior encontrado — iniciando estado limpo.');
    return;
  }

  for (const entry of snapshot.probes || []) {
    probes.set(entry.probe_id, entry);
  }
  for (const evt of snapshot.recentEvents || []) {
    recentEvents.push(evt);
  }
  if (snapshot.globalStats) {
    globalStats.totalIngestsReceived = snapshot.globalStats.totalIngestsReceived || 0;
    globalStats.totalValidationErrors = snapshot.globalStats.totalValidationErrors || 0;
  }

  console.log(
    `[Persistência] Estado restaurado: ${probes.size} probe(s) conhecido(s), ` +
    `${recentEvents.length} evento(s) no histórico.`
  );
}

// Monta e grava o snapshot atual no disco. Chamado periodicamente pelo server.js.
function persistSnapshot() {
  saveSnapshot({
    probes: Array.from(probes.values()),
    recentEvents,
    globalStats,
  });
}

// ─── Funções de Escrita ─────────────────────────────────────────────────────

/**
 * Atualiza o registro se o probe já existir; cria um novo se não existir. Protegido por mutex por 
 * probe_id (ver lock.js) para evitar que duas mensagens MQTT do mesmo probe, processadas quase 
 * simultaneamente, causem um "lost update" sobre o dicionário em memória.
 *
 * @param {string} probe_id - O identificador único do microsserviço
 * @param {object} payload - Os dados do heartbeat recebidos via MQTT
 * @returns {Promise<object>}
 */

function upsertService(probe_id, payload) {
  return withLock(probe_id, async () => {
    const isNew = !probes.has(probe_id);
    const now = new Date();

    const existing = probes.get(probe_id) || {};

    const entry = {
      probe_id: probe_id,
      uptime: payload.uptime,
      latencia: payload.latencia,
      ultimo_heartbeat: payload.ultimo_heartbeat,
      status: 'ONLINE',
      firstSeenAt: existing.firstSeenAt || now,
      lastSeenAt: now,
    };

    // Salva no nosso "dicionário" global
    probes.set(probe_id, entry);
    ingestCount.set(probe_id, (ingestCount.get(probe_id) || 0) + 1);
    globalStats.totalIngestsReceived++;

    // Registra um novo evento para o histórico 
    if (isNew) {
      addEvent(probe_id, 'NOVO_PROBE_DETECTADO', { latencia: payload.latencia });
    } else if (existing.status === 'DOWN') {
      addEvent(probe_id, 'PROBE_RECUPERADO', { latencia: payload.latencia });
    } else {
      addEvent(probe_id, 'HEARTBEAT_MQTT', { latencia: payload.latencia });
    }

    return entry;
  });
}

// Adiciona um evento à lista de recentes. Se atingir o limite máximo, remove o mais antigo.
function addEvent(probe_id, type, payload = {}) {
  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    occurredAt: new Date(),
    probe_id,
    type,
    payload,
  };

  recentEvents.push(event);
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.shift(); // Remove o item mais antigo do array
  }
}

// Contador de erros de validação (incrementado quando o JSON do MQTT vem com erro)
function recordValidationError() {
  globalStats.totalValidationErrors++;
}

// ─── Watchdog de Disponibilidade ─────────────────────────────────────────────
/**
 * Varre todos os probes conhecidos e marca como DOWN qualquer um que não envie heartbeat há mais de 
 * STALE_TIMEOUT_MS, isso precisa rodar em um timer (setInterval) porque a ausência de mensagens MQTT 
 * não dispara nenhum evento por si só, é o próprio silêncio que precisa ser detectado proativamente.
 *
 * @returns {object[]} Lista de probes cujo status mudou
 */
function checkStaleProbes() {
  const now = Date.now();
  const changed = [];

  for (const [probe_id, entry] of probes.entries()) {
    const elapsed = now - new Date(entry.lastSeenAt).getTime();
    const shouldBeDown = elapsed > STALE_TIMEOUT_MS;

    if (shouldBeDown && entry.status !== 'DOWN') {
      entry.status = 'DOWN';
      probes.set(probe_id, entry);
      addEvent(probe_id, 'PROBE_INDISPONIVEL', { elapsedMs: elapsed });
      changed.push(entry);
    }
  }

  return changed;
}

// ─── Funções de Leitura ──────────────────────────────────────────────────────

function getService(probe_id) {
  return probes.get(probe_id);
}

function getAllServices() {
  return Array.from(probes.values());
}

function getRecentEvents(n = 20) {
  return recentEvents.slice(-n);
}

function getStats() {
  return {
    ...globalStats,
    servicesMonitored: probes.size,
    uptimeSeconds: Math.floor((Date.now() - globalStats.serverStartedAt.getTime()) / 1000),
  };
}

// ─── Exportações ─────────────────────────────────────────────────────────────────

module.exports = {
  upsertService,
  recordValidationError,
  getService,
  getAllServices,
  getRecentEvents,
  getStats,
  restoreFromDisk,
  persistSnapshot,
  checkStaleProbes,
  STALE_TIMEOUT_MS,
};