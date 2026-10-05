-- Migration: Add track_inventory to products and color_name to product_variants
BEGIN;

ALTER TABLE IF EXISTS products
ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT true;

ALTER TABLE IF EXISTS product_variants
ADD COLUMN IF NOT EXISTS color_name text;

COMMIT;
