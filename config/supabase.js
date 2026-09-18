require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("CRITICAL WARNING: SUPABASE_URL or SUPABASE_SECRET_KEY is not defined in environment variables!");
}

const supabase = createClient(
    supabaseUrl || "https://missing-supabase-url.supabase.co",
    supabaseKey || "missing-supabase-key"
);

module.exports = supabase;