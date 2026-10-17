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

// In-process lock to prevent simultaneous concurrent requests within the same process
const activeLocks = new Map();

const acquireLock = (key, ttlMs = 15000) => {
  const now = Date.now();
  const existing = activeLocks.get(key);
  if (existing && now - existing < ttlMs) {
    return false;
  }
  activeLocks.set(key, now);
  return true;
};

const releaseLock = (key) => {
  activeLocks.delete(key);
};

// Periodically clean stale in-memory locks
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of activeLocks.entries()) {
    if (now - ts > 30000) activeLocks.delete(k);
  }
}, 60000).unref?.();

let hasAuthEventsTable = null;

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
      const { data, error } = await supabase
        .from("auth_email_events")
        .insert({
          email: normalizedEmail,
          event_type: eventType,
          ip_address: ipAddress
        })
        .select("id")
        .single();
      if (!error && data) return data.id;
    } catch (err) {
      console.warn("[RateLimit] Error inserting into auth_email_events:", err.message);
    }
  }

  // Fallback: Persist in notifications table with valid system enums (isolated from admin UI via reference_type: rate_limit)
  try {
    const { data: fallbackData, error: fallbackErr } = await supabase
      .from("notifications")
      .insert({
        recipient_type: "admin",
        type: "system",
        title: normalizedEmail,
        message: `${eventType}|${ipAddress || "unknown_ip"}`,
        reference_type: "rate_limit",
        is_read: true
      })
      .select("id")
      .single();

    if (!fallbackErr && fallbackData) return fallbackData.id;
    console.error("[RateLimit] Error in persistent event logging fallback:", fallbackErr?.message);
    return null;
  } catch (fallbackErr) {
    console.error("[RateLimit] Exception in persistent event logging fallback:", fallbackErr.message);
    return null;
  }
};

/**
 * Remove a pending reservation record if email delivery failed
 * (Ensures resend allowance is NOT consumed on failure)
 */
const removePendingReservation = async (reservationId) => {
  if (!reservationId) return;
  const isTableAvailable = await checkTableAvailability();

  if (isTableAvailable) {
    try {
      await supabase.from("auth_email_events").delete().eq("id", reservationId);
      return;
    } catch {}
  }

  try {
    await supabase.from("notifications").delete().eq("id", reservationId);
  } catch {}
};

/**
 * Finalize a pending reservation after email delivery succeeded
 */
const finalizeReservation = async (reservationId, finalEventType) => {
  if (!reservationId) return;
  const isTableAvailable = await checkTableAvailability();

  if (isTableAvailable) {
    try {
      await supabase
        .from("auth_email_events")
        .update({ event_type: finalEventType })
        .eq("id", reservationId);
      return;
    } catch {}
  }

  try {
    const { data } = await supabase
      .from("notifications")
      .select("message")
      .eq("id", reservationId)
      .maybeSingle();

    const ipPart = (data?.message || "").includes("|") ? data.message.split("|")[1] : "unknown_ip";
    await supabase
      .from("notifications")
      .update({ message: `${finalEventType}|${ipPart}` })
      .eq("id", reservationId);
  } catch {}
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
        .select("id, created_at, ip_address, event_type")
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

  // Fallback query on notifications table
  try {
    const legacyRefTypes = eventTypes.map((t) => `auth_email_event:${t}`);

    // Query both rate_limit reference_type and legacy auth_email_event:* rows
    const { data, error } = await supabase
      .from("notifications")
      .select("id, created_at, message, reference_type")
      .eq("recipient_type", "admin")
      .eq("type", "system")
      .eq("title", normalizedEmail)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      const filtered = data.filter((row) => {
        // Matches legacy reference_type
        if (legacyRefTypes.includes(row.reference_type)) return true;
        // Matches modern rate_limit reference_type with message encoded as eventType|ip
        if (row.reference_type === "rate_limit") {
          const typeInMsg = (row.message || "").split("|")[0];
          return eventTypes.includes(typeInMsg);
        }
        return false;
      });
      return filtered;
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
    const { data, error } = await supabase
      .from("notifications")
      .select("id, message, reference_type")
      .eq("recipient_type", "admin")
      .eq("type", "system")
      .gte("created_at", sinceIso);

    if (!error && Array.isArray(data)) {
      const count = data.filter((row) => {
        if (row.reference_type === "rate_limit" && (row.message || "").includes(`|${ipAddress}`)) {
          return true;
        }
        if (row.message === ipAddress) return true;
        return false;
      }).length;
      return count;
    }
  } catch {}

  return 0;
};

/**
 * Separate IP-based abuse protection for authentication endpoints
 * Max 30 requests per 15-minute rolling window per IP
 */
const checkIpAbuseLimit = async (ipAddress) => {
  if (!ipAddress) return { allowed: true };
  const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const count = await queryIpRequestCount({ ipAddress, sinceIso: fifteenMinsAgo });
  if (count >= 30) {
    return {
      allowed: false,
      reason: "ip_abuse",
      message: "Too many requests from this network. Please try again later."
    };
  }
  return { allowed: true, count };
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

  // 1. IP Abuse Protection
  const ipCheck = await checkIpAbuseLimit(ipAddress);
  if (!ipCheck.allowed) {
    return ipCheck;
  }

  // 2. Hourly Limit Check: Max 3 additional resends per rolling 60-minute window
  const resendEvents = await queryRecentEvents({
    email: normalizedEmail,
    eventType: ["verification_resend", "verification_resend:pending"],
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

  // 3. Cooldown Check across any verification email issuance (initial, resend, or in-flight pending)
  const recentIssuances = await queryRecentEvents({
    email: normalizedEmail,
    eventType: ["verification_initial", "verification_resend", "verification_resend:pending"],
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

  // 1. IP Abuse Protection
  const ipCheck = await checkIpAbuseLimit(ipAddress);
  if (!ipCheck.allowed) {
    return ipCheck;
  }

  // 2. Query events in the rolling 60-minute window (including pending)
  const recentEvents = await queryRecentEvents({
    email: normalizedEmail,
    eventType: ["password_reset", "password_reset:pending"],
    sinceIso: oneHourAgo
  });

  // 3. Hourly Limit Check (1 initial + 3 additional resends = max 4 in 60 minutes)
  if (recentEvents.length >= 4) {
    return {
      allowed: false,
      reason: "hourly_limit",
      totalInWindow: recentEvents.length
    };
  }

  // 4. Cooldown Check (Minimum 60 seconds)
  const lastEvent = recentEvents[0];
  if (lastEvent) {
    const lastEventTime = new Date(lastEvent.created_at).getTime();
    const elapsedMs = now - lastEventTime;
    if (elapsedMs < 60 * 1000) {
      const remainingSeconds = Math.max(1, Math.ceil((60 * 1000 - elapsedMs) / 1000));
      return {
        allowed: false,
        reason: "cooldown",
        remainingSeconds
      };
    }
  }

  return {
    allowed: true,
    totalIssued: recentEvents.length
  };
};

module.exports = {
  getClientIp,
  acquireLock,
  releaseLock,
  checkIpAbuseLimit,
  checkVerificationResendLimit,
  checkPasswordResetLimit,
  recordEmailEvent,
  removePendingReservation,
  finalizeReservation
};
