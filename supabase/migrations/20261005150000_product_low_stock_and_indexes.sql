-- Migration: Add low_stock_threshold to site_settings and product query indexes
BEGIN;

ALTER TABLE IF EXISTS site_settings
ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 5;

CREATE INDEX IF NOT EXISTS products_active_featured_idx ON products(is_active, is_featured);
CREATE INDEX IF NOT EXISTS products_active_created_idx ON products(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS products_active_price_idx ON products(is_active, base_price);

COMMIT;
