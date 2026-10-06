-- Migration: 20261006000000_add_category_image_path.sql
-- Description: Add single category image path for public outer category card visual

ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_path text;
