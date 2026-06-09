//Business rules and validation for each type of information

const VALID_STATUSES = ['healthy', 'degraded', 'unhealthy'];
const SERVICE_ID_REGEX = /^[a-z0-9_-]{3,64}$/;
const TIMESTAMP_TOLERANCE_MS = 60 * 1000; // 60 sec tolerance

/**
 * Injest payload
 * @param {object} body - body JSON parse
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateIngestPayload(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Corpo da requisição deve ser um objeto JSON'] };
  }

  // ── serviceId ──────────────────────────────────────────────────────────────
  if (!body.serviceId) {
    errors.push('serviceId é obrigatório');
  } else if (typeof body.serviceId !== 'string') {
    errors.push('serviceId deve ser uma string');
  } else if (!SERVICE_ID_REGEX.test(body.serviceId)) {
    errors.push(
      'serviceId deve ter 3–64 caracteres e conter apenas letras minúsculas, números, hífens e underscores'
    );
  }

  // ── timestamp ──────────────────────────────────────────────────────────────
  if (!body.timestamp) {
    errors.push('timestamp é obrigatório');
  } else {
    const parsed = new Date(body.timestamp);
    if (isNaN(parsed.getTime())) {
      errors.push('timestamp deve ser uma data válida no formato ISO 8601 (ex: 2025-06-09T10:00:00Z)');
    } else if (parsed.getTime() > Date.now() + TIMESTAMP_TOLERANCE_MS) {
      errors.push('timestamp não pode ser no futuro (tolerância de 60 segundos)');
    }
  }

  // ── status ─────────────────────────────────────────────────────────────────
  if (!body.status) {
    errors.push('status é obrigatório');
  } else if (!VALID_STATUSES.includes(body.status)) {
    errors.push(`status deve ser um de: ${VALID_STATUSES.join(', ')}`);
  }

  // ── metrics ────────────────────────────────────────────────────────────────
  if (!body.metrics || typeof body.metrics !== 'object') {
    errors.push('metrics é obrigatório e deve ser um objeto');
  } else {
    const m = body.metrics;

    // cpuUsage : obrigatório
    if (m.cpuUsage === undefined || m.cpuUsage === null) {
      errors.push('metrics.cpuUsage é obrigatório');
    } else if (typeof m.cpuUsage !== 'number' || isNaN(m.cpuUsage)) {
      errors.push('metrics.cpuUsage deve ser um número');
    } else if (m.cpuUsage < 0 || m.cpuUsage > 100) {
      errors.push('metrics.cpuUsage deve estar entre 0 e 100');
    }

    // memoryUsageMB : obrigatório
    if (m.memoryUsageMB === undefined || m.memoryUsageMB === null) {
      errors.push('metrics.memoryUsageMB é obrigatório');
    } else if (!Number.isInteger(m.memoryUsageMB)) {
      errors.push('metrics.memoryUsageMB deve ser um número inteiro');
    } else if (m.memoryUsageMB <= 0) {
      errors.push('metrics.memoryUsageMB deve ser maior que 0');
    } else if (m.memoryUsageMB > 1_048_576) {
      errors.push('metrics.memoryUsageMB excede o limite máximo de 1.048.576 MB (1 TB)');
    }

    // requestsPerSecond : optional
    if (m.requestsPerSecond !== undefined && m.requestsPerSecond !== null) {
      if (typeof m.requestsPerSecond !== 'number' || isNaN(m.requestsPerSecond)) {
        errors.push('metrics.requestsPerSecond deve ser um número');
      } else if (m.requestsPerSecond < 0) {
        errors.push('metrics.requestsPerSecond não pode ser negativo');
      }
    }

    // errorRate : optional from 0.0–1.0
    if (m.errorRate !== undefined && m.errorRate !== null) {
      if (typeof m.errorRate !== 'number' || isNaN(m.errorRate)) {
        errors.push('metrics.errorRate deve ser um número');
      } else if (m.errorRate < 0 || m.errorRate > 1) {
        errors.push('metrics.errorRate deve estar entre 0.0 e 1.0 (proporção, não percentual)');
      }
    }

    // latencyP99ms : optional
    if (m.latencyP99ms !== undefined && m.latencyP99ms !== null) {
      if (!Number.isInteger(m.latencyP99ms)) {
        errors.push('metrics.latencyP99ms deve ser um número inteiro');
      } else if (m.latencyP99ms < 0) {
        errors.push('metrics.latencyP99ms não pode ser negativo');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = { validateIngestPayload };
