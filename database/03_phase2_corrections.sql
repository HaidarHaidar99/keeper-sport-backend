-- =============================================================================
-- Keeper Sports — Phase 2 Corrections Migration
-- Version: 2.2 (final — approved 2026-09-15)
-- Apply in Supabase SQL Editor AFTER Phase 1 schema (01_initial_schema.sql)
-- =============================================================================

-- =============================================================================
-- 1. PRODUCTS TABLE — Add total_sold counter column
-- =============================================================================

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS total_sold INT NOT NULL DEFAULT 0 CHECK (total_sold >= 0);

CREATE INDEX IF NOT EXISTS idx_products_total_sold ON products(total_sold DESC);

-- =============================================================================
-- 2. IDEMPOTENCY LEDGER — product_sold_increments
--
--    Keyed on order_item_id (order_items.id), NOT (order_id, product_id).
--    One order may contain multiple line items for the same product in
--    different sizes. PRIMARY KEY (order_id, product_id) would reject the
--    second line item. order_item_id is unique per line — this is correct.
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_sold_increments (
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    quantity      INT  NOT NULL CHECK (quantity > 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (order_item_id)
);

-- =============================================================================
-- 3. ATOMIC increment_product_total_sold() FUNCTION
--
--    Accepts only p_order_item_id. Derives product_id and quantity from
--    order_items internally — never trusts caller-supplied values.
--    This enforces the DB invariant that the counted product and quantity
--    belong to the specified order item.
--
--    Idempotency:
--      First call  → INSERT succeeds → GET DIAGNOSTICS = 1 → increments total_sold
--      Retry       → PK conflict     → GET DIAGNOSTICS = 0 → no-op
--      Concurrent  → PK lock serialises both; only one INSERT wins
--
--    SECURITY DEFINER + SET search_path = public, pg_temp prevents
--    search_path injection attacks.
-- =============================================================================

DROP FUNCTION IF EXISTS increment_product_total_sold(UUID, UUID, INT);
DROP FUNCTION IF EXISTS increment_product_total_sold(UUID);

CREATE OR REPLACE FUNCTION increment_product_total_sold(
    p_order_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_product_id    UUID;
    v_quantity      INT;
    v_rows_inserted INT;
BEGIN
    -- Derive product_id and quantity from the authoritative order_items record.
    -- We never trust caller-supplied values for these fields.
    SELECT product_id, quantity
      INTO v_product_id, v_quantity
      FROM order_items
     WHERE id = p_order_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order item % not found', p_order_item_id;
    END IF;

    -- Claim the idempotency slot for this delivered line item.
    -- ON CONFLICT DO NOTHING is atomic at the DB level — no race condition.
    INSERT INTO product_sold_increments (order_item_id, quantity)
    VALUES (p_order_item_id, v_quantity)
    ON CONFLICT (order_item_id) DO NOTHING;

    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

    -- Increment only when this line item has not been counted before.
    IF v_rows_inserted = 1 THEN
        UPDATE products
        SET    total_sold = total_sold + v_quantity,
               updated_at = now()
        WHERE  id = v_product_id;
    END IF;
    -- v_rows_inserted = 0 → conflict → already counted → no-op
END;
$$;

-- =============================================================================
-- 4. PERFORMANCE INDEX — approved reviews for rating sort
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_reviews_approved_rating
    ON reviews(product_id, rating)
    WHERE status = 'approved';

-- =============================================================================
-- 5. get_products_paginated() RPC FUNCTION
--
--    Filters  : category, search, on_sale, featured
--               + unified variant filter for size / in_stock / effective price
--    Sorts    : newest, price_asc, price_desc, a_z, z_a,
--               best_seller, rating_asc, rating_desc
--    Pagination: accurate totalItems from identical WHERE clause
--    Rating   : computed once via CTE — not per-row correlated subquery
--
--    Price behaviour:
--      • No size selected → price filter and price sort use products.base_price
--      • Size selected    → price filter and price sort use
--                           COALESCE(variant.price, products.base_price)
--                           for the specified size's variant
--
--    Size + in_stock behaviour:
--      • When both are set, ONE variant must satisfy size + availability
--        simultaneously — not two independent EXISTS clauses.
--
--    SECURITY DEFINER + SET search_path = public, pg_temp prevents
--    search_path injection attacks.
-- =============================================================================

DROP FUNCTION IF EXISTS get_products_paginated(UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION get_products_paginated(
    p_category_id UUID    DEFAULT NULL,
    p_search      TEXT    DEFAULT NULL,
    p_min_price   NUMERIC DEFAULT NULL,
    p_max_price   NUMERIC DEFAULT NULL,
    p_on_sale     BOOLEAN DEFAULT NULL,
    p_in_stock    BOOLEAN DEFAULT NULL,
    p_is_featured BOOLEAN DEFAULT NULL,
    p_size        TEXT    DEFAULT NULL,
    p_sort        TEXT    DEFAULT 'newest',
    p_page        INT     DEFAULT 1,
    p_limit       INT     DEFAULT 12
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_offset   INT;
    v_limit    INT;
    v_total    BIGINT;
    v_products JSON;
BEGIN
    v_limit  := LEAST(50, GREATEST(1, COALESCE(p_limit, 12)));
    v_offset := (GREATEST(1, COALESCE(p_page, 1)) - 1) * v_limit;

    -- =========================================================================
    -- COUNT — identical WHERE to the DATA query, no LIMIT/OFFSET
    -- =========================================================================
    SELECT COUNT(DISTINCT p.id)
      INTO v_total
      FROM products p
     WHERE p.is_active = true
       AND (p_category_id IS NULL OR p.category_id = p_category_id)
       AND (p_on_sale     IS NULL OR p_on_sale = false OR p.is_sale_enabled = true)
       AND (p_is_featured IS NULL OR p.is_featured = p_is_featured)
       AND (
           p_search IS NULL OR p_search = ''
           OR p.name_en ILIKE '%' || p_search || '%'
           OR p.name_ar ILIKE '%' || p_search || '%'
       )
       -- ── Unified variant filter ────────────────────────────────────────────
       -- Branch A (size provided): ONE variant satisfies size + effective price
       --   + availability simultaneously.
       -- Branch B (no size): base_price for price; any variant for availability.
       AND (
           (
               p_size IS NOT NULL AND p_size <> ''
               AND EXISTS (
                   SELECT 1 FROM product_variants pv
                    WHERE pv.product_id = p.id
                      AND pv.size = p_size
                      AND (p_min_price IS NULL OR COALESCE(pv.price, p.base_price) >= p_min_price)
                      AND (p_max_price IS NULL OR COALESCE(pv.price, p.base_price) <= p_max_price)
                      AND (p_in_stock IS NOT TRUE OR pv.is_available = true)
               )
           )
           OR
           (
               (p_size IS NULL OR p_size = '')
               AND (p_min_price IS NULL OR p.base_price >= p_min_price)
               AND (p_max_price IS NULL OR p.base_price <= p_max_price)
               AND (
                   p_in_stock IS NOT TRUE
                   OR EXISTS (
                       SELECT 1 FROM product_variants pv
                        WHERE pv.product_id = p.id AND pv.is_available = true
                   )
               )
           )
       );

    -- =========================================================================
    -- DATA PAGE — same WHERE + rating CTE + ORDER BY + LIMIT/OFFSET
    --
    -- rating_agg CTE: aggregated once for all products; joined rather than
    -- repeated as correlated subqueries in SELECT and ORDER BY.
    -- =========================================================================
    SELECT COALESCE(JSON_AGG(row_data), '[]'::JSON)
      INTO v_products
      FROM (
        WITH rating_agg AS (
            SELECT
                product_id,
                ROUND(AVG(rating)::NUMERIC, 1) AS avg_rating
            FROM   reviews
            WHERE  status = 'approved'
            GROUP  BY product_id
        )
        SELECT
            p.id,
            p.category_id,
            p.name_en,
            p.name_ar,
            p.base_price,
            p.is_sale_enabled,
            p.sale_price,
            p.is_featured,
            p.total_sold,
            p.created_at,
            ra.avg_rating,
            -- Primary image (display_order = 1)
            (
                SELECT pi.image_url
                  FROM product_images pi
                 WHERE pi.product_id = p.id AND pi.display_order = 1
                 LIMIT 1
            ) AS image_url,
            -- Product-level availability: true if ANY variant is available
            EXISTS (
                SELECT 1 FROM product_variants pv
                 WHERE pv.product_id = p.id AND pv.is_available = true
            ) AS is_available,
            -- All variants for size picker / price display on cards
            (
                SELECT COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'id',           pv2.id,
                            'size',         pv2.size,
                            'price',        COALESCE(pv2.price, p.base_price),
                            'is_available', pv2.is_available
                        )
                    ),
                    '[]'::JSON
                )
                  FROM product_variants pv2
                 WHERE pv2.product_id = p.id
            ) AS variants

        FROM products p
        LEFT JOIN rating_agg ra ON ra.product_id = p.id

        -- Identical WHERE to COUNT query above
        WHERE p.is_active = true
          AND (p_category_id IS NULL OR p.category_id = p_category_id)
          AND (p_on_sale     IS NULL OR p_on_sale = false OR p.is_sale_enabled = true)
          AND (p_is_featured IS NULL OR p.is_featured = p_is_featured)
          AND (
              p_search IS NULL OR p_search = ''
              OR p.name_en ILIKE '%' || p_search || '%'
              OR p.name_ar ILIKE '%' || p_search || '%'
          )
          AND (
              (
                  p_size IS NOT NULL AND p_size <> ''
                  AND EXISTS (
                      SELECT 1 FROM product_variants pv
                       WHERE pv.product_id = p.id
                         AND pv.size = p_size
                         AND (p_min_price IS NULL OR COALESCE(pv.price, p.base_price) >= p_min_price)
                         AND (p_max_price IS NULL OR COALESCE(pv.price, p.base_price) <= p_max_price)
                         AND (p_in_stock IS NOT TRUE OR pv.is_available = true)
                  )
              )
              OR
              (
                  (p_size IS NULL OR p_size = '')
                  AND (p_min_price IS NULL OR p.base_price >= p_min_price)
                  AND (p_max_price IS NULL OR p.base_price <= p_max_price)
                  AND (
                      p_in_stock IS NOT TRUE
                      OR EXISTS (
                          SELECT 1 FROM product_variants pv
                           WHERE pv.product_id = p.id AND pv.is_available = true
                      )
                  )
              )
          )

        -- ── ORDER BY ─────────────────────────────────────────────────────────
        -- price_asc / price_desc: when p_size is set, sort by that size's
        --   effective price COALESCE(variant.price, base_price).
        --   When no size, sort by base_price.
        -- rating sorts use ra.avg_rating from the CTE — computed once.
        -- All other CASE expressions return NULL for non-matching sort modes
        --   (NULLS LAST → no effect on ordering).
        ORDER BY
            CASE WHEN p_sort = 'price_asc' THEN
                CASE
                    WHEN p_size IS NOT NULL AND p_size <> '' THEN (
                        SELECT COALESCE(pv3.price, p.base_price)
                          FROM product_variants pv3
                         WHERE pv3.product_id = p.id AND pv3.size = p_size
                         LIMIT 1
                    )
                    ELSE p.base_price
                END
            END ASC  NULLS LAST,
            CASE WHEN p_sort = 'price_desc' THEN
                CASE
                    WHEN p_size IS NOT NULL AND p_size <> '' THEN (
                        SELECT COALESCE(pv3.price, p.base_price)
                          FROM product_variants pv3
                         WHERE pv3.product_id = p.id AND pv3.size = p_size
                         LIMIT 1
                    )
                    ELSE p.base_price
                END
            END DESC NULLS LAST,
            CASE WHEN p_sort = 'a_z'         THEN p.name_en     END ASC  NULLS LAST,
            CASE WHEN p_sort = 'z_a'         THEN p.name_en     END DESC NULLS LAST,
            CASE WHEN p_sort = 'best_seller' THEN p.total_sold  END DESC NULLS LAST,
            CASE WHEN p_sort = 'rating_desc' THEN ra.avg_rating END DESC NULLS LAST,
            CASE WHEN p_sort = 'rating_asc'  THEN ra.avg_rating END ASC  NULLS LAST,
            p.created_at DESC   -- default sort / tiebreaker

        LIMIT  v_limit
        OFFSET v_offset
    ) AS row_data;

    -- =========================================================================
    -- RETURN
    -- =========================================================================
    RETURN JSON_BUILD_OBJECT(
        'products',   v_products,
        'pagination', JSON_BUILD_OBJECT(
            'page',       GREATEST(1, COALESCE(p_page, 1)),
            'limit',      v_limit,
            'totalItems', v_total,
            'totalPages', CEIL(v_total::NUMERIC / v_limit)
        )
    );
END;
$$;

-- =============================================================================
-- 6. GRANTS
--
--    Express backend uses service_role key exclusively.
--    Frontend never calls Supabase directly.
--    PostgreSQL grants EXECUTE to PUBLIC by default — revoke that first,
--    then grant only to service_role.
-- =============================================================================

REVOKE ALL ON FUNCTION get_products_paginated(UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_products_paginated(UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION increment_product_total_sold(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION increment_product_total_sold(UUID) TO service_role;
