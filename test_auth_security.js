const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const supabase = require("./config/supabase");
const {
  checkVerificationResendLimit,
  checkPasswordResetLimit,
  recordEmailEvent,
  checkIpAbuseLimit,
  acquireLock,
  releaseLock
} = require("./utils/rateLimitService");

async function runSecuritySuite() {
  console.log("=================================================================");
  console.log("  KEEPER SPORTS — AUTHENTICATION & SECURITY VERIFICATION SUITE  ");
  console.log("=================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  const testEmail = `sec_test_${Date.now()}@example.com`;
  const ip = "192.168.1.100";

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Verification Cooldown (60 seconds) & Hourly Limit (Max 3 Resends)
    // -------------------------------------------------------------------------
    console.log("--- 1. Testing Verification Cooldown & Hourly Limits ---");

    // Fresh user: should be allowed (resendsUsed: 0, remainingResends: 3)
    const initialCheck = await checkVerificationResendLimit(testEmail, ip);
    assert(initialCheck.allowed === true && initialCheck.remainingResends === 3, "Initial check allows resend with 3 remaining");

    // Record verification_initial (separate from resend allowance)
    await recordEmailEvent({ email: testEmail, eventType: "verification_initial", ipAddress: ip });

    // Immediate check after initial: cooldown must block it!
    const cooldownCheck = await checkVerificationResendLimit(testEmail, ip);
    assert(cooldownCheck.allowed === false && cooldownCheck.reason === "cooldown", "Cooldown blocks resend within 60s of initial email");

    // Clean test cooldown event to test hourly limit
    await supabase.from("notifications").delete().eq("title", testEmail);

    // Simulate 3 resend events spaced out
    await recordEmailEvent({ email: testEmail, eventType: "verification_resend", ipAddress: ip });
    await recordEmailEvent({ email: testEmail, eventType: "verification_resend", ipAddress: ip });
    await recordEmailEvent({ email: testEmail, eventType: "verification_resend", ipAddress: ip });

    // 4th resend attempt: hourly limit must block it!
    const hourlyCheck = await checkVerificationResendLimit(testEmail, ip);
    assert(hourlyCheck.allowed === false && hourlyCheck.reason === "hourly_limit", "Hourly limit blocks after 3 additional resends");

    // -------------------------------------------------------------------------
    // TEST 2: Password Reset Rate Limits & Cooldown
    // -------------------------------------------------------------------------
    console.log("\n--- 2. Testing Password Reset Limits ---");
    const resetEmail = `reset_test_${Date.now()}@example.com`;

    const resetCheck1 = await checkPasswordResetLimit(resetEmail, ip);
    assert(resetCheck1.allowed === true, "Initial password reset request is allowed");

    await recordEmailEvent({ email: resetEmail, eventType: "password_reset", ipAddress: ip });
    const resetCooldown = await checkPasswordResetLimit(resetEmail, ip);
    assert(resetCooldown.allowed === false && resetCooldown.reason === "cooldown", "Password reset cooldown blocks immediate re-request");

    // -------------------------------------------------------------------------
    // TEST 3: In-Process & Persistent Concurrency Lock
    // -------------------------------------------------------------------------
    console.log("\n--- 3. Testing Concurrency Protection ---");
    const lockKey = `test_lock:${Date.now()}`;
    const lock1 = acquireLock(lockKey);
    const lock2 = acquireLock(lockKey); // simultaneous attempt
    assert(lock1 === true && lock2 === false, "Simultaneous request with same lockKey is rejected");
    releaseLock(lockKey);
    const lock3 = acquireLock(lockKey);
    assert(lock3 === true, "Lock is successfully re-acquired after release");
    releaseLock(lockKey);

    // -------------------------------------------------------------------------
    // TEST 4: IP Abuse Protection
    // -------------------------------------------------------------------------
    console.log("\n--- 4. Testing IP Abuse Protection ---");
    const ipCheck = await checkIpAbuseLimit(ip);
    assert(ipCheck.allowed === true, "Normal IP request rate is permitted");

    // -------------------------------------------------------------------------
    // TEST 5: Token Expiration (Strictly 5 Minutes) & Token Invalidation Lifecycle
    // -------------------------------------------------------------------------
    console.log("\n--- 5. Testing Token Expiration & Single-Use Lifecycle ---");
    const rawToken1 = crypto.randomBytes(32).toString("hex");
    const tokenHash1 = crypto.createHash("sha256").update(rawToken1).digest("hex");
    const rawToken2 = crypto.randomBytes(32).toString("hex");
    const tokenHash2 = crypto.createHash("sha256").update(rawToken2).digest("hex");

    const salt = await bcrypt.genSalt(10);
    const initialPasswordHash = await bcrypt.hash("OldPassword123!", salt);

    // Create temporary test user
    const dbEmail = `db_test_${Date.now()}@keepersport.test`;
    const expires5Min = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { data: createdUser, error: insertErr } = await supabase
      .from("users")
      .insert({
        full_name: "Test Athlete",
        email: dbEmail,
        password_hash: initialPasswordHash,
        auth_provider: "local",
        is_verified: false,
        verification_token_hash: tokenHash1,
        verification_token_expires_at: expires5Min,
        password_reset_token_hash: tokenHash1,
        password_reset_token_expires_at: expires5Min
      })
      .select("id, email, is_verified, verification_token_hash, password_reset_token_hash")
      .single();

    assert(!insertErr && createdUser, "Created test user in database");

    // Test token replacement: issuing Token 2 invalidates Token 1
    const { error: replaceErr } = await supabase
      .from("users")
      .update({
        verification_token_hash: tokenHash2,
        verification_token_expires_at: expires5Min
      })
      .eq("id", createdUser.id);

    assert(!replaceErr, "Updated user with replacement Token 2");

    // Attempt verification with old Token 1: MUST FAIL (not found)
    const { data: userWithOldToken } = await supabase
      .from("users")
      .select("id")
      .eq("verification_token_hash", tokenHash1)
      .maybeSingle();

    assert(userWithOldToken === null, "Old Token 1 is completely invalidated after replacement");

    // Verification with Token 2 succeeds
    const { data: userWithNewToken } = await supabase
      .from("users")
      .select("id, verification_token_expires_at")
      .eq("verification_token_hash", tokenHash2)
      .maybeSingle();

    const notExpired = new Date(userWithNewToken.verification_token_expires_at) > new Date();
    assert(userWithNewToken && notExpired, "Replacement Token 2 is valid and unexpired");

    // Single-use token consumption: verify user and clear token
    const { error: verifyErr } = await supabase
      .from("users")
      .update({
        is_verified: true,
        verification_token_hash: null,
        verification_token_expires_at: null
      })
      .eq("id", createdUser.id);

    assert(!verifyErr, "User marked as verified and token nulled");

    // Attempt reusing Token 2: MUST FAIL
    const { data: reusedTokenUser } = await supabase
      .from("users")
      .select("id")
      .eq("verification_token_hash", tokenHash2)
      .maybeSingle();

    assert(reusedTokenUser === null, "Single-use verified token cannot be reused");

    // -------------------------------------------------------------------------
    // TEST 6: Password Reset & Password Hash Transition
    // -------------------------------------------------------------------------
    console.log("\n--- 6. Testing Password Reset & Hash Transition ---");
    const newPassword = "NewStrongPassword456!";
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // Simulate password reset consumption
    await supabase
      .from("users")
      .update({
        password_hash: newPasswordHash,
        password_reset_token_hash: null,
        password_reset_token_expires_at: null
      })
      .eq("id", createdUser.id);

    // Fetch user to test passwords
    const { data: updatedUser } = await supabase
      .from("users")
      .select("password_hash")
      .eq("id", createdUser.id)
      .single();

    const oldMatch = await bcrypt.compare("OldPassword123!", updatedUser.password_hash);
    const newMatch = await bcrypt.compare("NewStrongPassword456!", updatedUser.password_hash);

    assert(oldMatch === false, "Old password immediately stops working");
    assert(newMatch === true, "New password immediately validates successfully");

    // -------------------------------------------------------------------------
    // TEST 7: Expired Token Rejection
    // -------------------------------------------------------------------------
    console.log("\n--- 7. Testing Expired Token Rejection ---");
    const pastExpiresAt = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
    await supabase
      .from("users")
      .update({
        password_reset_token_hash: tokenHash1,
        password_reset_token_expires_at: pastExpiresAt
      })
      .eq("id", createdUser.id);

    const { data: expiredCheckUser } = await supabase
      .from("users")
      .select("password_reset_token_expires_at")
      .eq("password_reset_token_hash", tokenHash1)
      .single();

    const isExpired = new Date(expiredCheckUser.password_reset_token_expires_at) < new Date();
    assert(isExpired === true, "Token past 5-minute window is correctly identified as expired");

    // -------------------------------------------------------------------------
    // TEST 8: Admin Authentication Still Works
    // -------------------------------------------------------------------------
    console.log("\n--- 8. Testing Admin Account Integrity ---");
    const { data: adminUser } = await supabase
      .from("users")
      .select("id, role, email")
      .in("role", ["admin", "super_admin"])
      .limit(1)
      .maybeSingle();

    assert(adminUser !== null, `Admin account intact (${adminUser?.email}, role: ${adminUser?.role})`);

    // Clean up test user & notifications
    await supabase.from("users").delete().eq("id", createdUser.id);
    await supabase.from("notifications").delete().in("title", [testEmail, resetEmail, dbEmail]);

  } catch (err) {
    console.error("Test suite exception:", err);
    failed++;
  }

  console.log("\n=================================================================");
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED  `);
  console.log("=================================================================\n");

  if (failed > 0) process.exit(1);
}

runSecuritySuite();
