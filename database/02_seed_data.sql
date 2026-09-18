-- =============================================================================
-- Keeper Sports — Seed Data (Phase 1)
-- =============================================================================

-- 1. Singleton Website Settings
INSERT INTO website_settings (
    id,
    website_name,
    about_us_en,
    about_us_ar,
    instagram_url,
    facebook_url,
    tiktok_url,
    whatsapp_number,
    contact_email,
    notification_destination_email,
    other_contact_info,
    theme_settings
) VALUES (
    1,
    'Keeper Sports',
    'Keeper Sports is Lebanon''s premier destination for authentic football shirts, footwear, elite sportswear, and bespoke custom team kits.',
    'كيبر سبورتس هي وجهتك الأولى في لبنان لقمصان كرة القدم الأصلية، الأحذية، الملابس الرياضية النخبوية، وتصميم الأطقم المخصصة.',
    'https://instagram.com/keepersports',
    'https://facebook.com/keepersports',
    'https://tiktok.com/@keepersports',
    '+96170000000',
    'contact@keepersports.com',
    'orders@keepersports.com',
    '{"address": "Beirut, Lebanon", "phone": "+961 1 000 000"}'::jsonb,
    '{"default_theme": "dark", "allow_theme_toggle": true}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
    website_name = EXCLUDED.website_name,
    about_us_en = EXCLUDED.about_us_en,
    about_us_ar = EXCLUDED.about_us_ar;

-- 2. Default Super Admin Seed Account
-- Password hash corresponds to: Admin12345! (Bcrypt 10 rounds)
INSERT INTO admins (
    email,
    password_hash,
    role,
    is_active
) VALUES (
    'admin@keepersports.com',
    '$2b$10$wBEPkvdrECVVUSCkvtwqY.Cq.QXPJi1XiVorxaTGe7/5ipE3PaYme',
    'super_admin',
    true
) ON CONFLICT (email) DO NOTHING;

-- 3. Core Product Categories
INSERT INTO categories (name_en, name_ar, description_en, description_ar, display_order, is_active) VALUES
('Football Shirts', 'قمصان كرة القدم', 'Official club and national team shirts', 'قمصان رسمية للأندية والمنتخبات العالمية', 1, true),
('Football Shoes', 'أحذية كرة القدم', 'Firm ground, turf, and indoor football boots', 'أحذية كرة قدم للملاعب العشبية، الترتان والصالات', 2, true),
('Sportswear', 'ملابس رياضية', 'Training jackets, tracksuits, shorts and hoodies', 'سترات تدريب، بدلات رياضية، شورتات وهوديز', 3, true),
('Equipment & Accessories', 'معدات وإكسسوارات', 'Goalkeeper gloves, balls, shin guards and bags', 'قفازات حراس مرمى، كرات، واقيات أرجل وحقائب', 4, true),
('Custom Kits', 'أطقم مخصصة', 'Personalized custom printed kits with custom name and badges', 'أطقم مصممة حسب الطلب مع طباعة الأسماء والشارات', 5, true);

-- 4. Initial Hero Slide
INSERT INTO hero_slides (title_en, title_ar, subtitle_en, subtitle_ar, media_url, media_type, display_order, is_active) VALUES
('Elevate Your Game', 'ارتقِ بمستواك الرياضي', 'Discover the 2026 kit collection and pro footwear', 'اكتشف أحدث تشكيلة لقمصان وأحذية موسم 2026', 'https://images.unsplash.com/photo-1518091043644-c1d4457512c6', 'image', 1, true);

-- 5. Initial Promotional Offer
INSERT INTO offers (title_en, title_ar, description_en, description_ar, old_price, new_price, starts_at, expires_at, is_active) VALUES
('Season Kickoff Sale', 'عروض انطلاق الموسم', 'Special discount on all official new season kits', 'خصومات حصرية على جميع قمصان الموسم الجديد', 85.00, 65.00, now(), now() + interval '14 days', true);
