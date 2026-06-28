# 📋 Resumo — Branch `feat/graphicsAndProbes` (Entrega 3)

Resumo completo do que foi implementado nesta branch, com o **status de versionamento** (o que já está commitado e o que ainda não).

---

## 🎯 Visão geral

A branch entrega a **GUI do Administrador** da Entrega 3 e enriquece a observabilidade do sistema:

1. **Dashboard nativo** (HTML/CSS/JS puro) servido pelo próprio servidor em `http://localhost:3000`.
2. **5 probes novos** simulando microsserviços com latências distintas.
3. **Scripts** para subir/derrubar todos os probes de uma vez.
4. **Servidor** ajustado para servir a GUI estática.
5. **Grafana** com datasource corrigido + 6 painéis novos.

---

## 🛠️ O que foi feito (por área)

### 1. Dashboard nativo — `dashboard/`
GUI moderna, tema escuro, sem framework e sem build step:
- **Tabela de status** com PROBE_ID, badge ONLINE/DOWN (pulsante), uptime (`Xh Xm Xs`), latência (valor + barra de intensidade), último heartbeat ("há X s") e ingestões.
- **DOWN sobe automaticamente ao topo** (independente da ordenação escolhida).
- **Polling assíncrono** (2s) com atualização sem refresh e sem piscar (DOM diff), banner de erro + reconexão automática.
- **Controle remoto de intervalo** (input 1000–60000ms, atalhos 1/3/5/10/30s, validação no cliente, feedback de sucesso/erro, e contador de erros de validação no cabeçalho).
- **Ordenação** por latência/uptime (↑↓) e status.
- **4 cards** globais (probes online, latência média, uptime do servidor, total de ingestões).
- **Feed de eventos** com ícone por tipo e tempo relativo.
- **3 gráficos Chart.js**: latência por probe (com limiares 50/150ms), comparativo de uptime e latência média geral.

### 2. Probes novos — `probes/`
Mesma estrutura dos existentes, com `MQTT_BROKER_URL` configurável e jitter de ±20%:
| Probe | Faixa de latência |
|---|---|
| `estoque.js` | 20–60 ms |
| `gateway.js` | 5–15 ms |
| `notificacoes.js` | 50–200 ms |
| `relatorios.js` | 100–500 ms |
| `cache.js` | 1–5 ms |

### 3. Scripts de orquestração
- `run_all_probes.sh` — sobe os **8 probes** em background (nohup), grava logs em `logs/` e PIDs em `.probe_pids`.
- `stop_probes.sh` — encerra todos os probes.
- `run_probes.js` — maestro interativo atualizado para os **8 probes** (teclas `1`–`8`).

### 4. Servidor — `src/server.js`
- Serve a GUI estática (`express.static`) — dashboard disponível em `GET /`.
- Rota informativa movida de `/` para `/api/info`.
- `PORT` e `MQTT_BROKER_URL` configuráveis por variável de ambiente (defaults: `3000` e `mqtt://mosquitto:1883`).

### 5. Docker
- `Dockerfile` — passou a copiar a pasta `dashboard/` para a imagem (senão a GUI não é servida no container).

### 6. Grafana
- **Datasource Prometheus com `uid` fixo** (`PBFA97CFB590B2093`) em `grafana/provisioning/datasources/prometheus.yaml` — corrige o "No data"/gráficos sumindo, eliminando o copia-e-cola manual.
- **6 painéis novos** em `grafana/dashboards/dashboard.json` (além dos 3 originais — latência por probe, controle de intervalo e tabela):
  1. **Comparativo de Uptime** (bargauge) — `probe_uptime_seconds`
  2. **Latência Média Geral** (timeseries área) — `avg(probe_latencia_ms)`
  3. **Probes Online** (stat) — `count(probe_status == 1)`
  4. **Latência Atual por Probe** (bargauge) — `probe_latencia_ms` instantâneo, colorido por faixa
  5. **Status por Probe** (stat) — `probe_status` → 🟢 ONLINE / 🔴 DOWN
  6. **Latência Máxima Geral** (timeseries) — `max(probe_latencia_ms)`

### 7. Documentação
- `README.md` — instruções de execução atualizadas (Docker, probes, dashboard nativo).

---

## 🔀 Status de versionamento (Git)

Branch: **`feat/graphicsAndProbes`**

### ✅ Já commitado — commit `a283a1e` ("created more probes")
- `dashboard/app.js`, `dashboard/index.html`, `dashboard/style.css`
- `probes/cache.js`, `probes/estoque.js`, `probes/gateway.js`, `probes/notificacoes.js`, `probes/relatorios.js`
- `run_all_probes.sh`, `stop_probes.sh`
- `src/server.js` (static serve + `/api/info` + envs)
- `Dockerfile` (copy `dashboard/`)
- `README.md` (instruções)
- `grafana/provisioning/datasources/prometheus.yaml` (uid fixo)
- `.gitignore` (parcial: `data/`, `logs/`, `.probe_pids`)

### ⏳ Modificado e **NÃO commitado** (working tree)
| Arquivo | Mudança |
|---|---|
| `grafana/dashboards/dashboard.json` | **Os 6 painéis novos do Grafana** + ajustes de layout e tamanho de fonte do "Status por Probe" |
| `run_probes.js` | Maestro agora sobe as 8 probes (teclas `1`–`8`) |
| `.gitignore` | Passou a ignorar `docker-compose.override.yml` |
| `RESUMO_ENTREGA3.md` | Este arquivo (novo) |

### 🚫 Local / ignorado (não vai para o repositório)
- `docker-compose.override.yml` — coloca o Grafana na porta **3002** apenas nesta máquina (a 3001 está ocupada pelo projeto `bpv-server`). O `docker-compose.yml` versionado segue com a 3001 para a equipe.
- `logs/`, `.probe_pids`, `data/`, `node_modules/` — gerados em runtime.

---

## ▶️ Como rodar (resumo)

```bash
# 1. Docker Desktop aberto + porta 3000 livre
docker compose up -d --build      # broker + collector + prometheus + grafana
node run_probes.js                # sobe as 8 probes (Ctrl+C para sair)
```

| Interface | URL |
|---|---|
| Dashboard nativo | http://localhost:3000 |
| Grafana ("Painel Central") | http://localhost:3001· `admin`/`admin` |

> ⚠️ Sempre que editar `grafana/dashboards/dashboard.json`, rode `docker compose restart grafana` — o reload automático não aplica painel novo.

---

## 💾 Para commitar o que falta

```bash
git add grafana/dashboards/dashboard.json run_probes.js .gitignore RESUMO_ENTREGA3.md
git commit -m "feat(graphicsAndProbes): painéis novos no Grafana + maestro com 8 probes"
```
*(O `docker-compose.override.yml` fica de fora de propósito — é ajuste local.)*
