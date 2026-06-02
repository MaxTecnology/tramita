# Schema Prisma — Tramita

```prisma
// Tramita — SaaS da AutoHubs
// Domínio único: tramita.autohubs.com.br
// Roteamento por role pós-login:
//   MASTER      → /master/dashboard
//   ORG_*       → /app/dashboard
//   CLIENT      → /portal/board
// O slug da Organization identifica o escritório no contexto do JWT,
// não como subdomínio — todos os usuários acessam o mesmo domínio.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Planos (configurados pelo Master AutoHubs) ───────────────────────────────

model Plan {
  id              String   @id @default(cuid())
  name            String   // "Starter", "Pro", "Enterprise"
  maxClients      Int      // limite de clientes ativos
  priceMonthly    Decimal  @db.Decimal(10, 2)
  features        Json     // { pdf: true, sse: true, attachments: true }
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organizations   Organization[]

  @@map("plans")
}

// ─── Escritórios Contábeis (Tenants) ─────────────────────────────────────────

model Organization {
  id              String             @id @default(cuid())
  name            String
  slug            String             @unique // ex: "g2a" → tramita.autohubs.com.br/portal?org=g2a
  cnpj            String?            @unique
  email           String             @unique
  phone           String?
  planId          String
  subscriptionStatus SubscriptionStatus @default(TRIAL)
  trialEndsAt     DateTime?
  gracePeriodEndsAt DateTime?
  asaasCustomerId String?            // ID do customer no Asaas
  asaasSubscriptionId String?        // ID da subscription no Asaas
  isActive        Boolean            @default(true)
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  plan                Plan               @relation(fields: [planId], references: [id])
  users               User[]
  clients             Client[]
  boards              Board[]
  notificationConfig  NotificationConfig?
  messageTemplates    MessageTemplate[]
  notificationLogs    NotificationLog[]
  subscriptionHistory SubscriptionHistory[]

  @@map("organizations")
}

enum SubscriptionStatus {
  TRIAL
  ACTIVE
  GRACE_PERIOD
  SUSPENDED
  CANCELLED
}

// ─── Histórico de Assinatura ──────────────────────────────────────────────────

model SubscriptionHistory {
  id             String   @id @default(cuid())
  organizationId String
  event          String   // "PAYMENT_CONFIRMED" | "PAYMENT_OVERDUE" | "PLAN_CHANGED"
  planId         String?
  amount         Decimal? @db.Decimal(10, 2)
  asaasPaymentId String?
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])

  @@map("subscription_history")
}

// ─── Usuários Internos do Escritório ─────────────────────────────────────────

model User {
  id             String   @id @default(cuid())
  name           String
  email          String   @unique
  passwordHash   String
  role           UserRole @default(ORG_MEMBER)
  phone          String?
  organizationId String
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization  Organization @relation(fields: [organizationId], references: [id])
  assignedTasks Task[]       @relation("TaskAssignee")
  createdTasks  Task[]       @relation("TaskCreator")
  comments      Comment[]
  attachments   Attachment[]

  @@map("users")
}

enum UserRole {
  MASTER        // AutoHubs — acesso global
  ORG_ADMIN     // Admin do escritório
  ORG_MANAGER   // Gerente do escritório
  ORG_MEMBER    // Colaborador do escritório
}

// ─── Clientes Finais ──────────────────────────────────────────────────────────

model Client {
  id             String   @id @default(cuid())
  name           String
  cnpj           String?
  email          String
  passwordHash   String
  whatsapp       String?  // ex: 5582999999999 — usado nas notificações WhatsApp
  organizationId String
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  boards       Board[]
  comments     Comment[]

  @@unique([email, organizationId])
  @@map("clients")
}

// ─── Boards de Processo ───────────────────────────────────────────────────────

model Board {
  id             String   @id @default(cuid())
  title          String
  description    String?
  organizationId String
  clientId       String
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  client       Client       @relation(fields: [clientId], references: [id])
  columns      Column[]

  @@map("boards")
}

// ─── Colunas (Etapas do Processo) ────────────────────────────────────────────

model Column {
  id        String   @id @default(cuid())
  title     String
  position  Int
  color     String?
  isFinal   Boolean  @default(false) // dispara task.completed ao entrar aqui
  boardId   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  board Board  @relation(fields: [boardId], references: [id], onDelete: Cascade)
  tasks Task[]

  @@map("columns")
}

// ─── Tarefas / Processos ──────────────────────────────────────────────────────

model Task {
  id          String     @id @default(cuid())
  title       String
  description String?
  position    Int
  priority    Priority   @default(MEDIUM)
  status      TaskStatus @default(OPEN)
  dueDate     DateTime?
  columnId    String
  assigneeId  String?
  creatorId   String
  tags        String[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  column      Column        @relation(fields: [columnId], references: [id], onDelete: Cascade)
  assignee    User?         @relation("TaskAssignee", fields: [assigneeId], references: [id])
  creator     User          @relation("TaskCreator", fields: [creatorId], references: [id])
  comments    Comment[]
  history     TaskHistory[]
  attachments Attachment[]

  @@index([status])
  @@index([priority])
  @@index([dueDate])
  @@index([title])
  @@map("tasks")
}

enum Priority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum TaskStatus {
  OPEN
  IN_PROGRESS
  REVIEW
  DONE
  CANCELLED
}

// ─── Comentários ─────────────────────────────────────────────────────────────

model Comment {
  id         String            @id @default(cuid())
  content    String
  taskId     String
  authorType CommentAuthorType
  userId     String?
  clientId   String?
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt

  task   Task    @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user   User?   @relation(fields: [userId], references: [id])
  client Client? @relation(fields: [clientId], references: [id])

  @@map("comments")
}

enum CommentAuthorType {
  USER
  CLIENT
}

// ─── Histórico de Tarefas ─────────────────────────────────────────────────────

model TaskHistory {
  id        String   @id @default(cuid())
  taskId    String
  action    String   // "moved_to" | "assigned_to" | "priority_changed" | "commented" | "created"
  fromValue String?
  toValue   String?
  actorType String   // "user" | "client"
  actorId   String
  actorName String
  createdAt DateTime @default(now())

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@map("task_history")
}

// ─── Anexos (Backblaze B2) ──────────────────────────────────────────────────────

model Attachment {
  id         String   @id @default(cuid())
  taskId     String
  filename   String
  mimeType   String
  size       Int
  storageKey String
  uploadedBy String
  createdAt  DateTime @default(now())

  task     Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  uploader User @relation(fields: [uploadedBy], references: [id])

  @@map("attachments")
}

// ─── Configuração de Notificações por Escritório ──────────────────────────────

model NotificationConfig {
  id                   String   @id @default(cuid())
  organizationId       String   @unique
  // Canais habilitados
  whatsappEnabled      Boolean  @default(true)
  emailEnabled         Boolean  @default(true)
  // Eventos habilitados
  taskCreated          Boolean  @default(false) // interno apenas
  taskMoved            Boolean  @default(true)
  taskCompleted        Boolean  @default(true)
  commentAdded         Boolean  @default(true)
  dueDateAlert         Boolean  @default(true)
  // MaximizeBot
  maximizebotToken     String?  // Bearer token da org no MaximizeBot
  saveOnTicket         Boolean  @default(true)
  startChatbot         Boolean  @default(false)
  // Email
  smtpHost             String?
  smtpPort             Int?
  smtpUser             String?
  smtpPass             String?  // criptografado em AES-256
  emailFrom            String?  // ex: "G2A Contabilidade <noreply@g2a.com.br>"
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])

  // portalUrl é gerado dinamicamente no worker:
  // https://tramita.autohubs.com.br/portal — mesmo domínio para todos os escritórios
  // O slug da org é incluído no JWT do cliente, não na URL

  @@map("notification_configs")
}

// ─── Templates de Mensagem por Escritório ─────────────────────────────────────

model MessageTemplate {
  id             String          @id @default(cuid())
  organizationId String
  event          NotificationEvent
  channel        MessageChannel
  subject        String?         // apenas para email
  body           String          // template com variáveis {{clientName}}, {{taskTitle}}, etc.
  isActive       Boolean         @default(true)
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, event, channel])
  @@map("message_templates")
}

enum NotificationEvent {
  TASK_CREATED
  TASK_MOVED
  TASK_COMPLETED
  TASK_COMMENT_ADDED
  TASK_DUE_DATE_APPROACHING
}

enum MessageChannel {
  WHATSAPP
  EMAIL
}

// ─── Log de Notificações ──────────────────────────────────────────────────────

model NotificationLog {
  id             String             @id @default(cuid())
  organizationId String
  clientId       String?
  event          NotificationEvent
  channel        MessageChannel
  taskId         String?
  recipient      String             // número WhatsApp ou email
  message        String
  status         NotificationStatus @default(PENDING)
  error          String?
  sentAt         DateTime?
  createdAt      DateTime           @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])

  @@map("notification_logs")
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
}
```