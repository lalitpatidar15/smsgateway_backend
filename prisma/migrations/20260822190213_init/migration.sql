-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "GatewayStatus" AS ENUM ('PENDING', 'ACTIVE', 'OFFLINE', 'DEGRADED', 'DISABLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SmsJobStatus" AS ENUM ('QUEUED', 'SCHEDULED', 'CLAIMED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'RETRYING', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SmsPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "permissions" TEXT[],
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 100,
    "daily_limit" INTEGER NOT NULL DEFAULT 500,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "phone_number" TEXT,
    "token_hash" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "app_version" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "android_version" TEXT,
    "status" "GatewayStatus" NOT NULL DEFAULT 'PENDING',
    "last_seen_at" TIMESTAMP(3),
    "last_ip" TEXT,
    "battery" INTEGER,
    "charging" BOOLEAN,
    "network" TEXT,
    "signal_strength" INTEGER,
    "sim_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_sims" (
    "id" TEXT NOT NULL,
    "gateway_device_id" TEXT NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "subscription_id" TEXT,
    "carrier_name" TEXT,
    "phone_number" TEXT NOT NULL,
    "country_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_sims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_jobs" (
    "id" TEXT NOT NULL,
    "external_id" TEXT,
    "api_key_id" TEXT,
    "idempotency_key" TEXT,
    "recipient" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SmsJobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" "SmsPriority" NOT NULL DEFAULT 'NORMAL',
    "gateway_device_id" TEXT,
    "gateway_sim_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "scheduled_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "claim_expires_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "provider_reference" TEXT,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "segment_count" INTEGER NOT NULL DEFAULT 1,
    "encoding" TEXT NOT NULL DEFAULT 'GSM-7',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_attempts" (
    "id" TEXT NOT NULL,
    "sms_job_id" TEXT NOT NULL,
    "gateway_device_id" TEXT NOT NULL,
    "gateway_sim_id" TEXT,
    "attempt_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sms_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "gateway_device_id" TEXT,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_endpoint_id" TEXT NOT NULL,
    "sms_job_id" TEXT,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "status_code" INTEGER,
    "response" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_retry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "ip" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_devices_device_id_key" ON "gateway_devices"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_devices_token_hash_key" ON "gateway_devices"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_sims_gateway_device_id_slot_index_key" ON "gateway_sims"("gateway_device_id", "slot_index");

-- CreateIndex
CREATE UNIQUE INDEX "sms_jobs_external_id_key" ON "sms_jobs"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_jobs_idempotency_key_key" ON "sms_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "sms_jobs_status_scheduled_at_idx" ON "sms_jobs"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "sms_jobs_gateway_device_id_status_idx" ON "sms_jobs"("gateway_device_id", "status");

-- CreateIndex
CREATE INDEX "sms_jobs_recipient_idx" ON "sms_jobs"("recipient");

-- CreateIndex
CREATE INDEX "sms_jobs_created_at_idx" ON "sms_jobs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "gateway_sims" ADD CONSTRAINT "gateway_sims_gateway_device_id_fkey" FOREIGN KEY ("gateway_device_id") REFERENCES "gateway_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_jobs" ADD CONSTRAINT "sms_jobs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_jobs" ADD CONSTRAINT "sms_jobs_gateway_device_id_fkey" FOREIGN KEY ("gateway_device_id") REFERENCES "gateway_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_jobs" ADD CONSTRAINT "sms_jobs_gateway_sim_id_fkey" FOREIGN KEY ("gateway_sim_id") REFERENCES "gateway_sims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_attempts" ADD CONSTRAINT "sms_attempts_sms_job_id_fkey" FOREIGN KEY ("sms_job_id") REFERENCES "sms_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_attempts" ADD CONSTRAINT "sms_attempts_gateway_device_id_fkey" FOREIGN KEY ("gateway_device_id") REFERENCES "gateway_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_attempts" ADD CONSTRAINT "sms_attempts_gateway_sim_id_fkey" FOREIGN KEY ("gateway_sim_id") REFERENCES "gateway_sims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_gateway_device_id_fkey" FOREIGN KEY ("gateway_device_id") REFERENCES "gateway_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_endpoint_id_fkey" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_sms_job_id_fkey" FOREIGN KEY ("sms_job_id") REFERENCES "sms_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
