-- CreateIndex
CREATE UNIQUE INDEX "subscription_history_asaasPaymentId_event_key" ON "subscription_history"("asaasPaymentId", "event");

