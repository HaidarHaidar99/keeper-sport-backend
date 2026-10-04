-- Keeper Sports - Final PostgreSQL / Supabase schema
-- Authentication and business logic are handled by the Express backend.
-- Supabase is used as PostgreSQL + Storage. Do NOT duplicate this schema in Supabase Auth.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE TYPE user_role AS ENUM ('user','admin','super_admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE auth_provider AS ENUM ('local','google'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE media_type AS ENUM ('image','video'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE size_type AS ENUM ('letter','numeric','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE discount_type AS ENUM ('percentage','fixed','custom'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_method AS ENUM ('cash_on_delivery','whish_money'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('unpaid','pending_verification','paid','failed','refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_status AS ENUM ('pending','accepted','preparing','on_delivery','delivered','rejected','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE badge_type AS ENUM ('premier_league','champions_league','la_liga'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE notification_recipient AS ENUM ('user','admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('order','review','contact','stock','payment','user','system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(trim(full_name)) > 0),
  email text NOT NULL,
  password_hash text,
  role user_role NOT NULL DEFAULT 'user',
  auth_provider auth_provider NOT NULL DEFAULT 'local',
  google_id text,
  is_verified boolean NOT NULL DEFAULT false,
  verification_token_hash text,
  verification_token_expires_at timestamptz,
  password_reset_token_hash text,
  password_reset_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_google_id_unique UNIQUE (google_id),
  CONSTRAINT users_auth_shape CHECK (
    (auth_provider='local' AND password_hash IS NOT NULL AND google_id IS NULL)
    OR
    (auth_provider='google' AND password_hash IS NULL AND google_id IS NOT NULL)
  )
);

-- Enforce at most one super admin. Initial promotion is done deliberately by backend/admin SQL.
CREATE UNIQUE INDEX IF NOT EXISTS users_single_super_admin_idx
ON users ((role)) WHERE role='super_admin';

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  discount_type discount_type NOT NULL,
  discount_value numeric(12,2),
  free_delivery boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offers_dates CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT offers_discount CHECK (
    (discount_type='percentage' AND discount_value IS NOT NULL AND discount_value >= 0 AND discount_value <= 100)
    OR (discount_type='fixed' AND discount_value IS NOT NULL AND discount_value >= 0)
    OR (discount_type='custom' AND (discount_value IS NULL OR discount_value >= 0))
  )
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  brand text,
  description text,
  base_price numeric(12,2) NOT NULL CHECK (base_price >= 0),
  old_price numeric(12,2) CHECK (old_price IS NULL OR old_price >= 0),
  stock_quantity integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_premium boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  is_best_seller boolean NOT NULL DEFAULT false,
  is_new_arrival boolean NOT NULL DEFAULT false,
  printing_available boolean NOT NULL DEFAULT false,
  badges_available boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_type media_type NOT NULL,
  storage_path text NOT NULL,
  alt_text text,
  color_value text,
  is_cover boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_media_one_cover_idx ON product_media(product_id) WHERE is_cover=true;

CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_value text,
  size_type size_type,
  color_value text,
  sku text UNIQUE,
  price numeric(12,2) CHECK (price IS NULL OR price >= 0),
  old_price numeric(12,2) CHECK (old_price IS NULL OR old_price >= 0),
  stock_quantity integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, size_value, color_value)
);

-- Offers can target products and/or categories without duplicating offer data.
CREATE TABLE IF NOT EXISTS offer_products (
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (offer_id, product_id)
);
CREATE TABLE IF NOT EXISTS offer_categories (
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (offer_id, category_id)
);

CREATE TABLE IF NOT EXISTS carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  guest_identifier text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL AND guest_identifier IS NULL) OR (user_id IS NULL AND guest_identifier IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS carts_user_unique_idx ON carts(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carts_guest_unique_idx ON carts(guest_identifier) WHERE guest_identifier IS NOT NULL;

CREATE TABLE IF NOT EXISTS cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  selected_variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  printed_name text,
  printed_number text,
  badge badge_type,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  guest_identifier text,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL AND guest_identifier IS NULL) OR (user_id IS NULL AND guest_identifier IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_product_idx ON favorites(user_id,product_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS favorites_guest_product_idx ON favorites(guest_identifier,product_id) WHERE guest_identifier IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1000;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number bigint NOT NULL UNIQUE DEFAULT nextval('order_number_seq'),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  guest_access_token_hash text,
  customer_full_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  area text NOT NULL,
  address text,
  location_url text,
  payment_method payment_method NOT NULL,
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  status order_status NOT NULL DEFAULT 'pending',
  rejection_message text,
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  delivery_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  accepted_at timestamptz,
  preparing_at timestamptz,
  on_delivery_at timestamptz,
  delivered_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL) OR (guest_access_token_hash IS NOT NULL)),
  CHECK ((status <> 'rejected') OR (rejection_message IS NOT NULL AND length(trim(rejection_message)) > 0))
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  category_name_snapshot text,
  cover_image_path_snapshot text,
  size_value_snapshot text,
  color_value_snapshot text,
  quantity integer NOT NULL CHECK (quantity > 0),
  original_unit_price numeric(12,2) NOT NULL CHECK (original_unit_price >= 0),
  unit_discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_discount_amount >= 0),
  final_unit_price numeric(12,2) NOT NULL CHECK (final_unit_price >= 0),
  printed_name text,
  printed_number text,
  badge badge_type,
  printing_price_snapshot numeric(12,2) NOT NULL DEFAULT 0 CHECK (printing_price_snapshot >= 0),
  badge_price_snapshot numeric(12,2) NOT NULL DEFAULT 0 CHECK (badge_price_snapshot >= 0),
  line_total numeric(12,2) NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status order_status NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  rating numeric(2,1) NOT NULL,
  review_text text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rating >= 0.5 AND rating <= 5 AND mod((rating * 10)::integer,5)=0)
);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_user_product_idx
ON product_reviews(user_id,product_id) WHERE product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  recipient_type notification_recipient NOT NULL,
  type notification_type NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  reference_type text,
  reference_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((recipient_type='user' AND recipient_user_id IS NOT NULL) OR recipient_type='admin')
);

CREATE TABLE IF NOT EXISTS site_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  site_name text NOT NULL DEFAULT 'Keeper Sports',
  logo_path text,
  favicon_path text,
  phone_number text,
  email text,
  whatsapp_number text,
  instagram_url text,
  facebook_url text,
  tiktok_url text,
  x_url text,
  location_name text,
  location_url text,
  about_us text,
  seo_title text,
  seo_description text,
  seo_keywords text[],
  delivery_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  printing_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (printing_price >= 0),
  badge_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (badge_price >= 0),
  premier_league_badge_available boolean NOT NULL DEFAULT true,
  champions_league_badge_available boolean NOT NULL DEFAULT true,
  la_liga_badge_available boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS hero_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  subtitle text,
  media_type media_type NOT NULL,
  media_path text NOT NULL,
  fallback_image_path text,
  primary_button_text text,
  primary_button_route text,
  secondary_button_text text,
  secondary_button_route text,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offer_bars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  route text,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- Common indexes
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id);
CREATE INDEX IF NOT EXISTS product_media_product_idx ON product_media(product_id,sort_order);
CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS cart_items_cart_idx ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS favorites_product_idx ON favorites(product_id);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status,created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON order_status_history(order_id,created_at);
CREATE INDEX IF NOT EXISTS reviews_product_visible_idx ON product_reviews(product_id,is_visible);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(recipient_user_id,is_read,created_at DESC);
CREATE INDEX IF NOT EXISTS offers_active_dates_idx ON offers(is_visible,starts_at,ends_at);

-- Generic updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','categories','offers','products','product_variants','carts','cart_items',
    'product_reviews','site_settings','hero_slides','offer_bars'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I',t,t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',t,t);
  END LOOP;
END $$;

-- Helpful rating view: only visible reviews count.
CREATE OR REPLACE VIEW product_rating_summary AS
SELECT
  product_id,
  round(avg(rating)::numeric,2) AS average_rating,
  count(*)::bigint AS ratings_count
FROM product_reviews
WHERE is_visible=true AND product_id IS NOT NULL
GROUP BY product_id;

COMMIT;
