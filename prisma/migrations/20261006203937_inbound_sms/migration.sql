-- AlterTable
ALTER TABLE "api_keys" ALTER COLUMN "permissions" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "webhook_endpoints" ALTER COLUMN "events" SET DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "inbound_sms" (
    "id" TEXT NOT NULL,
    "gateway_device_id" TEXT NOT NULL,
    "gateway_sim_id" TEXT,
    "client_message_id" TEXT,
    "sender" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "sim_slot" INTEGER,
    "subscription_id" TEXT,
    "read_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_sms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_sms_client_message_id_key" ON "inbound_sms"("client_message_id");

-- CreateIndex
CREATE INDEX "inbound_sms_gateway_received_idx" ON "inbound_sms"("gateway_device_id", "received_at");

-- CreateIndex
CREATE INDEX "inbound_sms_received_at_idx" ON "inbound_sms"("received_at");

-- CreateIndex
CREATE INDEX "inbound_sms_sender_idx" ON "inbound_sms"("sender");

-- AddForeignKey
ALTER TABLE "inbound_sms" ADD CONSTRAINT "inbound_sms_gateway_device_id_fkey" FOREIGN KEY ("gateway_device_id") REFERENCES "gateway_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_sms" ADD CONSTRAINT "inbound_sms_gateway_sim_id_fkey" FOREIGN KEY ("gateway_sim_id") REFERENCES "gateway_sims"("id") ON DELETE SET NULL ON UPDATE CASCADE;
