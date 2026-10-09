const supabase = require("../config/supabase");

/**
 * Extract client IP address safely from reverse proxies (Vercel, Cloudflare, etc.)
 */
const getClientIp = (req) => {
  if (!req) return null;
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || null;
};

let hasAuthEventsTable = null;

/**
 * Check if auth_email_events table is accessible in Supabase
 */
/**
 * Check if auth_email_events table is accessible in Supabase
 */
const checkTableAvailability = async () => {
  if (hasAuthEventsTable !== null) return hasAuthEventsTable;
  try {
    const { error } = await supabase.from("auth_email_events").select("id").limit(1);
    hasAuthEventsTable = !error;
  } catch {
    hasAuthEventsTable = false;
  }
  return hasAuthEventsTable;
};

/**
 * Persist an authentication email event atomically into the database
 */
const recordEmailEvent = async ({ email, eventType, ipAddress }) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const isTableAvailable = await checkTableAvailability();

  if (isTableAvailable) {
    try {
      const { error } = await supabase.from("auth_email_events").insert({
        email: normalizedEmail,
        event_type: eventType,
        ip_address: ipAddress
      });
      if (!error) return true;
    } catch (err) {
      console.warn("[RateLimit] Error inserting into auth_email_events:", err.message);
    }
  }

  // Fallback: Persist in notifications table with valid system enums (isolated from admin UI)
  try {
    const { error: fallbackErr } = await supabase.from("notifications").insert({
      recipient_type: "admin",
      type: "system",
      title: normalizedEmail,
      message: ipAddress || "unknown_ip",
      reference_type: `auth_email_event:${eventType}`,
      is_read: true
    });
    if (!fallbackErr) return true;
    console.error("[RateLimit] Error in persistent event logging fallback:", fallbackErr.message);
    return false;
  } catch (fallbackErr) {
    console.error("[RateLimit] Exception in persistent event logging fallback:", fallbackErr.message);
    return false;
  }
};

/**
 * Query recent email events from the database
 */
const queryRecentEvents = async ({ email, eventType, sinceIso }) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const isTableAvailable = await checkTableAvailability();
  const eventTypes = Array.isArray(eventType) ? eventType : [eventType];

  if (isTableAvailable) {
    try {
      let query = supabase
        .from("auth_email_events")
        .select("id, created_at, ip_address")
        .eq("email", normalizedEmail);

      if (eventTypes.length === 1) {
        query = query.eq("event_type", eventTypes[0]);
      } else {
        query = query.in("event_type", eventTypes);
      }

      const { data, error } = await query
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        return data;
      }
    } catch (err) {
      console.warn("[RateLimit] Error querying auth_email_events:", err.message);
    }
  }

  // Fallback query on notifications table with valid system enums
  try {
    const refTypes = eventTypes.map((t) => `auth_email_event:${t}`);
    let fallbackQuery = supabase
      .from("notifications")
      .select("id, created_at, message")
      .eq("recipient_type", "admin")
      .eq("type", "system")
      .eq("title", normalizedEmail);

    if (refTypes.length === 1) {
      fallbackQuery = fallbackQuery.eq("reference_type", refTypes[0]);
    } else {
      fallbackQuery = fallbackQuery.in("reference_type", refTypes);
    }

    const { data, error } = await fallbackQuery
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      return data;
    }
  } catch (err) {
    console.error("[RateLimit] Error querying notifications fallback:", err.message);
  }

  return [];
};

/**
 * Query IP request count within a time window for anti-abuse protection
 */
const queryIpRequestCount = async ({ ipAddress, sinceIso }) => {
  if (!ipAddress) return 0;
  const isTableAvailable = await checkTableAvailability();

  if (isTableAvailable) {
    try {
      const { count, error } = await supabase
        .from("auth_email_events")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ipAddress)
        .gte("created_at", sinceIso);

      if (!error && typeof count === "number") {
        return count;
      }
    } catch {}
  }

  try {
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_type", "admin")
      .eq("type", "system")
      .eq("message", ipAddress)
      .gte("created_at", sinceIso);

    if (!error && typeof count === "number") {
      return count;
    }
  } catch {}

  return 0;
};

/**
 * Verification Email Resend Policy:
 * - 60s cooldown between successful issuances (after registration or previous resend)
 * - Max 3 additional resends per rolling 60-minute window (separate from initial registration email)
 */
const checkVerificationResendLimit = async (email, ipAddress) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const sixtySecsAgo = new Date(now - 60 * 1000).toISOString();
  const fifteenMinsAgo = new Date(now - 15 * 60 * 1000).toISOString();

  // 1. IP Abuse Protection (Max 40 email requests per 15 minutes per IP)
  if (ipAddress) {
    const ipCount = await queryIpRequestCount({ ipAddress, sinceIso: fifteenMinsAgo });
    if (ipCount >= 40) {
      return {
        allowed: false,
        reason: "ip_abuse",
        message: "Too many requests from this network. Please try again later."
      };
    }
  }

  // 2. Cooldown Check across any verification email issuance (initial or resend)
  const recentIssuances = await queryRecentEvents({
    email: normalizedEmail,
    eventType: ["verification_initial", "verification_resend"],
    sinceIso: sixtySecsAgo
  });

  const lastIssuance = recentIssuances[0];
  if (lastIssuance) {
    const lastIssuanceTime = new Date(lastIssuance.created_at).getTime();
    const elapsedMs = now - lastIssuanceTime;
    if (elapsedMs < 60 * 1000) {
      const remainingSeconds = Math.max(1, Math.ceil((60 * 1000 - elapsedMs) / 1000));
      return {
        allowed: false,
        reason: "cooldown",
        remainingSeconds,
        message: `Please wait ${remainingSeconds} seconds before requesting another verification email.`
      };
    }
  }

  // 3. Hourly Limit Check: Max 3 additional resends per rolling 60-minute window
  const resendEvents = await queryRecentEvents({
    email: normalizedEmail,
    eventType: "verification_resend",
    sinceIso: oneHourAgo
  });

  if (resendEvents.length >= 3) {
    return {
      allowed: false,
      reason: "hourly_limit",
      totalInWindow: resendEvents.length,
      message: "You have reached the maximum of 3 verification email resends for this hour. Please check your inbox or try again in an hour."
    };
  }

  return {
    allowed: true,
    resendsUsed: resendEvents.length,
    remainingResends: 3 - resendEvents.length
  };
};

/**
 * Password Reset Request Policy:
 * - 60s cooldown between successful reset email issuances
 * - Max 3 additional reset link requests per rolling 60-minute window after initial request (total 4)
 */
const checkPasswordResetLimit = async (email, ipAddress) => {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const sixtySecsAgo = new Date(now - 60 * 1000).toISOString();
  const fifteenMinsAgo = new Date(now - 15 * 60 * 1000).toISOString();

  // 1. IP Abuse Protection
  if (ipAddress) {
    const ipCount = await queryIpRequestCount({ ipAddress, sinceIso: fifteenMinsAgo });
    if (ipCount >= 40) {
      return {
        allowed: false,
        reason: "ip_abuse",
        message: "Too many requests from this network. Please try again later."
      };
    }
  }

  // 2. Query events in the rolling 60-minute window
  const recentEvents = await queryRecentEvents({
    email: normalizedEmail,
    eventType: "password_reset",
    sinceIso: oneHourAgo
  });

  // 3. Cooldown Check (Minimum 60 seconds)
  const lastEvent = recentEvents[0];
  if (lastEvent) {
    const lastEventTime = new Date(lastEvent.created_at).getTime();
    const elapsedMs = now - lastEventTime;
    if (elapsedMs < 60 * 1000) {
      const remainingSeconds = Math.ceil((60 * 1000 - elapsedMs) / 1000);
      return {
        allowed: false,
        reason: "cooldown",
        remainingSeconds
      };
    }
  }

  // 4. Hourly Limit Check (1 initial + 3 additional resends = max 4 in 60 minutes)
  if (recentEvents.length >= 4) {
    return {
      allowed: false,
      reason: "hourly_limit",
      totalInWindow: recentEvents.length
    };
  }

  return {
    allowed: true,
    totalIssued: recentEvents.length
  };
};

module.exports = {
  getClientIp,
  checkVerificationResendLimit,
  recordEmailEvent,
  checkPasswordResetLimit
};
