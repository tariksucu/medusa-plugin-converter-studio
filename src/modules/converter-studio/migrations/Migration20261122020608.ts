import { Migration } from '@medusajs/framework/mikro-orm/migrations';

export class Migration20261122020608 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "converter_studio_image_conversion" ("id" text not null, "product_id" text not null, "image_id" text null, "target" text check ("target" in ('image', 'thumbnail')) not null default 'image', "source_url" text not null, "result_url" text null, "result_file_id" text null, "from_format" text null, "to_format" text not null, "status" text check ("status" in ('processing', 'converted', 'skipped', 'failed', 'restored')) not null, "reason" text null, "message" text null, "credits" integer null, "source_size" integer null, "result_size" integer null, "conversion_id" text null, "trigger" text check ("trigger" in ('auto', 'manual', 'bulk')) not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "converter_studio_image_conversion_pkey" primary key ("id"));`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_converter_studio_image_conversion_deleted_at" ON "converter_studio_image_conversion" ("deleted_at") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_cs_image_conversion_product_id" ON "converter_studio_image_conversion" ("product_id") WHERE deleted_at IS NULL;`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_cs_image_conversion_status" ON "converter_studio_image_conversion" ("status") WHERE deleted_at IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "converter_studio_image_conversion" cascade;`);
  }
}
