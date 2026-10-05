const crypto = require("crypto");
const supabase = require("../config/supabase");

const GUEST_CART_COOKIE = "keeper_guest_cart";

const getGuestCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/"
  };
};

/**
 * Get or create cart for user or guest
 */
const getOrCreateCart = async (req, res) => {
  const userId = req.user?.id || null;
  let guestIdentifier = req.cookies?.[GUEST_CART_COOKIE] || req.headers["x-guest-identifier"] || null;

  if (userId) {
    // Look for user's cart
    const { data: userCart } = await supabase
      .from("carts")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (userCart) {
      return { cartId: userCart.id, isGuest: false };
    }

    // Check if there was a guest cart that should be merged or converted
    if (guestIdentifier) {
      const { data: guestCart } = await supabase
        .from("carts")
        .select("id")
        .eq("guest_identifier", guestIdentifier)
        .maybeSingle();

      if (guestCart) {
        // Upgrade guest cart to user cart
        const { error: upErr } = await supabase
          .from("carts")
          .update({
            user_id: userId,
            guest_identifier: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", guestCart.id);

        if (!upErr) {
          res.clearCookie(GUEST_CART_COOKIE, { ...getGuestCookieOptions(), maxAge: 0 });
          return { cartId: guestCart.id, isGuest: false };
        }
      }
    }

    // Create new cart for user
    const { data: newCart, error: createErr } = await supabase
      .from("carts")
      .insert({ user_id: userId })
      .select("id")
      .single();

    if (createErr) {
      console.error("Error creating user cart:", createErr);
      throw new Error("Could not initialize shopping cart.");
    }

    return { cartId: newCart.id, isGuest: false };
  }

  // Guest flow
  if (!guestIdentifier) {
    guestIdentifier = `guest_${crypto.randomUUID()}`;
    res.cookie(GUEST_CART_COOKIE, guestIdentifier, getGuestCookieOptions());
  }

  const { data: guestCart } = await supabase
    .from("carts")
    .select("id")
    .eq("guest_identifier", guestIdentifier)
    .maybeSingle();

  if (guestCart) {
    return { cartId: guestCart.id, isGuest: true, guestIdentifier };
  }

  const { data: newGuestCart, error: createGuestErr } = await supabase
    .from("carts")
    .insert({ guest_identifier: guestIdentifier })
    .select("id")
    .single();

  if (createGuestErr) {
    console.error("Error creating guest cart:", createGuestErr);
    throw new Error("Could not initialize guest shopping cart.");
  }

  return { cartId: newGuestCart.id, isGuest: true, guestIdentifier };
};

/**
 * Helper to calculate total count of items in a cart
 */
const calculateCartCount = async (cartId) => {
  const { data: items } = await supabase
    .from("cart_items")
    .select("quantity")
    .eq("cart_id", cartId);

  if (!items || items.length === 0) return 0;
  return items.reduce((sum, item) => sum + (item.quantity || 1), 0);
};

/**
 * Add Product to Cart
 * POST /api/cart/add
 * Body: { productId, variantId, quantity = 1, printedName, printedNumber, badge }
 */
const addToCart = async (req, res) => {
  try {
    const { productId, variantId, quantity = 1, printedName, printedNumber, badge } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required."
      });
    }

    const addQty = Math.max(1, parseInt(quantity, 10) || 1);

    // 1. Verify product exists, is active, and has stock
    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("id, name, base_price, stock_quantity, is_active")
      .eq("id", productId)
      .maybeSingle();

    if (prodErr || !product) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    if (!product.is_active) {
      return res.status(400).json({
        success: false,
        message: "This product is currently unavailable."
      });
    }

    if (product.stock_quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "This product is currently out of stock."
      });
    }

    // 2. If variant provided, verify variant
    if (variantId) {
      const { data: variant, error: varErr } = await supabase
        .from("product_variants")
        .select("id, stock_quantity, is_active")
        .eq("id", variantId)
        .eq("product_id", productId)
        .maybeSingle();

      if (varErr || !variant) {
        return res.status(400).json({
          success: false,
          message: "Selected product variant not found."
        });
      }

      if (!variant.is_active || variant.stock_quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: "Selected variant is out of stock."
        });
      }
    }

    // 3. Retrieve or create cart
    const { cartId } = await getOrCreateCart(req, res);

    // 4. Check if exact item exists in cart
    let query = supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cartId)
      .eq("product_id", productId);

    if (variantId) {
      query = query.eq("selected_variant_id", variantId);
    } else {
      query = query.is("selected_variant_id", null);
    }

    if (printedName) {
      query = query.eq("printed_name", printedName);
    } else {
      query = query.is("printed_name", null);
    }

    if (printedNumber) {
      query = query.eq("printed_number", printedNumber);
    } else {
      query = query.is("printed_number", null);
    }

    if (badge) {
      query = query.eq("badge", badge);
    } else {
      query = query.is("badge", null);
    }

    const { data: existingItem, error: findItemErr } = await query.maybeSingle();

    if (findItemErr) {
      console.error("Error checking existing cart item:", findItemErr);
      return res.status(500).json({
        success: false,
        message: "Failed to verify cart."
      });
    }

    let finalQuantity = addQty;

    if (existingItem) {
      finalQuantity = existingItem.quantity + addQty;
      // Cap at available stock
      if (finalQuantity > product.stock_quantity) {
        finalQuantity = product.stock_quantity;
      }

      const { error: updateErr } = await supabase
        .from("cart_items")
        .update({
          quantity: finalQuantity,
          updated_at: new Date().toISOString()
        })
        .eq("id", existingItem.id);

      if (updateErr) {
        console.error("Error updating cart item quantity:", updateErr);
        return res.status(500).json({
          success: false,
          message: "Failed to update cart."
        });
      }
    } else {
      if (finalQuantity > product.stock_quantity) {
        finalQuantity = product.stock_quantity;
      }

      const { error: insertErr } = await supabase
        .from("cart_items")
        .insert({
          cart_id: cartId,
          product_id: productId,
          selected_variant_id: variantId || null,
          quantity: finalQuantity,
          printed_name: printedName || null,
          printed_number: printedNumber || null,
          badge: badge || null
        });

      if (insertErr) {
        console.error("Error inserting cart item:", insertErr);
        return res.status(500).json({
          success: false,
          message: "Failed to add product to cart."
        });
      }
    }

    // 5. Calculate updated cart count
    const cartCount = await calculateCartCount(cartId);

    return res.json({
      success: true,
      message: `Added "${product.name}" to your cart.`,
      cartCount,
      addedQuantity: addQty
    });
  } catch (err) {
    console.error("Error in addToCart:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to add to cart."
    });
  }
};

/**
 * Get Current Cart Contents & Count
 * GET /api/cart
 */
const getCart = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const guestIdentifier = req.cookies?.[GUEST_CART_COOKIE] || req.headers["x-guest-identifier"] || null;

    if (!userId && !guestIdentifier) {
      return res.json({
        success: true,
        cart: null,
        items: [],
        cartCount: 0,
        subtotal: 0
      });
    }

    // Find cart
    let cartQuery = supabase.from("carts").select("id, created_at, updated_at");
    if (userId) {
      cartQuery = cartQuery.eq("user_id", userId);
    } else {
      cartQuery = cartQuery.eq("guest_identifier", guestIdentifier);
    }

    const { data: cart } = await cartQuery.maybeSingle();

    if (!cart) {
      return res.json({
        success: true,
        cart: null,
        items: [],
        cartCount: 0,
        subtotal: 0
      });
    }

    // Fetch cart items with product, media, and variant
    const { data: items, error: itemsErr } = await supabase
      .from("cart_items")
      .select(`
        id,
        cart_id,
        product_id,
        selected_variant_id,
        quantity,
        printed_name,
        printed_number,
        badge,
        created_at,
        products (
          id,
          name,
          slug,
          base_price,
          old_price,
          stock_quantity,
          is_active
        ),
        product_variants (
          id,
          size_value,
          color_value,
          price,
          old_price,
          stock_quantity
        )
      `)
      .eq("cart_id", cart.id)
      .order("created_at", { ascending: false });

    if (itemsErr) {
      console.error("Error fetching cart items:", itemsErr);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve cart items."
      });
    }

    // Fetch product cover media for items
    const productIds = (items || []).map((i) => i.product_id).filter(Boolean);
    let mediaMap = new Map();

    if (productIds.length > 0) {
      const { data: mediaList } = await supabase
        .from("product_media")
        .select("product_id, storage_path, alt_text, is_cover")
        .in("product_id", productIds)
        .order("is_cover", { ascending: false });

      (mediaList || []).forEach((m) => {
        if (!mediaMap.has(m.product_id)) {
          mediaMap.set(m.product_id, m.storage_path);
        }
      });
    }

    let subtotal = 0;
    let totalItems = 0;

    const formattedItems = (items || []).map((item) => {
      const prod = item.products;
      const variant = item.product_variants;
      const unitPrice = variant?.price ? parseFloat(variant.price) : parseFloat(prod?.base_price || 0);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      totalItems += item.quantity;

      return {
        id: item.id,
        productId: item.product_id,
        variantId: item.selected_variant_id,
        productName: prod?.name || "Product",
        productSlug: prod?.slug || "",
        coverImage: mediaMap.get(item.product_id) || null,
        unitPrice,
        quantity: item.quantity,
        lineTotal: parseFloat(lineTotal.toFixed(2)),
        variant: variant
          ? {
              size: variant.size_value,
              color: variant.color_value
            }
          : null,
        customization: {
          printedName: item.printed_name,
          printedNumber: item.printed_number,
          badge: item.badge
        },
        inStock: prod ? prod.stock_quantity >= item.quantity : false
      };
    });

    return res.json({
      success: true,
      cart: { id: cart.id },
      items: formattedItems,
      cartCount: totalItems,
      subtotal: parseFloat(subtotal.toFixed(2))
    });
  } catch (err) {
    console.error("Error in getCart:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching cart."
    });
  }
};

module.exports = {
  addToCart,
  getCart,
  GUEST_CART_COOKIE
};
