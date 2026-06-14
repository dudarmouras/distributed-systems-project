# 🗃️ Modelagem do Estado Central em Memória

## Estrutura Principal

O estado vive inteiramente na memória RAM do processo Node.js (Agente Coletor), isolado no módulo `src/state/store.js`.

Não há banco de dados persistente nesta etapa arquitetural — o estado reflete apenas a "foto atual" do sistema. Tudo é perdido ao reiniciar (comportamento intencional para o MVP da Entrega 01).

---

## Estruturas de Dados

### 1. `probes` — Map principal (O Dicionário Exigido)

```text
Map<probe_id: string, ProbeSnapshot: object>
```

Armazena o último snapshot consolidado recebido de cada microsserviço via MQTT. A chave de busca é o `probe_id` (string única por serviço).

```javascript
// Estrutura do valor (ProbeSnapshot):
{
  probe_id: "probe_pagamentos",              // string
  uptime: 3600,                              // number — tempo de atividade em segundos
  latencia: 145,                             // number — tempo de resposta em ms
  ultimo_heartbeat: "2026-06-14T10:00:00Z", // string — timestamp ISO 8601
  firstSeenAt: Date,                         // Date — quando o probe publicou pela 1ª vez
  lastSeenAt: Date                           // Date — registro interno de quando o pacote chegou
}
```

> **Complexidade:** inserção/busca constante **O(1)**.

---

### 2. `recentEvents` — Fila circular (Array com limite)

```text
Array<Event>  — máximo 100 itens, comportamento FIFO
```

Registra os 100 eventos mais recentes processados pelo broker (novos probes detectados, heartbeats recebidos, erros de validação JSON).

Quando chega o item 101, o mais antigo é descartado para proteger a memória do servidor.

```javascript
// Estrutura de um Event:
{
  id: "evt_1717920001234",       // string única (prefixo + timestamp ms + random)
  occurredAt: Date,              // quando o evento foi registrado pelo Node.js
  probe_id: "probe_pagamentos",  // microsserviço publicador
  type: "HEARTBEAT_MQTT",        // "NOVO_PROBE_DETECTADO" | "HEARTBEAT_MQTT"
  payload: {                     // dados específicos do evento
    latencia: 145
  }
}
```

> **Por que usar um Array e não um Map aqui?** A consulta da rota `/events` é sempre por ordem temporal (os N mais recentes), nunca por um ID específico. Um Array utilizando `push` e `shift` garante complexidade **O(1)** amortizada para esse padrão de rotatividade.

---

### 3. `ingestCount` — Contador por serviço

```text
Map<probe_id: string, count: number>
```

Contador simples de quantas mensagens MQTT válidas cada probe enviou desde que o servidor Node.js subiu. Usado como ferramenta de observabilidade interna na rota `/health`.

---

### 4. `globalStats` — Objeto de estatísticas globais

```javascript
{
  totalIngestsReceived: 1420, // integer — total de mensagens processadas do Broker
  totalValidationErrors: 2,   // integer — payloads malformados ou inválidos descartados
  serverStartedAt: Date       // quando o Agente Coletor iniciou
}
```

---

## Diagrama de Relacionamento em Memória

```text
globalStats (object)
│
├── totalIngestsReceived
└── serverStartedAt

probes (Map)
├── "probe_pagamentos"   → ProbeSnapshot { uptime, latencia, ultimo_heartbeat... }
├── "probe_autenticacao" → ProbeSnapshot { uptime, latencia, ultimo_heartbeat... }
└── "probe_pedidos"      → ProbeSnapshot { uptime, latencia, ultimo_heartbeat... }

ingestCount (Map)
├── "probe_pagamentos"   → 142
└── "probe_autenticacao" → 37

recentEvents (Array, máx 100)
├── [0]  { type: "NOVO_PROBE_DETECTADO", probe_id: "probe_autenticacao", ... }
├── [1]  { type: "HEARTBEAT_MQTT", probe_id: "probe_pagamentos", ... }
└── [99] { type: "HEARTBEAT_MQTT", ... }  ← Mais recente
```

---

## Operações sobre o Estado

| Operação | Estrutura Modificada/Acessada | Complexidade |
|---|---|---|
| Processar mensagem MQTT | `probes.set()` + `ingestCount` | O(1) |
| Buscar estado de um probe | `probes.get()` | O(1) |
| Listar toda a malha (todos os probes) | `probes.values()` | O(n) |
| Registrar log recente | `recentEvents.push()` + `shift()` | O(1) |
| Ler últimos N eventos (`/events`) | `recentEvents.slice(-N)` | O(N) |

---

## Considerações de Arquitetura e Evolução

- **Persistência e Tolerância a Falhas:** Para evitar a perda do dicionário global entre os restarts do servidor Node.js, a evolução natural desta arquitetura é externalizar este estado para um banco em memória como o Redis.
- **Séries Temporais:** Esta modelagem não guarda histórico longo de métricas. Essa responsabilidade já está delegada arquiteturalmente ao Prometheus, que faz o scrape da rota `/metrics` gerada a partir deste estado efêmero.