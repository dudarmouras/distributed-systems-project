# Dashboard de Saúde de Microsserviços

Servidor que recebe métricas de microsserviços via HTTP, guarda tudo em memória e expõe os dados pro Prometheus coletar. O Grafana lê o Prometheus e exibe os gráficos.

---

## Como funciona

```
Microsserviços → POST /ingest → Node.js (porta 3000) → /metrics → Prometheus → Grafana
```

Cada microsserviço manda um JSON com CPU, memória, status, etc. O servidor valida, salva em memória e disponibiliza pro Prometheus buscar a cada 15 segundos.

---

## Tecnologias

| O quê | Por quê |
|---|---|
| Node.js + Express | Leve, fácil de subir, bom pra receber muitas requisições HTTP |
| prom-client | Formata as métricas pro Prometheus entender |
| Prometheus | Armazena o histórico das métricas |
| Grafana | Mostra os dashboards |
| Docker Compose | Sobe tudo junto com um comando |

O Grafana sozinho não resolve porque ele só exibe — precisa de uma fonte de dados. O Express é o servidor que o enunciado pede: porta fixa, estado em memória, validações e protocolo definido.

---

## Estrutura de pastas

```
microservice-dashboard/
├── src/
│   ├── server.js                    # sobe o Express na porta 3000
│   ├── state/store.js               # estado em memória (Map + fila de eventos)
│   ├── validators/metricValidator.js # valida os dados antes de salvar
│   ├── collectors/metricsCollector.js# formata pra Prometheus
│   └── routes/
│       ├── ingest.js                # POST /ingest
│       └── health.js                # GET /health e GET /services
├── docs/
│   ├── protocol.md                  # contrato de comunicação
│   └── state-model.md               # como os dados ficam em memória
├── prometheus/prometheus.yml
├── docker-compose.yml
└── package.json
```

---

## Como rodar

### Só o servidor (desenvolvimento)

```bash
npm install
npm run dev
```

Servidor em `http://localhost:3000`

### Stack completo (Node + Prometheus + Grafana)

```bash
docker-compose up -d
```

| Serviço | URL |
|---|---|
| Servidor Node.js | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin/admin) |

### Teste rápido

```bash
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "payment-service",
    "timestamp": "2025-06-09T10:00:00Z",
    "status": "healthy",
    "metrics": {
      "cpuUsage": 23.5,
      "memoryUsageMB": 512,
      "requestsPerSecond": 142,
      "errorRate": 0.02,
      "latencyP99ms": 87
    }
  }'
```

---

## Estado em memória

Os dados ficam em três estruturas dentro do `store.js`:

- `Map` de serviços — guarda o último snapshot de cada serviço
- Array de até 100 eventos — histórico recente (quando enche, o mais antigo sai)
- `Map` de contadores — quantas vezes cada serviço mandou dados

Mais detalhes em [`docs/state-model.md`](docs/state-model.md)

---

## Protocolo

Tudo via HTTP + JSON. Endpoint principal: `POST /ingest`.

Mais detalhes em [`docs/protocol.md`](docs/protocol.md)

---

## Checklist etapa 1

- [x] Decisão tecnológica documentada
- [x] Estrutura de pastas organizada
- [x] Estado em memória modelado
- [x] Protocolo de comunicação documentado
- [x] Servidor rodando na porta 3000
- [x] Validações implementadas

---

## Time

> Adicione os nomes e RAs aqui.