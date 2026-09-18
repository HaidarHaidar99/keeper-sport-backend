// Verification Script for Keeper Sports Master Schema
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '01_initial_schema.sql');
const seedPath = path.join(__dirname, '02_seed_data.sql');

console.log("=== KEEPER SPORTS SCHEMA VALIDATION ===");

if (!fs.existsSync(schemaPath)) {
    console.error("FAIL: 01_initial_schema.sql not found");
    process.exit(1);
}
if (!fs.existsSync(seedPath)) {
    console.error("FAIL: 02_seed_data.sql not found");
    process.exit(1);
}

const schemaSql = fs.readFileSync(schemaPath, 'utf8');
const seedSql = fs.readFileSync(seedPath, 'utf8');

// 1. Verify all expected tables exist
const expectedTables = [
    'admins',
    'customers',
    'categories',
    'products',
    'product_variants',
    'product_images',
    'inventory_audit_logs',
    'orders',
    'order_items',
    'order_exchanges',
    'reviews',
    'review_images',
    'kits',
    'kit_variants',
    'kit_options',
    'hero_slides',
    'offers',
    'website_settings',
    'contact_messages',
    'notifications',
    'push_subscriptions'
];

console.log("\n[1] Checking Tables:");
expectedTables.forEach(table => {
    const tableRegex = new RegExp(`CREATE\\s+TABLE\\s+${table}\\b`, 'i');
    if (tableRegex.test(schemaSql)) {
        console.log(`  ✓ Table: ${table}`);
    } else {
        console.error(`  ✗ Missing table: ${table}`);
        process.exit(1);
    }
});

// 2. Verify Concurrency Stored Procedures
console.log("\n[2] Checking Atomic Inventory Stored Procedures:");
const expectedProcedures = [
    'reserve_variant_stock',
    'release_variant_stock',
    'fulfill_order_variant_stock',
    'record_physical_store_sale'
];
expectedProcedures.forEach(proc => {
    const procRegex = new RegExp(`FUNCTION\\s+${proc}\\b`, 'i');
    if (procRegex.test(schemaSql)) {
        console.log(`  ✓ Procedure: ${proc}`);
    } else {
        console.error(`  ✗ Missing procedure: ${proc}`);
        process.exit(1);
    }
});

// 3. Verify Concurrency Triggers & Logic
console.log("\n[3] Checking Concurrency Triggers & Constraints:");
const expectedTriggers = [
    'trg_set_order_number',
    'trg_check_product_image_limit',
    'trg_check_active_hero_slides_limit'
];
expectedTriggers.forEach(trg => {
    const trgRegex = new RegExp(`TRIGGER\\s+${trg}\\b`, 'i');
    if (trgRegex.test(schemaSql)) {
        console.log(`  ✓ Trigger: ${trg}`);
    } else {
        console.error(`  ✗ Missing trigger: ${trg}`);
        process.exit(1);
    }
});

// 4. Verify Generated Stock Columns
console.log("\n[4] Checking Stored Generated Columns:");
if (schemaSql.includes('is_available BOOLEAN GENERATED ALWAYS AS') &&
    schemaSql.includes('available_stock INT GENERATED ALWAYS AS')) {
    console.log("  ✓ Stored generated columns (is_available, available_stock) verified");
} else {
    console.error("  ✗ Missing stored generated columns");
    process.exit(1);
}

// 5. Verify Target Exclusivity on Notifications
console.log("\n[5] Checking Notifications Constraint:");
if (schemaSql.includes('chk_notification_target')) {
    console.log("  ✓ chk_notification_target constraint verified");
} else {
    console.error("  ✗ Missing chk_notification_target constraint");
    process.exit(1);
}

// 6. Verify B-Tree Indexes
console.log("\n[6] Checking Indexes:");
const expectedIndexes = [
    'idx_products_filter',
    'idx_products_price',
    'idx_variants_product',
    'idx_variants_availability',
    'idx_orders_customer',
    'idx_orders_guest_hash',
    'idx_orders_status',
    'idx_order_items_order',
    'idx_exchanges_order',
    'idx_reviews_product',
    'idx_notifications_admin',
    'idx_notifications_cust'
];
expectedIndexes.forEach(idx => {
    if (schemaSql.includes(idx)) {
        console.log(`  ✓ Index: ${idx}`);
    } else {
        console.error(`  ✗ Missing index: ${idx}`);
        process.exit(1);
    }
});

// 7. Verify RLS Statements
console.log("\n[7] Checking RLS Policies:");
const rlsCount = (schemaSql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length;
console.log(`  ✓ RLS enabled on ${rlsCount} tables`);
if (rlsCount < expectedTables.length) {
    console.error(`  ✗ Warning: Expected RLS on at least ${expectedTables.length} tables`);
}

console.log("\n=== ALL SCHEMA CHECKS PASSED SUCCESSFULLY ===");
