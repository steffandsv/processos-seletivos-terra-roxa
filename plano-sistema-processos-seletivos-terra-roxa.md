# Plano de Implementação — Sistema de Processos Seletivos
### Prefeitura Municipal de Terra Roxa – SP

**Versão:** 1.0
**Princípio reitor:** **Simplicidade na implantação acima de tudo.** Nenhuma feature entra se puder ser substituída por algo mais simples sem perda jurídica. Tudo o que for "ciclo completo" é **modular** — ativável/desativável por edital.

> Este documento é a especificação de construção a ser entregue ao programador de IA (Claude Code). Está dividido em: premissas, escopo modular, arquitetura, modelo de dados, módulos, jornadas, LGPD/segurança, acessibilidade, roadmap em fases, critérios de aceite e checklist jurídico.

---

## 1. Premissas assumidas (vete qualquer uma antes da Fase 1)

Resolvi as dez questões em aberto sempre pela opção mais simples. Estas premissas são a fundação — se alguma estiver errada, corrija **agora**, não depois.

| # | Tema | Decisão adotada (a mais simples) |
|---|------|----------------------------------|
| 1 | Aplicação de prova | O sistema **NÃO aplica prova online**. Ele gerencia inscrição → homologação → publicações → resultado. A prova acontece fora do sistema. |
| 2 | Tipos de avaliação | Sistema **agnóstico**: a comissão **faz upload** dos documentos de gabarito/resultado/classificação (PDF/CSV). Não há motor de notas. |
| 3 | Classificação | **Lista final classificada é enviada pelo admin** (upload). O sistema **não calcula nota nem desempate**. |
| 4 | Indeferimento de inscrição | Gera e-mail ao candidato com o **motivo**. Há **janela de reenvio** (configurável). **Recurso** é uma **fase modular** (ligada/desligada por edital). |
| 5 | PcD / cota | Deficiência é coletada como **dado opcional para atendimento especial**. **Não há motor de cota.** Laudo é **upload opcional**. Reserva de vaga, se houver, é tratada no texto do edital e na lista classificada enviada pelo admin. |
| 6 | Comunicação | **Somente e-mail.** Envio via **SMTP configurável por variável de ambiente** (aponte para o SMTP da prefeitura ou um provedor). |
| 7 | Publicações oficiais | Há uma área **"Publicações"** por edital (upload de editais, retificações, gabaritos, resultados com data/hora). **Não substitui o Diário Oficial** — é espelho de transparência. |
| 8 | Infraestrutura | App Node em **container Docker**, deploy via **GitHub Actions** no **mesmo host** do seu Postgres. Cria-se **novo usuário + novo database** no container Postgres existente. Autenticação **e-mail/senha** (sem gov.br nesta fase). |
| 9 | Documento com foto | Aceitos: **RG, CNH, CTPS digital, Passaporte, RNM**. Formatos **PDF/JPG/PNG**, até **8 MB**. Anexo é **obrigatório para homologar**. |
| 10 | Retenção (LGPD) | Dados e documentos mantidos durante a **validade do certame**. Encerrado o edital, o admin aciona **"Encerrar e expurgar"**, que apaga documentos dos **não classificados**. Política vetável. |

**Conta administradora:** única e compartilhada, conforme sua decisão. Mitigação embutida e inegociável (porque é grátis): **log de auditoria** registrando toda ação administrativa.

---

## 2. Escopo modular — o coração do sistema

Cada **edital** carrega uma configuração de fases. O front do candidato e o painel admin **renderizam condicionalmente** conforme estes flags. Assim o mesmo sistema atende um processo robusto e um "processo de motorista" simplificado sem código novo.

```jsonc
// config de fases armazenada por edital (jsonb)
{
  "permite_multiplas_vagas": false,   // true = candidato escolhe N vagas
  "exige_documento_foto": true,        // obrigatório p/ homologar
  "fase_homologacao": true,            // alguém valida a inscrição
  "fase_recurso_inscricao": false,     // recurso contra indeferimento
  "fase_atendimento_especial": true,   // PcD / condição especial na prova
  "fase_publicacao_gabarito": true,    // área de gabaritos
  "fase_recurso_gabarito": false,      // recurso contra gabarito
  "fase_resultado_classificacao": true,// upload de classificação final
  "janela_reenvio_documento_dias": 2   // 0 = sem reenvio
}
```

**Regra de ouro de implementação:** se um flag está `false`, a etapa **não existe** para o candidato (nem botão, nem e-mail, nem tela). Nada de telas "desabilitadas e cinzas".

Ciclo completo possível (todas as etapas são opcionais exceto Inscrição):

```
Edital publicado
  → Inscrição (sempre)
  → Homologação [modular]
      → Indeferido → Reenvio [modular] → Recurso de inscrição [modular]
  → Publicação de gabarito [modular]
      → Recurso de gabarito [modular]
  → Resultado / Classificação [modular]
  → Encerramento + expurgo LGPD
```

---

## 3. Arquitetura técnica

Mantida deliberadamente monolítica e enxuta — para **500 candidatos** não há nenhuma justificativa para microsserviços, filas ou CDN.

- **Aplicação única (monolito Node)** servindo tanto o site público quanto o painel admin.
- **Runtime:** Node LTS.
- **Framework:** Fastify (ou Express, se o programador preferir) — leve, rápido de subir.
- **Renderização:** server-side com EJS/Handlebars. Evita build de SPA, simplifica deploy (um container só). Frontend é HTML semântico + CSS + JS mínimo.
- **ORM/migrations:** Prisma (migrations versionadas e reprodutíveis no deploy).
- **Banco:** PostgreSQL **já existente** — criar `role` e `database` próprios do sistema no mesmo container; conexão via `DATABASE_URL` na rede Docker compartilhada.
- **Sessão/auth:** cookie de sessão assinado (e-mail/senha). Hash de senha com **argon2** (ou bcrypt). Camada de auth isolada atrás de uma **interface `AuthProvider`** — para gov.br entrar depois como implementação plugável, sem reescrita.
- **Upload de documentos:** volume Docker dedicado no host (ex.: `/data/uploads`), **fora** da raiz web. Para 500 pessoas, volume local + backup é suficiente; não há necessidade de object storage.
- **Geração de PDF (espelho/comprovante):** `pdfkit` ou `pdf-lib`. **Evitar Puppeteer/headless Chrome** — pesa o container e complica o deploy.
- **E-mail:** `nodemailer` + SMTP por variável de ambiente. Reenvio simples com retry; sem fila dedicada.
- **Proxy reverso + TLS:** Caddy (recomendado — HTTPS automático via Let's Encrypt) ou nginx, em container, na frente do app.

### 3.1 Containers (docker-compose)

```
[ caddy ]  --rede-->  [ app-node ]  --rede-->  [ postgres (já existente) ]
                            |
                            +--> volume: uploads
                            +--> SMTP externo (env)
```

### 3.2 CI/CD — GitHub Actions

1. Push na branch `main`.
2. Action roda lint + testes.
3. Build da imagem Docker → push para registry (GHCR) **ou** build direto no host.
4. Deploy por SSH no host: `docker compose pull && docker compose up -d`.
5. `prisma migrate deploy` roda no start do container (migrations idempotentes).

> Secrets (`DATABASE_URL`, `SMTP_*`, `SESSION_SECRET`, chave de criptografia de documentos) vivem em **GitHub Secrets** e em `.env` no host — nunca no repositório.

---

## 4. Modelo de dados (tabelas principais)

Enxuto e direto. Nomes em português para alinhar com o domínio.

- **usuario_admin** — `id`, `nome`, `email`, `senha_hash`, `criado_em`. (Conta única hoje; a tabela já suporta múltiplas amanhã.)
- **candidato** — `id`, `nome_completo`, `cpf` (único, com dígito verificador validado), `email` (único), `telefone`, `endereco` (campos ou jsonb), `tem_deficiencia` (bool), `descricao_deficiencia` (texto, opcional), `senha_hash`, `email_verificado` (bool), `criado_em`, `atualizado_em`.
- **edital** — `id`, `titulo`, `numero`, `descricao`, `config_fases` (jsonb — ver §2), `data_abertura_inscricao`, `data_encerramento_inscricao`, `status` (rascunho/publicado/encerrado/expurgado), `criado_em`.
- **cargo** (vaga) — `id`, `edital_id`, `nome`, `descricao`, `qtd_vagas`, `requisitos`.
- **inscricao** — `id`, `candidato_id`, `edital_id`, `cargo_id`, `status` (enviada/em_analise/homologada/indeferida/cancelada), `motivo_indeferimento` (texto), `termo_aceite_em` (timestamp), `pdf_espelho_path`, `criado_em`. **Unicidade** conforme flag: por padrão `UNIQUE(candidato_id, edital_id)` (um cargo por edital); se `permite_multiplas_vagas`, relaxa para `UNIQUE(candidato_id, cargo_id)`.
- **documento** — `id`, `inscricao_id`, `tipo` (doc_foto/laudo/outro), `arquivo_path`, `mime`, `tamanho`, `enviado_em`. (Armazenado **criptografado**.)
- **atendimento_especial** — `id`, `inscricao_id`, `tipo_necessidade`, `descricao`, `laudo_documento_id`. (Só existe se a fase estiver ligada.)
- **recurso** — `id`, `inscricao_id`, `fase` (inscricao/gabarito), `texto`, `anexo_path`, `status` (aberto/deferido/indeferido), `resposta_admin`, `respondido_em`, `criado_em`.
- **publicacao** — `id`, `edital_id`, `tipo` (edital/retificacao/gabarito_preliminar/gabarito_definitivo/resultado/classificacao/convocacao/outro), `titulo`, `arquivo_path`, `publicado_em` (data/hora carimbada).
- **log_auditoria** — `id`, `ator` (admin/candidato/sistema), `ator_id`, `acao`, `entidade`, `entidade_id`, `detalhes` (jsonb), `ip`, `criado_em`.
- **notificacao_email** — `id`, `destinatario`, `assunto`, `template`, `status` (enviado/falha), `tentativas`, `criado_em`. (Rastreabilidade de envio — peso jurídico.)

---

## 5. Módulos funcionais

### 5.1 Portal público (candidato)
- **Vitrine de oportunidades:** lista de editais publicados com status e datas.
- **Cadastro gratuito:** nome, CPF (validação de dígito verificador + unicidade), e-mail (com verificação por link), telefone, endereço, campo de deficiência (opcional). **Sem upload no cadastro** — o documento entra na inscrição.
- **Verificação de e-mail** antes de permitir inscrição (evita base suja).
- **Perfil:** atualização de dados cadastrais + exportação dos próprios dados (direito LGPD) + solicitação de exclusão.
- **Página do edital:** documentos, cargos/vagas, prazos, área de Publicações.
- **Inscrição:**
  1. Escolha de vaga (1 por padrão; N se `permite_multiplas_vagas`).
  2. Upload do documento com foto (se `exige_documento_foto`).
  3. (Se ligado) requerimento de atendimento especial + laudo.
  4. **Termo de aceite** com timestamp: "Li o edital integralmente e estou ciente de que não posso trocar a vaga depois."
  5. Envio → status `enviada` (ou `em_analise` se há homologação).
  6. **E-mail de confirmação de recebimento** + **PDF espelho** (todos os dados + data/hora).
- **Acompanhamento:** o candidato vê o status da própria inscrição e recebe e-mail a cada mudança (homologada, indeferida com motivo, etc.).
- **Recursos** (se a fase estiver ligada): abertura dentro da janela, com protocolo e acompanhamento da resposta.

### 5.2 Painel administrativo
- **Login** da conta administradora.
- **CRUD de editais** com o configurador de fases (§2) — sem programador.
- **CRUD de cargos/vagas** por edital.
- **Fila de homologação:** lista de inscrições com visualização do documento, botões **Homologar / Indeferir (com motivo)**. Ao homologar → e-mail "Inscrição homologada" + espelho. Ao indeferir → e-mail com motivo (+ link de reenvio se houver janela).
- **Publicações:** upload de documentos oficiais por edital com carimbo de data/hora.
- **Recursos:** lista, leitura, resposta fundamentada (deferido/indeferido).
- **Resultado/Classificação:** upload da lista final (PDF/CSV) → vira Publicação.
- **Listas públicas:** geração de listas de inscritos/classificados **somente com nome e número de inscrição** — **nunca CPF, nunca vínculo público com deficiência** (ver §6).
- **Relatórios simples:** total de inscritos por cargo, homologados, indeferidos.
- **Encerrar e expurgar:** encerra o edital e apaga documentos dos não classificados (LGPD).
- **Log de auditoria:** visualização das ações.

---

## 6. LGPD e segurança

- **Bases legais (não consentimento):** o tratamento se ancora em **cumprimento de obrigação legal** e **execução de políticas públicas** (LGPD art. 7º, II e III; art. 23). Isso deve estar escrito no Aviso de Privacidade do sistema.
- **Dado sensível:** deficiência (art. 5º, II). Coleta **opcional**, finalidade **restrita** a atendimento especial, e **nunca exposta em lista pública**.
- **Minimização:** nenhum documento é coletado no cadastro; só na inscrição, e só o necessário.
- **Listas públicas seguras:** publicar **nome + número de inscrição**. **Não** publicar CPF. **Não** sinalizar quem é PcD ou cotista. (Tendência consolidada dos órgãos de controle e da prática da própria ANPD em seus certames.)
- **Criptografia:** documentos cifrados em repouso (chave em env/secret); TLS em trânsito (Caddy).
- **Retenção/descarte:** conforme premissa 10, com ação explícita de expurgo e registro no log.
- **Direitos do titular:** telas de exportar dados e solicitar exclusão no perfil do candidato.
- **Aviso de Privacidade + Termos de Uso:** páginas públicas, versionadas.
- **Trilha de auditoria:** toda ação administrativa logada (mitigação da conta única).
- **Senhas:** argon2/bcrypt; política mínima de senha; rate limit no login.
- **Backups:** rotina de backup do banco e do volume de uploads, testada (restore vale mais que backup).

---

## 7. Acessibilidade

Obrigação legal (LBI 13.146/2015; eMAG), não enfeite. Mínimo viável:
- HTML semântico, navegação por teclado, contraste adequado, `alt` em imagens, `labels` em todos os campos.
- Mensagens de erro descritivas e associadas ao campo.
- Testar com leitor de tela (NVDA) a jornada de cadastro → inscrição → envio.

> Isso é distinto de "atendimento especial na prova" (que é requerimento do candidato) e de "reserva de vaga PcD" (que é regra do edital). São três coisas separadas; aqui falamos da acessibilidade **do sistema**.

---

## 8. Roadmap em fases

Implantar em fatias finas. Cada fase entrega algo que **funciona em produção**.

**Fase 0 — Fundação (infra)**
Docker + compose, conexão com Postgres existente (novo db/user), Caddy + TLS, GitHub Actions com deploy automático, Prisma migrate, healthcheck. Critério: "hello world" no ar sob HTTPS, deploy por push funcionando.

**Fase 1 — MVP de inscrição (o que você mais precisa)**
Cadastro + verificação de e-mail, login do candidato, vitrine de editais, CRUD de editais/cargos no admin, inscrição com escolha de vaga + termo de aceite + upload de documento, **espelho em PDF por e-mail**, log de auditoria. Critério: um candidato se inscreve do zero e recebe o espelho.

**Fase 2 — Homologação**
Fila de homologação no admin, homologar/indeferir com motivo, e-mails de status, reenvio de documento, listas públicas (nome + nº inscrição). Critério: o admin valida e o candidato é notificado.

**Fase 3 — Transparência**
Área de Publicações por edital, upload de gabaritos/resultados/classificação com carimbo de data/hora. Critério: documentos oficiais visíveis no portal.

**Fase 4 — Recursos (modular)**
Recurso de inscrição e de gabarito, com janela, protocolo e resposta. Critério: ligar/desligar por edital e o fluxo respeitar os prazos.

**Fase 5 — Maturidade LGPD**
Exportação/exclusão de dados pelo titular, "Encerrar e expurgar", Aviso de Privacidade/Termos versionados. Critério: ciclo de vida do dado completo.

**Fase 6 (futuro/opcional)** — Atendimento especial PcD, 2FA do admin, autenticação gov.br plugável.

---

## 9. Critérios de aceite (transversais)

- Um edital "motorista" (sem recurso, sem atendimento especial) e um edital completo **convivem no mesmo sistema** só mudando a config de fases.
- Toda mudança de status do candidato gera **um, e somente um**, e-mail correspondente, registrado em `notificacao_email`.
- Nenhuma lista pública exibe CPF ou condição de deficiência.
- Toda ação do admin aparece no log de auditoria com data/hora e ator.
- O espelho de inscrição em PDF reflete fielmente os dados e a data/hora de envio.
- Deploy é 100% reproduzível por `git push` → produção.

---

## 10. Checklist jurídico (antes de abrir o primeiro edital real)

- [ ] Aviso de Privacidade e Termos de Uso publicados e revisados pela Procuradoria do município.
- [ ] Bases legais documentadas (obrigação legal / políticas públicas).
- [ ] Política de retenção e descarte aprovada.
- [ ] Confirmação de que listas públicas não expõem dado sensível nem CPF.
- [ ] Definição de quem é o **encarregado (DPO)** do município para este tratamento.
- [ ] Texto do termo de aceite validado juridicamente.
- [ ] Backups testados (restore real, não só dump).

---

## 11. Riscos residuais (assumidos por decisão do cliente)

1. **Conta administradora única:** sem rastreabilidade individual de operador. Mitigado parcialmente por log de auditoria; risco residual de não-repúdio permanece.
2. **Sem validação oficial de CPF** (Conecta gov.br indisponível para municípios): antifraude limitado a dígito verificador + unicidade. Fraude por CPF de terceiros não é detectável automaticamente.
3. **Classificação manual:** o cálculo de notas/desempate fica fora do sistema; erro humano na lista enviada não é capturado pelo software.

Estes riscos são consequência direta da prioridade de **simplicidade** e estão aqui registrados de propósito — para que a decisão seja consciente, não acidental.
