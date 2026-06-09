# 🗃️ Modelagem do Estado Central em Memória

## Estrutura Principal

O estado vive inteiramente em memória no processo Node.js, no módulo `src/state/store.js`.  
Não há banco de dados nesta etapa — tudo é perdido ao reiniciar (comportamento intencional para o MVP).

---

## Estruturas de Dados

### 1. `services` — Map principal

```
Map<serviceId: string, ServiceSnapshot: object>
```

Armazena o **último snapshot** recebido de cada microsserviço.  
Chave = `serviceId` (string única por serviço).

```js
// Estrutura do valor (ServiceSnapshot):
{
  serviceId: "payment-service",   // string
  firstSeenAt: Date,              // quando apareceu pela primeira vez
  lastSeenAt: Date,               // quando chegou o último dado
  status: "healthy",              // "healthy" | "degraded" | "unhealthy"
  consecutiveUnhealthy: 0,        // contador de snapshots unhealthy seguidos
  metrics: {
    cpuUsage: 23.5,               // float
    memoryUsageMB: 512,           // integer
    requestsPerSecond: 142.0,     // float | null
    errorRate: 0.02,              // float | null
    latencyP99ms: 87              // integer | null
  }
}
```

**Complexidade:** inserção/busca O(1).

---

### 2. `recentEvents` — Fila circular (array com limite)

```
Array<Event>  — máximo 100 itens, comportamento FIFO
```

Registra os **100 eventos mais recentes** de qualquer serviço (mudanças de status, erros, novas ingestões).  
Quando chega o item 101, o mais antigo é removido do início.

```js
// Estrutura de um Event:
{
  id: "evt_1717920001234",        // string única (prefixo + timestamp ms)
  occurredAt: Date,               // quando o evento foi registrado
  serviceId: "payment-service",  // serviço envolvido
  type: "STATUS_CHANGE",         // "INGEST" | "STATUS_CHANGE" | "VALIDATION_ERROR" | "NEW_SERVICE"
  payload: {                     // dados específicos do tipo
    from: "healthy",
    to: "degraded"
  }
}
```

**Por que array e não Map?** A consulta é sempre por ordem temporal (os N mais recentes), nunca por ID específico. Array com shift/push é O(1) amortizado para esse padrão.

---

### 3. `ingestCount` — Contador por serviço

```
Map<serviceId: string, count: number>
```

Contador simples de quantas ingestões cada serviço enviou desde que o servidor subiu.  
Usado no `/health` e em métricas de observabilidade do próprio agente.

---

### 4. `globalStats` — Objeto de estatísticas globais

```js
{
  totalIngestsReceived: 0,    // integer — total desde o boot
  totalValidationErrors: 0,   // integer — payloads rejeitados
  serverStartedAt: Date       // quando o servidor iniciou
}
```

---

## Diagrama de Relacionamento

```
globalStats (object)
│
├── totalIngestsReceived
└── serverStartedAt

services (Map)
├── "payment-service" → ServiceSnapshot
├── "auth-service"    → ServiceSnapshot
└── "order-service"   → ServiceSnapshot

ingestCount (Map)
├── "payment-service" → 142
└── "auth-service"    → 37

recentEvents (Array, máx 100)
├── [0] { type: "NEW_SERVICE", serviceId: "auth-service", ... }
├── [1] { type: "INGEST", serviceId: "payment-service", ... }
└── [99] { type: "STATUS_CHANGE", ... }  ← mais recente
```

---

## Operações sobre o Estado

| Operação | Estrutura | Complexidade |
|---|---|---|
| Registrar nova ingestão | `services.set()` + `ingestCount` | O(1) |
| Buscar último estado de um serviço | `services.get()` | O(1) |
| Listar todos os serviços | `services.values()` | O(n) |
| Adicionar evento recente | `recentEvents.push()` + trim | O(1) |
| Ler últimos N eventos | `recentEvents.slice(-N)` | O(N) |

---

## Considerações de Evolução Futura

- Para persistência entre restarts: substituir os Maps por Redis (drop-in com ioredis)
- Para histórico de séries temporais: já está sendo delegado ao Prometheus (scrape do `/metrics`)
- O `recentEvents` não precisa crescer: o histórico completo fica no Prometheus/Grafana
