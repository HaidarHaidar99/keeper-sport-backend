const supabase = require('../config/supabase');

async function seed() {
  console.log('--- SEEDING KEEPER SPORTS DATABASE ---');

  // 1. Ensure Website Settings
  await supabase.from('website_settings').upsert({
    id: 1,
    website_name: 'Keeper Sports',
    about_us_en: 'Keeper Sports is Lebanon\'s premier destination for authentic football shirts, footwear, elite sportswear, and bespoke custom team kits.',
    about_us_ar: 'كيبر سبورتس هي وجهتك الأولى لقمصان كرة القدم الأصلية، الأحذية، الملابس الرياضية، وتصميم الأطقم المخصصة.',
    contact_phone: '+96170000000',
    contact_email: 'support@keepersports.com',
    announcement_text: '100% Authentic Matchday Kits | Size Exchanges Guaranteed | Fast Delivery'
  });

  // 2. Categories
  const categoriesToInsert = [
    { name_en: 'Football Shirts', name_ar: 'قمصان كرة القدم', description_en: 'Official matchday jerseys', display_order: 1, is_active: true },
    { name_en: 'Football Shoes', name_ar: 'أحذية كرة القدم', description_en: 'Pro firm ground and turf boots', display_order: 2, is_active: true },
    { name_en: 'Sportswear', name_ar: 'ملابس رياضية', description_en: 'Training jackets and tracksuits', display_order: 3, is_active: true },
    { name_en: 'Equipment & Accessories', name_ar: 'معدات وإكسسوارات', description_en: 'Goalkeeper gloves and balls', display_order: 4, is_active: true }
  ];

  let { data: existingCats } = await supabase.from('categories').select('*');
  if (!existingCats || existingCats.length === 0) {
    const { data: inserted, error: catErr } = await supabase
      .from('categories')
      .insert(categoriesToInsert)
      .select();
    if (catErr) {
      console.error('Category insert error:', catErr);
      return;
    }
    existingCats = inserted;
  }
  console.log(`✓ Categories count: ${existingCats.length}`);
  const insertedCats = existingCats;

  const shirtCat = insertedCats.find(c => c.name_en === 'Football Shirts') || insertedCats[0];
  const shoeCat = insertedCats.find(c => c.name_en === 'Football Shoes') || insertedCats[1];
  const equipCat = insertedCats.find(c => c.name_en === 'Equipment & Accessories') || insertedCats[3];

  // 3. Product 1: Real Madrid Home Kit (Clothing with XS-XXL sizes and variant prices)
  const { data: p1 } = await supabase.from('products').insert([{
    name_en: 'Real Madrid Official Home Kit 2026/27',
    name_ar: 'طقم ريال مدريد الرسمي الأساسي 2026/27',
    description_en: 'Official player version match shirt featuring lightweight moisture-wicking technology and premium embroidered club crest.',
    description_ar: 'قميص المباريات الرسمي للاعبين بتقنية متطورة لامتصاص الرطوبة وشعار النادي الملكي المطرز بدقة عالية.',
    category_id: shirtCat.id,
    base_price: 85.00,
    is_sale_enabled: true,
    sale_price: 75.00,
    is_featured: true,
    is_active: true,
    total_sold: 42
  }]).select().single();

  if (p1) {
    await supabase.from('product_images').insert([
      { product_id: p1.id, image_url: 'https://images.unsplash.com/photo-1518091043644-c1d4457512c6?auto=format&fit=crop&w=800&q=80', display_order: 1 },
      { product_id: p1.id, image_url: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=800&q=80', display_order: 2 }
    ]);

    await supabase.from('product_variants').insert([
      { product_id: p1.id, size: 'XS', price: 75.00, physical_stock: 8, reserved_stock: 0, track_quantity: true },
      { product_id: p1.id, size: 'S', price: 75.00, physical_stock: 12, reserved_stock: 0, track_quantity: true },
      { product_id: p1.id, size: 'M', price: 75.00, physical_stock: 15, reserved_stock: 0, track_quantity: true },
      { product_id: p1.id, size: 'L', price: 78.00, physical_stock: 10, reserved_stock: 0, track_quantity: true },
      { product_id: p1.id, size: 'XL', price: 80.00, physical_stock: 5, reserved_stock: 0, track_quantity: true },
      { product_id: p1.id, size: 'XXL', price: 82.00, physical_stock: 3, reserved_stock: 0, track_quantity: true }
    ]);
    console.log('✓ Seeded Product 1: Real Madrid Kit with XS-XXL variant matrix');
  }

  // 4. Product 2: Predator Elite Pro Boots (Shoes with 39-45 sizes)
  const { data: p2 } = await supabase.from('products').insert([{
    name_en: 'Predator Elite FG Professional Boots',
    name_ar: 'حذاء بريداتور إيليت للملاعب العشبية',
    description_en: 'Elite football boots engineered for surgical strike accuracy, rubber grip zones, and carbon-fiber sprint frame.',
    description_ar: 'حذاء كرة قدم احترافي مصمم لتسديدات دقيقة مع خطوط مطاطية للتحكم بالكرة وقاعدة كربونية خفيفة.',
    category_id: shoeCat.id,
    base_price: 145.00,
    is_sale_enabled: false,
    sale_price: null,
    is_featured: true,
    is_active: true,
    total_sold: 28
  }]).select().single();

  if (p2) {
    await supabase.from('product_images').insert([
      { product_id: p2.id, image_url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80', display_order: 1 }
    ]);

    await supabase.from('product_variants').insert([
      { product_id: p2.id, size: '39', price: 140.00, physical_stock: 4, reserved_stock: 0, track_quantity: true },
      { product_id: p2.id, size: '40', price: 140.00, physical_stock: 6, reserved_stock: 0, track_quantity: true },
      { product_id: p2.id, size: '41', price: 145.00, physical_stock: 10, reserved_stock: 0, track_quantity: true },
      { product_id: p2.id, size: '42', price: 145.00, physical_stock: 8, reserved_stock: 0, track_quantity: true },
      { product_id: p2.id, size: '43', price: 145.00, physical_stock: 5, reserved_stock: 0, track_quantity: true },
      { product_id: p2.id, size: '44', price: 150.00, physical_stock: 2, reserved_stock: 0, track_quantity: true },
      { product_id: p2.id, size: '45', price: 150.00, physical_stock: 0, reserved_stock: 0, track_quantity: true }
    ]);
    console.log('✓ Seeded Product 2: Predator Boots with 39-45 shoe sizes');
  }

  // 5. Product 3: Unsized Equipment (Goalkeeper Pro Match Gloves)
  const { data: p3 } = await supabase.from('products').insert([{
    name_en: 'Keeper Pro Match Contact Latex Gloves',
    name_ar: 'قفازات حارس مرمى للمباريات مع لاصق لاتكس',
    description_en: 'Professional 4mm German contact latex palm offering supreme grip in wet and dry matchday conditions.',
    description_ar: 'قفازات حراس مرمى احترافية بلاصق لاتكس ألماني 4 ملم للثبات العالي في جميع الظروف المناخية.',
    category_id: equipCat.id,
    base_price: 55.00,
    is_sale_enabled: false,
    sale_price: null,
    is_featured: false,
    is_active: true,
    total_sold: 19
  }]).select().single();

  if (p3) {
    await supabase.from('product_images').insert([
      { product_id: p3.id, image_url: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&w=800&q=80', display_order: 1 }
    ]);
    console.log('✓ Seeded Product 3: Goalkeeper Gloves (unsized product)');
  }

  // 6. Product 4: Arsenal Away Kit 2026/27 (Sale Item)
  const { data: p4 } = await supabase.from('products').insert([{
    name_en: 'Arsenal FC Away Match Jersey 2026/27',
    name_ar: 'طقم نادي آرسنال الاحتياطي 2026/27',
    description_en: 'Bold modern away design celebrating north London culture with aeroready athletic fit.',
    description_ar: 'تصميم جريء وعصري لطقم آرسنال الاحتياطي مع تقنية تهوية رياضية مريحة.',
    category_id: shirtCat.id,
    base_price: 80.00,
    is_sale_enabled: true,
    sale_price: 60.00,
    is_featured: true,
    is_active: true,
    total_sold: 35
  }]).select().single();

  if (p4) {
    await supabase.from('product_images').insert([
      { product_id: p4.id, image_url: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=800&q=80', display_order: 1 }
    ]);

    await supabase.from('product_variants').insert([
      { product_id: p4.id, size: 'S', price: 60.00, physical_stock: 5, reserved_stock: 0, track_quantity: true },
      { product_id: p4.id, size: 'M', price: 60.00, physical_stock: 10, reserved_stock: 0, track_quantity: true },
      { product_id: p4.id, size: 'L', price: 60.00, physical_stock: 8, reserved_stock: 0, track_quantity: true },
      { product_id: p4.id, size: 'XL', price: 65.00, physical_stock: 4, reserved_stock: 0, track_quantity: true }
    ]);
    console.log('✓ Seeded Product 4: Arsenal Away Kit with Sale & Sizing');
  }

  console.log('--- SEEDING COMPLETED SUCCESSFULLY ---');
}

seed().catch(console.error);
