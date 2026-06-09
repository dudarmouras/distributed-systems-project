// Uses prom-client lib to create gauges that are translated to metrics
const client = require('prom-client');
const register = new client.Registry();
register.setDefaultLabels({ app: 'microservice-dashboard' });

// ─── Gauges Def ────────────────────────────────────────────────────

const cpuGauge = new client.Gauge({
  name: 'service_cpu_usage_percent',
  help: 'Uso de CPU em percentual por serviço',
  labelNames: ['service', 'status'],
  registers: [register],
});

const memoryGauge = new client.Gauge({
  name: 'service_memory_usage_mb',
  help: 'Uso de memória em MB por serviço',
  labelNames: ['service', 'status'],
  registers: [register],
});

const rpsGauge = new client.Gauge({
  name: 'service_requests_per_second',
  help: 'Requisições por segundo por serviço',
  labelNames: ['service'],
  registers: [register],
});

const errorRateGauge = new client.Gauge({
  name: 'service_error_rate',
  help: 'Taxa de erros (0.0–1.0) por serviço',
  labelNames: ['service'],
  registers: [register],
});

const latencyGauge = new client.Gauge({
  name: 'service_latency_p99_ms',
  help: 'Latência P99 em milissegundos por serviço',
  labelNames: ['service'],
  registers: [register],
});

const statusGauge = new client.Gauge({
  name: 'service_status',
  help: 'Status do serviço (1=healthy, 0.5=degraded, 0=unhealthy)',
  labelNames: ['service'],
  registers: [register],
});

// ─── Number status ────────────────────────────────

const STATUS_VALUE = {
  healthy: 1,
  degraded: 0.5,
  unhealthy: 0,
};

// ─── Update functions ───────────────────────────────────────────────────

/**
 * @param {object} serviceEntry
 */
function updateMetrics(serviceEntry) {
  const { serviceId, status, metrics } = serviceEntry;
  const labels = { service: serviceId };

  cpuGauge.set({ ...labels, status }, metrics.cpuUsage);
  memoryGauge.set({ ...labels, status }, metrics.memoryUsageMB);
  statusGauge.set(labels, STATUS_VALUE[status] ?? 0);

  if (metrics.requestsPerSecond != null) {
    rpsGauge.set(labels, metrics.requestsPerSecond);
  }
  if (metrics.errorRate != null) {
    errorRateGauge.set(labels, metrics.errorRate);
  }
  if (metrics.latencyP99ms != null) {
    latencyGauge.set(labels, metrics.latencyP99ms);
  }
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

module.exports = { updateMetrics, getMetricsText, getContentType };
