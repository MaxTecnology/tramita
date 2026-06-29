# Chaves JWT (RS256) — Geração e Rotação

A API assina os tokens de acesso com `JWT_PRIVATE_KEY` (RS256) e valida com
`JWT_PUBLIC_KEY` em todo request autenticado (`apps/api/src/lib/jwt.ts`). Sem
essas duas variáveis configuradas, login e qualquer rota autenticada falham.

## Por que ficam em variável de ambiente

É o mesmo modelo já usado para `DATABASE_URL`, `ASAAS_API_KEY`, `B2_APP_KEY`
etc. — não é um risco específico do JWT. Alternativas avaliadas e descartadas:

- **Guardar no banco de dados:** piora a segurança — quem comprometer o
  banco (SQL injection, backup vazado) passaria a conseguir forjar token de
  qualquer usuário, além de já ter acesso aos dados. Hoje esses dois riscos
  são separados.
- **Gerenciador de segredos dedicado (Vault, Infisical, etc.):** seria o
  upgrade correto em escala maior (múltiplos serviços/times), mas é
  infraestrutura desproporcional para um VPS único no Dokploy hoje.
- **Trocar para HS256 (segredo único):** resolveria o incômodo operacional
  do formato PEM, mas não foi feito — decisão de manter RS256 como está.

## Gerar um par novo para produção

**Não gerar nem colar a chave privada em chat, ticket ou qualquer lugar
versionado.** Rodar direto no terminal (local ou no servidor), copiar pro
painel do Dokploy, e apagar os arquivos locais na mesma sessão.

```bash
cd /tmp
openssl genrsa -out jwt-private-prod.pem 2048
openssl rsa -in jwt-private-prod.pem -pubout -out jwt-public-prod.pem
```

Gerar um par **novo e específico para produção** — nunca reaproveitar a
chave de desenvolvimento (`.env` local).

## Converter para variável de ambiente

`apps/api/src/lib/jwt.ts` aceita dois formatos — escolha conforme a
plataforma de deploy:

### Local / plataformas que preservam o valor exatamente como digitado

Uma linha com `\n` literal (duas letras: barra + n) separando as linhas do
PEM — é isso que `.replace(/\\n/g, '\n')` desfaz em runtime:

```bash
sed ':a;N;$!ba;s/\n/\\n/g' jwt-private-prod.pem
sed ':a;N;$!ba;s/\n/\\n/g' jwt-public-prod.pem
```

### Dokploy (e qualquer painel cujo gerador de `.env` desfaça o `\n`)

**Use este formato no Dokploy.** Algumas plataformas geram um arquivo
`.env` envolvendo o valor em aspas duplas, e o parser usado pelo `docker
compose` desfaz `\n` para quebra de linha real dentro de aspas — quebrando
o formato acima mesmo colado em uma linha só (erro visto na prática:
`unexpected character "+" in variable name "MIIEvQI..."`, o parser
interpretando o corpo da chave como se fosse o início de outra variável).

Para esse caso, codificar o PEM inteiro (com as quebras de linha reais) em
base64 — sem `\n`, sem caractere que confunda o parser:

```bash
base64 -w0 jwt-private-prod.pem
base64 -w0 jwt-public-prod.pem
```

(`-w0` desativa a quebra de linha do próprio `base64` — sem ela, o GNU
`base64` quebra a saída a cada 76 colunas, reintroduzindo o mesmo problema.
No macOS, usar `base64 -i jwt-private-prod.pem | tr -d '\n'` em vez disso.)

Cole a saída de cada um direto para `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` no
painel de Environment. `lib/jwt.ts` detecta automaticamente: se o valor
começa com `-----BEGIN`, trata como PEM com `\n` literal; senão, decodifica
como base64.

## Limpar os arquivos locais depois de copiar

```bash
shred -u jwt-private-prod.pem jwt-public-prod.pem 2>/dev/null || rm -f jwt-private-prod.pem jwt-public-prod.pem
```

`shred` sobrescreve antes de apagar — mais seguro que `rm` puro para um
arquivo que conteve chave privada. Se `shred` não existir no sistema, o `rm`
do fallback já evita deixar o `.pem` esquecido no disco.

## Cuidados de segurança

- `*.pem` já está no `.gitignore` do projeto — o cuidado de não versionar
  vale igualmente fora do git (notas, tickets, backups em texto puro).
- Depois de configurada em produção, a chave **não pode mudar** sem
  invalidar todas as sessões ativas — trocar só em caso de suspeita de
  comprometimento, e nesse caso é intencional forçar logout de todo mundo.
- Backup, se necessário, só em formato cifrado (ex: gerenciador de senhas) —
  nunca em texto puro.
