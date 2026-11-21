CREATE TABLE "series_reader_settings" (
	"user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"reader" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "series_reader_settings_user_id_series_id_pk" PRIMARY KEY("user_id","series_id")
);
--> statement-breakpoint
ALTER TABLE "series_reader_settings" ADD CONSTRAINT "series_reader_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_reader_settings" ADD CONSTRAINT "series_reader_settings_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;