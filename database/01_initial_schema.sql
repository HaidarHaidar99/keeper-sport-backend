-- =============================================================================
-- Keeper Sports — Master Database Schema (Phase 1)
-- Version: 1.0 (Source of Truth)
-- Database: Supabase PostgreSQL
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. DROP EXISTING OBJECTS (FOR CLEAN INITIALIZATION)
-- =============================================================================
DROP TRIGGER IF EXISTS trg_set_order_number ON orders;
DROP TRIGGER IF EXISTS trg_check_product_image_limit ON product_images;
DROP TRIGGER IF EXISTS trg_check_active_hero_slides_limit ON hero_slides;

DROP FUNCTION IF EXISTS set_order_number();
DROP FUNCTION IF EXISTS check_product_image_limit();
DROP FUNCTION IF EXISTS check_active_hero_slides_limit();
DROP FUNCTION IF EXISTS reserve_variant_stock(UUID, INT, UUID);
DROP FUNCTION IF EXISTS release_variant_stock(UUID, INT, UUID, TEXT);
DROP FUNCTION IF EXISTS fulfill_order_variant_stock(UUID, INT, UUID);
DROP FUNCTION IF EXISTS record_physical_store_sale(UUID, INT, UUID, TEXT);

DROP TABLE IF EXISTS inventory_audit_logs CASCADE;
DROP TABLE IF EXISTS push_subscriptions CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS order_exchanges CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS review_images CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS product_images CASCADE;
DROP TABLE IF EXISTS product_variants CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS kit_options CASCADE;
DROP TABLE IF EXISTS kit_variants CASCADE;
DROP TABLE IF EXISTS kits CASCADE;
DROP TABLE IF EXISTS hero_slides CASCADE;
DROP TABLE IF EXISTS offers CASCADE;
DROP TABLE IF EXISTS website_settings CASCADE;
DROP TABLE IF EXISTS contact_messages CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS admins CASCADE;

DROP SEQUENCE IF EXISTS order_number_seq;

-- =============================================================================
-- 2. ACCOUNTS & PROFILES
-- =============================================================================

-- Table 1: admins
CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'super_admin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 2: customers
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    verification_token VARCHAR(255),
    reset_password_token VARCHAR(255),
    reset_password_expires_at TIMESTAMPTZ,
    -- Optional saved checkout convenience defaults (separate from historical orders)
    saved_phone VARCHAR(50),
    saved_country VARCHAR(100) DEFAULT 'Lebanon',
    saved_city VARCHAR(100),
    saved_address TEXT,
    saved_live_location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 3. CATALOG & INVENTORY
-- =============================================================================

-- Table 3: categories
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_en VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description_en TEXT,
    description_ar TEXT,
    image_url TEXT,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 4: products
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name_en VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description_en TEXT NOT NULL,
    description_ar TEXT NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL CHECK (base_price >= 0),
    is_sale_enabled BOOLEAN NOT NULL DEFAULT false,
    sale_price DECIMAL(10, 2) CHECK (
        sale_price IS NULL OR (sale_price >= 0 AND sale_price < base_price)
    ),
    is_featured BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 5: product_variants
CREATE TABLE product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    size VARCHAR(50), -- Nullable for products without sizes, or 'S', 'M', '42', etc.
    price DECIMAL(10, 2) CHECK (price IS NULL OR price >= 0), -- Nullable size-specific price override
    track_quantity BOOLEAN NOT NULL DEFAULT true,
    physical_stock INT NOT NULL DEFAULT 0 CHECK (physical_stock >= 0),
    reserved_stock INT NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
    -- Stored generated stock calculations
    available_stock INT GENERATED ALWAYS AS (
        GREATEST(0, physical_stock - reserved_stock)
    ) STORED,
    is_available BOOLEAN GENERATED ALWAYS AS (
        CASE 
            WHEN track_quantity = false THEN true 
            ELSE (physical_stock - reserved_stock) > 0 
        END
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_product_size UNIQUE (product_id, size)
);

-- Table 6: product_images (Max 3 images enforced by constraint & trigger)
CREATE TABLE product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    display_order INT NOT NULL CHECK (display_order IN (1, 2, 3)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_product_image_slot UNIQUE (product_id, display_order)
);

-- Table 17: inventory_audit_logs (Section 16: auditable inventory changes)
CREATE TABLE inventory_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    change_type VARCHAR(50) NOT NULL CHECK (
        change_type IN ('RESERVE', 'RELEASE', 'STORE_SALE', 'RESTOCK', 'EXCHANGE', 'ADJUSTMENT', 'DELIVERY_FULFILL')
    ),
    quantity_change INT NOT NULL,
    previous_physical INT NOT NULL,
    new_physical INT NOT NULL,
    previous_reserved INT NOT NULL,
    new_reserved INT NOT NULL,
    reference_id UUID, -- Links to orders(id), admins(id), or order_exchanges(id)
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 4. ORDERS & TRANSACTIONS
-- =============================================================================

CREATE SEQUENCE order_number_seq START WITH 1001;

-- Table 7: orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL, -- Nullable for guests
    guest_token_hash VARCHAR(64), -- SHA-256 hash of raw token for secure guest lookups
    -- Immutable delivery snapshot (Section 18)
    delivery_phone VARCHAR(50) NOT NULL,
    delivery_country VARCHAR(100) NOT NULL DEFAULT 'Lebanon',
    delivery_city VARCHAR(100) NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_live_location TEXT,
    total_amount DECIMAL(10, 2) NOT NULL CHECK (total_amount >= 0),
    payment_method VARCHAR(50) NOT NULL DEFAULT 'COD' CHECK (payment_method IN ('COD', 'WISH_MONEY')),
    payment_status VARCHAR(50) NOT NULL DEFAULT 'Unpaid' CHECK (
        payment_status IN ('Unpaid', 'Pending Verification', 'Paid', 'Failed', 'Rejected')
    ),
    order_status VARCHAR(50) NOT NULL DEFAULT 'Pending' CHECK (
        order_status IN ('Pending', 'Accepted', 'Preparing', 'On Delivery', 'Delivered', 'Declined', 'Cancelled')
    ),
    rejection_reason TEXT,
    admin_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 8: order_items
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    product_name_snapshot VARCHAR(255) NOT NULL,
    size_snapshot VARCHAR(50),
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price >= 0),
    total_price DECIMAL(10, 2) NOT NULL CHECK (total_price >= 0),
    customization_details JSONB, -- Custom kit info (name, number, badges)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 9: order_exchanges (Section 23: Exchanges Only)
CREATE TABLE order_exchanges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    original_variant_id UUID NOT NULL REFERENCES product_variants(id),
    replacement_variant_id UUID NOT NULL REFERENCES product_variants(id),
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'item_received', 'replacement_dispatched', 'completed', 'declined')
    ),
    decline_reason TEXT,
    admin_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 5. REVIEWS
-- =============================================================================

-- Table 10: reviews
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    customer_name VARCHAR(255) NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 11: review_images (Min 1 required per submitted review)
CREATE TABLE review_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 6. CUSTOM 2D KIT DESIGNER (Section 34)
-- =============================================================================

-- Table 12: kits
CREATE TABLE kits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_name VARCHAR(255) NOT NULL,
    kit_name VARCHAR(255) NOT NULL,
    season VARCHAR(50) NOT NULL,
    front_image_url TEXT NOT NULL,
    back_image_url TEXT NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL CHECK (base_price >= 0),
    is_name_allowed BOOLEAN NOT NULL DEFAULT true,
    is_number_allowed BOOLEAN NOT NULL DEFAULT true,
    name_number_price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 CHECK (name_number_price >= 0),
    name_style_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    number_style_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 13: kit_variants (Apparel sizing for kits)
CREATE TABLE kit_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kit_id UUID NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
    size VARCHAR(50) NOT NULL,
    price_override DECIMAL(10, 2) CHECK (price_override IS NULL OR price_override >= 0),
    track_quantity BOOLEAN NOT NULL DEFAULT true,
    physical_stock INT NOT NULL DEFAULT 0 CHECK (physical_stock >= 0),
    reserved_stock INT NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
    available_stock INT GENERATED ALWAYS AS (
        GREATEST(0, physical_stock - reserved_stock)
    ) STORED,
    is_available BOOLEAN GENERATED ALWAYS AS (
        CASE 
            WHEN track_quantity = false THEN true 
            ELSE (physical_stock - reserved_stock) > 0 
        END
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_kit_size UNIQUE (kit_id, size)
);

-- Table 14: kit_options (Badges and sleeve patches)
CREATE TABLE kit_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kit_id UUID NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
    badge_name VARCHAR(100) NOT NULL,
    badge_image_url TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    position_config JSONB NOT NULL DEFAULT '{}'::jsonb, -- Target slot & canvas coordinates
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 7. MARKETING & CONTENT
-- =============================================================================

-- Table 15: hero_slides (Max 3 active slides enforced by partial index & trigger)
CREATE TABLE hero_slides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_en VARCHAR(255) NOT NULL,
    title_ar VARCHAR(255) NOT NULL,
    subtitle_en TEXT,
    subtitle_ar TEXT,
    media_url TEXT NOT NULL,
    media_type VARCHAR(20) NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
    display_order INT NOT NULL CHECK (display_order IN (1, 2, 3)),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce unique slot per active slide at the storage level
CREATE UNIQUE INDEX uq_hero_active_display_order 
ON hero_slides(display_order) 
WHERE is_active = true;

-- Table 16: offers (Timed promotional campaigns)
CREATE TABLE offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_en VARCHAR(255) NOT NULL,
    title_ar VARCHAR(255) NOT NULL,
    description_en TEXT,
    description_ar TEXT,
    old_price DECIMAL(10, 2),
    new_price DECIMAL(10, 2),
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    button_link TEXT,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 17 (singleton): website_settings
CREATE TABLE website_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    website_name VARCHAR(255) NOT NULL DEFAULT 'Keeper Sports',
    about_us_en TEXT,
    about_us_ar TEXT,
    instagram_url TEXT,
    facebook_url TEXT,
    tiktok_url TEXT,
    whatsapp_number VARCHAR(50),
    contact_email VARCHAR(255),
    notification_destination_email VARCHAR(255),
    other_contact_info JSONB DEFAULT '{}'::jsonb,
    theme_settings JSONB DEFAULT '{"default_theme": "dark"}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 18: contact_messages
CREATE TABLE contact_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 19: notifications (Strict relational FKs with exclusivity constraint)
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES admins(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    is_broadcast BOOLEAN NOT NULL DEFAULT false,
    title_en VARCHAR(255) NOT NULL,
    title_ar VARCHAR(255) NOT NULL,
    message_en TEXT NOT NULL,
    message_ar TEXT NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'new_order', 'contact_message', 'pending_review', 
        'exchange_request', 'low_stock', 'order_status_update', 'promo'
    )),
    reference_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_notification_target CHECK (
        (is_broadcast = true AND admin_id IS NULL AND customer_id IS NULL) OR
        (is_broadcast = false AND admin_id IS NOT NULL AND customer_id IS NULL) OR
        (is_broadcast = false AND admin_id IS NULL AND customer_id IS NOT NULL)
    )
);

-- Table 20: push_subscriptions
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(255),
    subscription_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 8. CONCURRENCY TRIGGERS
-- =============================================================================

-- Concurrency-Safe Order Number Assignment
CREATE OR REPLACE FUNCTION set_order_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        NEW.order_number := 'KP-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('order_number_seq')::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_order_number
BEFORE INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION set_order_number();

-- Concurrency-Safe Product Images Limit (Max 3)
CREATE OR REPLACE FUNCTION check_product_image_limit()
RETURNS TRIGGER AS $$
BEGIN
    -- Row-lock parent product to serialize concurrent image insertions
    PERFORM 1 FROM products WHERE id = NEW.product_id FOR UPDATE;
    
    IF (SELECT COUNT(*) FROM product_images WHERE product_id = NEW.product_id AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)) >= 3 THEN
        RAISE EXCEPTION 'A product cannot have more than 3 images.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_product_image_limit
BEFORE INSERT OR UPDATE ON product_images
FOR EACH ROW
EXECUTE FUNCTION check_product_image_limit();

-- Concurrency-Safe Active Hero Slides Limit (Max 3)
CREATE OR REPLACE FUNCTION check_active_hero_slides_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_active = true THEN
        -- Transaction advisory lock ensures serialized checks across connections
        PERFORM pg_advisory_xact_lock(hashtext('hero_slides_active_lock'));
        
        IF (SELECT COUNT(*) FROM hero_slides WHERE is_active = true AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)) >= 3 THEN
            RAISE EXCEPTION 'Cannot have more than 3 active hero slides.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_active_hero_slides_limit
BEFORE INSERT OR UPDATE ON hero_slides
FOR EACH ROW
EXECUTE FUNCTION check_active_hero_slides_limit();

-- =============================================================================
-- 9. ATOMIC INVENTORY STORED PROCEDURES (Sections 16 & 41)
-- =============================================================================

-- 1. Reserve Stock for Online Order
CREATE OR REPLACE FUNCTION reserve_variant_stock(
    p_variant_id UUID,
    p_quantity INT,
    p_order_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_track BOOLEAN;
    v_phys INT;
    v_res INT;
BEGIN
    SELECT track_quantity, physical_stock, reserved_stock
    INTO v_track, v_phys, v_res
    FROM product_variants
    WHERE id = p_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product variant % not found', p_variant_id;
    END IF;

    -- If tracking is disabled, reservation is bypassed
    IF NOT v_track THEN
        RETURN;
    END IF;

    IF (v_phys - v_res) < p_quantity THEN
        RAISE EXCEPTION 'Insufficient available stock for variant %. Available: %, Requested: %', 
            p_variant_id, (v_phys - v_res), p_quantity;
    END IF;

    UPDATE product_variants
    SET reserved_stock = reserved_stock + p_quantity,
        updated_at = now()
    WHERE id = p_variant_id;

    INSERT INTO inventory_audit_logs (
        variant_id, change_type, quantity_change,
        previous_physical, new_physical,
        previous_reserved, new_reserved,
        reference_id, notes
    ) VALUES (
        p_variant_id, 'RESERVE', p_quantity,
        v_phys, v_phys,
        v_res, v_res + p_quantity,
        p_order_id, 'Online order stock reservation'
    );
END;
$$ LANGUAGE plpgsql;

-- 2. Release Stock from Declined/Cancelled Online Order
CREATE OR REPLACE FUNCTION release_variant_stock(
    p_variant_id UUID,
    p_quantity INT,
    p_order_id UUID,
    p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_track BOOLEAN;
    v_phys INT;
    v_res INT;
BEGIN
    SELECT track_quantity, physical_stock, reserved_stock
    INTO v_track, v_phys, v_res
    FROM product_variants
    WHERE id = p_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product variant % not found', p_variant_id;
    END IF;

    IF NOT v_track THEN
        RETURN;
    END IF;

    UPDATE product_variants
    SET reserved_stock = GREATEST(0, reserved_stock - p_quantity),
        updated_at = now()
    WHERE id = p_variant_id;

    INSERT INTO inventory_audit_logs (
        variant_id, change_type, quantity_change,
        previous_physical, new_physical,
        previous_reserved, new_reserved,
        reference_id, notes
    ) VALUES (
        p_variant_id, 'RELEASE', -p_quantity,
        v_phys, v_phys,
        v_res, GREATEST(0, v_res - p_quantity),
        p_order_id, COALESCE(p_reason, 'Online order cancelled/declined')
    );
END;
$$ LANGUAGE plpgsql;

-- 3. Fulfill Delivered Online Order
CREATE OR REPLACE FUNCTION fulfill_order_variant_stock(
    p_variant_id UUID,
    p_quantity INT,
    p_order_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_track BOOLEAN;
    v_phys INT;
    v_res INT;
BEGIN
    SELECT track_quantity, physical_stock, reserved_stock
    INTO v_track, v_phys, v_res
    FROM product_variants
    WHERE id = p_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product variant % not found', p_variant_id;
    END IF;

    IF NOT v_track THEN
        RETURN;
    END IF;

    UPDATE product_variants
    SET physical_stock = GREATEST(0, physical_stock - p_quantity),
        reserved_stock = GREATEST(0, reserved_stock - p_quantity),
        updated_at = now()
    WHERE id = p_variant_id;

    INSERT INTO inventory_audit_logs (
        variant_id, change_type, quantity_change,
        previous_physical, new_physical,
        previous_reserved, new_reserved,
        reference_id, notes
    ) VALUES (
        p_variant_id, 'DELIVERY_FULFILL', -p_quantity,
        v_phys, GREATEST(0, v_phys - p_quantity),
        v_res, GREATEST(0, v_res - p_quantity),
        p_order_id, 'Order delivered to customer'
    );
END;
$$ LANGUAGE plpgsql;

-- 4. Record Direct Physical Store Sale
CREATE OR REPLACE FUNCTION record_physical_store_sale(
    p_variant_id UUID,
    p_quantity INT,
    p_admin_id UUID,
    p_notes TEXT
)
RETURNS VOID AS $$
DECLARE
    v_track BOOLEAN;
    v_phys INT;
    v_res INT;
BEGIN
    SELECT track_quantity, physical_stock, reserved_stock
    INTO v_track, v_phys, v_res
    FROM product_variants
    WHERE id = p_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product variant % not found', p_variant_id;
    END IF;

    IF NOT v_track THEN
        RETURN;
    END IF;

    -- Physical store customer cannot purchase an item currently reserved for an online order
    IF (v_phys - v_res) < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock in physical store. Physical: %, Reserved for online: %, Available: %',
            v_phys, v_res, (v_phys - v_res);
    END IF;

    UPDATE product_variants
    SET physical_stock = physical_stock - p_quantity,
        updated_at = now()
    WHERE id = p_variant_id;

    INSERT INTO inventory_audit_logs (
        variant_id, change_type, quantity_change,
        previous_physical, new_physical,
        previous_reserved, new_reserved,
        reference_id, notes
    ) VALUES (
        p_variant_id, 'STORE_SALE', -p_quantity,
        v_phys, v_phys - p_quantity,
        v_res, v_res,
        p_admin_id, COALESCE(p_notes, 'Physical store point-of-sale purchase')
    );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 10. TARGETED PERFORMANCE B-TREE INDEXES (O(log N) Complexity)
-- =============================================================================

-- Catalog filtering & sorting
CREATE INDEX idx_products_filter ON products(category_id, is_active, is_featured, is_sale_enabled);
CREATE INDEX idx_products_price ON products(base_price);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_variants_availability ON product_variants(is_available);

-- Orders & Customers
CREATE INDEX idx_orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX idx_orders_guest_hash ON orders(guest_token_hash);
CREATE INDEX idx_orders_status ON orders(order_status, created_at DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_exchanges_order ON order_exchanges(order_id);

-- Community & Content
CREATE INDEX idx_reviews_product ON reviews(product_id, status);
CREATE INDEX idx_notifications_admin ON notifications(admin_id, is_read) WHERE admin_id IS NOT NULL;
CREATE INDEX idx_notifications_cust ON notifications(customer_id, is_read) WHERE customer_id IS NOT NULL;

-- =============================================================================
-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE hero_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- PUBLIC READ-ONLY ACCESS VIA ANON FOR PUBLIC CATALOG
CREATE POLICY "Public can view active categories" ON categories 
    FOR SELECT TO anon, authenticated USING (is_active = true);

CREATE POLICY "Public can view active products" ON products 
    FOR SELECT TO anon, authenticated USING (is_active = true);

CREATE POLICY "Public can view product variants" ON product_variants 
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public can view product images" ON product_images 
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public can view active kits" ON kits 
    FOR SELECT TO anon, authenticated USING (is_active = true);

CREATE POLICY "Public can view kit variants" ON kit_variants 
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public can view active kit options" ON kit_options 
    FOR SELECT TO anon, authenticated USING (is_active = true);

CREATE POLICY "Public can view active hero slides" ON hero_slides 
    FOR SELECT TO anon, authenticated USING (is_active = true);

CREATE POLICY "Public can view active offers" ON offers 
    FOR SELECT TO anon, authenticated USING (is_active = true);

CREATE POLICY "Public can view approved reviews" ON reviews 
    FOR SELECT TO anon, authenticated USING (status = 'approved');

CREATE POLICY "Public can view review images" ON review_images 
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Public can view website settings" ON website_settings 
    FOR SELECT TO anon, authenticated USING (true);

-- PROTECTED TABLES: ZERO DIRECT ACCESS FOR ANON
-- (All operations on admins, customers, orders, order_items, order_exchanges, 
--  inventory_audit_logs, contact_messages, and notifications are executed 
--  authoritatively by the Express backend using the service_role key which bypasses RLS)
