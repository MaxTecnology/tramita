# Design — Cadastro de Organização pelo Master + Reset de Senha

## Contexto

Hoje a única forma de criar uma `Organization` é pela tela pública `/register`,
que sempre passa pelo fluxo de escolha de plano e — quando o plano não é
`trial` — tenta criar `customer`/`subscription` na Asaas, com rollback total
em caso de falha. A senha do primeiro usuário `ORG_ADMIN` é definida pelo
próprio escritório no formulário.

Para o onboarding manual de escritórios feito pelo Max (dono do produto), via
painel Master, isso é desnecessário: não há por que depender da Asaas nem do
formulário de autosserviço para cadastrar um cliente que ele mesmo está
trazendo pra dentro.

Além disso, hoje **não existe nenhuma forma de redefinir senha de ninguém no
sistema** (só o cliente final troca a própria senha no portal). Isso vira
problema direto quando o admin de um escritório cadastrado pelo Master
esquece a senha gerada e perde o acesso.

## Escopo

1. Endpoint + tela no Master para criar uma `Organization` + seu primeiro
   `ORG_ADMIN`, com senha gerada automaticamente e Asaas opcional.
2. Reset de senha de usuário:
   - Master pode redefinir a senha de qualquer usuário, de qualquer org.
   - `ORG_ADMIN` pode redefinir a senha de `ORG_MANAGER`/`ORG_MEMBER` da
     própria org (tela de Usuários já existente).

Fora de escopo: alterar o fluxo de `/register` público (continua como está);
fluxo de "esqueci minha senha" por e-mail (não existe SMTP/infra de envio
configurada com confiabilidade ainda — o reset aqui é sempre manual, feito
por quem tem permissão administrativa).

## Backend

### Helper de senha aleatória

`generateRandomPassword()` em `apps/api/src/modules/auth/auth.service.ts`,
ao lado de `hashPassword`. Gera 12 caracteres (letras maiúsculas/minúsculas,
números, 1 símbolo), excluindo caracteres visualmente ambíguos (`0/O`,
`1/l/I`). Usada tanto na criação de organização pelo Master quanto no reset
de senha — não existe hoje, e os dois fluxos novos precisam dela.

### Criação de organização pelo Master

Novo `createOrganizationByMaster` em `organizations.service.ts`, nova rota
`POST /master/organizations` (dentro de `masterOrgRoutes`, já protegida por
`requireRole('MASTER')` no `master/index.ts`).

Schema de entrada (`organizations.schema.ts`):

```typescript
export const createOrgByMasterSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  cnpj: z.string().optional(),
  planId: z.string(),
  adminName: z.string().min(2),
  createAsaasSubscription: z.boolean(),
}).refine(
  (data) => !data.createAsaasSubscription || !!data.cnpj,
  { message: 'CNPJ é obrigatório para criar assinatura na Asaas', path: ['cnpj'] },
)
```

Comportamento de `createOrganizationByMaster`:

1. Valida e-mail não duplicado (mesmo erro 409 do fluxo público).
2. Valida que `planId` existe e está `isActive` (404 se não).
3. Gera senha com `generateRandomPassword()`.
4. Cria `Organization` (`subscriptionStatus: 'ACTIVE'`, sem `trialEndsAt`) +
   `User` `ORG_ADMIN` em transação — mesmo padrão de transação já usado em
   `register()`.
5. Se `createAsaasSubscription === true`: chama `createCustomer` +
   `createSubscription` (mesma lógica/parâmetros já usados em `register()`
   para plano pago). Se falhar, desfaz a criação (deleta `User` +
   `Organization`) e relança erro 502 — mesmo comportamento do fluxo público.
6. Retorna `{ organization, user: { id, name, email, role }, temporaryPassword }`.
   `temporaryPassword` só existe nessa resposta — não é persistido em texto
   puro em nenhum lugar.

Decisão: esta função **não reaproveita `register()`** por dentro. Os dois
fluxos divergem em status inicial (`ACTIVE` vs `TRIAL`/condicionado ao
plano), origem da senha (gerada vs definida pelo usuário) e opcionalidade da
Asaas (sempre condicional ao plano vs flag explícita) — forçar uma função
compartilhada geraria mais ramificação condicional do que o ganho de não
duplicar o bloco de chamada+rollback da Asaas (~15 linhas).

### Reset de senha

Novo `resetUserPassword(id: string, organizationId?: string)` em
`users.service.ts`:

```typescript
export async function resetUserPassword(id: string, organizationId?: string) {
  const user = await prisma.user.findFirst({
    where: { id, isActive: true, ...(organizationId ? { organizationId } : {}) },
  })
  if (!user) throw new AppError(404, 'Usuário não encontrado')

  const temporaryPassword = generateRandomPassword()
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(temporaryPassword) },
  })
  return { id: user.id, name: user.name, email: user.email, temporaryPassword }
}
```

Quando `organizationId` é passado, o escopo é restrito a essa org (caso do
`ORG_ADMIN`); quando omitido, busca em qualquer org (caso do Master).

Rotas:

- `POST /users/:id/reset-password` em `users.routes.ts` — mesmo grupo de
  rotas já protegido por `requireRole('ORG_ADMIN')` + `checkSubscription`,
  chama `resetUserPassword(id, request.user.organizationId!)`.
- `POST /master/organizations/:orgId/users/:userId/reset-password` em
  `organizations.routes.ts` (`masterOrgRoutes`) — chama
  `resetUserPassword(userId)` sem escopo de org (Master pode resetar
  qualquer usuário), mas antes verifica que `userId` pertence a `orgId`
  (404 se não, evita reset cross-org por engano de UI).

### Detalhe de organização inclui lista de usuários

`getOrganization(id)` em `organizations.service.ts` hoje retorna só
`usersCount`. Passa a incluir também `users: { id, name, email, role,
isActive }[]` (já busca a org com `include`, só falta adicionar o `include`
de `users` e mapear no retorno) — necessário para a tela de detalhe da
organização no Master listar os usuários e oferecer o botão de reset por
linha.

## Frontend

### `apps/web/src/pages/master/Organizations.tsx`

- Botão "Criar organização" no topo da tabela, abre `Dialog` com os campos:
  nome, email, telefone (opcional), plano (select dos planos ativos), nome
  do admin, checkbox "Também criar assinatura na Asaas" (ao marcar, exibe e
  exige o campo CNPJ).
- Ao criar com sucesso: troca o conteúdo do dialog para uma tela de
  confirmação mostrando a senha gerada (texto monoespaçado + botão
  "Copiar"), com aviso "Essa senha não será mostrada novamente — repasse
  para o escritório agora." Fechar o dialog não permite reabrir a senha.
- Lista de organizações invalida (`useQuery` refetch) após o fechamento.

### Tela de detalhe da organização (Master) — nova

Hoje só existe a listagem (`Organizations.tsx`); não há tela de detalhe por
organização. Este trabalho cria `/master/organizations/:id`, minimamente:
nome, status, plano, e a lista de usuários da org com botão "Redefinir
senha" por linha (mesmo padrão de confirmação com senha exibida uma vez).
A listagem ganha um link (nome da org clicável) levando a essa tela nova.

### `apps/web/src/pages/app/Users.tsx` (tela de Usuários do escritório)

Botão "Redefinir senha" por linha de `ORG_MANAGER`/`ORG_MEMBER` (não exibido
na própria linha do `ORG_ADMIN` logado — ele já tem fluxo de troca de senha
separado, fora de escopo aqui). Mesmo padrão de modal de confirmação com
senha exibida uma vez.

## Testes

- `organizations.service.test.ts`: `createOrganizationByMaster` — sucesso
  sem Asaas, sucesso com Asaas mockada, rollback quando Asaas falha, 409 em
  e-mail duplicado, 404 em plano inexistente/inativo, erro de validação
  quando `createAsaasSubscription: true` sem CNPJ.
- `organizations.routes.test.ts`: 403 para quem não é `MASTER` no novo
  endpoint; `getOrganization` retornando a lista de `users`.
- `users.service.test.ts`: `resetUserPassword` — sucesso escopado por org,
  sucesso sem escopo (Master), 404 quando usuário pertence a outra org e a
  chamada é escopada.
- `users.routes.test.ts` / `organizations.routes.test.ts`: 403 nos dois
  endpoints de reset para roles sem permissão; reset cross-org do Master
  bloqueado quando `userId` não pertence a `orgId` informado na URL.

Sem testes de frontend dedicados (modais de formulário simples, fora do
padrão de cobertura do projeto).
