const supabase = require("../config/supabase");

const BUCKET_NAME = "keeper-media";
const STORAGE_FILE_PATH = "metadata/site_content.json";

let cachedSiteContent = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 15000; // 15 seconds

const defaultContent = {
  homepage_story: {
    is_active: true,
    heading: "CRAFTED FOR MATCHDAY EXCELLENCE",
    subheading: "Engineered with precision grip, anatomical arch compression, and tournament-grade durability for elite athletes.",
    media_path: null,
    button_text: "EXPLORE PRODUCTS",
    button_route: "/products"
  },
  location: {
    is_active: true,
    location_name: "Keeper Sports Store",
    address: "Hanaway Main Street, Tyre, South Lebanon",
    location_url: "https://maps.app.goo.gl/mffodPxBbR573zzk8",
    description: "Experience authentic goalkeeper gloves, official club kits, and matchday gear in person.",
    phone_number: "+961 70 000 000",
    whatsapp_number: "+961 70 000 000"
  },
  social_media: {
    is_active: true,
    instagram_url: "",
    facebook_url: "",
    tiktok_url: "",
    x_url: "",
    youtube_url: "",
    whatsapp_url: ""
  }
};

/**
 * Fetch persistent site content metadata
 */
const getSiteContent = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && cachedSiteContent && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedSiteContent;
  }

  try {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).download(STORAGE_FILE_PATH);
    if (error || !data) {
      if (!cachedSiteContent) {
        cachedSiteContent = JSON.parse(JSON.stringify(defaultContent));
      }
      return cachedSiteContent;
    }

    const text = await data.text();
    const parsed = JSON.parse(text || "{}");
    cachedSiteContent = {
      homepage_story: { ...defaultContent.homepage_story, ...(parsed.homepage_story || {}) },
      location: { ...defaultContent.location, ...(parsed.location || {}) },
      social_media: { ...defaultContent.social_media, ...(parsed.social_media || {}) }
    };
    lastFetchTime = now;
    return cachedSiteContent;
  } catch (err) {
    if (!cachedSiteContent) {
      cachedSiteContent = JSON.parse(JSON.stringify(defaultContent));
    }
    return cachedSiteContent;
  }
};

/**
 * Update section of site content
 */
const updateSiteContent = async (section, data) => {
  try {
    const current = await getSiteContent(false);
    if (section && current[section]) {
      current[section] = {
        ...current[section],
        ...data
      };
    }
    cachedSiteContent = { ...current };
    lastFetchTime = Date.now();

    const buffer = Buffer.from(JSON.stringify(current, null, 2));
    await supabase.storage.from(BUCKET_NAME).upload(STORAGE_FILE_PATH, buffer, {
      upsert: true,
      contentType: "application/json"
    });
    return current;
  } catch (err) {
    console.error(`Error saving ${section} content to storage:`, err.message);
    return cachedSiteContent || defaultContent;
  }
};

module.exports = {
  getSiteContent,
  updateSiteContent,
  defaultContent
};
