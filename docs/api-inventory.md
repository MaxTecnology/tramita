# Inventário da API

> Gerado por `pnpm --filter api audit:routes` (apps/api/scripts/route-audit). Não editar à mão: rode de novo.

"Quem passa" vem de chamar cada rota sem token e com um token de cada papel, no banco de teste (passa = não recebe 401/403). "Usada por" cruza com as chamadas do web; "Teste de rota" indica se algum teste da API chama a rota por HTTP (a regra pode ter teste só no service).

## Resumo

- Rotas: **212**
- Públicas (sem login): **6** — `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /organizations/plans`, `POST /organizations/register`, `GET /organizations/signup-status`
- Sem uso no web nem chamador externo conhecido: **2**
- Sem teste de rota: **52**
- Cliente (portal) passa fora de /portal: **13** (rotas compartilhadas — o escopo dentro delas é revisado na auditoria de segurança)

## Sem uso

| Método | Rota | Quem passa | Teste de rota |
|---|---|---|---|
| GET | `/document-reader/metricas` | Admin, Gerente, Membro | sim |
| GET | `/portal/requests/:id` | Cliente | sim |

## Cliente fora de /portal

| Método | Rota | Quem passa |
|---|---|---|
| GET | `/boards` | Admin, Gerente, Membro, Cliente |
| GET | `/boards/:id` | Admin, Gerente, Membro, Cliente |
| DELETE | `/comments/:id` | Admin, Gerente, Membro, Cliente |
| DELETE | `/request-comments/:id` | Admin, Gerente, Membro, Cliente |
| GET | `/requests/:requestId/comments` | Admin, Gerente, Membro, Cliente |
| POST | `/requests/:requestId/comments` | Admin, Gerente, Membro, Cliente |
| GET | `/tasks/:id/attachments` | Admin, Gerente, Membro, Cliente |
| POST | `/tasks/:id/attachments` | Admin, Gerente, Membro, Cliente |
| DELETE | `/tasks/:id/attachments/:attachmentId` | Admin, Gerente, Membro, Cliente |
| GET | `/tasks/:taskId/comments` | Admin, Gerente, Membro, Cliente |
| POST | `/tasks/:taskId/comments` | Admin, Gerente, Membro, Cliente |
| GET | `/users/me` | Admin, Gerente, Membro, Cliente, Master |
| PATCH | `/users/me` | Admin, Gerente, Membro, Cliente, Master |

## Todas as rotas por módulo

### /approvals

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| POST | `/approvals/:id/close` | Admin, Gerente, Membro | web | sim |

### /auth

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| POST | `/auth/change-password` | Admin, Gerente, Membro, Cliente, Master | web | sim |
| POST | `/auth/login` | **público** | web | sim |
| POST | `/auth/logout` | **público** | web | sim |
| GET | `/auth/me` | Admin, Gerente, Membro, Cliente, Master | web | **não** |
| PATCH | `/auth/me` | Admin, Gerente, Membro, Cliente, Master | web | **não** |
| POST | `/auth/refresh` | **público** | web (auth-refresh, fetch direto) | sim |

### /boards

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/boards` | Admin, Gerente, Membro, Cliente | web | sim |
| POST | `/boards` | Admin, Gerente, Membro | web | sim |
| GET | `/boards/:id` | Admin, Gerente, Membro, Cliente | web | sim |
| PATCH | `/boards/:id` | Admin, Gerente | web (indireto) | sim |
| PATCH | `/boards/:id/delay-reason` | Admin, Gerente, Membro | web | sim |
| POST | `/boards/:id/os` | Admin, Gerente, Membro | web | sim |
| GET | `/boards/:id/stage-times` | Admin, Gerente, Membro | web | sim |
| GET | `/boards/:id/stream` | token próprio (ticket/webhook) | web (indireto) | sim |
| GET | `/boards/:id/tasks/search` | Admin, Gerente, Membro | web | sim |

### /client-users

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/client-users` | Admin, Gerente | web | sim |
| POST | `/client-users` | Admin, Gerente | web | sim |
| DELETE | `/client-users/:id` | Admin, Gerente | web | sim |
| GET | `/client-users/:id` | Admin, Gerente | web | **não** |
| PATCH | `/client-users/:id` | Admin, Gerente | web | sim |

### /clients

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/clients` | Admin, Gerente, Membro | web | sim |
| POST | `/clients` | Admin, Gerente | web | sim |
| DELETE | `/clients/:id` | Admin, Gerente | web | sim |
| PATCH | `/clients/:id` | Admin, Gerente | web | sim |
| GET | `/clients/:id/assignments` | Admin, Gerente, Membro | web | **não** |
| POST | `/clients/:id/reactivate` | Admin, Gerente | web | sim |
| GET | `/clients/:id/users` | Admin, Gerente | web | sim |
| GET | `/clients/lookup-cnpj/:cnpj` | Admin, Gerente | web | sim |
| GET | `/clients/search-users` | Admin, Gerente | web | **não** |

### /columns

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| POST | `/columns/:columnId/tasks` | Admin, Gerente, Membro | web | sim |

### /comments

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| DELETE | `/comments/:id` | Admin, Gerente, Membro, Cliente | web (indireto) | sim |

### /dashboard

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/dashboard/metrics` | Admin, Gerente, Membro | web | sim |
| GET | `/dashboard/os` | Admin, Gerente, Membro | web | sim |
| GET | `/dashboard/productivity` | Admin, Gerente, Membro | web | sim |
| GET | `/dashboard/team-members` | Admin, Gerente | web | **não** |

### /delay-reasons

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/delay-reasons` | Admin, Gerente, Membro | web | sim |
| POST | `/delay-reasons` | Admin | web | **não** |
| DELETE | `/delay-reasons/:id` | Admin | web | **não** |
| PATCH | `/delay-reasons/:id` | Admin | web | **não** |

### /departments

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/departments` | Admin, Gerente, Membro | web | sim |
| POST | `/departments` | Admin | web | sim |
| DELETE | `/departments/:id` | Admin | web | **não** |
| PATCH | `/departments/:id` | Admin | web | **não** |

### /document-reader

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| POST | `/document-reader/:id/confirmar` | Admin, Gerente, Membro | web | sim |
| POST | `/document-reader/:id/reabrir` | Admin, Gerente, Membro | web | **não** |
| POST | `/document-reader/:id/rejeitar` | Admin, Gerente, Membro | web | **não** |
| POST | `/document-reader/:id/trocar-tarefa` | Admin, Gerente, Membro | web | **não** |
| GET | `/document-reader/:id/visualizar` | Admin, Gerente, Membro | web | sim |
| POST | `/document-reader/confirmar-lote` | Admin, Gerente, Membro | web | sim |
| GET | `/document-reader/fila` | Admin, Gerente, Membro | web | sim |
| GET | `/document-reader/metricas` | Admin, Gerente, Membro | — | sim |
| GET | `/document-reader/modelos` | Admin | web | sim |
| POST | `/document-reader/modelos` | Admin | web | sim |
| DELETE | `/document-reader/modelos/:id` | Admin | web | sim |
| PATCH | `/document-reader/modelos/:id` | Admin | web | sim |
| POST | `/document-reader/modelos/analisar` | Admin | web | sim |
| POST | `/document-reader/modelos/verificar-colisao` | Admin | web | sim |
| GET | `/document-reader/obrigacoes` | Admin, Gerente, Membro | web | sim |
| POST | `/document-reader/obrigacoes` | Admin | web | sim |
| GET | `/document-reader/rejeitados` | Admin, Gerente, Membro | web | sim |
| POST | `/document-reader/upload` | Admin, Gerente | web | sim |

### /holidays

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/holidays` | Admin, Gerente, Membro | web | sim |
| POST | `/holidays` | Admin | web | sim |
| DELETE | `/holidays/:id` | Admin | web | sim |
| GET | `/holidays/days` | Admin, Gerente, Membro | web | sim |

### /master

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/master/organizations` | Master | web | sim |
| POST | `/master/organizations` | Master | web | sim |
| GET | `/master/organizations/:id` | Master | web | sim |
| PATCH | `/master/organizations/:id` | Master | web | sim |
| POST | `/master/organizations/:orgId/users/:userId/reset-password` | Master | web | sim |
| GET | `/master/plans` | Master | web | sim |
| POST | `/master/plans` | Master | web | sim |
| DELETE | `/master/plans/:id` | Master | web | sim |
| PATCH | `/master/plans/:id` | Master | web | sim |
| GET | `/master/revenue` | Master | web | **não** |

### /municipalities

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/municipalities` | Admin, Gerente, Membro | web | **não** |

### /notifications

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/notifications` | Admin, Gerente, Membro, Cliente | web | **não** |
| POST | `/notifications/:id/read` | Admin, Gerente, Membro, Cliente | web | **não** |
| POST | `/notifications/:id/unread` | Admin, Gerente, Membro, Cliente | web | **não** |
| GET | `/notifications/config` | Admin | web | sim |
| PATCH | `/notifications/config` | Admin | web | sim |
| DELETE | `/notifications/config/sla-sound` | Admin | web | sim |
| POST | `/notifications/config/sla-sound` | Admin | web | sim |
| POST | `/notifications/config/test-email` | Admin | web | sim |
| POST | `/notifications/config/test-whatsapp` | Admin | web | sim |
| GET | `/notifications/logs` | Admin | web | **não** |
| POST | `/notifications/read-all` | Admin, Gerente, Membro, Cliente | web | sim |
| POST | `/notifications/read-by-task` | Admin, Gerente, Membro, Cliente, Master | web | sim |
| GET | `/notifications/stream` | token próprio (ticket/webhook) | web (indireto) | sim |
| DELETE | `/notifications/templates/:event/:channel` | Admin | web | **não** |
| GET | `/notifications/templates/:event/:channel` | Admin | web | sim |
| PUT | `/notifications/templates/:event/:channel` | Admin | web | sim |
| POST | `/notifications/templates/preview` | Admin | web | sim |
| GET | `/notifications/unread-count` | Admin, Gerente, Membro, Cliente | web | **não** |

### /org

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/org/subscription` | Admin | web | **não** |
| POST | `/org/subscription/change-plan` | Admin | web | **não** |

### /organizations

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/organizations/plans` | **público** | web | **não** |
| POST | `/organizations/register` | **público** | web | sim |
| GET | `/organizations/signup-status` | **público** | web | sim |

### /os

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/os` | Admin, Gerente, Membro | web | **não** |
| POST | `/os` | Admin, Gerente, Membro | web | sim |

### /os-models

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/os-models` | Admin, Gerente, Membro | web | **não** |
| POST | `/os-models` | Admin | web | sim |
| DELETE | `/os-models/:id` | Admin | web | sim |
| GET | `/os-models/:id` | Admin, Gerente, Membro | web | sim |
| PATCH | `/os-models/:id` | Admin | web | sim |

### /portal

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| POST | `/portal/approvals/:id/approve` | Cliente | web | **não** |
| POST | `/portal/approvals/:id/request-changes` | Cliente | web | **não** |
| GET | `/portal/clients` | Cliente | web | sim |
| GET | `/portal/departments` | Cliente | web | sim |
| GET | `/portal/document-requests` | Cliente | web | sim |
| GET | `/portal/document-requests/months` | Cliente | web | sim |
| GET | `/portal/home` | Cliente | web | sim |
| GET | `/portal/protocols` | Cliente | web | sim |
| GET | `/portal/protocols/:id` | Cliente | web | sim |
| GET | `/portal/protocols/:id/download` | Cliente | web | sim |
| DELETE | `/portal/protocols/:id/pay` | Cliente | web | sim |
| POST | `/portal/protocols/:id/pay` | Cliente | web | sim |
| GET | `/portal/requests` | Cliente | web | sim |
| POST | `/portal/requests` | Cliente | web | sim |
| GET | `/portal/requests/:id` | Cliente | — | sim |
| POST | `/portal/requests/:id/attachments` | Cliente | web | **não** |
| PATCH | `/portal/requests/:id/cancel` | Cliente | web | sim |
| GET | `/portal/services` | Cliente | web | sim |
| GET | `/portal/tasks/:taskId/documents` | Cliente | web (indireto) | **não** |
| DELETE | `/portal/tasks/:taskId/documents/requests/:reqId/not-applicable` | Cliente | web (indireto) | **não** |
| POST | `/portal/tasks/:taskId/documents/requests/:reqId/not-applicable` | Cliente | web (indireto) | sim |
| POST | `/portal/tasks/:taskId/documents/requests/:reqId/upload` | Cliente | web | sim |
| GET | `/portal/tasks/:taskId/history` | Cliente | web (indireto) | sim |

### /process-templates

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/process-templates` | Admin, Gerente, Membro | web | sim |
| POST | `/process-templates` | Admin | web | sim |
| DELETE | `/process-templates/:id` | Admin | web | sim |
| GET | `/process-templates/:id` | Admin, Gerente, Membro | web | **não** |
| PATCH | `/process-templates/:id` | Admin | web | sim |

### /protocols

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/protocols` | Admin, Gerente, Membro | web | sim |
| GET | `/protocols/:id` | Admin, Gerente, Membro | web | sim |
| POST | `/protocols/:id/cancel` | Admin, Gerente, Membro | web | sim |
| PATCH | `/protocols/:id/payment` | Admin, Gerente, Membro | web | sim |
| GET | `/protocols/:id/receipt` | Admin, Gerente, Membro | web | sim |
| POST | `/protocols/:id/replace` | Admin, Gerente, Membro | web | sim |
| GET | `/protocols/summary` | Admin, Gerente, Membro | web | sim |
| GET | `/protocols/unpaid` | Admin, Gerente, Membro | web | sim |
| GET | `/protocols/unpaid/summary` | Admin, Gerente, Membro | web | sim |

### /recurring-templates

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/recurring-templates` | Admin, Gerente, Membro | web | sim |
| POST | `/recurring-templates` | Admin | web | sim |
| DELETE | `/recurring-templates/:id` | Admin | web | **não** |
| GET | `/recurring-templates/:id` | Admin, Gerente | web | sim |
| PATCH | `/recurring-templates/:id` | Admin | web | sim |
| GET | `/recurring-templates/:id/assignments` | Admin, Gerente | web | sim |
| POST | `/recurring-templates/:id/assignments` | Admin | web | **não** |
| DELETE | `/recurring-templates/:id/assignments/:assignmentId` | Admin | web | **não** |
| PATCH | `/recurring-templates/:id/assignments/:assignmentId` | Admin | web (indireto) | **não** |
| POST | `/recurring-templates/:id/assignments/bulk-generate` | Admin | web | **não** |
| POST | `/recurring-templates/:id/assignments/bulk-regenerate` | Admin | web | **não** |
| GET | `/recurring-templates/:id/generation-log` | Admin, Gerente | web | **não** |
| POST | `/recurring-templates/bulk-generate` | Admin | web | **não** |
| GET | `/recurring-templates/failed-generations` | Admin, Gerente | web | sim |

### /request-comments

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| DELETE | `/request-comments/:id` | Admin, Gerente, Membro, Cliente | web (indireto) | sim |

### /requests

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/requests` | Admin, Gerente, Membro | web | sim |
| GET | `/requests/:id` | Admin, Gerente, Membro | web | sim |
| POST | `/requests/:id/approve` | Admin, Gerente, Membro | web | sim |
| POST | `/requests/:id/cancel` | Admin, Gerente | web | sim |
| POST | `/requests/:id/needs-info` | Admin, Gerente, Membro | web | sim |
| POST | `/requests/:id/reject` | Admin, Gerente, Membro | web | sim |
| GET | `/requests/:requestId/comments` | Admin, Gerente, Membro, Cliente | web | sim |
| POST | `/requests/:requestId/comments` | Admin, Gerente, Membro, Cliente | web (indireto) | sim |
| GET | `/requests/pending-count` | Admin, Gerente, Membro | web | sim |
| GET | `/requests/stream` | token próprio (ticket/webhook) | web (indireto) | sim |

### /sla

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/sla/config` | Admin, Gerente, Membro | web | sim |
| GET | `/sla/custom-sound-url` | Admin, Gerente, Membro | web | **não** |
| GET | `/sla/preferences` | Admin, Gerente, Membro | web | sim |
| PATCH | `/sla/preferences` | Admin, Gerente, Membro | web | sim |

### /stream

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| POST | `/stream/ticket` | Admin, Gerente, Membro, Cliente, Master | web | sim |

### /tasks

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/tasks` | Admin, Gerente, Membro | web | sim |
| DELETE | `/tasks/:id` | Admin, Gerente | web (indireto) | sim |
| PATCH | `/tasks/:id` | Admin, Gerente, Membro | web | sim |
| GET | `/tasks/:id/approvals` | Admin, Gerente, Membro | web | **não** |
| POST | `/tasks/:id/approvals` | Admin, Gerente, Membro | web | sim |
| POST | `/tasks/:id/assume` | Admin, Gerente, Membro | web | sim |
| GET | `/tasks/:id/attachments` | Admin, Gerente, Membro, Cliente | web | sim |
| POST | `/tasks/:id/attachments` | Admin, Gerente, Membro, Cliente | web | sim |
| DELETE | `/tasks/:id/attachments/:attachmentId` | Admin, Gerente, Membro, Cliente | web | sim |
| PATCH | `/tasks/:id/delay-reason` | Admin, Gerente, Membro | web | sim |
| GET | `/tasks/:id/documents` | Admin, Gerente, Membro | web (indireto) | **não** |
| POST | `/tasks/:id/documents/deliveries` | Admin, Gerente, Membro | web | sim |
| POST | `/tasks/:id/documents/deliveries/:reqId/check` | Admin, Gerente, Membro | web | **não** |
| POST | `/tasks/:id/documents/deliveries/:reqId/upload` | Admin, Gerente, Membro | web | sim |
| POST | `/tasks/:id/documents/requests` | Admin, Gerente, Membro | web | **não** |
| PATCH | `/tasks/:id/documents/requests/:reqId` | Admin, Gerente, Membro | web | sim |
| POST | `/tasks/:id/documents/requests/:reqId/upload` | Admin, Gerente, Membro | web (indireto) | **não** |
| GET | `/tasks/:id/history` | Admin, Gerente, Membro | web (indireto) | **não** |
| PATCH | `/tasks/:id/move` | Admin, Gerente, Membro | web | sim |
| POST | `/tasks/:id/regenerate` | Admin | web | **não** |
| POST | `/tasks/:id/release` | Admin, Gerente, Membro | web | sim |
| GET | `/tasks/:taskId/comments` | Admin, Gerente, Membro, Cliente | web (indireto) | sim |
| POST | `/tasks/:taskId/comments` | Admin, Gerente, Membro, Cliente | web (indireto) | sim |
| GET | `/tasks/:taskId/protocols` | Admin, Gerente, Membro | web | **não** |
| POST | `/tasks/:taskId/protocols` | Admin, Gerente, Membro | web | sim |
| POST | `/tasks/assume-bulk` | Admin, Gerente, Membro | web | sim |

### /users

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| GET | `/users` | Admin | web | sim |
| POST | `/users` | Admin | web | sim |
| DELETE | `/users/:id` | Admin | web | **não** |
| PATCH | `/users/:id` | Admin | web | sim |
| GET | `/users/:id/portfolio` | Admin | web | sim |
| POST | `/users/:id/reactivate` | Admin | web | sim |
| POST | `/users/:id/reset-password` | Admin | web | sim |
| POST | `/users/:id/transfer` | Admin | web | sim |
| GET | `/users/me` | Admin, Gerente, Membro, Cliente, Master | web | sim |
| PATCH | `/users/me` | Admin, Gerente, Membro, Cliente, Master | web (indireto) | **não** |
| GET | `/users/options` | Admin, Gerente, Membro | web | sim |

### /webhooks

| Método | Rota | Quem passa | Usada por | Teste de rota |
|---|---|---|---|---|
| POST | `/webhooks/asaas` | token próprio (ticket/webhook) | Asaas (webhook) | sim |
