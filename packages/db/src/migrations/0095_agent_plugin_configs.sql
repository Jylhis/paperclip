CREATE TABLE "agent_plugin_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"server_binary" text NOT NULL,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cwd" text,
	"timeout_sec" integer DEFAULT 30 NOT NULL,
	"restart_policy" text DEFAULT 'on_failure' NOT NULL,
	"workspace_scope" text DEFAULT 'agent' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_plugin_configs" ADD CONSTRAINT "agent_plugin_configs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_plugin_configs" ADD CONSTRAINT "agent_plugin_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_plugin_configs_agent_name_idx" ON "agent_plugin_configs" USING btree ("agent_id","name");
--> statement-breakpoint
CREATE INDEX "agent_plugin_configs_company_agent_idx" ON "agent_plugin_configs" USING btree ("company_id","agent_id");
