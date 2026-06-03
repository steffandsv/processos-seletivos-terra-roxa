# Sistema de Processos Seletivos — Prefeitura Municipal de Terra Roxa/SP

Monolito Node que gerencia o ciclo **inscrição → homologação → publicações → resultado**
de processos seletivos. O sistema **não aplica prova**, **não calcula nota** e **não tem
motor de cota** — é deliberadamente simples (ver `plano-sistema-processos-seletivos-terra-roxa.md`).

Cada **edital** carrega uma configuração de fases (jsonb). Etapas desligadas **não existem**
para o candidato — o mesmo sistema atende um processo robusto e um "processo de motorista"
simplificado sem código novo.

## Stack

- **Node 22** + **Fastify 5** (site público + painel admin no mesmo processo)
- **EJS** server-side (sem build de SPA) · HTML semântico, acessível (eMAG/LBI)
- **Prisma** + **PostgreSQL** (migrations versionadas)
- **argon2** (`@node-rs/argon2`) para senhas · sessão por cookie assinado · CSRF synchronizer-token
- **Documentos cifrados em repouso** (AES-256-GCM) · upload fora da raiz web
- **pdfkit** para o espelho de inscrição (sem headless Chrome)
- **nodemailer** + SMTP por variável de ambiente (modo dev loga em vez de enviar)
- Deploy: **Docker** + **Caddy** (HTTPS automático) + **GitHub Actions**

## Estrutura

```
src/
  server.js            Montagem do Fastify, plugins, healthcheck, handlers de erro
  config.js            Leitura/validação de variáveis de ambiente (fail-fast)
  db.js                Cliente Prisma único
  plugins/auth.js      Sessão (cookie), CSRF, flash, reply.render, guards
  lib/                 cpf, crypto, fases, audit, email, pdf, upload, validators, format, seguranca, web
  routes/
    public.js          Vitrine, página do edital, listas públicas, downloads, privacidade/termos
    auth-candidato.js  Cadastro, verificação de e-mail, login, recuperação de senha
    candidato.js       Conta/LGPD, inscrição, espelho, reenvio, recursos
    admin.js + admin/  Login, dashboard, editais/cargos, homologação, publicações, recursos, relatório, auditoria
  views/               Templates EJS (+ views/emails)
prisma/schema.prisma   Modelo de dados (§4 do plano)
scripts/               create-admin.js, seed-demo.js
tests/                 Testes unitários (cpf, crypto, fases)
```

## Rodar localmente

```bash
npm install
cp .env.example .env          # edite DATABASE_URL e gere os segredos:
#   openssl rand -hex 32   ->  SESSION_SECRET
#   openssl rand -hex 32   ->  DOC_ENCRYPTION_KEY

npm run prisma:generate
npm run migrate:deploy        # aplica as migrations no banco

npm run create:admin -- admin@terraroxa.sp.gov.br "Administrador" "SuaSenhaForte123"
npm run seed:demo             # (opcional) cria 2 editais de exemplo

npm run dev                   # http://localhost:3000  (admin em /admin/login)
```

Sem `SMTP_HOST` configurado, os e-mails **não são enviados de verdade**: ficam registrados
no console e na tabela `notificacao_email` (modo desenvolvimento).

## Scripts

| Comando | Ação |
|---|---|
| `npm run dev` | Servidor com reload (`--watch`) |
| `npm start` | Servidor (produção) |
| `npm test` | Testes unitários (`node --test`) |
| `npm run lint` | ESLint |
| `npm run migrate:deploy` | Aplica migrations |
| `npm run create:admin -- <email> "<nome>" <senha>` | Cria/atualiza o admin |
| `npm run seed:demo` | Editais de demonstração |

## Variáveis de ambiente

Veja `.env.example`. Essenciais: `DATABASE_URL`, `SESSION_SECRET` (≥32 chars),
`DOC_ENCRYPTION_KEY` (64 hex = 32 bytes), `APP_BASE_URL`, `UPLOAD_DIR`, `SMTP_*`, `MAIL_FROM`,
`COOKIE_SECURE` (true atrás de HTTPS), `ORGAO_NOME`, `ORGAO_UF`, `DPO_CONTATO`.

Os segredos vivem em **GitHub Secrets** e no `.env` do host — **nunca no repositório**.

## Banco de dados

Role e database dedicados no Postgres existente:

```sql
CREATE ROLE processos_app LOGIN PASSWORD '***';
CREATE DATABASE processos_seletivos OWNER processos_app;
```

`DATABASE_URL=postgresql://processos_app:SENHA@HOST:5432/processos_seletivos?schema=public`

## Deploy (Docker + Caddy + GitHub Actions)

```
[ caddy ] --rede--> [ app-node ] --rede--> [ postgres (já existente) ]
                         +--> volume: uploads
                         +--> SMTP externo (env)
```

1. No host: clone do repo, `.env` de produção (`UPLOAD_DIR=/data/uploads`, `COOKIE_SECURE=true`,
   `APP_BASE_URL=https://seu-dominio`, `DATABASE_URL` apontando para o container Postgres pela
   rede Docker compartilhada). Defina `DOMAIN` e `POSTGRES_NETWORK` (nome da rede do Postgres).
2. `docker compose up -d --build`. O `docker-entrypoint.sh` roda `prisma migrate deploy` e sobe o app.
3. CI/CD: push em `main` → GitHub Actions roda **lint + testes** e faz **deploy por SSH**
   (`git pull && docker compose build && docker compose up -d`). Secrets necessários:
   `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PORT` (opcional), `APP_DIR`.

Healthcheck: `GET /health` (app) e `GET /health/db` (conexão com o banco).

## Cobertura do plano

| Fase | Entregue |
|---|---|
| 0 — Fundação | Docker/compose, Caddy, GitHub Actions, Prisma migrate, healthcheck |
| 1 — MVP inscrição | Cadastro + verificação de e-mail, login, vitrine, CRUD editais/cargos, inscrição (vaga + termo + upload), espelho PDF por e-mail, auditoria |
| 2 — Homologação | Fila, homologar/indeferir com motivo, e-mails de status, reenvio, listas públicas (nome + nº) |
| 3 — Transparência | Publicações por edital com carimbo de data/hora; resultado/classificação como publicação |
| 4 — Recursos (modular) | Recurso de inscrição e de gabarito, protocolo, resposta, liga/desliga por edital |
| 5 — LGPD | Exportar/excluir dados do titular, Encerrar + Expurgar, Aviso de Privacidade/Termos |
| 6 — Futuro | Atendimento especial PcD já incluído; 2FA do admin e gov.br ficam como `AuthProvider` plugável |

### Modularidade

A config de fases por edital fica em `edital.config_fases` (jsonb). Ver `src/lib/fases.js`.
Um edital "motorista" (sem recurso, sem atendimento especial) e um edital completo convivem
no mesmo sistema apenas mudando os flags — sem código novo.

### LGPD / segurança

- Bases legais: obrigação legal / políticas públicas (não consentimento) — ver Aviso de Privacidade.
- Deficiência é dado sensível, opcional, **nunca** exposto em lista pública.
- Listas públicas: **somente nome + número de inscrição** (nunca CPF, nunca PcD).
- Documentos **cifrados em repouso**; TLS via Caddy; toda ação administrativa **auditada**.
- "Encerrar e expurgar" remove documentos das inscrições **não homologadas** (premissa 10).

### Riscos residuais assumidos (§11 do plano)

Conta administradora única (mitigada por auditoria), CPF validado só por dígito verificador
(sem Conecta gov.br) e classificação calculada fora do sistema. Decisões conscientes de simplicidade.
