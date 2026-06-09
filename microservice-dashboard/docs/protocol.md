# 📡 Protocolo de Comunicação

## Visão Geral

O agente coletor se comunica com os microsserviços via **HTTP/1.1 + JSON**.  
Não há WebSocket ou socket puro nesta etapa — o modelo é **push-based**: cada serviço envia seus dados ativamente para o agente.

---

## Endpoints Disponíveis

### `POST /ingest` — Ingestão de métricas

Recebe o snapshot de saúde de um microsserviço.

**Headers obrigatórios:**
```
Content-Type: application/json
```

**Payload (corpo da requisição):**

```json
{
  "serviceId": "string",         // obrigatório — identificador único do serviço
  "timestamp": "string",         // obrigatório — ISO 8601 (ex: "2025-06-09T10:00:00Z")
  "status": "string",            // obrigatório — "healthy" | "degraded" | "unhealthy"
  "metrics": {
    "cpuUsage": number,          // obrigatório — percentual 0.0–100.0
    "memoryUsageMB": number,     // obrigatório — inteiro positivo
    "requestsPerSecond": number, // opcional  — float >= 0
    "errorRate": number,         // opcional  — float 0.0–1.0 (proporção, não percentual)
    "latencyP99ms": number       // opcional  — inteiro >= 0
  }
}
```

**Exemplo de requisição válida:**
```json
{
  "serviceId": "payment-service",
  "timestamp": "2025-06-09T10:00:00Z",
  "status": "degraded",
  "metrics": {
    "cpuUsage": 78.3,
    "memoryUsageMB": 1024,
    "requestsPerSecond": 320.5,
    "errorRate": 0.07,
    "latencyP99ms": 430
  }
}
```

**Resposta de sucesso (`200 OK`):**
```json
{
  "ok": true,
  "serviceId": "payment-service",
  "receivedAt": "2025-06-09T10:00:01.234Z"
}
```

**Resposta de erro de validação (`400 Bad Request`):**
```json
{
  "ok": false,
  "error": "VALIDATION_ERROR",
  "details": [
    "cpuUsage deve estar entre 0 e 100",
    "status deve ser: healthy | degraded | unhealthy"
  ]
}
```

---

### `GET /health` — Status do próprio agente

Retorna se o servidor está operacional.

**Resposta (`200 OK`):**
```json
{
  "status": "ok",
  "uptime": 3725,
  "servicesMonitored": 5,
  "totalIngestsReceived": 1420
}
```

---

### `GET /services` — Lista de serviços monitorados

Retorna o último snapshot de todos os serviços registrados em memória.

**Resposta (`200 OK`):**
```json
{
  "services": [
    {
      "serviceId": "payment-service",
      "lastSeen": "2025-06-09T10:00:00Z",
      "status": "degraded",
      "metrics": { ... }
    }
  ],
  "count": 1
}
```

---

### `GET /metrics` — Endpoint Prometheus (scrape)

Retorna todas as métricas no **formato texto Prometheus** para ser consumido pelo Prometheus server.

**Exemplo de saída:**
```
# HELP service_cpu_usage_percent CPU usage percent por serviço
# TYPE service_cpu_usage_percent gauge
service_cpu_usage_percent{service="payment-service"} 78.3

# HELP service_memory_usage_mb Memória usada em MB
# TYPE service_memory_usage_mb gauge
service_memory_usage_mb{service="payment-service"} 1024
```

---

## Regras de Formato

| Campo | Tipo | Restrições |
|---|---|---|
| `serviceId` | string | 3–64 chars, apenas `[a-z0-9\-_]`, não pode ser vazio |
| `timestamp` | string | ISO 8601 obrigatório, não pode ser futuro (tolerância: 60s) |
| `status` | string | Exatamente: `"healthy"`, `"degraded"` ou `"unhealthy"` |
| `cpuUsage` | float | 0.0 ≤ valor ≤ 100.0 |
| `memoryUsageMB` | integer | > 0, máximo razoável: 1.048.576 (1TB) |
| `requestsPerSecond` | float | ≥ 0 |
| `errorRate` | float | 0.0 ≤ valor ≤ 1.0 (0% a 100%) |
| `latencyP99ms` | integer | ≥ 0 |

---

## Códigos de Erro

| Código HTTP | `error` | Significado |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Campos inválidos ou ausentes |
| 400 | `INVALID_JSON` | Corpo não é JSON válido |
| 405 | `METHOD_NOT_ALLOWED` | Método HTTP incorreto |
| 500 | `INTERNAL_ERROR` | Erro inesperado no servidor |
