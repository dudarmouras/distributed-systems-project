const client = require('prom-client');
const register = new client.Registry();
register.setDefaultLabels({ app: 'microservice-dashboard' });

// ─── Gauges Def  ────

const uptimeGauge = new client.Gauge({
  name: 'probe_uptime_seconds',
  help: 'Tempo de atividade (uptime) do probe em segundos',
  labelNames: ['probe_id'],
  registers: [register],
});

const latenciaGauge = new client.Gauge({
  name: 'probe_latencia_ms',
  help: 'Latência da comunicação em milissegundos por probe',
  labelNames: ['probe_id'],
  registers: [register],
});

const heartbeatGauge = new client.Gauge({
  name: 'probe_ultimo_heartbeat_timestamp',
  help: 'Timestamp (UNIX) do último heartbeat recebido',
  labelNames: ['probe_id'],
  registers: [register],
});

// Gauge de disponibilidade: 1 = ONLINE, 0 = DOWN, usado no Grafana para colorir linhas da tabela (alerta visual de indisponibilidade)
const statusGauge = new client.Gauge({
  name: 'probe_status',
  help: 'Disponibilidade do probe: 1 = ONLINE, 0 = DOWN (sem heartbeat recente)',
  labelNames: ['probe_id'],
  registers: [register],
});

// ─── Update functions ───

function updateMetrics(probeEntry) {
  // Extraímos exatamente as chaves exigidas no escopo da disciplina
  const { probe_id, uptime, latencia, ultimo_heartbeat, status } = probeEntry;
  const labels = { probe_id: probe_id };

  if (uptime != null) {
    uptimeGauge.set(labels, uptime);
  }
  
  if (latencia != null) {
    latenciaGauge.set(labels, latencia);
  }
  
  if (ultimo_heartbeat != null) {
    // O Prometheus requer valores numéricos, então convertemos a data ISO para um Timestamp UNIX (segundos)
    const timestamp = new Date(ultimo_heartbeat).getTime() / 1000;
    if (!isNaN(timestamp)) {
      heartbeatGauge.set(labels, timestamp);
    }
  }

  if (status != null) {
    statusGauge.set(labels, status === 'DOWN' ? 0 : 1);
  }
}

/**
 * Atualiza apenas o gauge de status (chamado pelo watchdog de probes inativos, que não recebe um 
 * payload completo, só sabe que ficou stale).
 * @param {string} probe_id
 * @param {'ONLINE'|'DOWN'} status
 */
function updateStatusMetric(probe_id, status) {
  statusGauge.set({ probe_id }, status === 'DOWN' ? 0 : 1);
}

/**
 * @returns {Promise<string>}
 */

async function getMetricsText() {
  return register.metrics();
}

function getContentType() {
  return register.contentType;
}

module.exports = { updateMetrics, updateStatusMetric, getMetricsText, getContentType };