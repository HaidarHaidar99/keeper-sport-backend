const supabase = require("../config/supabase");

const BUCKET_NAME = "keeper-media";
const STORAGE_FILE_PATH = "metadata/category_images.json";

let cachedMap = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 30000; // 30s cache

/**
 * Fetch category image map { [categoryId]: imageUrl }
 */
const getCategoryImagesMap = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && cachedMap && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedMap;
  }

  try {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).download(STORAGE_FILE_PATH);
    if (error || !data) {
      if (!cachedMap) cachedMap = {};
      return cachedMap;
    }
    const text = await data.text();
    cachedMap = JSON.parse(text || "{}");
    lastFetchTime = now;
    return cachedMap;
  } catch (err) {
    if (!cachedMap) cachedMap = {};
    return cachedMap;
  }
};

/**
 * Set or update category image in persistent storage
 */
const setCategoryImage = async (categoryId, imagePath) => {
  try {
    const currentMap = await getCategoryImagesMap(true);
    if (imagePath) {
      currentMap[categoryId] = imagePath;
    } else {
      delete currentMap[categoryId];
    }
    cachedMap = { ...currentMap };
    lastFetchTime = Date.now();

    const buffer = Buffer.from(JSON.stringify(currentMap, null, 2));
    await supabase.storage.from(BUCKET_NAME).upload(STORAGE_FILE_PATH, buffer, {
      upsert: true,
      contentType: "application/json"
    });
    return currentMap;
  } catch (err) {
    console.error("Error setting category image in storage:", err.message);
  }
};

/**
 * Remove category image from persistent storage
 */
const removeCategoryImage = async (categoryId) => {
  return setCategoryImage(categoryId, null);
};

module.exports = {
  getCategoryImagesMap,
  setCategoryImage,
  removeCategoryImage
};
