// Armazenamento em memória + funções de exportação com estruturas internas

// ─── Estrutura de Dados ────────────────────────────────────────────────────

const probes = new Map();

/** @type {Array<object>} Eventos recentes (máximo de 100) */
const recentEvents = [];
const MAX_EVENTS = 100; // Bloqueia o consumo infinito de memória do servidor

/** @type {Map<string, number>} probe_id → contagem de heartbeats recebidos */
const ingestCount = new Map();

/** Estatísticas globais do servidor (usado pela rota /health) */
const globalStats = {
  totalIngestsReceived: 0,
  totalValidationErrors: 0,
  serverStartedAt: new Date(),
};

// ─── Funções de Escrita ─────────────────────────────────────────────────────

/**
 * Atualiza o registro se o probe já existir; cria um novo se não existir.
 * @param {string} probe_id - O identificador único do microsserviço
 * @param {object} payload - Os dados do heartbeat recebidos via MQTT
 */
function upsertService(probe_id, payload) {
  const isNew = !probes.has(probe_id);
  const now = new Date();

  const existing = probes.get(probe_id) || {};

  // Monta a entrada na memória EXATAMENTE como exigido no escopo do projeto
  const entry = {
    probe_id: probe_id,
    uptime: payload.uptime,
    latencia: payload.latencia,
    ultimo_heartbeat: payload.ultimo_heartbeat,
    firstSeenAt: existing.firstSeenAt || now,
    lastSeenAt: now,
  };

  // Salva no nosso "dicionário" global
  probes.set(probe_id, entry);
  ingestCount.set(probe_id, (ingestCount.get(probe_id) || 0) + 1);
  globalStats.totalIngestsReceived++;

  // Registra um novo evento para o histórico (útil para auditoria)
  if (isNew) {
    addEvent(probe_id, 'NOVO_PROBE_DETECTADO', { latencia: payload.latencia });
  } else {
    addEvent(probe_id, 'HEARTBEAT_MQTT', { latencia: payload.latencia });
  }

  return entry;
}

/** * Adiciona um evento à lista de recentes. 
 * Se atingir o limite máximo, remove o primeiro (mais antigo).
 */
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

/** Contador de erros de validação (incrementado quando o JSON do MQTT vem com erro) */
function recordValidationError() {
  globalStats.totalValidationErrors++;
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
};