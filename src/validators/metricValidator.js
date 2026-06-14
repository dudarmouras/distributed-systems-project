// Regras de negócio e validação para cada tipo de informação

const PROBE_ID_REGEX = /^[a-z0-9_-]{3,64}$/;
const TIMESTAMP_TOLERANCE_MS = 60 * 1000; // Tolerância de 60 segundos

/**
 * Valida o payload de ingestão recebido via MQTT
 * @param {object} body - Objeto JSON parseado
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateIngestPayload(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['O payload deve ser um objeto JSON'] };
  }

  // ── probe_id ──────────────────────────────────────────────────────────────
  if (!body.probe_id) {
    errors.push('probe_id é obrigatório');
  } else if (typeof body.probe_id !== 'string') {
    errors.push('probe_id deve ser uma string');
  } else if (!PROBE_ID_REGEX.test(body.probe_id)) {
    errors.push(
      'probe_id deve ter 3–64 caracteres e conter apenas letras minúsculas, números, hífens e underscores'
    );
  }

  // ── uptime ─────────────────────────────────────────────────────────────────
  if (body.uptime === undefined || body.uptime === null) {
    errors.push('uptime é obrigatório');
  } else if (typeof body.uptime !== 'number' || isNaN(body.uptime)) {
    errors.push('uptime deve ser um número');
  } else if (body.uptime < 0) {
    errors.push('uptime não pode ser negativo');
  }

  // ── latencia ───────────────────────────────────────────────────────────────
  if (body.latencia === undefined || body.latencia === null) {
    errors.push('latencia é obrigatória');
  } else if (typeof body.latencia !== 'number' || isNaN(body.latencia)) {
    errors.push('latencia deve ser um número');
  } else if (body.latencia < 0) {
    errors.push('latencia não pode ser negativa');
  }

  // ── ultimo_heartbeat ───────────────────────────────────────────────────────
  if (!body.ultimo_heartbeat) {
    errors.push('ultimo_heartbeat é obrigatório');
  } else {
    const parsed = new Date(body.ultimo_heartbeat);
    if (isNaN(parsed.getTime())) {
      errors.push('ultimo_heartbeat deve ser uma data válida no formato ISO 8601 (ex: 2026-06-14T10:00:00Z)');
    } else if (parsed.getTime() > Date.now() + TIMESTAMP_TOLERANCE_MS) {
      errors.push('ultimo_heartbeat não pode ser no futuro (tolerância de 60 segundos)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = { validateIngestPayload };