-- Wipes all client and operational data, keeping the tenant setup:
--   kept: plans, organizations, subscription_history, users (staff), user_sla_preferences,
--         departments, notification_configs, message_templates, obligation_types,
--         document_models, os_templates (+columns/docs), recurring_task_templates (+documents)
--   wiped: clients, client users/accesses/assignments, boards/columns/tasks and everything
--          hanging off them, requests, protocols, received documents, notification logs,
--          recurring assignments and generation logs
--
-- Pre-production only. Irreversible: take a pg_dump before running.
-- No CASCADE on purpose: if a table referencing these exists and is not listed,
-- Postgres aborts instead of silently wiping it.

BEGIN;

TRUNCATE TABLE
  request_attachments,
  request_comments,
  requests,
  protocol_events,
  protocols,
  protocol_counters,
  received_documents,
  notification_logs,
  task_deliverables,
  task_document_requirements,
  task_history,
  comments,
  attachments,
  tasks,
  column_documents,
  columns,
  boards,
  recurring_generation_logs,
  recurring_task_assignments,
  client_user_accesses,
  client_assignments,
  client_users,
  clients;

COMMIT;

-- Sanity check: every count below must be 0
SELECT 'clients' AS t, count(*) FROM clients
UNION ALL SELECT 'client_users', count(*) FROM client_users
UNION ALL SELECT 'tasks', count(*) FROM tasks
UNION ALL SELECT 'boards', count(*) FROM boards
UNION ALL SELECT 'requests', count(*) FROM requests;
