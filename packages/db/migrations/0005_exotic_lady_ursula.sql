ALTER TABLE "delivery" DROP CONSTRAINT "delivery_endpoint_id_endpoint_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_endpoint_id_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoint"("id") ON DELETE cascade ON UPDATE no action;