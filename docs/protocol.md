# 📡 Protocolo de Comunicação

## Visão Geral

A arquitetura de comunicação do Dashboard de Saúde de Microsserviços é híbrida, utilizando o melhor de dois mundos para atender aos requisitos de sistemas distribuídos:

1. **MQTT (Mensageria Pub/Sub):** Utilizado para a **ingestão** contínua de dados. Os microsserviços (Probes) publicam seus *heartbeats* ativamente em um Broker Mosquitto, dispensando o uso de conexões socket puras ou requisições HTTP REST diretas.
2. **HTTP/1.1 (Pull/Scrape):** Utilizado para **disponibilização** dos dados consolidados ao Prometheus e para endpoints de checagem de saúde dos microsserviços pelos administradores.

---

## 1. Barramento MQTT (Ingestão de Dados)

### Estrutura de Tópicos

O barramento de mensagens segue uma hierarquia estrita para garantir isolamento estrutural:

- **Padrão de Tópico:** `probes/<probe_id>/metrics`
- **Exemplo Prático:** O serviço de pagamentos publica exclusivamente em `probes/probe_pagamentos/metrics`.

### Distinção de Papéis (Autenticação/Escopo)

- **Probes (Publicadores):** Cada microsserviço atua como um *Publisher* isolado. Eles só possuem permissão e conhecimento para publicar no seu próprio tópico específico. Não podem ler dados de outros probes.
- **Administrador / Agente Coletor (Assinante):** O Servidor Central (Node.js) atua com privilégios globais. Ele faz um *Subscribe* com *wildcard* em `probes/+/metrics`, permitindo escutar e consolidar a saúde de toda a malha de serviços simultaneamente.

### Formato da Mensagem (Payload JSON)

As mensagens publicadas no broker devem ser um objeto JSON validável contendo estritamente os dados de saúde exigidos.

**Payload obrigatório:**

```json
{
  "probe_id": "string",         // identificador único do serviço
  "uptime": number,             // tempo de atividade em segundos
  "latencia": number,           // latência simulada/medida em milissegundos
  "ultimo_heartbeat": "string"  // timestamp em formato ISO 8601
}
```

**Exemplo de publicação válida no broker:**

```json
{
  "probe_id": "probe_pagamentos",
  "uptime": 3600,
  "latencia": 145,
  "ultimo_heartbeat": "2026-06-14T10:00:00Z"
}
```

> **Nota de Erro:** Como o MQTT é assíncrono, falhas de validação não retornam códigos HTTP (como `400 Bad Request`) para o Probe. O Agente Coletor descarta pacotes malformados silenciosamente e registra o erro nos seus logs internos (`VALIDATION_ERROR`).

---

## 2. Endpoints HTTP (Leitura e Monitoramento)

O Servidor Central mantém uma porta TCP fixa aberta (**Porta 3000**) respondendo a conexões web para leitura do estado consolidado em memória.

---

### `GET /health` — Status do próprio agente

Retorna o status operacional do Agente Coletor e estatísticas de ingestão do MQTT.

**Resposta de sucesso (`200 OK`):**

```json
{
  "status": "ok",
  "uptimeSeconds": 3725,
  "servicesMonitored": 3,
  "totalIngestsReceived": 1420,
  "totalValidationErrors": 0,
  "serverStartedAt": "2026-06-14T08:00:00.000Z"
}
```

---

### `GET /services` — Estado da Memória Central

Retorna a "foto" mais recente do dicionário mantido em memória, contendo o último snapshot de todos os Probes que enviaram dados via MQTT.

**Resposta de sucesso (`200 OK`):**

```json
{
  "services": [
    {
      "probe_id": "probe_pagamentos",
      "uptime": 3600,
      "latencia": 145,
      "ultimo_heartbeat": "2026-06-14T10:00:00Z",
      "firstSeenAt": "2026-06-14T09:00:00.000Z",
      "lastSeenAt": "2026-06-14T10:00:00.123Z"
    }
  ],
  "count": 1
}
```

---

### `GET /metrics` — Endpoint Prometheus (Scrape)

Disponibiliza a estrutura em memória traduzida para o formato de texto que o Prometheus exige para armazenamento de série temporal.

**Exemplo de saída:**

```text
# HELP probe_uptime_seconds Tempo de atividade (uptime) do probe em segundos
# TYPE probe_uptime_seconds gauge
probe_uptime_seconds{probe_id="probe_pagamentos"} 3600

# HELP probe_latencia_ms Latência da comunicação em milissegundos por probe
# TYPE probe_latencia_ms gauge
probe_latencia_ms{probe_id="probe_pagamentos"} 145
```