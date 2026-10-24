CREATE TABLE "invoice_pdfs" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"content" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"series" text NOT NULL,
	"financial_year" text NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "invoice_sequences_series_financial_year_pk" PRIMARY KEY("series","financial_year")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(16) NOT NULL,
	"series" text NOT NULL,
	"financial_year" text NOT NULL,
	"sequence" integer NOT NULL,
	"invoice_date" date NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"user_id" text,
	"payment_id" uuid NOT NULL,
	"subscription_id" uuid,
	"order_id" uuid,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"place_of_supply_state_code" char(2) NOT NULL,
	"supply_type" text NOT NULL,
	"pricing_mode" text NOT NULL,
	"line_items" jsonb NOT NULL,
	"tax_rate_bps" integer NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"utgst_paise" bigint NOT NULL,
	"igst_paise" bigint NOT NULL,
	"total_tax_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"provider_payment_id" text NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "invoices_series_fy_sequence_unique" UNIQUE("series","financial_year","sequence"),
	CONSTRAINT "invoices_number_length_check" CHECK (char_length("invoices"."invoice_number") <= 16),
	CONSTRAINT "invoices_supply_type_check" CHECK ("invoices"."supply_type" in ('intra-state', 'inter-state')),
	CONSTRAINT "invoices_totals_check" CHECK ("invoices"."total_paise" = "invoices"."taxable_paise" + "invoices"."cgst_paise" + "invoices"."sgst_paise" + "invoices"."utgst_paise" + "invoices"."igst_paise")
);
--> statement-breakpoint
ALTER TABLE "invoice_pdfs" ADD CONSTRAINT "invoice_pdfs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_user_idx" ON "invoices" USING btree ("user_id");