import type { RouteDocs } from '@/api-docs/types'
import { changePasswordSchema, loginBodySchema, logoutBodySchema, refreshBodySchema, updateProfileSchema } from '@/modules/auth/auth.schema'
import { changePlanSchema, createOrgByMasterSchema, registerOrgSchema, updateOrgSchema } from '@/modules/organizations/organizations.schema'
import { createPlanSchema, updatePlanSchema } from '@/modules/plans/plans.schema'
import { createUserSchema, listUsersQuerySchema, updateMyProfileSchema, updateUserSchema, userOptionsQuerySchema } from '@/modules/users/users.schema'
import { portfolioQuerySchema, transferSchema } from '@/modules/users/responsibility-transfer.schema'
import { createClientUserSchema, updateClientUserSchema } from '@/modules/client-users/client-users.schema'
import { updateSlaPreferenceSchema } from '@/modules/sla/sla.schema'

// Login, accounts, the office subscription and the AutoHubs master panel
export const ACCESS_DOCS: RouteDocs = {
  'POST /auth/login': { summary: 'Entrar com e-mail e senha', description: 'Devolve `accessToken` (15 min) e `refreshToken`. Depois de 10 tentativas erradas (configurável) numa janela de 15 minutos, a conta fica bloqueada até a janela acabar.', body: loginBodySchema },
  'POST /auth/refresh': { summary: 'Renovar a sessão', description: 'Troca o `refreshToken` por um novo par de tokens. Recusa a sessão de usuário desativado ou com papel alterado.', body: refreshBodySchema },
  'POST /auth/logout': { summary: 'Sair', description: 'Invalida o `refreshToken` informado.', body: logoutBodySchema },
  'POST /auth/change-password': { summary: 'Trocar a própria senha', description: 'Encerra as outras sessões do usuário.', body: changePasswordSchema },
  'GET /auth/me': { summary: 'Perfil de quem está logado' },
  'PATCH /auth/me': { summary: 'Atualizar o próprio perfil', body: updateProfileSchema },

  'GET /master/plans': { summary: 'Listar planos' },
  'POST /master/plans': { summary: 'Criar plano', body: createPlanSchema },
  'PATCH /master/plans/:id': { summary: 'Alterar plano', body: updatePlanSchema },
  'DELETE /master/plans/:id': { summary: 'Desativar plano', description: 'Exclusão lógica: escritórios no plano continuam nele.' },
  'GET /master/organizations': { summary: 'Listar escritórios' },
  'GET /master/organizations/:id': { summary: 'Detalhe do escritório', description: 'Assinatura, plano, uso e usuários.' },
  'PATCH /master/organizations/:id': { summary: 'Alterar escritório', description: 'Plano, situação da assinatura e modo de cobrança (Asaas ou manual).', body: updateOrgSchema },
  'POST /master/organizations': { summary: 'Cadastrar escritório pelo painel master', body: createOrgByMasterSchema },
  'POST /master/organizations/:orgId/users/:userId/reset-password': { summary: 'Gerar senha provisória para usuário de um escritório' },
  'GET /master/revenue': { summary: 'Receita e assinaturas da AutoHubs' },

  'GET /organizations/plans': { summary: 'Planos à venda (página pública de cadastro)' },
  'GET /organizations/signup-status': { summary: 'Se o cadastro público está aberto' },
  'POST /organizations/register': { summary: 'Cadastrar escritório (autoatendimento)', description: 'Cria o escritório, o administrador e a assinatura no Asaas. Pode estar fechado (veja GET /organizations/signup-status).', body: registerOrgSchema },
  'GET /org/subscription': { summary: 'Assinatura do escritório' },
  'POST /org/subscription/change-plan': { summary: 'Trocar de plano', body: changePlanSchema },

  'POST /webhooks/asaas': { summary: 'Eventos de cobrança do Asaas', description: 'Chamado pelo Asaas com o token no header `asaas-access-token`. Atualiza a situação da assinatura; o mesmo evento repetido é ignorado.' },

  'GET /users/me': { summary: 'Meu usuário', description: 'Papel, departamentos e o que posso ver. Serve a equipe e o cliente do portal.' },
  'PATCH /users/me': { summary: 'Atualizar meu usuário', body: updateMyProfileSchema },
  'GET /users/options': { summary: 'Pessoas para escolher como responsável', description: 'Nome e departamentos de cada pessoa ativa da equipe.', querystring: userOptionsQuerySchema },
  'GET /users': { summary: 'Listar a equipe', description: 'Ativos por padrão; `status=inactive` lista os desativados (para reativar).', querystring: listUsersQuerySchema },
  'POST /users': { summary: 'Cadastrar pessoa da equipe', description: 'A senha é gerada pelo servidor e volta uma única vez em `temporaryPassword`.', body: createUserSchema },
  'POST /users/:id/reactivate': { summary: 'Reativar pessoa desativada', description: 'Volta com os mesmos departamentos. 409 se já estiver ativa.' },
  'PATCH /users/:id': { summary: 'Alterar pessoa da equipe', description: 'Mudar papel ou desativar encerra as sessões dela.', body: updateUserSchema },
  'DELETE /users/:id': { summary: 'Remover pessoa da equipe' },
  'POST /users/:id/reset-password': { summary: 'Gerar senha provisória' },
  'GET /users/:id/portfolio': { summary: 'Carteira da pessoa', description: 'Clientes, tarefas e recorrências pelas quais ela responde — usado antes de transferir.', querystring: portfolioQuerySchema },
  'POST /users/:id/transfer': { summary: 'Transferir responsabilidades para outra pessoa', body: transferSchema },

  'GET /client-users': { summary: 'Listar usuários do portal' },
  'GET /client-users/:id': { summary: 'Detalhe do usuário do portal' },
  'POST /client-users': { summary: 'Cadastrar usuário do portal', description: 'Pessoa do cliente que acompanha os processos; os acessos são por cliente e departamento.', body: createClientUserSchema },
  'PATCH /client-users/:id': { summary: 'Alterar usuário do portal', body: updateClientUserSchema },
  'DELETE /client-users/:id': { summary: 'Remover usuário do portal' },

  'GET /sla/config': { summary: 'Regras de alerta de prazo do escritório' },
  'GET /sla/custom-sound-url': { summary: 'Link do som de alerta personalizado' },
  'GET /sla/preferences': { summary: 'Minhas preferências de alerta de prazo' },
  'PATCH /sla/preferences': { summary: 'Alterar minhas preferências de alerta', body: updateSlaPreferenceSchema },
}
