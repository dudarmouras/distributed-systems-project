// Memory storage + export functions with intern structures

// ─── Data structure ────────────────────────────────────────────────────

/** @type {Map<string, object>} serviceId (name) + their data */
const services = new Map();

/** @type {Array<object>} Recent eventos (max 100) */

const recentEvents = [];
const MAX_EVENTS = 100; // It blocks infinite memory

/** @type {Map<string, number>} serviceId → ingest count */
const ingestCount = new Map();

/** statistics */
const globalStats = {
  totalIngestsReceived: 0,
  totalValidationErrors: 0,
  serverStartedAt: new Date(),
};

// ─── Writing function ─────────────────────────────────────────────────────

/**
 * Update if exists, 
 * @param {string} serviceIdcreate if doesn't
 * @param {object} snapshot 
 */
function upsertService(serviceId, snapshot) {
  const isNew = !services.has(serviceId);
  const now = new Date();

  const existing = services.get(serviceId) || {};
  const previousStatus = existing.status;

  const entry = {
    serviceId,
    firstSeenAt: existing.firstSeenAt || now,
    lastSeenAt: now,
    status: snapshot.status,
    consecutiveUnhealthy:
      snapshot.status === 'unhealthy'
        ? (existing.consecutiveUnhealthy || 0) + 1
        : 0,
    metrics: { ...snapshot.metrics },
  };

  services.set(serviceId, entry);
  ingestCount.set(serviceId, (ingestCount.get(serviceId) || 0) + 1);
  globalStats.totalIngestsReceived++;

  // Register new event
  if (isNew) {
    addEvent(serviceId, 'NEW_SERVICE', { status: snapshot.status });
  } else if (previousStatus !== snapshot.status) {
    addEvent(serviceId, 'STATUS_CHANGE', {
      from: previousStatus,
      to: snapshot.status,
    });
  } else {
    addEvent(serviceId, 'INGEST', { status: snapshot.status });
  }

  return entry;
}

// Add event to recent events function if it reaches the max count, removes the first one (oldest)
function addEvent(serviceId, type, payload = {}) {
  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    occurredAt: new Date(),
    serviceId,
    type,
    payload,
  };

  recentEvents.push(event);
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.shift(); 
  }
}

/** Validation counter */
function recordValidationError() {
  globalStats.totalValidationErrors++;
}

// ─── Read functions ──────────────────────────────────────────────────────

function getService(serviceId) {
  return services.get(serviceId);
}

function getAllServices() {
  return Array.from(services.values());
}

function getRecentEvents(n = 20) {
  return recentEvents.slice(-n);
}

function getStats() {
  return {
    ...globalStats,
    servicesMonitored: services.size,
    uptimeSeconds: Math.floor((Date.now() - globalStats.serverStartedAt.getTime()) / 1000),
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  upsertService,
  recordValidationError,
  getService,
  getAllServices,
  getRecentEvents,
  getStats,
};
