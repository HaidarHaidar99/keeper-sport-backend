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
  let guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.[GUEST_CART_COOKIE] || null;

  if (userId) {
    // Look for user's cart
    const { data: userCart } = await supabase
      .from("carts")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (userCart) {
      return { cartId: userCart.id, isGuest: false, guestIdentifier: null };
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
          if (res) res.clearCookie(GUEST_CART_COOKIE, { ...getGuestCookieOptions(), maxAge: 0 });
          return { cartId: guestCart.id, isGuest: false, guestIdentifier: null };
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

    return { cartId: newCart.id, isGuest: false, guestIdentifier: null };
  }

  // Guest flow
  if (!guestIdentifier) {
    guestIdentifier = `guest_${crypto.randomUUID()}`;
    if (res) res.cookie(GUEST_CART_COOKIE, guestIdentifier, getGuestCookieOptions());
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
 * Helper to fetch formatted cart items, count, and subtotal
 */
const fetchFormattedCartData = async (cartId) => {
  if (!cartId) {
    return { items: [], cartCount: 0, subtotal: 0 };
  }

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
    .eq("cart_id", cartId)
    .order("created_at", { ascending: false });

  if (itemsErr) {
    console.error("Error fetching cart items:", itemsErr);
    return { items: [], cartCount: 0, subtotal: 0 };
  }

  const productIds = (items || []).map((i) => i.product_id).filter(Boolean);
  let mediaMap = new Map();
  let variantsByProduct = new Map();

  if (productIds.length > 0) {
    const [mediaRes, variantsRes] = await Promise.all([
      supabase
        .from("product_media")
        .select("product_id, storage_path, alt_text, is_cover")
        .in("product_id", productIds)
        .order("is_cover", { ascending: false }),
      supabase
        .from("product_variants")
        .select("id, product_id, size_value, color_value, price, stock_quantity, is_active")
        .in("product_id", productIds)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
    ]);

    (mediaRes.data || []).forEach((m) => {
      if (!mediaMap.has(m.product_id)) {
        mediaMap.set(m.product_id, m.storage_path);
      }
    });

    (variantsRes.data || []).forEach((v) => {
      if (!variantsByProduct.has(v.product_id)) {
        variantsByProduct.set(v.product_id, []);
      }
      variantsByProduct.get(v.product_id).push(v);
    });
  }

  let subtotal = 0;
  let totalItems = 0;

  const formattedItems = (items || []).map((item) => {
    const prod = item.products;
    const variant = item.product_variants;
    const prodVariants = variantsByProduct.get(item.product_id) || [];
    const requiresVariantSelection = prodVariants.length > 0 && !item.selected_variant_id;
    const unitPrice = variant?.price ? parseFloat(variant.price) : parseFloat(prod?.base_price || 0);
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;
    totalItems += item.quantity;

    return {
      id: item.id,
      productId: item.product_id,
      variantId: item.selected_variant_id,
      selectedVariantId: item.selected_variant_id,
      requiresVariantSelection,
      availableVariants: prodVariants,
      productName: prod?.name || "Product",
      productSlug: prod?.slug || "",
      coverImage: mediaMap.get(item.product_id) || null,
      unitPrice,
      quantity: item.quantity,
      lineTotal: parseFloat(lineTotal.toFixed(2)),
      product: prod
        ? {
            id: prod.id,
            name: prod.name,
            slug: prod.slug,
            base_price: prod.base_price,
            primaryImage: mediaMap.get(item.product_id) || null,
            stock_quantity: prod.stock_quantity
          }
        : null,
      variant: variant
        ? {
            id: variant.id,
            size: variant.size_value,
            color: variant.color_value,
            stock_quantity: variant.stock_quantity
          }
        : null,
      selectedSize: variant?.size_value || null,
      selectedColor: variant?.color_value || null,
      printedName: item.printed_name,
      printedNumber: item.printed_number,
      badge: item.badge,
      inStock: variant ? variant.stock_quantity >= item.quantity : (prod ? prod.stock_quantity >= item.quantity : false)
    };
  });

  return {
    items: formattedItems,
    cartCount: totalItems,
    subtotal: parseFloat(subtotal.toFixed(2))
  };
};

/**
 * Add Product to Cart
 * POST /api/cart/add
 * Body: { productId, variantId, quantity = 1, printedName, printedNumber, badge }
 */
const addToCart = async (req, res) => {
  try {
    const productId = req.body.productId || req.body.product_id;
    const { variantId, size, color, quantity = 1, printedName, printedNumber, badge } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required."
      });
    }

    const addQty = Math.max(1, parseInt(quantity, 10) || 1);

    // 1. Verify product exists and is active
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

    // 2. Fetch variants for this product
    const { data: variants } = await supabase
      .from("product_variants")
      .select("id, size_value, color_value, stock_quantity, is_active")
      .eq("product_id", productId)
      .eq("is_active", true);

    let resolvedVariantId = variantId || null;
    let availableStock = product.stock_quantity;

    if (variants && variants.length > 0) {
      const availSizes = Array.from(new Set(variants.map((v) => v.size_value).filter(Boolean)));
      const availColors = Array.from(new Set(variants.map((v) => v.color_value).filter(Boolean)));

      // If specific size, color, or variantId is passed, resolve matching variant
      if (variantId || size || color) {
        const matched = variants.find((v) => {
          if (variantId) return v.id === variantId;
          const sizeMatch = !availSizes.length || v.size_value === size;
          const colorMatch = !availColors.length || v.color_value === color;
          return sizeMatch && colorMatch;
        });

        if (!matched) {
          return res.status(400).json({
            success: false,
            message: "Selected product option is not available."
          });
        }

        resolvedVariantId = matched.id;
        availableStock = matched.stock_quantity;
      } else {
        // Deferred variant selection: allowed in schema (selected_variant_id is nullable)
        resolvedVariantId = null;
        availableStock = product.stock_quantity > 0 ? product.stock_quantity : variants.reduce((sum, v) => sum + (v.stock_quantity || 0), 0);
      }
    }

    // Check if available stock is zero
    if (availableStock <= 0) {
      return res.status(400).json({
        success: false,
        message: resolvedVariantId ? "Selected option is out of stock." : "This product is out of stock."
      });
    }

    // 3. Retrieve or create cart
    const cartInfo = await getOrCreateCart(req, res);
    const cartId = cartInfo.cartId;

    // 4. Check if exact item exists in cart
    let query = supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cartId)
      .eq("product_id", productId);

    if (resolvedVariantId) {
      query = query.eq("selected_variant_id", resolvedVariantId);
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

    const currentCartQty = existingItem ? existingItem.quantity : 0;
    const requestedTotalQty = currentCartQty + addQty;

    // Strict stock enforcement: existing Cart quantity + newly requested quantity cannot exceed stock
    if (requestedTotalQty > availableStock) {
      return res.status(400).json({
        success: false,
        message: `Only ${availableStock} items available in stock.`
      });
    }

    let finalQuantity = requestedTotalQty;

    if (existingItem) {
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
      const { error: insertErr } = await supabase
        .from("cart_items")
        .insert({
          cart_id: cartId,
          product_id: productId,
          selected_variant_id: resolvedVariantId,
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

    // 5. Calculate updated cart data
    const cartData = await fetchFormattedCartData(cartId);

    return res.json({
      success: true,
      message: `Added "${product.name}" to your cart.`,
      cartCount: cartData.cartCount,
      addedQuantity: addQty,
      guestIdentifier: cartInfo.guestIdentifier || null,
      cart: {
        id: cartId,
        items: cartData.items,
        cartCount: cartData.cartCount,
        subtotal: cartData.subtotal
      },
      items: cartData.items,
      subtotal: cartData.subtotal
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
    const guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.[GUEST_CART_COOKIE] || null;

    if (!userId && !guestIdentifier) {
      return res.json({
        success: true,
        cart: { id: null, items: [], cartCount: 0, subtotal: 0 },
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
        cart: { id: null, items: [], cartCount: 0, subtotal: 0 },
        items: [],
        cartCount: 0,
        subtotal: 0,
        guestIdentifier
      });
    }

    const cartData = await fetchFormattedCartData(cart.id);

    return res.json({
      success: true,
      cart: {
        id: cart.id,
        items: cartData.items,
        cartCount: cartData.cartCount,
        subtotal: cartData.subtotal
      },
      items: cartData.items,
      cartCount: cartData.cartCount,
      subtotal: cartData.subtotal,
      guestIdentifier
    });
  } catch (err) {
    console.error("Error in getCart:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching cart."
    });
  }
};

/**
 * Update Cart Item Quantity
 * PUT /api/cart/items/:itemId
 * Body: { quantity }
 */
const updateCartItemQuantity = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;
    const newQty = parseInt(quantity, 10);

    const userId = req.user?.id || null;
    const guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.[GUEST_CART_COOKIE] || null;

    if (!userId && !guestIdentifier) {
      return res.status(400).json({ success: false, message: "Cart identifier required." });
    }

    // Verify item belongs to this cart
    const { data: cartItem, error: fetchErr } = await supabase
      .from("cart_items")
      .select("id, cart_id, product_id, selected_variant_id, quantity, carts!inner(id, user_id, guest_identifier)")
      .eq("id", itemId)
      .maybeSingle();

    if (fetchErr || !cartItem) {
      return res.status(404).json({ success: false, message: "Cart item not found." });
    }

    const cart = cartItem.carts;
    const isOwner = (userId && cart.user_id === userId) || (!userId && cart.guest_identifier === guestIdentifier);

    if (!isOwner) {
      return res.status(403).json({ success: false, message: "Unauthorized access to cart item." });
    }

    if (isNaN(newQty) || newQty <= 0) {
      // Remove item if quantity is 0 or less
      await supabase.from("cart_items").delete().eq("id", itemId);
    } else {
      // Check stock against variant or product
      let availableStock = 0;
      if (cartItem.selected_variant_id) {
        const { data: variant } = await supabase
          .from("product_variants")
          .select("stock_quantity")
          .eq("id", cartItem.selected_variant_id)
          .maybeSingle();
        availableStock = variant ? variant.stock_quantity : 0;
      } else {
        const { data: prod } = await supabase
          .from("products")
          .select("stock_quantity")
          .eq("id", cartItem.product_id)
          .maybeSingle();
        availableStock = prod ? prod.stock_quantity : 0;
      }

      if (availableStock <= 0) {
        return res.status(400).json({
          success: false,
          message: "Out of stock."
        });
      }

      if (newQty > availableStock) {
        return res.status(400).json({
          success: false,
          message: `Only ${availableStock} items available in stock.`
        });
      }

      await supabase
        .from("cart_items")
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq("id", itemId);
    }

    const cartData = await fetchFormattedCartData(cart.id);

    return res.json({
      success: true,
      message: "Cart updated.",
      cart: {
        id: cart.id,
        items: cartData.items,
        cartCount: cartData.cartCount,
        subtotal: cartData.subtotal
      },
      items: cartData.items,
      cartCount: cartData.cartCount,
      subtotal: cartData.subtotal
    });
  } catch (err) {
    console.error("Error updating cart item:", err);
    return res.status(500).json({ success: false, message: "Failed to update item quantity." });
  }
};

/**
 * Remove Cart Item
 * DELETE /api/cart/items/:itemId
 */
const removeCartItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user?.id || null;
    const guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.[GUEST_CART_COOKIE] || null;

    if (!userId && !guestIdentifier) {
      return res.status(400).json({ success: false, message: "Cart identifier required." });
    }

    const { data: cartItem, error: fetchErr } = await supabase
      .from("cart_items")
      .select("id, cart_id, carts!inner(id, user_id, guest_identifier)")
      .eq("id", itemId)
      .maybeSingle();

    if (fetchErr || !cartItem) {
      return res.status(404).json({ success: false, message: "Cart item not found." });
    }

    const cart = cartItem.carts;
    const isOwner = (userId && cart.user_id === userId) || (!userId && cart.guest_identifier === guestIdentifier);

    if (!isOwner) {
      return res.status(403).json({ success: false, message: "Unauthorized access to cart item." });
    }

    await supabase.from("cart_items").delete().eq("id", itemId);

    const cartData = await fetchFormattedCartData(cart.id);

    return res.json({
      success: true,
      message: "Item removed from cart.",
      cart: {
        id: cart.id,
        items: cartData.items,
        cartCount: cartData.cartCount,
        subtotal: cartData.subtotal
      },
      items: cartData.items,
      cartCount: cartData.cartCount,
      subtotal: cartData.subtotal
    });
  } catch (err) {
    console.error("Error removing cart item:", err);
    return res.status(500).json({ success: false, message: "Failed to remove item from cart." });
  }
};

/**
 * Clear Entire Cart
 * DELETE /api/cart
 */
const clearCart = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const guestIdentifier = req.headers["x-guest-identifier"] || req.cookies?.[GUEST_CART_COOKIE] || null;

    if (!userId && !guestIdentifier) {
      return res.status(400).json({ success: false, message: "Cart identifier required." });
    }

    let cartQuery = supabase.from("carts").select("id");
    if (userId) {
      cartQuery = cartQuery.eq("user_id", userId);
    } else {
      cartQuery = cartQuery.eq("guest_identifier", guestIdentifier);
    }

    const { data: cart } = await cartQuery.maybeSingle();

    if (cart) {
      await supabase.from("cart_items").delete().eq("cart_id", cart.id);
    }

    return res.json({
      success: true,
      message: "Cart cleared successfully.",
      cart: {
        id: cart?.id || null,
        items: [],
        cartCount: 0,
        subtotal: 0
      },
      items: [],
      cartCount: 0,
      subtotal: 0
    });
  } catch (err) {
    console.error("Error clearing cart:", err);
    return res.status(500).json({ success: false, message: "Failed to clear cart." });
  }
};

/**
 * Update Cart Item Variant (Resolve deferred size/color choice)
 * PUT /api/cart/items/:itemId/variant
 * Body: { variantId, size, color }
 */
const updateCartItemVariant = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { variantId, size, color } = req.body;
    const cartInfo = await getOrCreateCart(req, res);
    const cartId = cartInfo.cartId;

    // Verify item exists in this cart
    const { data: item, error: itemErr } = await supabase
      .from("cart_items")
      .select("id, product_id, quantity, cart_id")
      .eq("id", itemId)
      .eq("cart_id", cartId)
      .maybeSingle();

    if (itemErr || !item) {
      return res.status(404).json({ success: false, message: "Cart item not found." });
    }

    // Fetch active variants for this product
    const { data: variants } = await supabase
      .from("product_variants")
      .select("*")
      .eq("product_id", item.product_id)
      .eq("is_active", true);

    if (!variants || variants.length === 0) {
      return res.status(400).json({ success: false, message: "Product has no variant options." });
    }

    const matchedVariant = variants.find((v) => {
      if (variantId) return v.id === variantId;
      const sMatch = !v.size_value || v.size_value === size;
      const cMatch = !v.color_value || v.color_value === color;
      return sMatch && cMatch;
    });

    if (!matchedVariant) {
      return res.status(400).json({ success: false, message: "Selected size/color option is not available." });
    }

    if (matchedVariant.stock_quantity <= 0) {
      return res.status(400).json({ success: false, message: "Selected option is out of stock." });
    }

    // Check if another cart line with this same variant already exists
    const { data: existingSameVariant } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cartId)
      .eq("product_id", item.product_id)
      .eq("selected_variant_id", matchedVariant.id)
      .neq("id", itemId)
      .maybeSingle();

    if (existingSameVariant) {
      const mergedQty = Math.min(matchedVariant.stock_quantity, existingSameVariant.quantity + item.quantity);
      await supabase.from("cart_items").update({ quantity: mergedQty, updated_at: new Date().toISOString() }).eq("id", existingSameVariant.id);
      await supabase.from("cart_items").delete().eq("id", itemId);
    } else {
      const safeQty = Math.min(matchedVariant.stock_quantity, item.quantity);
      await supabase.from("cart_items").update({ selected_variant_id: matchedVariant.id, quantity: safeQty, updated_at: new Date().toISOString() }).eq("id", itemId);
    }

    const cartData = await fetchFormattedCartData(cartId);
    return res.json({
      success: true,
      message: "Size updated successfully.",
      cart: {
        id: cartId,
        items: cartData.items,
        cartCount: cartData.cartCount,
        subtotal: cartData.subtotal
      },
      items: cartData.items,
      cartCount: cartData.cartCount,
      subtotal: cartData.subtotal
    });
  } catch (err) {
    console.error("updateCartItemVariant error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to update item size." });
  }
};

module.exports = {
  addToCart,
  getCart,
  updateCartItemQuantity,
  updateCartItemVariant,
  removeCartItem,
  clearCart,
  fetchFormattedCartData,
  GUEST_CART_COOKIE
};

