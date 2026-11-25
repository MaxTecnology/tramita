# Tramita API

- **OpenAPI Version:** `3.2.0`
- **API Version:** `1.0.0`

API do Tramita (AutoHubs): processos, ordens de serviço, tarefas e portal do cliente de escritórios contábeis. Toda rota privada usa `Authorization: Bearer <accessToken>` (JWT RS256, 15 min; renove em POST /auth/refresh). Erros sempre como `{ "message": "..." }` em pt-BR. Multi-tenant: tudo é filtrado pela organização do token.

## Contents

**Operations**

- [POST /auth/login](#scalar-operation-post-authlogin)
- [POST /auth/refresh](#scalar-operation-post-authrefresh)
- [POST /auth/logout](#scalar-operation-post-authlogout)
- [POST /auth/change-password](#scalar-operation-post-authchange-password)
- [GET /auth/me](#scalar-operation-get-authme)
- [PATCH /auth/me](#scalar-operation-patch-authme)
- [GET /master/plans](#scalar-operation-get-masterplans)
- [POST /master/plans](#scalar-operation-post-masterplans)
- [PATCH /master/plans/{id}](#scalar-operation-patch-masterplansid)
- [DELETE /master/plans/{id}](#scalar-operation-delete-masterplansid)
- [GET /master/organizations](#scalar-operation-get-masterorganizations)
- [POST /master/organizations](#scalar-operation-post-masterorganizations)
- [GET /master/organizations/{id}](#scalar-operation-get-masterorganizationsid)
- [PATCH /master/organizations/{id}](#scalar-operation-patch-masterorganizationsid)
- [POST /master/organizations/{orgId}/users/{userId}/reset-password](#scalar-operation-post-masterorganizationsorgidusersuseridreset-password)
- [GET /master/revenue](#scalar-operation-get-masterrevenue)
- [GET /organizations/plans](#scalar-operation-get-organizationsplans)
- [GET /organizations/signup-status](#scalar-operation-get-organizationssignup-status)
- [POST /organizations/register](#scalar-operation-post-organizationsregister)
- [GET /org/subscription](#scalar-operation-get-orgsubscription)
- [POST /org/subscription/change-plan](#scalar-operation-post-orgsubscriptionchange-plan)
- [POST /webhooks/asaas](#scalar-operation-post-webhooksasaas)
- [GET /users/me](#scalar-operation-get-usersme)
- [PATCH /users/me](#scalar-operation-patch-usersme)
- [GET /users/options](#scalar-operation-get-usersoptions)
- [GET /users](#scalar-operation-get-users)
- [POST /users](#scalar-operation-post-users)
- [POST /users/{id}/reactivate](#scalar-operation-post-usersidreactivate)
- [PATCH /users/{id}](#scalar-operation-patch-usersid)
- [DELETE /users/{id}](#scalar-operation-delete-usersid)
- [POST /users/{id}/reset-password](#scalar-operation-post-usersidreset-password)
- [GET /users/{id}/portfolio](#scalar-operation-get-usersidportfolio)
- [POST /users/{id}/transfer](#scalar-operation-post-usersidtransfer)
- [GET /clients](#scalar-operation-get-clients)
- [POST /clients](#scalar-operation-post-clients)
- [GET /clients/lookup-cnpj/{cnpj}](#scalar-operation-get-clientslookup-cnpjcnpj)
- [GET /clients/search-users](#scalar-operation-get-clientssearch-users)
- [DELETE /clients/{id}](#scalar-operation-delete-clientsid)
- [PATCH /clients/{id}](#scalar-operation-patch-clientsid)
- [POST /clients/{id}/reactivate](#scalar-operation-post-clientsidreactivate)
- [GET /clients/{id}/users](#scalar-operation-get-clientsidusers)
- [GET /clients/{id}/assignments](#scalar-operation-get-clientsidassignments)
- [GET /boards](#scalar-operation-get-boards)
- [POST /boards](#scalar-operation-post-boards)
- [GET /boards/{id}](#scalar-operation-get-boardsid)
- [PATCH /boards/{id}](#scalar-operation-patch-boardsid)
- [GET /boards/{id}/tasks/search](#scalar-operation-get-boardsidtaskssearch)
- [POST /columns/{columnId}/tasks](#scalar-operation-post-columnscolumnidtasks)
- [GET /tasks](#scalar-operation-get-tasks)
- [POST /tasks/assume-bulk](#scalar-operation-post-tasksassume-bulk)
- [POST /tasks/{id}/assume](#scalar-operation-post-tasksidassume)
- [PATCH /tasks/{id}/move](#scalar-operation-patch-tasksidmove)
- [DELETE /tasks/{id}](#scalar-operation-delete-tasksid)
- [PATCH /tasks/{id}](#scalar-operation-patch-tasksid)
- [GET /tasks/{id}/history](#scalar-operation-get-tasksidhistory)
- [POST /tasks/{id}/regenerate](#scalar-operation-post-tasksidregenerate)
- [GET /tasks/{taskId}/comments](#scalar-operation-get-taskstaskidcomments)
- [POST /tasks/{taskId}/comments](#scalar-operation-post-taskstaskidcomments)
- [DELETE /comments/{id}](#scalar-operation-delete-commentsid)
- [GET /notifications/config](#scalar-operation-get-notificationsconfig)
- [PATCH /notifications/config](#scalar-operation-patch-notificationsconfig)
- [POST /notifications/config/test-whatsapp](#scalar-operation-post-notificationsconfigtest-whatsapp)
- [POST /notifications/config/test-email](#scalar-operation-post-notificationsconfigtest-email)
- [POST /notifications/templates/preview](#scalar-operation-post-notificationstemplatespreview)
- [GET /notifications/templates/{event}/{channel}](#scalar-operation-get-notificationstemplateseventchannel)
- [PUT /notifications/templates/{event}/{channel}](#scalar-operation-put-notificationstemplateseventchannel)
- [DELETE /notifications/templates/{event}/{channel}](#scalar-operation-delete-notificationstemplateseventchannel)
- [POST /notifications/config/sla-sound](#scalar-operation-post-notificationsconfigsla-sound)
- [DELETE /notifications/config/sla-sound](#scalar-operation-delete-notificationsconfigsla-sound)
- [GET /notifications/logs](#scalar-operation-get-notificationslogs)
- [GET /portal/clients](#scalar-operation-get-portalclients)
- [GET /portal/tasks/{taskId}/history](#scalar-operation-get-portaltaskstaskidhistory)
- [GET /portal/tasks/{taskId}/documents](#scalar-operation-get-portaltaskstaskiddocuments)
- [POST /portal/tasks/{taskId}/documents/requests/{reqId}/upload](#scalar-operation-post-portaltaskstaskiddocumentsrequestsreqidupload)
- [GET /portal/departments](#scalar-operation-get-portaldepartments)
- [GET /portal/services](#scalar-operation-get-portalservices)
- [POST /portal/requests](#scalar-operation-post-portalrequests)
- [GET /portal/requests](#scalar-operation-get-portalrequests)
- [GET /portal/requests/{id}](#scalar-operation-get-portalrequestsid)
- [PATCH /portal/requests/{id}/cancel](#scalar-operation-patch-portalrequestsidcancel)
- [POST /portal/requests/{id}/attachments](#scalar-operation-post-portalrequestsidattachments)
- [GET /portal/home](#scalar-operation-get-portalhome)
- [GET /portal/document-requests/months](#scalar-operation-get-portaldocument-requestsmonths)
- [GET /portal/document-requests](#scalar-operation-get-portaldocument-requests)
- [POST /portal/tasks/{taskId}/documents/requests/{reqId}/not-applicable](#scalar-operation-post-portaltaskstaskiddocumentsrequestsreqidnot-applicable)
- [DELETE /portal/tasks/{taskId}/documents/requests/{reqId}/not-applicable](#scalar-operation-delete-portaltaskstaskiddocumentsrequestsreqidnot-applicable)
- [GET /portal/protocols](#scalar-operation-get-portalprotocols)
- [POST /portal/protocols/{id}/pay](#scalar-operation-post-portalprotocolsidpay)
- [DELETE /portal/protocols/{id}/pay](#scalar-operation-delete-portalprotocolsidpay)
- [GET /portal/protocols/{id}](#scalar-operation-get-portalprotocolsid)
- [GET /portal/protocols/{id}/download](#scalar-operation-get-portalprotocolsiddownload)
- [POST /stream/ticket](#scalar-operation-post-streamticket)
- [GET /notifications/stream](#scalar-operation-get-notificationsstream)
- [GET /boards/{id}/stream](#scalar-operation-get-boardsidstream)
- [POST /tasks/{id}/attachments](#scalar-operation-post-tasksidattachments)
- [GET /tasks/{id}/attachments](#scalar-operation-get-tasksidattachments)
- [DELETE /tasks/{id}/attachments/{attachmentId}](#scalar-operation-delete-tasksidattachmentsattachmentid)
- [GET /tasks/{id}/documents](#scalar-operation-get-tasksiddocuments)
- [POST /tasks/{id}/documents/requests](#scalar-operation-post-tasksiddocumentsrequests)
- [POST /tasks/{id}/documents/deliveries](#scalar-operation-post-tasksiddocumentsdeliveries)
- [PATCH /tasks/{id}/documents/requests/{reqId}](#scalar-operation-patch-tasksiddocumentsrequestsreqid)
- [POST /tasks/{id}/documents/deliveries/{reqId}/upload](#scalar-operation-post-tasksiddocumentsdeliveriesreqidupload)
- [POST /tasks/{id}/documents/deliveries/{reqId}/check](#scalar-operation-post-tasksiddocumentsdeliveriesreqidcheck)
- [POST /tasks/{id}/documents/requests/{reqId}/upload](#scalar-operation-post-tasksiddocumentsrequestsreqidupload)
- [GET /requests/stream](#scalar-operation-get-requestsstream)
- [GET /requests](#scalar-operation-get-requests)
- [GET /requests/pending-count](#scalar-operation-get-requestspending-count)
- [GET /requests/{id}](#scalar-operation-get-requestsid)
- [POST /requests/{id}/approve](#scalar-operation-post-requestsidapprove)
- [POST /requests/{id}/reject](#scalar-operation-post-requestsidreject)
- [POST /requests/{id}/needs-info](#scalar-operation-post-requestsidneeds-info)
- [POST /requests/{id}/cancel](#scalar-operation-post-requestsidcancel)
- [GET /requests/{requestId}/comments](#scalar-operation-get-requestsrequestidcomments)
- [POST /requests/{requestId}/comments](#scalar-operation-post-requestsrequestidcomments)
- [DELETE /request-comments/{id}](#scalar-operation-delete-request-commentsid)
- [POST /tasks/{taskId}/protocols](#scalar-operation-post-taskstaskidprotocols)
- [GET /tasks/{taskId}/protocols](#scalar-operation-get-taskstaskidprotocols)
- [GET /protocols/summary](#scalar-operation-get-protocolssummary)
- [GET /protocols/unpaid/summary](#scalar-operation-get-protocolsunpaidsummary)
- [GET /protocols/unpaid](#scalar-operation-get-protocolsunpaid)
- [GET /protocols](#scalar-operation-get-protocols)
- [GET /protocols/{id}](#scalar-operation-get-protocolsid)
- [POST /protocols/{id}/replace](#scalar-operation-post-protocolsidreplace)
- [PATCH /protocols/{id}/payment](#scalar-operation-patch-protocolsidpayment)
- [POST /protocols/{id}/cancel](#scalar-operation-post-protocolsidcancel)
- [GET /protocols/{id}/receipt](#scalar-operation-get-protocolsidreceipt)
- [GET /dashboard/metrics](#scalar-operation-get-dashboardmetrics)
- [GET /dashboard/team-members](#scalar-operation-get-dashboardteam-members)
- [GET /dashboard/productivity](#scalar-operation-get-dashboardproductivity)
- [GET /departments](#scalar-operation-get-departments)
- [POST /departments](#scalar-operation-post-departments)
- [PATCH /departments/{id}](#scalar-operation-patch-departmentsid)
- [DELETE /departments/{id}](#scalar-operation-delete-departmentsid)
- [GET /holidays](#scalar-operation-get-holidays)
- [POST /holidays](#scalar-operation-post-holidays)
- [GET /holidays/days](#scalar-operation-get-holidaysdays)
- [DELETE /holidays/{id}](#scalar-operation-delete-holidaysid)
- [GET /municipalities](#scalar-operation-get-municipalities)
- [GET /os-models](#scalar-operation-get-os-models)
- [POST /os-models](#scalar-operation-post-os-models)
- [GET /os-models/{id}](#scalar-operation-get-os-modelsid)
- [DELETE /os-models/{id}](#scalar-operation-delete-os-modelsid)
- [PATCH /os-models/{id}](#scalar-operation-patch-os-modelsid)
- [GET /boards/{id}/stage-times](#scalar-operation-get-boardsidstage-times)
- [GET /dashboard/os](#scalar-operation-get-dashboardos)
- [GET /os](#scalar-operation-get-os)
- [POST /os](#scalar-operation-post-os)
- [POST /boards/{id}/os](#scalar-operation-post-boardsidos)
- [POST /tasks/{id}/release](#scalar-operation-post-tasksidrelease)
- [GET /delay-reasons](#scalar-operation-get-delay-reasons)
- [POST /delay-reasons](#scalar-operation-post-delay-reasons)
- [PATCH /delay-reasons/{id}](#scalar-operation-patch-delay-reasonsid)
- [DELETE /delay-reasons/{id}](#scalar-operation-delete-delay-reasonsid)
- [PATCH /tasks/{id}/delay-reason](#scalar-operation-patch-tasksiddelay-reason)
- [PATCH /boards/{id}/delay-reason](#scalar-operation-patch-boardsiddelay-reason)
- [GET /recurring-templates](#scalar-operation-get-recurring-templates)
- [POST /recurring-templates](#scalar-operation-post-recurring-templates)
- [GET /recurring-templates/failed-generations](#scalar-operation-get-recurring-templatesfailed-generations)
- [GET /recurring-templates/{id}](#scalar-operation-get-recurring-templatesid)
- [DELETE /recurring-templates/{id}](#scalar-operation-delete-recurring-templatesid)
- [PATCH /recurring-templates/{id}](#scalar-operation-patch-recurring-templatesid)
- [GET /recurring-templates/{id}/assignments](#scalar-operation-get-recurring-templatesidassignments)
- [POST /recurring-templates/{id}/assignments](#scalar-operation-post-recurring-templatesidassignments)
- [GET /recurring-templates/{id}/generation-log](#scalar-operation-get-recurring-templatesidgeneration-log)
- [PATCH /recurring-templates/{id}/assignments/{assignmentId}](#scalar-operation-patch-recurring-templatesidassignmentsassignmentid)
- [DELETE /recurring-templates/{id}/assignments/{assignmentId}](#scalar-operation-delete-recurring-templatesidassignmentsassignmentid)
- [POST /recurring-templates/{id}/assignments/bulk-generate](#scalar-operation-post-recurring-templatesidassignmentsbulk-generate)
- [POST /recurring-templates/{id}/assignments/bulk-regenerate](#scalar-operation-post-recurring-templatesidassignmentsbulk-regenerate)
- [POST /recurring-templates/bulk-generate](#scalar-operation-post-recurring-templatesbulk-generate)
- [GET /client-users](#scalar-operation-get-client-users)
- [POST /client-users](#scalar-operation-post-client-users)
- [GET /client-users/{id}](#scalar-operation-get-client-usersid)
- [PATCH /client-users/{id}](#scalar-operation-patch-client-usersid)
- [DELETE /client-users/{id}](#scalar-operation-delete-client-usersid)
- [GET /process-templates](#scalar-operation-get-process-templates)
- [POST /process-templates](#scalar-operation-post-process-templates)
- [GET /process-templates/{id}](#scalar-operation-get-process-templatesid)
- [DELETE /process-templates/{id}](#scalar-operation-delete-process-templatesid)
- [PATCH /process-templates/{id}](#scalar-operation-patch-process-templatesid)
- [GET /sla/config](#scalar-operation-get-slaconfig)
- [GET /sla/custom-sound-url](#scalar-operation-get-slacustom-sound-url)
- [GET /sla/preferences](#scalar-operation-get-slapreferences)
- [PATCH /sla/preferences](#scalar-operation-patch-slapreferences)
- [POST /document-reader/upload](#scalar-operation-post-document-readerupload)
- [GET /document-reader/fila](#scalar-operation-get-document-readerfila)
- [GET /document-reader/{id}/visualizar](#scalar-operation-get-document-readeridvisualizar)
- [GET /document-reader/rejeitados](#scalar-operation-get-document-readerrejeitados)
- [GET /document-reader/obrigacoes](#scalar-operation-get-document-readerobrigacoes)
- [POST /document-reader/obrigacoes](#scalar-operation-post-document-readerobrigacoes)
- [GET /document-reader/metricas](#scalar-operation-get-document-readermetricas)
- [POST /document-reader/confirmar-lote](#scalar-operation-post-document-readerconfirmar-lote)
- [POST /document-reader/{id}/confirmar](#scalar-operation-post-document-readeridconfirmar)
- [POST /document-reader/{id}/trocar-tarefa](#scalar-operation-post-document-readeridtrocar-tarefa)
- [POST /document-reader/{id}/rejeitar](#scalar-operation-post-document-readeridrejeitar)
- [POST /document-reader/{id}/reabrir](#scalar-operation-post-document-readeridreabrir)
- [GET /notifications](#scalar-operation-get-notifications)
- [GET /notifications/unread-count](#scalar-operation-get-notificationsunread-count)
- [POST /notifications/read-all](#scalar-operation-post-notificationsread-all)
- [POST /notifications/read-by-task](#scalar-operation-post-notificationsread-by-task)
- [POST /notifications/{id}/read](#scalar-operation-post-notificationsidread)
- [POST /notifications/{id}/unread](#scalar-operation-post-notificationsidunread)
- [GET /tasks/{id}/approvals](#scalar-operation-get-tasksidapprovals)
- [POST /tasks/{id}/approvals](#scalar-operation-post-tasksidapprovals)
- [POST /approvals/{id}/close](#scalar-operation-post-approvalsidclose)
- [POST /portal/approvals/{id}/approve](#scalar-operation-post-portalapprovalsidapprove)
- [POST /portal/approvals/{id}/request-changes](#scalar-operation-post-portalapprovalsidrequest-changes)
- [POST /document-reader/modelos/analisar](#scalar-operation-post-document-readermodelosanalisar)
- [GET /document-reader/modelos](#scalar-operation-get-document-readermodelos)
- [POST /document-reader/modelos](#scalar-operation-post-document-readermodelos)
- [POST /document-reader/modelos/verificar-colisao](#scalar-operation-post-document-readermodelosverificar-colisao)
- [PATCH /document-reader/modelos/{id}](#scalar-operation-patch-document-readermodelosid)
- [DELETE /document-reader/modelos/{id}](#scalar-operation-delete-document-readermodelosid)

<a id="scalar-context-global-servers"></a>

## Servers

- **URL:** `https://tramitaapi.autohubs.com.br`
  - **Description:** Produção
- **URL:** `http://localhost:3000`
  - **Description:** Local

## Operations

<a id="scalar-operation-post-authlogin"></a>

### Entrar com e-mail e senha

- **Method:** `POST`
- **Path:** `/auth/login`
- **Tags:** Autenticação

Devolve `accessToken` (15 min) e `refreshToken`. Depois de 10 tentativas erradas (configurável) numa janela de 15 minutos, a conta fica bloqueada até a janela acabar.

**Quem pode:** público

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

No authentication required.

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`email` (required)**: `string`, format: `email`
- **`password` (required)**: `string`, minLength: `1`

<a id="scalar-example-1"></a>

**Generated example:**

```json
{
  "email": "hello@example.com",
  "password": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-authrefresh"></a>

### Renovar a sessão

- **Method:** `POST`
- **Path:** `/auth/refresh`
- **Tags:** Autenticação

Troca o `refreshToken` por um novo par de tokens. Recusa a sessão de usuário desativado ou com papel alterado.

**Quem pode:** público

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

No authentication required.

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`refreshToken` (required)**: `string`, minLength: `1`

<a id="scalar-example-2"></a>

**Generated example:**

```json
{
  "refreshToken": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-authlogout"></a>

### Sair

- **Method:** `POST`
- **Path:** `/auth/logout`
- **Tags:** Autenticação

Invalida o `refreshToken` informado.

**Quem pode:** público

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

No authentication required.

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`refreshToken` (required)**: `string`, minLength: `1`

<a id="scalar-example-3"></a>

**Generated example:**

```json
{
  "refreshToken": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-authchange-password"></a>

### Trocar a própria senha

- **Method:** `POST`
- **Path:** `/auth/change-password`
- **Tags:** Autenticação

Encerra as outras sessões do usuário.

**Quem pode:** Admin, Gerente, Membro, Cliente, Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`currentPassword` (required)**: `string`, minLength: `1`
- **`newPassword` (required)**: `string`, minLength: `8`
- **`keepRefreshToken`**: `string`, format: `uuid`

<a id="scalar-example-4"></a>

**Generated example:**

```json
{
  "currentPassword": "",
  "newPassword": "",
  "keepRefreshToken": "123e4567-e89b-12d3-a456-426614174000"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-authme"></a>

### Perfil de quem está logado

- **Method:** `GET`
- **Path:** `/auth/me`
- **Tags:** Autenticação

**Quem pode:** Admin, Gerente, Membro, Cliente, Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-authme"></a>

### Atualizar o próprio perfil

- **Method:** `PATCH`
- **Path:** `/auth/me`
- **Tags:** Autenticação

**Quem pode:** Admin, Gerente, Membro, Cliente, Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`name`**: `string`, minLength: `2`
- **`phone`**: `string`

<a id="scalar-example-5"></a>

**Generated example:**

```json
{
  "name": "",
  "phone": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-masterplans"></a>

### Listar planos

- **Method:** `GET`
- **Path:** `/master/plans`
- **Tags:** Master (AutoHubs)

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-masterplans"></a>

### Criar plano

- **Method:** `POST`
- **Path:** `/master/plans`
- **Tags:** Master (AutoHubs)

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`maxClients` (required)**: `integer`, exclusiveMinimum: `0`
- **`name` (required)**: `string`, minLength: `1`
- **`priceMonthly` (required)**: `number`, exclusiveMinimum: `0`
- **`features`**: `object`, default: `{}`

  **Additional properties:**

  `boolean`

<a id="scalar-example-6"></a>

**Generated example:**

```json
{
  "name": "",
  "maxClients": 1,
  "priceMonthly": 1,
  "features": {}
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-masterplansid"></a>

### Alterar plano

- **Method:** `PATCH`
- **Path:** `/master/plans/{id}`
- **Tags:** Master (AutoHubs)

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`features`**: `object`, default: `{}`

  **Additional properties:**

  `boolean`
- **`maxClients`**: `integer`, exclusiveMinimum: `0`
- **`name`**: `string`, minLength: `1`
- **`priceMonthly`**: `number`, exclusiveMinimum: `0`

<a id="scalar-example-7"></a>

**Generated example:**

```json
{
  "name": "",
  "maxClients": 1,
  "priceMonthly": 1,
  "features": {}
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-masterplansid"></a>

### Desativar plano

- **Method:** `DELETE`
- **Path:** `/master/plans/{id}`
- **Tags:** Master (AutoHubs)

Exclusão lógica: escritórios no plano continuam nele.

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-masterorganizations"></a>

### Listar escritórios

- **Method:** `GET`
- **Path:** `/master/organizations`
- **Tags:** Master (AutoHubs)

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-masterorganizations"></a>

### Cadastrar escritório pelo painel master

- **Method:** `POST`
- **Path:** `/master/organizations`
- **Tags:** Master (AutoHubs)

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`adminName` (required)**: `string`, minLength: `2`
- **`createAsaasSubscription` (required)**: `boolean`
- **`email` (required)**: `string`, format: `email`
- **`name` (required)**: `string`, minLength: `2`
- **`planId` (required)**: `string`, minLength: `1`
- **`cnpj`**: `string`
- **`manualNextDueDate`**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`
- **`phone`**: `string`

<a id="scalar-example-8"></a>

**Generated example:**

```json
{
  "name": "",
  "email": "hello@example.com",
  "phone": "",
  "cnpj": "",
  "planId": "",
  "adminName": "",
  "createAsaasSubscription": true,
  "manualNextDueDate": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-masterorganizationsid"></a>

### Detalhe do escritório

- **Method:** `GET`
- **Path:** `/master/organizations/{id}`
- **Tags:** Master (AutoHubs)

Assinatura, plano, uso e usuários.

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-masterorganizationsid"></a>

### Alterar escritório

- **Method:** `PATCH`
- **Path:** `/master/organizations/{id}`
- **Tags:** Master (AutoHubs)

Plano, situação da assinatura e modo de cobrança (Asaas ou manual).

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`manualNextDueDate`**: `string | null`, pattern: `^\d{4}-\d{2}-\d{2}$`
- **`planId`**: `string`
- **`subscriptionStatus`**: `string`, possible values: `"ACTIVE", "SUSPENDED", "CANCELLED", "GRACE_PERIOD", "TRIAL"`

<a id="scalar-example-9"></a>

**Generated example:**

```json
{
  "planId": "",
  "subscriptionStatus": "ACTIVE",
  "manualNextDueDate": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-masterorganizationsorgidusersuseridreset-password"></a>

### Gerar senha provisória para usuário de um escritório

- **Method:** `POST`
- **Path:** `/master/organizations/{orgId}/users/{userId}/reset-password`
- **Tags:** Master (AutoHubs)

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`orgId` (required)**: `string`
- **`userId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-masterrevenue"></a>

### Receita e assinaturas da AutoHubs

- **Method:** `GET`
- **Path:** `/master/revenue`
- **Tags:** Master (AutoHubs)

**Quem pode:** Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-organizationsplans"></a>

### Planos à venda (página pública de cadastro)

- **Method:** `GET`
- **Path:** `/organizations/plans`
- **Tags:** Cadastro público

**Quem pode:** público

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

No authentication required.

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-organizationssignup-status"></a>

### Se o cadastro público está aberto

- **Method:** `GET`
- **Path:** `/organizations/signup-status`
- **Tags:** Cadastro público

**Quem pode:** público

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

No authentication required.

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-organizationsregister"></a>

### Cadastrar escritório (autoatendimento)

- **Method:** `POST`
- **Path:** `/organizations/register`
- **Tags:** Cadastro público

Cria o escritório, o administrador e a assinatura no Asaas. Pode estar fechado (veja GET /organizations/signup-status).

**Quem pode:** público

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

No authentication required.

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`adminName` (required)**: `string`, minLength: `2`
- **`adminPassword` (required)**: `string`, minLength: `8`
- **`email` (required)**: `string`, format: `email`
- **`name` (required)**: `string`, minLength: `2`
- **`planId` (required)**: `string`, minLength: `1`
- **`cnpj`**: `string`
- **`phone`**: `string`

<a id="scalar-example-10"></a>

**Generated example:**

```json
{
  "name": "",
  "cnpj": "",
  "email": "hello@example.com",
  "phone": "",
  "adminName": "",
  "adminPassword": "",
  "planId": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-orgsubscription"></a>

### Assinatura do escritório

- **Method:** `GET`
- **Path:** `/org/subscription`
- **Tags:** Organização

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-orgsubscriptionchange-plan"></a>

### Trocar de plano

- **Method:** `POST`
- **Path:** `/org/subscription/change-plan`
- **Tags:** Organização

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`planId` (required)**: `string`, minLength: `1`

<a id="scalar-example-11"></a>

**Generated example:**

```json
{
  "planId": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-webhooksasaas"></a>

### Eventos de cobrança do Asaas

- **Method:** `POST`
- **Path:** `/webhooks/asaas`
- **Tags:** Webhooks

Chamado pelo Asaas com o token no header `asaas-access-token`. Atualiza a situação da assinatura; o mesmo evento repetido é ignorado.

**Quem pode:** quem tem a credencial própria da rota (veja Autenticação)

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **asaasToken**: API key in header `asaas-access-token`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-usersme"></a>

### Meu usuário

- **Method:** `GET`
- **Path:** `/users/me`
- **Tags:** Usuários

Papel, departamentos e o que posso ver. Serve a equipe e o cliente do portal.

**Quem pode:** Admin, Gerente, Membro, Cliente, Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-usersme"></a>

### Atualizar meu usuário

- **Method:** `PATCH`
- **Path:** `/users/me`
- **Tags:** Usuários

**Quem pode:** Admin, Gerente, Membro, Cliente, Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`name`**: `string`, minLength: `2`
- **`phone`**: `string | null`

<a id="scalar-example-12"></a>

**Generated example:**

```json
{
  "name": "",
  "phone": null
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-usersoptions"></a>

### Pessoas para escolher como responsável

- **Method:** `GET`
- **Path:** `/users/options`
- **Tags:** Usuários

Nome e departamentos de cada pessoa ativa da equipe.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-users"></a>

### Listar a equipe

- **Method:** `GET`
- **Path:** `/users`
- **Tags:** Usuários

Ativos por padrão; `status=inactive` lista os desativados (para reativar).

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`status`**: `string`, possible values: `"active", "inactive"`, default: `"active"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-users"></a>

### Cadastrar pessoa da equipe

- **Method:** `POST`
- **Path:** `/users`
- **Tags:** Usuários

A senha é gerada pelo servidor e volta uma única vez em `temporaryPassword`.

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`email` (required)**: `string`, format: `email`
- **`name` (required)**: `string`, minLength: `2`
- **`role` (required)**: `string`, possible values: `"ORG_MANAGER", "ORG_MEMBER"`
- **`departmentIds`**: `array`

  **Items:**

  `string`, pattern: `^[cC][^\s-]{8,}$`
- **`phone`**: `string`
- **`seesDepartmentWork`**: `boolean`

<a id="scalar-example-13"></a>

**Generated example:**

```json
{
  "name": "",
  "email": "hello@example.com",
  "role": "ORG_MANAGER",
  "phone": "",
  "departmentIds": [
    ""
  ],
  "seesDepartmentWork": true
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-usersidreactivate"></a>

### Reativar pessoa desativada

- **Method:** `POST`
- **Path:** `/users/{id}/reactivate`
- **Tags:** Usuários

Volta com os mesmos departamentos. 409 se já estiver ativa.

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-usersid"></a>

### Alterar pessoa da equipe

- **Method:** `PATCH`
- **Path:** `/users/{id}`
- **Tags:** Usuários

Mudar papel ou desativar encerra as sessões dela.

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`departmentIds`**: `array`, minItems: `1`

  **Items:**

  `string`, pattern: `^[cC][^\s-]{8,}$`
- **`email`**: `string`, format: `email`
- **`name`**: `string`, minLength: `2`
- **`phone`**: `string | null`
- **`role`**: `string`, possible values: `"ORG_MANAGER", "ORG_MEMBER"`
- **`seesDepartmentWork`**: `boolean`

<a id="scalar-example-14"></a>

**Generated example:**

```json
{
  "name": "",
  "email": "hello@example.com",
  "role": "ORG_MANAGER",
  "phone": null,
  "departmentIds": [
    ""
  ],
  "seesDepartmentWork": true
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-usersid"></a>

### Remover pessoa da equipe

- **Method:** `DELETE`
- **Path:** `/users/{id}`
- **Tags:** Usuários

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-usersidreset-password"></a>

### Gerar senha provisória

- **Method:** `POST`
- **Path:** `/users/{id}/reset-password`
- **Tags:** Usuários

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-usersidportfolio"></a>

### Carteira da pessoa

- **Method:** `GET`
- **Path:** `/users/{id}/portfolio`
- **Tags:** Usuários

Clientes, tarefas e recorrências pelas quais ela responde — usado antes de transferir.

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Query parameters

- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-usersidtransfer"></a>

### Transferir responsabilidades para outra pessoa

- **Method:** `POST`
- **Path:** `/users/{id}/transfer`
- **Tags:** Usuários

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`clientIds` (required)**: `array`, minItems: `1`

  **Items:**

  `string`, pattern: `^[cC][^\s-]{8,}$`
- **`toUserId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`includeBoards`**: `boolean`, default: `true`
- **`includeTasks`**: `boolean`, default: `true`

<a id="scalar-example-15"></a>

**Generated example:**

```json
{
  "toUserId": "",
  "clientIds": [
    ""
  ],
  "departmentId": "",
  "includeBoards": true,
  "includeTasks": true
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-clients"></a>

### Listar clientes do escritório

- **Method:** `GET`
- **Path:** `/clients`
- **Tags:** Clientes

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-clients"></a>

### Cadastrar cliente

- **Method:** `POST`
- **Path:** `/clients`
- **Tags:** Clientes

Respeita o limite de clientes do plano.

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`clientUsers` (required)**: `array`, minItems: `1`

  **Items:**

  **Any of:**
  - `object`, no additional properties
    - **`departmentIds` (required)**: `array`, minItems: `1`

      **Items:**

      `string`, pattern: `^[cC][^\s-]{8,}$`
    - **`existingId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - `object`, no additional properties
    - **`departmentIds` (required)**: `array`, minItems: `1`

      **Items:**

      `string`, pattern: `^[cC][^\s-]{8,}$`
    - **`email` (required)**: `string`, format: `email`
    - **`name` (required)**: `string`, minLength: `2`
    - **`password` (required)**: `string`, minLength: `8`
    - **`phone`**: `string`
- **`codigo` (required)**: `string`, minLength: `1`
- **`departments` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`departmentId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - **`responsibleUserId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`estado` (required)**: `string`, possible values: `"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"`
- **`ibgeCityCode` (required)**: `integer`, minimum: `1`, maximum: `9999999`
- **`name` (required)**: `string`, minLength: `2`
- **`bairro`**: `string | null`
- **`caepf`**: `string | null`
- **`cei`**: `string | null`
- **`cep`**: `string | null`
- **`clientType`**: `string`, possible values: `"PF", "PJ"`, default: `"PJ"`
- **`cnpj`**: `string | null`
- **`complemento`**: `string | null`
- **`cpf`**: `string | null`
- **`inscricaoEstadual`**: `string | null`
- **`logradouro`**: `string | null`
- **`notes`**: `string | null`
- **`numero`**: `string | null`
- **`phone`**: `string | null`
- **`whatsapp`**: `string | null`

<a id="scalar-example-16"></a>

**Generated example:**

```json
{
  "name": "",
  "codigo": "",
  "clientType": "PJ",
  "cnpj": null,
  "cpf": null,
  "cei": null,
  "caepf": null,
  "inscricaoEstadual": null,
  "whatsapp": null,
  "phone": null,
  "notes": null,
  "cep": null,
  "estado": "AC",
  "ibgeCityCode": 1,
  "bairro": null,
  "logradouro": null,
  "numero": null,
  "complemento": null,
  "departments": [
    {
      "departmentId": "",
      "responsibleUserId": ""
    }
  ],
  "clientUsers": [
    {
      "existingId": "",
      "departmentIds": [
        ""
      ]
    }
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-clientslookup-cnpjcnpj"></a>

### Buscar dados da empresa pelo CNPJ

- **Method:** `GET`
- **Path:** `/clients/lookup-cnpj/{cnpj}`
- **Tags:** Clientes

Preenche razão social e endereço no cadastro, com estado e cidade (código IBGE). Consulta a BrasilAPI e, se ela estiver fora, o CNPJ.ws. `ibgeCityCode: null` quando a cidade não foi reconhecida — escolher à mão. 502 quando os dois serviços estão fora.

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`cnpj` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-clientssearch-users"></a>

### Buscar usuários do portal para vincular ao cliente

- **Method:** `GET`
- **Path:** `/clients/search-users`
- **Tags:** Clientes

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-clientsid"></a>

### Desativar cliente

- **Method:** `DELETE`
- **Path:** `/clients/{id}`
- **Tags:** Clientes

Sai das listas e o portal dele é bloqueado; o histórico continua.

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-clientsid"></a>

### Alterar cliente

- **Method:** `PATCH`
- **Path:** `/clients/{id}`
- **Tags:** Clientes

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`clientUsers` (required)**: `array`, minItems: `1`

  **Items:**

  **Any of:**
  - `object`, no additional properties
    - **`departmentIds` (required)**: `array`, minItems: `1`

      **Items:**

      `string`, pattern: `^[cC][^\s-]{8,}$`
    - **`existingId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - `object`, no additional properties
    - **`departmentIds` (required)**: `array`, minItems: `1`

      **Items:**

      `string`, pattern: `^[cC][^\s-]{8,}$`
    - **`email` (required)**: `string`, format: `email`
    - **`name` (required)**: `string`, minLength: `2`
    - **`password` (required)**: `string`, minLength: `8`
    - **`phone`**: `string`
- **`codigo` (required)**: `string`, minLength: `1`
- **`departments` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`departmentId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - **`responsibleUserId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`estado` (required)**: `string`, possible values: `"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"`
- **`ibgeCityCode` (required)**: `integer`, minimum: `1`, maximum: `9999999`
- **`name` (required)**: `string`, minLength: `2`
- **`bairro`**: `string | null`
- **`caepf`**: `string | null`
- **`cei`**: `string | null`
- **`cep`**: `string | null`
- **`clientType`**: `string`, possible values: `"PF", "PJ"`, default: `"PJ"`
- **`cnpj`**: `string | null`
- **`complemento`**: `string | null`
- **`cpf`**: `string | null`
- **`inscricaoEstadual`**: `string | null`
- **`logradouro`**: `string | null`
- **`notes`**: `string | null`
- **`numero`**: `string | null`
- **`phone`**: `string | null`
- **`whatsapp`**: `string | null`

<a id="scalar-example-17"></a>

**Generated example:**

```json
{
  "name": "",
  "codigo": "",
  "clientType": "PJ",
  "cnpj": null,
  "cpf": null,
  "cei": null,
  "caepf": null,
  "inscricaoEstadual": null,
  "whatsapp": null,
  "phone": null,
  "notes": null,
  "cep": null,
  "estado": "AC",
  "ibgeCityCode": 1,
  "bairro": null,
  "logradouro": null,
  "numero": null,
  "complemento": null,
  "departments": [
    {
      "departmentId": "",
      "responsibleUserId": ""
    }
  ],
  "clientUsers": [
    {
      "existingId": "",
      "departmentIds": [
        ""
      ]
    }
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-clientsidreactivate"></a>

### Reativar cliente

- **Method:** `POST`
- **Path:** `/clients/{id}/reactivate`
- **Tags:** Clientes

Volta a ficar ativo e o portal reabre. Conta no limite de clientes do plano (422); responsável de departamento desativado ou código/CPF/CNPJ já em uso → 409.

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-clientsidusers"></a>

### Usuários do portal ligados ao cliente

- **Method:** `GET`
- **Path:** `/clients/{id}/users`
- **Tags:** Clientes

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-clientsidassignments"></a>

### Departamentos que atendem o cliente e seus responsáveis

- **Method:** `GET`
- **Path:** `/clients/{id}/assignments`
- **Tags:** Clientes

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-boards"></a>

### Listar processos

- **Method:** `GET`
- **Path:** `/boards`
- **Tags:** Processos

A equipe vê os do seu escopo; o cliente, os dos clientes e departamentos a que tem acesso.

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`clientId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`responsibleUserId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`columnTitle`**: `string`
- **`overdue`**: `boolean`
- **`dueSoon`**: `boolean`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-boards"></a>

### Abrir processo

- **Method:** `POST`
- **Path:** `/boards`
- **Tags:** Processos

A partir de um modelo de processo: cria as colunas e as OS do modelo para o cliente.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`clientId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`title` (required)**: `string`, minLength: `1`
- **`competence`**: `string`, pattern: `^\d{4}-(0[1-9]|1[0-2])$`
- **`description`**: `string`
- **`dueDate`**: `string`, format: `date-time`
- **`processTemplateId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`responsibleUserId`**: `string`, pattern: `^[cC][^\s-]{8,}$`

<a id="scalar-example-18"></a>

**Generated example:**

```json
{
  "title": "",
  "description": "",
  "clientId": "",
  "processTemplateId": "",
  "competence": "",
  "responsibleUserId": "",
  "dueDate": "2026-11-25T20:59:58.647Z"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-boardsid"></a>

### Processo com colunas e tarefas

- **Method:** `GET`
- **Path:** `/boards/{id}`
- **Tags:** Processos

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-boardsid"></a>

### Alterar processo

- **Method:** `PATCH`
- **Path:** `/boards/{id}`
- **Tags:** Processos

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`description`**: `string`
- **`dueDate`**: `string | null`, format: `date-time`
- **`responsibleUserId`**: `string | null`, pattern: `^[cC][^\s-]{8,}$`
- **`title`**: `string`, minLength: `1`

<a id="scalar-example-19"></a>

**Generated example:**

```json
{
  "title": "",
  "description": "",
  "responsibleUserId": "",
  "dueDate": "2026-11-25T20:59:58.651Z"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-boardsidtaskssearch"></a>

### Buscar tarefas no processo

- **Method:** `GET`
- **Path:** `/boards/{id}/tasks/search`
- **Tags:** Processos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Query parameters

- **`q`**: `string`
- **`priority`**: `string`, possible values: `"LOW", "MEDIUM", "HIGH", "URGENT"`
- **`status`**: `string`, possible values: `"OPEN", "DONE", "DISREGARDED", "BLOCKED"`
- **`assigneeId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`dueBefore`**: `string`, format: `date-time`
- **`dueAfter`**: `string`, format: `date-time`
- **`competence`**: `string`, format: `date-time`
- **`targetBefore`**: `string`, format: `date-time`
- **`targetAfter`**: `string`, format: `date-time`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-columnscolumnidtasks"></a>

### Criar tarefa na coluna

- **Method:** `POST`
- **Path:** `/columns/{columnId}/tasks`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`columnId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`departmentId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`title` (required)**: `string`, minLength: `1`
- **`assigneeId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`description`**: `string`
- **`dueDate`**: `string`, format: `date-time`
- **`priority`**: `string`, possible values: `"LOW", "MEDIUM", "HIGH", "URGENT"`, default: `"MEDIUM"`
- **`tags`**: `array of string`, default: `[]`

<a id="scalar-example-20"></a>

**Generated example:**

```json
{
  "title": "",
  "description": "",
  "priority": "MEDIUM",
  "assigneeId": "",
  "dueDate": "2026-11-25T20:59:58.658Z",
  "tags": [],
  "departmentId": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-tasks"></a>

### Listar tarefas

- **Method:** `GET`
- **Path:** `/tasks`
- **Tags:** Tarefas

Minhas tarefas, do departamento ou do escritório, conforme o papel e os filtros.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`clientId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`assigneeId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`status`**: `string`, possible values: `"OPEN", "STARTED", "DONE", "DISREGARDED", "BLOCKED"`
- **`recurringTemplateId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`dateFrom`**: `string`, format: `date-time`
- **`dateTo`**: `string`, format: `date-time`
- **`dateField`**: `string`, possible values: `"target", "effective", "period"`
- **`boardType`**: `string`, possible values: `"PROCESS", "RECURRING_SYSTEM", "SERVICE_SYSTEM"`
- **`scope`**: `string`, possible values: `"mine", "department", "all"`
- **`openOnly`**: `boolean`
- **`q`**: `string`
- **`taskId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`limit`**: `integer`, minimum: `1`, maximum: `500`
- **`cursor`**: `string`, pattern: `^[cC][^\s-]{8,}$`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksassume-bulk"></a>

### Assumir várias tarefas

- **Method:** `POST`
- **Path:** `/tasks/assume-bulk`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`fromUserId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`

<a id="scalar-example-21"></a>

**Generated example:**

```json
{
  "fromUserId": "",
  "departmentId": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksidassume"></a>

### Assumir tarefa

- **Method:** `POST`
- **Path:** `/tasks/{id}/assume`
- **Tags:** Tarefas

Falha com 409 se outra pessoa assumiu antes (`expectedAssigneeId`).

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`expectedAssigneeId` (required)**: `string | null`, pattern: `^[cC][^\s-]{8,}$`

<a id="scalar-example-22"></a>

**Generated example:**

```json
{
  "expectedAssigneeId": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-tasksidmove"></a>

### Mover ou reordenar tarefa no quadro

- **Method:** `PATCH`
- **Path:** `/tasks/{id}/move`
- **Tags:** Tarefas

`position` é o índice na coluna de destino. Na mesma coluna só reordena (sem histórico nem aviso); entre colunas dispara a notificação de etapa para o cliente quando a tarefa é visível a ele.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`columnId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`position` (required)**: `integer`, minimum: `0`
- **`delayNote`**: `string`, maxLength: `500`
- **`delayReasonId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`processDelayNote`**: `string`, maxLength: `500`
- **`processDelayReasonId`**: `string`, pattern: `^[cC][^\s-]{8,}$`

<a id="scalar-example-23"></a>

**Generated example:**

```json
{
  "columnId": "",
  "position": 0,
  "delayReasonId": "",
  "delayNote": "",
  "processDelayReasonId": "",
  "processDelayNote": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-tasksid"></a>

### Excluir tarefa

- **Method:** `DELETE`
- **Path:** `/tasks/{id}`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-tasksid"></a>

### Alterar tarefa

- **Method:** `PATCH`
- **Path:** `/tasks/{id}`
- **Tags:** Tarefas

Título, prazo, prioridade, status, responsável (pode ser de outro departamento) e visibilidade para o cliente.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`assigneeId`**: `string | null`, pattern: `^[cC][^\s-]{8,}$`
- **`competence`**: `string | null`, format: `date-time`
- **`delayNote`**: `string`, maxLength: `500`
- **`delayReasonId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`description`**: `string`
- **`dueDate`**: `string | null`, format: `date-time`
- **`priority`**: `string`, possible values: `"LOW", "MEDIUM", "HIGH", "URGENT"`
- **`processDelayNote`**: `string`, maxLength: `500`
- **`processDelayReasonId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`status`**: `string`, possible values: `"OPEN", "STARTED", "DONE", "DISREGARDED", "BLOCKED"`
- **`tags`**: `array of string`
- **`targetDate`**: `string | null`, format: `date-time`
- **`title`**: `string`, minLength: `1`
- **`visibleToClient`**: `boolean`

<a id="scalar-example-24"></a>

**Generated example:**

```json
{
  "title": "",
  "description": "",
  "priority": "LOW",
  "status": "OPEN",
  "assigneeId": "",
  "dueDate": "2026-11-25T20:59:58.681Z",
  "tags": [
    ""
  ],
  "departmentId": "",
  "visibleToClient": true,
  "targetDate": "2026-11-25T20:59:58.681Z",
  "competence": "2026-11-25T20:59:58.681Z",
  "delayReasonId": "",
  "delayNote": "",
  "processDelayReasonId": "",
  "processDelayNote": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-tasksidhistory"></a>

### Histórico da tarefa

- **Method:** `GET`
- **Path:** `/tasks/{id}/history`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksidregenerate"></a>

### Gerar de novo tarefa de recorrência

- **Method:** `POST`
- **Path:** `/tasks/{id}/regenerate`
- **Tags:** Tarefas

Refaz a tarefa a partir do modelo recorrente atual.

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-taskstaskidcomments"></a>

### Comentários da tarefa

- **Method:** `GET`
- **Path:** `/tasks/{taskId}/comments`
- **Tags:** Tarefas

O cliente não recebe os comentários internos.

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`taskId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-taskstaskidcomments"></a>

### Comentar na tarefa

- **Method:** `POST`
- **Path:** `/tasks/{taskId}/comments`
- **Tags:** Tarefas

`isInternal: true` deixa o comentário só para a equipe (ignorado quando quem escreve é o cliente).

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`taskId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`content` (required)**: `string`, minLength: `1`, maxLength: `4000`
- **`isInternal`**: `boolean`

<a id="scalar-example-25"></a>

**Generated example:**

```json
{
  "content": "",
  "isInternal": true
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-commentsid"></a>

### Apagar comentário

- **Method:** `DELETE`
- **Path:** `/comments/{id}`
- **Tags:** Comentários

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-notificationsconfig"></a>

### Configuração de WhatsApp e e-mail do escritório

- **Method:** `GET`
- **Path:** `/notifications/config`
- **Tags:** Notificações

Tokens e senhas nunca voltam na resposta.

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-notificationsconfig"></a>

### Alterar configuração de WhatsApp e e-mail

- **Method:** `PATCH`
- **Path:** `/notifications/config`
- **Tags:** Notificações

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`approvalChangesRequested`**: `boolean`
- **`approvalRequested`**: `boolean`
- **`commentAdded`**: `boolean`
- **`documentRejected`**: `boolean`
- **`emailEnabled`**: `boolean`
- **`lateClosureThresholdDays`**: `integer`, minimum: `0`, maximum: `90`
- **`maximizebotToken`**: `string`
- **`protocolCreated`**: `boolean`
- **`protocolWarningDays`**: `integer`, minimum: `0`, maximum: `90`
- **`recurringGenerationFailed`**: `boolean`
- **`requestApproved`**: `boolean`
- **`requestCancelled`**: `boolean`
- **`requestCommentAdded`**: `boolean`
- **`requestCreated`**: `boolean`
- **`requestNeedsInfo`**: `boolean`
- **`requestRejected`**: `boolean`
- **`saveOnTicket`**: `boolean`
- **`slaDigestEnabled`**: `boolean`
- **`slaDueCriticalDays`**: `integer`, minimum: `0`, maximum: `90`
- **`slaTargetWarningDays`**: `integer`, minimum: `0`, maximum: `90`
- **`startChatbot`**: `boolean`
- **`taskAssumed`**: `boolean`
- **`taskBlocked`**: `boolean`
- **`taskCompleted`**: `boolean`
- **`taskCreated`**: `boolean`
- **`taskMoved`**: `boolean`
- **`whatsappEnabled`**: `boolean`

<a id="scalar-example-26"></a>

**Generated example:**

```json
{
  "whatsappEnabled": true,
  "emailEnabled": true,
  "taskCreated": true,
  "taskMoved": true,
  "taskCompleted": true,
  "commentAdded": true,
  "slaTargetWarningDays": 0,
  "slaDueCriticalDays": 0,
  "slaDigestEnabled": true,
  "lateClosureThresholdDays": 0,
  "requestCreated": true,
  "requestApproved": true,
  "requestRejected": true,
  "requestNeedsInfo": true,
  "requestCommentAdded": true,
  "requestCancelled": true,
  "protocolCreated": true,
  "taskAssumed": true,
  "approvalRequested": true,
  "approvalChangesRequested": true,
  "protocolWarningDays": 0,
  "taskBlocked": true,
  "recurringGenerationFailed": true,
  "documentRejected": true,
  "maximizebotToken": "",
  "saveOnTicket": true,
  "startChatbot": true
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-notificationsconfigtest-whatsapp"></a>

### Enviar WhatsApp de teste

- **Method:** `POST`
- **Path:** `/notifications/config/test-whatsapp`
- **Tags:** Notificações

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`number` (required)**: `string`, minLength: `10`

<a id="scalar-example-27"></a>

**Generated example:**

```json
{
  "number": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-notificationsconfigtest-email"></a>

### Enviar e-mail de teste

- **Method:** `POST`
- **Path:** `/notifications/config/test-email`
- **Tags:** Notificações

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`to` (required)**: `string`, format: `email`

<a id="scalar-example-28"></a>

**Generated example:**

```json
{
  "to": "hello@example.com"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-notificationstemplatespreview"></a>

### Pré-visualizar mensagem com as variáveis preenchidas

- **Method:** `POST`
- **Path:** `/notifications/templates/preview`
- **Tags:** Notificações

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`channel` (required)**: `string`, possible values: `"WHATSAPP", "EMAIL"`
- **`event` (required)**: `string`, possible values: `"TASK_CREATED", "TASK_MOVED", "TASK_COMPLETED", "TASK_COMMENT_ADDED", "TASK_BLOCKED", "REQUEST_CREATED", "REQUEST_APPROVED", "REQUEST_REJECTED", "RECURRING_GENERATION_FAILED", "DOCUMENT_REJECTED", "SLA_DIGEST", "REQUEST_NEEDS_INFO", "REQUEST_COMMENT_ADDED", "REQUEST_CANCELLED", "PROTOCOL_CREATED", "TASK_ASSUMED", "APPROVAL_REQUESTED", "APPROVAL_CHANGES_REQUESTED"`
- **`body`**: `string`

<a id="scalar-example-29"></a>

**Generated example:**

```json
{
  "event": "TASK_CREATED",
  "channel": "WHATSAPP",
  "body": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-notificationstemplateseventchannel"></a>

### Mensagem usada no evento e canal

- **Method:** `GET`
- **Path:** `/notifications/templates/{event}/{channel}`
- **Tags:** Notificações

A personalizada do escritório ou, sem ela, a padrão do sistema. `variables` lista os campos que esse aviso preenche no envio.

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`event` (required)**: `string`
- **`channel` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-put-notificationstemplateseventchannel"></a>

### Personalizar mensagem do evento e canal

- **Method:** `PUT`
- **Path:** `/notifications/templates/{event}/{channel}`
- **Tags:** Notificações

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`event` (required)**: `string`
- **`channel` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`body` (required)**: `string`, minLength: `1`
- **`subject`**: `string`

<a id="scalar-example-30"></a>

**Generated example:**

```json
{
  "subject": "",
  "body": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-notificationstemplateseventchannel"></a>

### Voltar à mensagem padrão

- **Method:** `DELETE`
- **Path:** `/notifications/templates/{event}/{channel}`
- **Tags:** Notificações

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`event` (required)**: `string`
- **`channel` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-notificationsconfigsla-sound"></a>

### Enviar som de alerta de prazo personalizado

- **Method:** `POST`
- **Path:** `/notifications/config/sla-sound`
- **Tags:** Notificações

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-31"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-notificationsconfigsla-sound"></a>

### Voltar ao som de alerta padrão

- **Method:** `DELETE`
- **Path:** `/notifications/config/sla-sound`
- **Tags:** Notificações

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-notificationslogs"></a>

### Mensagens enviadas aos clientes

- **Method:** `GET`
- **Path:** `/notifications/logs`
- **Tags:** Notificações

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`page`**: `integer`, default: `1`, minimum: `1`
- **`limit`**: `integer`, default: `50`, minimum: `1`, maximum: `100`
- **`status`**: `string`, possible values: `"PENDING", "SENT", "FAILED"`
- **`channel`**: `string`, possible values: `"WHATSAPP", "EMAIL"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portalclients"></a>

### Empresas que posso acompanhar

- **Method:** `GET`
- **Path:** `/portal/clients`
- **Tags:** Portal do cliente

Portal: um usuário pode acompanhar mais de uma empresa.

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portaltaskstaskidhistory"></a>

### Andamento da tarefa (versão do cliente)

- **Method:** `GET`
- **Path:** `/portal/tasks/{taskId}/history`
- **Tags:** Portal do cliente

Só os eventos que fazem sentido para o cliente.

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`taskId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portaltaskstaskiddocuments"></a>

### Documentos pedidos e entregues na tarefa

- **Method:** `GET`
- **Path:** `/portal/tasks/{taskId}/documents`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`taskId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-portaltaskstaskiddocumentsrequestsreqidupload"></a>

### Enviar documento pedido pelo escritório

- **Method:** `POST`
- **Path:** `/portal/tasks/{taskId}/documents/requests/{reqId}/upload`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`taskId` (required)**: `string`
- **`reqId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-32"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portaldepartments"></a>

### Departamentos que posso acompanhar

- **Method:** `GET`
- **Path:** `/portal/departments`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portalservices"></a>

### Serviços que posso solicitar

- **Method:** `GET`
- **Path:** `/portal/services`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-portalrequests"></a>

### Solicitar serviço ao escritório

- **Method:** `POST`
- **Path:** `/portal/requests`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`clientId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`title` (required)**: `string`, minLength: `1`
- **`competence`**: `string`, pattern: `^\d{4}-(0[1-9]|1[0-2])$`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`description`**: `string`
- **`osModelId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`processTemplateId`**: `string`, pattern: `^[cC][^\s-]{8,}$`

<a id="scalar-example-33"></a>

**Generated example:**

```json
{
  "clientId": "",
  "title": "",
  "description": "",
  "departmentId": "",
  "processTemplateId": "",
  "osModelId": "",
  "competence": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portalrequests"></a>

### Minhas solicitações

- **Method:** `GET`
- **Path:** `/portal/requests`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portalrequestsid"></a>

### Detalhe da solicitação

- **Method:** `GET`
- **Path:** `/portal/requests/{id}`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-portalrequestsidcancel"></a>

### Cancelar solicitação ainda não analisada

- **Method:** `PATCH`
- **Path:** `/portal/requests/{id}/cancel`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-portalrequestsidattachments"></a>

### Anexar arquivo à solicitação

- **Method:** `POST`
- **Path:** `/portal/requests/{id}/attachments`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-34"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portalhome"></a>

### Início do portal

- **Method:** `GET`
- **Path:** `/portal/home`
- **Tags:** Portal do cliente

Pendências, processos em andamento e guias a pagar da empresa escolhida.

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`clientId` (required)**: `string`, minLength: `1`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portaldocument-requestsmonths"></a>

### Meses com documentos pedidos

- **Method:** `GET`
- **Path:** `/portal/document-requests/months`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`clientId` (required)**: `string`, minLength: `1`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portaldocument-requests"></a>

### Documentos pedidos no mês ("Enviar documentos")

- **Method:** `GET`
- **Path:** `/portal/document-requests`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`clientId` (required)**: `string`, minLength: `1`
- **`competence` (required)**: `string`, pattern: `^\d{4}-(0[1-9]|1[0-2])$`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-portaltaskstaskiddocumentsrequestsreqidnot-applicable"></a>

### Avisar que o documento pedido não se aplica

- **Method:** `POST`
- **Path:** `/portal/tasks/{taskId}/documents/requests/{reqId}/not-applicable`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`taskId` (required)**: `string`
- **`reqId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-portaltaskstaskiddocumentsrequestsreqidnot-applicable"></a>

### Desfazer o "não se aplica"

- **Method:** `DELETE`
- **Path:** `/portal/tasks/{taskId}/documents/requests/{reqId}/not-applicable`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`taskId` (required)**: `string`
- **`reqId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portalprotocols"></a>

### Guias e protocolos da empresa

- **Method:** `GET`
- **Path:** `/portal/protocols`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`clientId` (required)**: `string`, minLength: `1`
- **`status`**: `string`, possible values: `"SENT", "VIEWED", "DOWNLOADED", "EXPIRED"`
- **`search`**: `string`
- **`competence`**: `string`, pattern: `^\d{4}-(0[1-9]|1[0-2])$`
- **`departmentId`**: `string`
- **`dueFrom`**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`
- **`dueTo`**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`
- **`paymentStatus`**: `string`, possible values: `"unpaid", "paid"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-portalprotocolsidpay"></a>

### Informar pagamento da guia

- **Method:** `POST`
- **Path:** `/portal/protocols/{id}/pay`
- **Tags:** Portal do cliente

JSON `{ amount }`, ou multipart com `amount` antes do comprovante (opcional).

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`amount` (required)**: `string`, minLength: `1`

<a id="scalar-example-35"></a>

**Generated example:**

```json
{
  "amount": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-portalprotocolsidpay"></a>

### Desfazer o pagamento informado

- **Method:** `DELETE`
- **Path:** `/portal/protocols/{id}/pay`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portalprotocolsid"></a>

### Abrir protocolo

- **Method:** `GET`
- **Path:** `/portal/protocols/{id}`
- **Tags:** Portal do cliente

Registra que o cliente visualizou.

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-portalprotocolsiddownload"></a>

### Baixar arquivo do protocolo

- **Method:** `GET`
- **Path:** `/portal/protocols/{id}/download`
- **Tags:** Portal do cliente

Registra o download e devolve um link temporário.

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-streamticket"></a>

### Ticket para abrir um canal em tempo real

- **Method:** `POST`
- **Path:** `/stream/ticket`
- **Tags:** Tempo real

O `EventSource` do navegador não manda header; o ticket vai na URL do canal.

**Quem pode:** Admin, Gerente, Membro, Cliente, Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-notificationsstream"></a>

### Avisos do sino em tempo real

- **Method:** `GET`
- **Path:** `/notifications/stream`
- **Tags:** Notificações

Server-Sent Events. Sem header de token: use `?ticket=` obtido em POST /stream/ticket (uso único, 30 s).

**Quem pode:** quem tem a credencial própria da rota (veja Autenticação)

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **streamTicket**: API key in query `ticket`

  Ticket de uso único de POST /stream/ticket (30 s)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-boardsidstream"></a>

### Mudanças no processo em tempo real

- **Method:** `GET`
- **Path:** `/boards/{id}/stream`
- **Tags:** Processos

Server-Sent Events. Sem header de token: use `?ticket=` obtido em POST /stream/ticket (uso único, 30 s). O cliente recebe só o aviso de que algo mudou, sem o conteúdo.

**Quem pode:** quem tem a credencial própria da rota (veja Autenticação)

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **streamTicket**: API key in query `ticket`

  Ticket de uso único de POST /stream/ticket (30 s)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksidattachments"></a>

### Anexar arquivo à tarefa

- **Method:** `POST`
- **Path:** `/tasks/{id}/attachments`
- **Tags:** Tarefas

PDF, imagem e documentos de escritório; o conteúdo precisa bater com a extensão.

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-36"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-tasksidattachments"></a>

### Anexos da tarefa

- **Method:** `GET`
- **Path:** `/tasks/{id}/attachments`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-tasksidattachmentsattachmentid"></a>

### Apagar anexo

- **Method:** `DELETE`
- **Path:** `/tasks/{id}/attachments/{attachmentId}`
- **Tags:** Tarefas

Recusado quando o arquivo está ligado a um documento ou protocolo.

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`
- **`attachmentId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-tasksiddocuments"></a>

### Documentos pedidos e entregues da tarefa

- **Method:** `GET`
- **Path:** `/tasks/{id}/documents`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksiddocumentsrequests"></a>

### Pedir documento ao cliente

- **Method:** `POST`
- **Path:** `/tasks/{id}/documents/requests`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`name` (required)**: `string`, minLength: `1`

<a id="scalar-example-37"></a>

**Generated example:**

```json
{
  "name": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksiddocumentsdeliveries"></a>

### Prever documento a entregar ao cliente

- **Method:** `POST`
- **Path:** `/tasks/{id}/documents/deliveries`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`name` (required)**: `string`, minLength: `1`
- **`requiresPayment`**: `boolean`, default: `false`

<a id="scalar-example-38"></a>

**Generated example:**

```json
{
  "name": "",
  "requiresPayment": false
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-tasksiddocumentsrequestsreqid"></a>

### Aprovar ou recusar documento enviado pelo cliente

- **Method:** `PATCH`
- **Path:** `/tasks/{id}/documents/requests/{reqId}`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`
- **`reqId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`decision` (required)**: `string`, possible values: `"APPROVED", "REJECTED"`
- **`rejectionReason`**: `string`, minLength: `1`

<a id="scalar-example-39"></a>

**Generated example:**

```json
{
  "decision": "APPROVED",
  "rejectionReason": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksiddocumentsdeliveriesreqidupload"></a>

### Enviar documento ao cliente

- **Method:** `POST`
- **Path:** `/tasks/{id}/documents/deliveries/{reqId}/upload`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`
- **`reqId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-40"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksiddocumentsdeliveriesreqidcheck"></a>

### Conferir arquivo antes de entregar

- **Method:** `POST`
- **Path:** `/tasks/{id}/documents/deliveries/{reqId}/check`
- **Tags:** Tarefas

Lê o arquivo e avisa se não parece ser o documento esperado; não salva nada.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`
- **`reqId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-41"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksiddocumentsrequestsreqidupload"></a>

### Anexar pelo escritório documento pedido ao cliente

- **Method:** `POST`
- **Path:** `/tasks/{id}/documents/requests/{reqId}/upload`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`
- **`reqId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-42"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-requestsstream"></a>

### Novas solicitações em tempo real

- **Method:** `GET`
- **Path:** `/requests/stream`
- **Tags:** Solicitações

Server-Sent Events. Sem header de token: use `?ticket=` obtido em POST /stream/ticket (uso único, 30 s).

**Quem pode:** quem tem a credencial própria da rota (veja Autenticação)

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **streamTicket**: API key in query `ticket`

  Ticket de uso único de POST /stream/ticket (30 s)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-requests"></a>

### Solicitações dos clientes

- **Method:** `GET`
- **Path:** `/requests`
- **Tags:** Solicitações

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`status`**: `string`, possible values: `"PENDING", "APPROVED", "REJECTED", "CANCELLED", "NEEDS_INFO"`
- **`scope`**: `string`, possible values: `"mine", "department", "all"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-requestspending-count"></a>

### Quantas solicitações aguardam análise

- **Method:** `GET`
- **Path:** `/requests/pending-count`
- **Tags:** Solicitações

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-requestsid"></a>

### Detalhe da solicitação

- **Method:** `GET`
- **Path:** `/requests/{id}`
- **Tags:** Solicitações

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-requestsidapprove"></a>

### Aceitar solicitação

- **Method:** `POST`
- **Path:** `/requests/{id}/approve`
- **Tags:** Solicitações

Abre o processo ou a OS do serviço pedido.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

**Any of:**

- `object`, no additional properties
  - **`boardId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - **`columnId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - **`mode` (required)**: `string`, possible values: `"EXISTING_BOARD"`
  - **`dependsOnTaskIds`**: `array`, maxItems: `50`

    **Items:**

    `string`, pattern: `^[cC][^\s-]{8,}$`
  - **`osModelId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- `object`, no additional properties
  - **`mode` (required)**: `string`, possible values: `"NEW_BOARD"`
- `object`, no additional properties
  - **`mode` (required)**: `string`, possible values: `"OS"`
  - **`osModelId`**: `string`, pattern: `^[cC][^\s-]{8,}$`

<a id="scalar-example-43"></a>

**Generated example:**

```json
{
  "mode": "EXISTING_BOARD",
  "boardId": "",
  "columnId": "",
  "osModelId": "",
  "dependsOnTaskIds": [
    ""
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-requestsidreject"></a>

### Recusar solicitação

- **Method:** `POST`
- **Path:** `/requests/{id}/reject`
- **Tags:** Solicitações

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`reason`**: `string`

<a id="scalar-example-44"></a>

**Generated example:**

```json
{
  "reason": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-requestsidneeds-info"></a>

### Pedir mais informações ao cliente

- **Method:** `POST`
- **Path:** `/requests/{id}/needs-info`
- **Tags:** Solicitações

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`comment` (required)**: `string`, minLength: `1`, maxLength: `4000`

<a id="scalar-example-45"></a>

**Generated example:**

```json
{
  "comment": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-requestsidcancel"></a>

### Cancelar solicitação já aceita

- **Method:** `POST`
- **Path:** `/requests/{id}/cancel`
- **Tags:** Solicitações

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`reason` (required)**: `string`, minLength: `1`, maxLength: `4000`

<a id="scalar-example-46"></a>

**Generated example:**

```json
{
  "reason": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-requestsrequestidcomments"></a>

### Conversa da solicitação

- **Method:** `GET`
- **Path:** `/requests/{requestId}/comments`
- **Tags:** Solicitações

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`requestId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-requestsrequestidcomments"></a>

### Escrever na conversa da solicitação

- **Method:** `POST`
- **Path:** `/requests/{requestId}/comments`
- **Tags:** Solicitações

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`requestId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`content` (required)**: `string`, minLength: `1`, maxLength: `4000`

<a id="scalar-example-47"></a>

**Generated example:**

```json
{
  "content": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-request-commentsid"></a>

### Apagar mensagem da solicitação

- **Method:** `DELETE`
- **Path:** `/request-comments/{id}`
- **Tags:** Solicitações

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-taskstaskidprotocols"></a>

### Registrar protocolo na tarefa

- **Method:** `POST`
- **Path:** `/tasks/{taskId}/protocols`
- **Tags:** Tarefas

Guia, recibo ou comprovante entregue ao cliente, a partir de um anexo da tarefa.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`taskId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`title` (required)**: `string`, minLength: `1`
- **`amount`**: `string`
- **`attachmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`content`**: `string`, minLength: `1`
- **`dueDate`**: `string`, format: `date-time`
- **`requiresPayment`**: `boolean`, default: `false`

<a id="scalar-example-48"></a>

**Generated example:**

```json
{
  "title": "",
  "dueDate": "2026-11-25T20:59:58.802Z",
  "attachmentId": "",
  "content": "",
  "requiresPayment": false,
  "amount": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-taskstaskidprotocols"></a>

### Protocolos da tarefa

- **Method:** `GET`
- **Path:** `/tasks/{taskId}/protocols`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`taskId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-protocolssummary"></a>

### Resumo dos protocolos: vistos, baixados, pendentes

- **Method:** `GET`
- **Path:** `/protocols/summary`
- **Tags:** Protocolos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-protocolsunpaidsummary"></a>

### Resumo das guias não pagas

- **Method:** `GET`
- **Path:** `/protocols/unpaid/summary`
- **Tags:** Protocolos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-protocolsunpaid"></a>

### Guias não pagas

- **Method:** `GET`
- **Path:** `/protocols/unpaid`
- **Tags:** Protocolos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`clientId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`dueMonth`**: `string`, pattern: `^\d{4}-(0[1-9]|1[0-2])$`
- **`situation`**: `string`, possible values: `"overdue", "upcoming", "paid"`
- **`scope`**: `string`, possible values: `"mine", "department", "all"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-protocols"></a>

### Listar protocolos

- **Method:** `GET`
- **Path:** `/protocols`
- **Tags:** Protocolos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`status`**: `string`, possible values: `"SENT", "VIEWED", "DOWNLOADED", "EXPIRED"`
- **`clientId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`from`**: `string`, format: `date-time`
- **`to`**: `string`, format: `date-time`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-protocolsid"></a>

### Detalhe do protocolo

- **Method:** `GET`
- **Path:** `/protocols/{id}`
- **Tags:** Protocolos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-protocolsidreplace"></a>

### Trocar o arquivo do protocolo

- **Method:** `POST`
- **Path:** `/protocols/{id}/replace`
- **Tags:** Protocolos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-49"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-protocolsidpayment"></a>

### Atualizar pagamento da guia

- **Method:** `PATCH`
- **Path:** `/protocols/{id}/payment`
- **Tags:** Protocolos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`amount`**: `string`
- **`dueDate`**: `string`

<a id="scalar-example-50"></a>

**Generated example:**

```json
{
  "amount": "",
  "dueDate": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-protocolsidcancel"></a>

### Cancelar protocolo

- **Method:** `POST`
- **Path:** `/protocols/{id}/cancel`
- **Tags:** Protocolos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`reason` (required)**: `string`, minLength: `3`

<a id="scalar-example-51"></a>

**Generated example:**

```json
{
  "reason": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-protocolsidreceipt"></a>

### Recibo do protocolo em PDF

- **Method:** `GET`
- **Path:** `/protocols/{id}/receipt`
- **Tags:** Protocolos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-dashboardmetrics"></a>

### Números do painel: tarefas abertas, atrasadas, concluídas

- **Method:** `GET`
- **Path:** `/dashboard/metrics`
- **Tags:** Dashboard

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-dashboardteam-members"></a>

### Pessoas para filtrar o painel

- **Method:** `GET`
- **Path:** `/dashboard/team-members`
- **Tags:** Dashboard

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-dashboardproductivity"></a>

### Produtividade da equipe no período

- **Method:** `GET`
- **Path:** `/dashboard/productivity`
- **Tags:** Dashboard

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`from` (required)**: `string`, format: `date-time`
- **`to` (required)**: `string`, format: `date-time`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`userId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`boardType`**: `string`, possible values: `"PROCESS", "RECURRING_SYSTEM", "SERVICE_SYSTEM"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-departments"></a>

### Listar departamentos

- **Method:** `GET`
- **Path:** `/departments`
- **Tags:** Departamentos

Com `withCounts=true` (só Admin), cada departamento traz `peopleCount` (pessoas ativas) e `clientsCount` (clientes ativos atendidos).

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`withCounts`**: `string`, possible values: `"true", "false"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-departments"></a>

### Criar departamento

- **Method:** `POST`
- **Path:** `/departments`
- **Tags:** Departamentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`name` (required)**: `string`, minLength: `1`

<a id="scalar-example-52"></a>

**Generated example:**

```json
{
  "name": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-departmentsid"></a>

### Alterar departamento

- **Method:** `PATCH`
- **Path:** `/departments/{id}`
- **Tags:** Departamentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`name`**: `string`, minLength: `1`

<a id="scalar-example-53"></a>

**Generated example:**

```json
{
  "name": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-departmentsid"></a>

### Remover departamento

- **Method:** `DELETE`
- **Path:** `/departments/{id}`
- **Tags:** Departamentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-holidays"></a>

### Listar feriados

- **Method:** `GET`
- **Path:** `/holidays`
- **Tags:** Feriados

Os mesmos para todo o sistema; contam no prazo em dias úteis.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`year`**: `integer`, minimum: `2000`, maximum: `2100`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-holidays"></a>

### Cadastrar feriado

- **Method:** `POST`
- **Path:** `/holidays`
- **Tags:** Feriados

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`date` (required)**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`
- **`name` (required)**: `string`, minLength: `2`, maxLength: `80`

<a id="scalar-example-54"></a>

**Generated example:**

```json
{
  "date": "",
  "name": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-holidaysdays"></a>

### Dias de feriado num intervalo

- **Method:** `GET`
- **Path:** `/holidays/days`
- **Tags:** Feriados

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`from` (required)**: `integer`, minimum: `2000`, maximum: `2100`
- **`to` (required)**: `integer`, minimum: `2000`, maximum: `2100`

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-holidaysid"></a>

### Remover feriado

- **Method:** `DELETE`
- **Path:** `/holidays/{id}`
- **Tags:** Feriados

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-municipalities"></a>

### Cidades de um estado (IBGE)

- **Method:** `GET`
- **Path:** `/municipalities`
- **Tags:** Municípios

Código IBGE e nome, em ordem alfabética. Usado no cadastro do cliente e nas exceções de vencimento.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`uf` (required)**: `string`, possible values: `"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-os-models"></a>

### Listar modelos de OS

- **Method:** `GET`
- **Path:** `/os-models`
- **Tags:** Modelos de OS

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`usage`**: `string`, possible values: `"standalone", "process"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-os-models"></a>

### Criar modelo de OS

- **Method:** `POST`
- **Path:** `/os-models`
- **Tags:** Modelos de OS

Departamento, prazo interno em dias úteis, documentos pedidos e entregues.

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`departmentId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`name` (required)**: `string`, minLength: `1`, maxLength: `120`
- **`autoCompleteOnAllDelivered`**: `boolean`, default: `false`
- **`deadlineBusinessDays`**: `integer | null`, minimum: `1`, maximum: `365`
- **`description`**: `string | null`, maxLength: `2000`
- **`documentDeliveries`**: `array`, default: `[]`

  **Items:**

  no additional properties
  - **`name` (required)**: `string`, minLength: `1`
  - **`obligationTypeId`**: `string | null`, pattern: `^[cC][^\s-]{8,}$`
  - **`requiresPayment`**: `boolean`, default: `false`
- **`documentRequests`**: `array`, default: `[]`

  **Items:**

  no additional properties
  - **`name` (required)**: `string`, minLength: `1`
- **`isActive`**: `boolean`, default: `true`
- **`priority`**: `string`, possible values: `"LOW", "MEDIUM", "HIGH", "URGENT"`, default: `"MEDIUM"`
- **`requiresCompetence`**: `boolean`, default: `false`
- **`usableInProcess`**: `boolean`, default: `false`
- **`usableStandalone`**: `boolean`, default: `true`
- **`visibleToClient`**: `boolean`, default: `true`

<a id="scalar-example-55"></a>

**Generated example:**

```json
{
  "name": "",
  "description": "",
  "departmentId": "",
  "priority": "MEDIUM",
  "visibleToClient": true,
  "requiresCompetence": false,
  "deadlineBusinessDays": 1,
  "autoCompleteOnAllDelivered": false,
  "usableStandalone": true,
  "usableInProcess": false,
  "isActive": true,
  "documentRequests": [],
  "documentDeliveries": []
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-os-modelsid"></a>

### Detalhe do modelo de OS

- **Method:** `GET`
- **Path:** `/os-models/{id}`
- **Tags:** Modelos de OS

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-os-modelsid"></a>

### Arquivar modelo de OS

- **Method:** `DELETE`
- **Path:** `/os-models/{id}`
- **Tags:** Modelos de OS

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-os-modelsid"></a>

### Alterar modelo de OS

- **Method:** `PATCH`
- **Path:** `/os-models/{id}`
- **Tags:** Modelos de OS

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`autoCompleteOnAllDelivered`**: `boolean`, default: `false`
- **`deadlineBusinessDays`**: `integer | null`, minimum: `1`, maximum: `365`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`description`**: `string | null`, maxLength: `2000`
- **`documentDeliveries`**: `array`, default: `[]`

  **Items:**

  no additional properties
  - **`name` (required)**: `string`, minLength: `1`
  - **`obligationTypeId`**: `string | null`, pattern: `^[cC][^\s-]{8,}$`
  - **`requiresPayment`**: `boolean`, default: `false`
- **`documentRequests`**: `array`, default: `[]`

  **Items:**

  no additional properties
  - **`name` (required)**: `string`, minLength: `1`
- **`isActive`**: `boolean`, default: `true`
- **`name`**: `string`, minLength: `1`, maxLength: `120`
- **`priority`**: `string`, possible values: `"LOW", "MEDIUM", "HIGH", "URGENT"`, default: `"MEDIUM"`
- **`requiresCompetence`**: `boolean`, default: `false`
- **`usableInProcess`**: `boolean`, default: `false`
- **`usableStandalone`**: `boolean`, default: `true`
- **`visibleToClient`**: `boolean`, default: `true`

<a id="scalar-example-56"></a>

**Generated example:**

```json
{
  "name": "",
  "description": "",
  "departmentId": "",
  "priority": "MEDIUM",
  "visibleToClient": true,
  "requiresCompetence": false,
  "deadlineBusinessDays": 1,
  "autoCompleteOnAllDelivered": false,
  "usableStandalone": true,
  "usableInProcess": false,
  "isActive": true,
  "documentRequests": [],
  "documentDeliveries": []
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-boardsidstage-times"></a>

### Tempo gasto em cada etapa do processo

- **Method:** `GET`
- **Path:** `/boards/{id}/stage-times`
- **Tags:** Processos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-dashboardos"></a>

### Painel de OS: no prazo, atrasadas, aguardando cliente

- **Method:** `GET`
- **Path:** `/dashboard/os`
- **Tags:** Dashboard

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`from` (required)**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`
- **`to` (required)**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-os"></a>

### Lista de OS

- **Method:** `GET`
- **Path:** `/os`
- **Tags:** Ordens de Serviço

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`clientId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`osModelId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`assigneeId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`boardId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`situation`**: `string`, possible values: `"ON_TIME", "DUE_SOON", "LATE", "PAUSED", "WAITING_DEPENDENCY", "DONE", "NONE"`
- **`search`**: `string`, maxLength: `100`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-os"></a>

### Abrir OS avulsa para um cliente

- **Method:** `POST`
- **Path:** `/os`
- **Tags:** Ordens de Serviço

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`clientId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`osModelId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`assigneeId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`competence`**: `string`, pattern: `^\d{4}-(0[1-9]|1[0-2])$`
- **`dueDate`**: `string`, format: `date-time`

<a id="scalar-example-57"></a>

**Generated example:**

```json
{
  "osModelId": "",
  "clientId": "",
  "competence": "",
  "assigneeId": "",
  "dueDate": "2026-11-25T20:59:58.853Z"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-boardsidos"></a>

### Incluir OS em processo aberto

- **Method:** `POST`
- **Path:** `/boards/{id}/os`
- **Tags:** Processos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`columnId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`osModelId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`assigneeId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`competence`**: `string`, pattern: `^\d{4}-(0[1-9]|1[0-2])$`
- **`dependsOnTaskIds`**: `array`, default: `[]`, maxItems: `50`

  **Items:**

  `string`, pattern: `^[cC][^\s-]{8,}$`
- **`dueDate`**: `string`, format: `date-time`

<a id="scalar-example-58"></a>

**Generated example:**

```json
{
  "osModelId": "",
  "columnId": "",
  "competence": "",
  "assigneeId": "",
  "dueDate": "2026-11-25T20:59:58.855Z",
  "dependsOnTaskIds": []
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksidrelease"></a>

### Liberar OS antes da dependência

- **Method:** `POST`
- **Path:** `/tasks/{id}/release`
- **Tags:** Tarefas

Com justificativa.

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`reason` (required)**: `string`, minLength: `3`, maxLength: `500`

<a id="scalar-example-59"></a>

**Generated example:**

```json
{
  "reason": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-delay-reasons"></a>

### Listar motivos de atraso

- **Method:** `GET`
- **Path:** `/delay-reasons`
- **Tags:** Motivos de atraso

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-delay-reasons"></a>

### Criar motivo de atraso

- **Method:** `POST`
- **Path:** `/delay-reasons`
- **Tags:** Motivos de atraso

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`name` (required)**: `string`, minLength: `2`, maxLength: `80`
- **`requiresNote`**: `boolean`, default: `false`

<a id="scalar-example-60"></a>

**Generated example:**

```json
{
  "name": "",
  "requiresNote": false
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-delay-reasonsid"></a>

### Alterar motivo de atraso

- **Method:** `PATCH`
- **Path:** `/delay-reasons/{id}`
- **Tags:** Motivos de atraso

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`isActive`**: `boolean`
- **`name`**: `string`, minLength: `2`, maxLength: `80`
- **`requiresNote`**: `boolean`

<a id="scalar-example-61"></a>

**Generated example:**

```json
{
  "name": "",
  "requiresNote": true,
  "isActive": true
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-delay-reasonsid"></a>

### Remover motivo de atraso

- **Method:** `DELETE`
- **Path:** `/delay-reasons/{id}`
- **Tags:** Motivos de atraso

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-tasksiddelay-reason"></a>

### Informar motivo de atraso da tarefa

- **Method:** `PATCH`
- **Path:** `/tasks/{id}/delay-reason`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`delayReasonId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`delayNote`**: `string`, maxLength: `500`

<a id="scalar-example-62"></a>

**Generated example:**

```json
{
  "delayReasonId": "",
  "delayNote": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-boardsiddelay-reason"></a>

### Informar motivo de atraso do processo

- **Method:** `PATCH`
- **Path:** `/boards/{id}/delay-reason`
- **Tags:** Processos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`delayReasonId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`delayNote`**: `string`, maxLength: `500`

<a id="scalar-example-63"></a>

**Generated example:**

```json
{
  "delayReasonId": "",
  "delayNote": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-recurring-templates"></a>

### Listar tarefas recorrentes

- **Method:** `GET`
- **Path:** `/recurring-templates`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-recurring-templates"></a>

### Criar tarefa recorrente

- **Method:** `POST`
- **Path:** `/recurring-templates`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`departmentId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`dueDayOfPeriod` (required)**: `integer`, minimum: `1`, maximum: `31`
- **`generationDayOfPeriod` (required)**: `integer`, minimum: `1`, maximum: `31`
- **`periodicity` (required)**: `string`, possible values: `"WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"`
- **`title` (required)**: `string`, minLength: `1`
- **`autoCompleteOnAllActivitiesDone`**: `boolean`, default: `false`
- **`competenceMonthOffset`**: `integer`, default: `1`, minimum: `0`
- **`description`**: `string`
- **`documentDeliveries`**: `array`, default: `[]`

  **Items:**

  no additional properties
  - **`name` (required)**: `string`, minLength: `1`
  - **`obligationTypeId`**: `string | null`, pattern: `^[cC][^\s-]{8,}$`
  - **`requiresPayment`**: `boolean`, default: `false`
- **`documentRequests`**: `array`, default: `[]`

  **Items:**

  no additional properties
  - **`name` (required)**: `string`, minLength: `1`
- **`dueBusinessDayRoll`**: `string`, possible values: `"NONE", "FORWARD", "BACKWARD"`, default: `"NONE"`
- **`dueMonthAnchor`**: `integer`, default: `1`, minimum: `1`, maximum: `12`
- **`dueRules`**: `array`, default: `[]`, maxItems: `5600`

  **Items:**

  no additional properties
  - **`dueDayOfPeriod` (required)**: `integer`, minimum: `1`, maximum: `31`
  - **`dueBusinessDayRoll`**: `string`, possible values: `"NONE", "FORWARD", "BACKWARD"`, default: `"NONE"`
  - **`ibgeCityCode`**: `integer`, minimum: `1`, maximum: `9999999`
  - **`uf`**: `string`, possible values: `"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"`
- **`dueScope`**: `string`, possible values: `"FEDERAL", "STATE", "CITY"`, default: `"FEDERAL"`
- **`generationMonthOffset`**: `integer`, default: `1`, minimum: `0`
- **`isActive`**: `boolean`, default: `true`
- **`notifyViaEmail`**: `boolean`, default: `false`
- **`notifyViaWhatsapp`**: `boolean`, default: `true`
- **`onlyListedLocations`**: `boolean`, default: `false`
- **`priority`**: `string`, possible values: `"LOW", "MEDIUM", "HIGH", "URGENT"`, default: `"MEDIUM"`
- **`targetBusinessDayRoll`**: `string`, possible values: `"NONE", "FORWARD", "BACKWARD"`, default: `"NONE"`
- **`targetOffsetDays`**: `integer`, default: `0`
- **`visibleToClient`**: `boolean`, default: `true`

<a id="scalar-example-64"></a>

**Generated example:**

```json
{
  "departmentId": "",
  "title": "",
  "description": "",
  "periodicity": "WEEKLY",
  "priority": "MEDIUM",
  "dueDayOfPeriod": 1,
  "dueBusinessDayRoll": "NONE",
  "dueMonthAnchor": 1,
  "competenceMonthOffset": 1,
  "targetOffsetDays": 0,
  "targetBusinessDayRoll": "NONE",
  "generationMonthOffset": 1,
  "generationDayOfPeriod": 1,
  "autoCompleteOnAllActivitiesDone": false,
  "notifyViaWhatsapp": true,
  "notifyViaEmail": false,
  "visibleToClient": true,
  "isActive": true,
  "documentRequests": [],
  "documentDeliveries": [],
  "dueScope": "FEDERAL",
  "onlyListedLocations": false,
  "dueRules": []
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-recurring-templatesfailed-generations"></a>

### Gerações que falharam

- **Method:** `GET`
- **Path:** `/recurring-templates/failed-generations`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-recurring-templatesid"></a>

### Detalhe da tarefa recorrente

- **Method:** `GET`
- **Path:** `/recurring-templates/{id}`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-recurring-templatesid"></a>

### Remover tarefa recorrente

- **Method:** `DELETE`
- **Path:** `/recurring-templates/{id}`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-recurring-templatesid"></a>

### Alterar tarefa recorrente

- **Method:** `PATCH`
- **Path:** `/recurring-templates/{id}`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`autoCompleteOnAllActivitiesDone`**: `boolean`, default: `false`
- **`competenceMonthOffset`**: `integer`, default: `1`, minimum: `0`
- **`departmentId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`description`**: `string`
- **`documentDeliveries`**: `array`, default: `[]`

  **Items:**

  no additional properties
  - **`name` (required)**: `string`, minLength: `1`
  - **`obligationTypeId`**: `string | null`, pattern: `^[cC][^\s-]{8,}$`
  - **`requiresPayment`**: `boolean`, default: `false`
- **`documentRequests`**: `array`, default: `[]`

  **Items:**

  no additional properties
  - **`name` (required)**: `string`, minLength: `1`
- **`dueBusinessDayRoll`**: `string`, possible values: `"NONE", "FORWARD", "BACKWARD"`, default: `"NONE"`
- **`dueDayOfPeriod`**: `integer`, minimum: `1`, maximum: `31`
- **`dueMonthAnchor`**: `integer`, default: `1`, minimum: `1`, maximum: `12`
- **`dueRules`**: `array`, default: `[]`, maxItems: `5600`

  **Items:**

  no additional properties
  - **`dueDayOfPeriod` (required)**: `integer`, minimum: `1`, maximum: `31`
  - **`dueBusinessDayRoll`**: `string`, possible values: `"NONE", "FORWARD", "BACKWARD"`, default: `"NONE"`
  - **`ibgeCityCode`**: `integer`, minimum: `1`, maximum: `9999999`
  - **`uf`**: `string`, possible values: `"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"`
- **`dueScope`**: `string`, possible values: `"FEDERAL", "STATE", "CITY"`, default: `"FEDERAL"`
- **`generationDayOfPeriod`**: `integer`, minimum: `1`, maximum: `31`
- **`generationMonthOffset`**: `integer`, default: `1`, minimum: `0`
- **`isActive`**: `boolean`, default: `true`
- **`notifyViaEmail`**: `boolean`, default: `false`
- **`notifyViaWhatsapp`**: `boolean`, default: `true`
- **`onlyListedLocations`**: `boolean`, default: `false`
- **`periodicity`**: `string`, possible values: `"WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"`
- **`priority`**: `string`, possible values: `"LOW", "MEDIUM", "HIGH", "URGENT"`, default: `"MEDIUM"`
- **`targetBusinessDayRoll`**: `string`, possible values: `"NONE", "FORWARD", "BACKWARD"`, default: `"NONE"`
- **`targetOffsetDays`**: `integer`, default: `0`
- **`title`**: `string`, minLength: `1`
- **`visibleToClient`**: `boolean`, default: `true`

<a id="scalar-example-65"></a>

**Generated example:**

```json
{
  "departmentId": "",
  "title": "",
  "description": "",
  "periodicity": "WEEKLY",
  "priority": "MEDIUM",
  "dueDayOfPeriod": 1,
  "dueBusinessDayRoll": "NONE",
  "dueMonthAnchor": 1,
  "competenceMonthOffset": 1,
  "targetOffsetDays": 0,
  "targetBusinessDayRoll": "NONE",
  "generationMonthOffset": 1,
  "generationDayOfPeriod": 1,
  "autoCompleteOnAllActivitiesDone": false,
  "notifyViaWhatsapp": true,
  "notifyViaEmail": false,
  "visibleToClient": true,
  "isActive": true,
  "documentRequests": [],
  "documentDeliveries": [],
  "dueScope": "FEDERAL",
  "onlyListedLocations": false,
  "dueRules": []
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-recurring-templatesidassignments"></a>

### Clientes que recebem a recorrência

- **Method:** `GET`
- **Path:** `/recurring-templates/{id}/assignments`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-recurring-templatesidassignments"></a>

### Incluir cliente na recorrência

- **Method:** `POST`
- **Path:** `/recurring-templates/{id}/assignments`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`clientId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`

<a id="scalar-example-66"></a>

**Generated example:**

```json
{
  "clientId": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-recurring-templatesidgeneration-log"></a>

### Registro das gerações

- **Method:** `GET`
- **Path:** `/recurring-templates/{id}/generation-log`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-recurring-templatesidassignmentsassignmentid"></a>

### Alterar cliente da recorrência

- **Method:** `PATCH`
- **Path:** `/recurring-templates/{id}/assignments/{assignmentId}`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`
- **`assignmentId` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`isActive`**: `boolean`

<a id="scalar-example-67"></a>

**Generated example:**

```json
{
  "isActive": true
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-recurring-templatesidassignmentsassignmentid"></a>

### Tirar cliente da recorrência

- **Method:** `DELETE`
- **Path:** `/recurring-templates/{id}/assignments/{assignmentId}`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`
- **`assignmentId` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-recurring-templatesidassignmentsbulk-generate"></a>

### Gerar a competência para todos os clientes da recorrência

- **Method:** `POST`
- **Path:** `/recurring-templates/{id}/assignments/bulk-generate`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`assignmentIds` (required)**: `array`, minItems: `1`

  **Items:**

  `string`, pattern: `^[cC][^\s-]{8,}$`
- **`dueMonth` (required)**: `string`, format: `date-time`

<a id="scalar-example-68"></a>

**Generated example:**

```json
{
  "dueMonth": "2026-11-25T20:59:58.895Z",
  "assignmentIds": [
    ""
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-recurring-templatesidassignmentsbulk-regenerate"></a>

### Gerar de novo a competência para os clientes da recorrência

- **Method:** `POST`
- **Path:** `/recurring-templates/{id}/assignments/bulk-regenerate`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`assignmentIds` (required)**: `array`, minItems: `1`

  **Items:**

  `string`, pattern: `^[cC][^\s-]{8,}$`
- **`dueMonth` (required)**: `string`, format: `date-time`

<a id="scalar-example-69"></a>

**Generated example:**

```json
{
  "dueMonth": "2026-11-25T20:59:58.897Z",
  "assignmentIds": [
    ""
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-recurring-templatesbulk-generate"></a>

### Gerar a competência de todas as recorrências

- **Method:** `POST`
- **Path:** `/recurring-templates/bulk-generate`
- **Tags:** Tarefas recorrentes

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`dueMonth` (required)**: `string`, format: `date-time`

<a id="scalar-example-70"></a>

**Generated example:**

```json
{
  "dueMonth": "2026-11-25T20:59:58.899Z"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-client-users"></a>

### Listar usuários do portal

- **Method:** `GET`
- **Path:** `/client-users`
- **Tags:** Usuários do portal

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-client-users"></a>

### Cadastrar usuário do portal

- **Method:** `POST`
- **Path:** `/client-users`
- **Tags:** Usuários do portal

Pessoa do cliente que acompanha os processos; os acessos são por cliente e departamento.

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`accesses` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`clientId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - **`departmentId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`email` (required)**: `string`, format: `email`
- **`name` (required)**: `string`, minLength: `2`
- **`password` (required)**: `string`, minLength: `8`
- **`isActive`**: `boolean`, default: `true`
- **`phone`**: `string`

<a id="scalar-example-71"></a>

**Generated example:**

```json
{
  "name": "",
  "email": "hello@example.com",
  "password": "",
  "phone": "",
  "isActive": true,
  "accesses": [
    {
      "clientId": "",
      "departmentId": ""
    }
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-client-usersid"></a>

### Detalhe do usuário do portal

- **Method:** `GET`
- **Path:** `/client-users/{id}`
- **Tags:** Usuários do portal

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-client-usersid"></a>

### Alterar usuário do portal

- **Method:** `PATCH`
- **Path:** `/client-users/{id}`
- **Tags:** Usuários do portal

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`accesses`**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`clientId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - **`departmentId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`email`**: `string`, format: `email`
- **`isActive`**: `boolean`
- **`name`**: `string`, minLength: `2`
- **`password`**: `string`, minLength: `8`
- **`phone`**: `string | null`

<a id="scalar-example-72"></a>

**Generated example:**

```json
{
  "name": "",
  "email": "hello@example.com",
  "password": "",
  "phone": null,
  "isActive": true,
  "accesses": [
    {
      "clientId": "",
      "departmentId": ""
    }
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-client-usersid"></a>

### Remover usuário do portal

- **Method:** `DELETE`
- **Path:** `/client-users/{id}`
- **Tags:** Usuários do portal

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-process-templates"></a>

### Listar modelos de processo

- **Method:** `GET`
- **Path:** `/process-templates`
- **Tags:** Modelos de processo

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-process-templates"></a>

### Criar modelo de processo

- **Method:** `POST`
- **Path:** `/process-templates`
- **Tags:** Modelos de processo

Colunas e as OS de cada uma, com dependências.

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`columns` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`title` (required)**: `string`, minLength: `1`
  - **`documents`**: `array`, default: `[]`

    **Items:**

    no additional properties
    - **`name` (required)**: `string`, minLength: `1`
  - **`notifyClient`**: `boolean`, default: `false`
  - **`statusEffect`**: `string`, possible values: `"NONE", "OPEN", "STARTED", "BLOCKED", "DISREGARDED", "DONE"`, default: `"NONE"`
- **`name` (required)**: `string`, minLength: `1`
- **`clientCanRequest`**: `boolean`
- **`deadlineBusinessDays`**: `integer | null`, minimum: `1`, maximum: `365`
- **`departmentId`**: `string | null`, minLength: `1`
- **`description`**: `string`
- **`isActive`**: `boolean`, default: `true`
- **`items`**: `array`, maxItems: `100`

  **Items:**

  no additional properties
  - **`columnIndex` (required)**: `integer`, minimum: `0`
  - **`osModelId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - **`dependsOn`**: `array`, default: `[]`

    **Items:**

    `integer`, minimum: `0`

<a id="scalar-example-73"></a>

**Generated example:**

```json
{
  "name": "",
  "description": "",
  "isActive": true,
  "departmentId": "",
  "deadlineBusinessDays": 1,
  "clientCanRequest": true,
  "columns": [
    {
      "title": "",
      "statusEffect": "NONE",
      "notifyClient": false,
      "documents": []
    }
  ],
  "items": [
    {
      "osModelId": "",
      "columnIndex": 0,
      "dependsOn": []
    }
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-process-templatesid"></a>

### Detalhe do modelo de processo

- **Method:** `GET`
- **Path:** `/process-templates/{id}`
- **Tags:** Modelos de processo

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-process-templatesid"></a>

### Arquivar modelo de processo

- **Method:** `DELETE`
- **Path:** `/process-templates/{id}`
- **Tags:** Modelos de processo

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-process-templatesid"></a>

### Alterar modelo de processo

- **Method:** `PATCH`
- **Path:** `/process-templates/{id}`
- **Tags:** Modelos de processo

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`clientCanRequest`**: `boolean`
- **`columns`**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`title` (required)**: `string`, minLength: `1`
  - **`documents`**: `array`, default: `[]`

    **Items:**

    no additional properties
    - **`name` (required)**: `string`, minLength: `1`
  - **`notifyClient`**: `boolean`, default: `false`
  - **`statusEffect`**: `string`, possible values: `"NONE", "OPEN", "STARTED", "BLOCKED", "DISREGARDED", "DONE"`, default: `"NONE"`
- **`deadlineBusinessDays`**: `integer | null`, minimum: `1`, maximum: `365`
- **`departmentId`**: `string | null`, minLength: `1`
- **`description`**: `string | null`
- **`isActive`**: `boolean`, default: `true`
- **`items`**: `array`, maxItems: `100`

  **Items:**

  no additional properties
  - **`columnIndex` (required)**: `integer`, minimum: `0`
  - **`osModelId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
  - **`dependsOn`**: `array`, default: `[]`

    **Items:**

    `integer`, minimum: `0`
- **`name`**: `string`, minLength: `1`

<a id="scalar-example-74"></a>

**Generated example:**

```json
{
  "name": "",
  "description": null,
  "isActive": true,
  "departmentId": "",
  "deadlineBusinessDays": 1,
  "clientCanRequest": true,
  "columns": [
    {
      "title": "",
      "statusEffect": "NONE",
      "notifyClient": false,
      "documents": []
    }
  ],
  "items": [
    {
      "osModelId": "",
      "columnIndex": 0,
      "dependsOn": []
    }
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-slaconfig"></a>

### Regras de alerta de prazo do escritório

- **Method:** `GET`
- **Path:** `/sla/config`
- **Tags:** SLA

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-slacustom-sound-url"></a>

### Link do som de alerta personalizado

- **Method:** `GET`
- **Path:** `/sla/custom-sound-url`
- **Tags:** SLA

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-slapreferences"></a>

### Minhas preferências de alerta de prazo

- **Method:** `GET`
- **Path:** `/sla/preferences`
- **Tags:** SLA

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-slapreferences"></a>

### Alterar minhas preferências de alerta

- **Method:** `PATCH`
- **Path:** `/sla/preferences`
- **Tags:** SLA

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`dueCriticalSound`**: `string`, possible values: `"CHIME", "BELL", "SOFT_PING", "MUTE", "ORG_CUSTOM"`
- **`dueCriticalVolume`**: `integer`, minimum: `0`, maximum: `100`
- **`targetWarningSound`**: `string`, possible values: `"CHIME", "BELL", "SOFT_PING", "MUTE", "ORG_CUSTOM"`
- **`targetWarningVolume`**: `integer`, minimum: `0`, maximum: `100`

<a id="scalar-example-75"></a>

**Generated example:**

```json
{
  "targetWarningSound": "CHIME",
  "targetWarningVolume": 0,
  "dueCriticalSound": "CHIME",
  "dueCriticalVolume": 0
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readerupload"></a>

### Enviar documentos para o robô ler

- **Method:** `POST`
- **Path:** `/document-reader/upload`
- **Tags:** Robô de documentos

O robô identifica cliente, obrigação e competência e sugere a tarefa.

**Quem pode:** Admin, Gerente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-76"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-document-readerfila"></a>

### Fila de revisão do robô

- **Method:** `GET`
- **Path:** `/document-reader/fila`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`scope`**: `string`, possible values: `"mine", "department", "all"`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-document-readeridvisualizar"></a>

### Link para ver o documento lido

- **Method:** `GET`
- **Path:** `/document-reader/{id}/visualizar`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-document-readerrejeitados"></a>

### Documentos rejeitados

- **Method:** `GET`
- **Path:** `/document-reader/rejeitados`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-document-readerobrigacoes"></a>

### Tipos de obrigação que o robô reconhece

- **Method:** `GET`
- **Path:** `/document-reader/obrigacoes`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readerobrigacoes"></a>

### Cadastrar tipo de obrigação

- **Method:** `POST`
- **Path:** `/document-reader/obrigacoes`
- **Tags:** Robô de documentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`code` (required)**: `string`, minLength: `1`
- **`name` (required)**: `string`, minLength: `1`

<a id="scalar-example-77"></a>

**Generated example:**

```json
{
  "code": "",
  "name": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-document-readermetricas"></a>

### Métricas do robô de documentos

- **Method:** `GET`
- **Path:** `/document-reader/metricas`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readerconfirmar-lote"></a>

### Confirmar várias sugestões do robô

- **Method:** `POST`
- **Path:** `/document-reader/confirmar-lote`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`ids` (required)**: `array`, minItems: `1`, maxItems: `50`

  **Items:**

  `string`, pattern: `^[cC][^\s-]{8,}$`

<a id="scalar-example-78"></a>

**Generated example:**

```json
{
  "ids": [
    ""
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readeridconfirmar"></a>

### Confirmar sugestão: anexar o documento à tarefa

- **Method:** `POST`
- **Path:** `/document-reader/{id}/confirmar`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`amount`**: `string`
- **`deliverableId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`paymentDueDate`**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`

<a id="scalar-example-79"></a>

**Generated example:**

```json
{
  "deliverableId": "",
  "amount": "",
  "paymentDueDate": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readeridtrocar-tarefa"></a>

### Escolher outra tarefa para o documento

- **Method:** `POST`
- **Path:** `/document-reader/{id}/trocar-tarefa`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`taskId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`amount`**: `string`
- **`deliverableId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`paymentDueDate`**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`

<a id="scalar-example-80"></a>

**Generated example:**

```json
{
  "deliverableId": "",
  "amount": "",
  "paymentDueDate": "",
  "taskId": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readeridrejeitar"></a>

### Rejeitar documento

- **Method:** `POST`
- **Path:** `/document-reader/{id}/rejeitar`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readeridreabrir"></a>

### Devolver documento rejeitado à fila

- **Method:** `POST`
- **Path:** `/document-reader/{id}/reabrir`
- **Tags:** Robô de documentos

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-notifications"></a>

### Avisos do sino

- **Method:** `GET`
- **Path:** `/notifications`
- **Tags:** Notificações

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Query parameters

- **`status`**: `string`, possible values: `"all", "read", "unread"`
- **`type`**: `string`, possible values: `"TASK_COMMENT", "REQUEST_CREATED", "REQUEST_COMMENT", "DOCUMENT_UPLOADED", "APPROVAL_REQUESTED", "APPROVAL_DECIDED", "TASK_ASSUMED", "TASK_ASSIGNED", "BOARD_ASSIGNED", "DOCUMENT_RECEIVED", "DOCUMENT_REJECTED", "REQUEST_STATUS"`
- **`clientId`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`from`**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`
- **`to`**: `string`, pattern: `^\d{4}-\d{2}-\d{2}$`
- **`q`**: `string`, maxLength: `200`
- **`cursor`**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`limit`**: `integer`, minimum: `1`, maximum: `50`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-notificationsunread-count"></a>

### Avisos não lidos

- **Method:** `GET`
- **Path:** `/notifications/unread-count`
- **Tags:** Notificações

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-notificationsread-all"></a>

### Marcar todos os avisos como lidos

- **Method:** `POST`
- **Path:** `/notifications/read-all`
- **Tags:** Notificações

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-notificationsread-by-task"></a>

### Marcar como lidos os avisos de uma tarefa

- **Method:** `POST`
- **Path:** `/notifications/read-by-task`
- **Tags:** Notificações

**Quem pode:** Admin, Gerente, Membro, Cliente, Master

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`taskId` (required)**: `string`, minLength: `1`

<a id="scalar-example-81"></a>

**Generated example:**

```json
{
  "taskId": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-notificationsidread"></a>

### Marcar aviso como lido

- **Method:** `POST`
- **Path:** `/notifications/{id}/read`
- **Tags:** Notificações

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-notificationsidunread"></a>

### Marcar aviso como não lido

- **Method:** `POST`
- **Path:** `/notifications/{id}/unread`
- **Tags:** Notificações

**Quem pode:** Admin, Gerente, Membro, Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-tasksidapprovals"></a>

### Aprovações pedidas ao cliente nesta tarefa

- **Method:** `GET`
- **Path:** `/tasks/{id}/approvals`
- **Tags:** Tarefas

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-tasksidapprovals"></a>

### Pedir aprovação ao cliente

- **Method:** `POST`
- **Path:** `/tasks/{id}/approvals`
- **Tags:** Tarefas

O arquivo a aprovar vai depois dos campos.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`
- **`message`**: `string`

  Mensagem ao cliente (opcional)
- **`title`**: `string`

  O que o cliente deve aprovar (até 200 caracteres)

<a id="scalar-example-82"></a>

**Generated example:**

```json
{
  "title": "",
  "message": "",
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-approvalsidclose"></a>

### Encerrar aprovação sem resposta do cliente

- **Method:** `POST`
- **Path:** `/approvals/{id}/close`
- **Tags:** Aprovações

JSON `{ reason, note }`, ou multipart com os mesmos campos antes de um print opcional como prova.

**Quem pode:** Admin, Gerente, Membro

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`note` (required)**: `string`, minLength: `1`, maxLength: `2000`
- **`reason` (required)**: `string`, possible values: `"APPROVED_OUTSIDE", "NO_RESPONSE"`

<a id="scalar-example-83"></a>

**Generated example:**

```json
{
  "reason": "APPROVED_OUTSIDE",
  "note": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-portalapprovalsidapprove"></a>

### Aprovar o que o escritório enviou

- **Method:** `POST`
- **Path:** `/portal/approvals/{id}/approve`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`note`**: `string`, maxLength: `2000`

<a id="scalar-example-84"></a>

**Generated example:**

```json
{
  "note": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-portalapprovalsidrequest-changes"></a>

### Pedir ajuste no que o escritório enviou

- **Method:** `POST`
- **Path:** `/portal/approvals/{id}/request-changes`
- **Tags:** Portal do cliente

**Quem pode:** Cliente

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`note` (required)**: `string`, minLength: `1`, maxLength: `2000`

<a id="scalar-example-85"></a>

**Generated example:**

```json
{
  "note": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readermodelosanalisar"></a>

### Ler um PDF de exemplo para montar um modelo

- **Method:** `POST`
- **Path:** `/document-reader/modelos/analisar`
- **Tags:** Robô de documentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `multipart/form-data`

- **`file` (required)**: `string`, format: `binary`

<a id="scalar-example-86"></a>

**Generated example:**

```json
{
  "file": "@filename"
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-get-document-readermodelos"></a>

### Modelos de leitura

- **Method:** `GET`
- **Path:** `/document-reader/modelos`
- **Tags:** Robô de documentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readermodelos"></a>

### Criar modelo de leitura

- **Method:** `POST`
- **Path:** `/document-reader/modelos`
- **Tags:** Robô de documentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`ancoras` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`pagina` (required)**: `integer`, minimum: `1`
  - **`texto` (required)**: `string`, minLength: `1`
  - **`x` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`y` (required)**: `number`, minimum: `0`, maximum: `1`
- **`nome` (required)**: `string`, minLength: `1`
- **`obligationTypeId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`zonas` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`campo` (required)**: `string`, minLength: `1`
  - **`h` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`pagina` (required)**: `integer`, minimum: `1`
  - **`tipo` (required)**: `string`, possible values: `"cnpj", "data", "competencia", "periodo_apuracao", "moeda", "texto"`
  - **`w` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`x` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`y` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`opcional`**: `boolean`

<a id="scalar-example-87"></a>

**Generated example:**

```json
{
  "nome": "",
  "obligationTypeId": "",
  "ancoras": [
    {
      "texto": "",
      "pagina": 1,
      "x": 0,
      "y": 0
    }
  ],
  "zonas": [
    {
      "campo": "",
      "pagina": 1,
      "x": 0,
      "y": 0,
      "w": 0,
      "h": 0,
      "tipo": "cnpj",
      "opcional": true
    }
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-post-document-readermodelosverificar-colisao"></a>

### Verificar se o modelo conflita com outro

- **Method:** `POST`
- **Path:** `/document-reader/modelos/verificar-colisao`
- **Tags:** Robô de documentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`ancoras` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`pagina` (required)**: `integer`, minimum: `1`
  - **`texto` (required)**: `string`, minLength: `1`
  - **`x` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`y` (required)**: `number`, minimum: `0`, maximum: `1`
- **`paginas` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`itens` (required)**: `array`

    **Items:**

    no additional properties
    - **`h` (required)**: `number`, minimum: `0`, maximum: `1`
    - **`str` (required)**: `string`
    - **`w` (required)**: `number`, minimum: `0`, maximum: `1`
    - **`x` (required)**: `number`, minimum: `0`, maximum: `1`
    - **`y` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`numero` (required)**: `integer`, minimum: `1`
  - **`altura`**: `number`
  - **`largura`**: `number`
- **`excluirModeloId`**: `string`, pattern: `^[cC][^\s-]{8,}$`

<a id="scalar-example-88"></a>

**Generated example:**

```json
{
  "paginas": [
    {
      "numero": 1,
      "itens": [
        {
          "str": "",
          "x": 0,
          "y": 0,
          "w": 0,
          "h": 0
        }
      ],
      "largura": 1,
      "altura": 1
    }
  ],
  "ancoras": [
    {
      "texto": "",
      "pagina": 1,
      "x": 0,
      "y": 0
    }
  ],
  "excluirModeloId": ""
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-patch-document-readermodelosid"></a>

### Alterar modelo de leitura

- **Method:** `PATCH`
- **Path:** `/document-reader/modelos/{id}`
- **Tags:** Robô de documentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Request body

**Required:** `true`

**Content type:** `application/json`

no additional properties

- **`ancoras` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`pagina` (required)**: `integer`, minimum: `1`
  - **`texto` (required)**: `string`, minLength: `1`
  - **`x` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`y` (required)**: `number`, minimum: `0`, maximum: `1`
- **`nome` (required)**: `string`, minLength: `1`
- **`obligationTypeId` (required)**: `string`, pattern: `^[cC][^\s-]{8,}$`
- **`zonas` (required)**: `array`, minItems: `1`

  **Items:**

  no additional properties
  - **`campo` (required)**: `string`, minLength: `1`
  - **`h` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`pagina` (required)**: `integer`, minimum: `1`
  - **`tipo` (required)**: `string`, possible values: `"cnpj", "data", "competencia", "periodo_apuracao", "moeda", "texto"`
  - **`w` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`x` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`y` (required)**: `number`, minimum: `0`, maximum: `1`
  - **`opcional`**: `boolean`

<a id="scalar-example-89"></a>

**Generated example:**

```json
{
  "nome": "",
  "obligationTypeId": "",
  "ancoras": [
    {
      "texto": "",
      "pagina": 1,
      "x": 0,
      "y": 0
    }
  ],
  "zonas": [
    {
      "campo": "",
      "pagina": 1,
      "x": 0,
      "y": 0,
      "w": 0,
      "h": 0,
      "tipo": "cnpj",
      "opcional": true
    }
  ]
}
```

#### Responses

##### 200 Default Response

<a id="scalar-operation-delete-document-readermodelosid"></a>

### Arquivar modelo de leitura

- **Method:** `DELETE`
- **Path:** `/document-reader/modelos/{id}`
- **Tags:** Robô de documentos

**Quem pode:** Admin

**Servers:** [Inherited servers](#scalar-context-global-servers)

#### Authentication

- **bearerAuth**: HTTP bearer (`JWT`)

#### Path parameters

- **`id` (required)**: `string`

#### Responses

##### 200 Default Response
