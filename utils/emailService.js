const { Resend } = require("resend");

const getFrontendUrl = () => {
  const url = process.env.FRONTEND_URL || "https://keepersportlb.com";
  return url.replace(/\/+$/, "");
};

const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
};

const getSenderEmail = () => {
  return process.env.RESEND_FROM_EMAIL || "Keeper Sports <auth@keepersportlb.com>";
};

/**
 * Base email layout for Keeper Sports
 */
const renderEmailTemplate = ({ title, subtitle, contentHtml, buttonText, buttonUrl }) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0c0e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0c0e; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #111216; border: 1px solid #1c1f27; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Top Accent Bar -->
          <tr>
            <td style="height: 3px; background-color: #E10600;"></td>
          </tr>
          
          <!-- Header -->
          <tr>
            <td style="padding: 36px 36px 20px 36px; text-align: left;">
              <div style="font-size: 13px; font-weight: 800; letter-spacing: 0.15em; color: #E10600; text-transform: uppercase; margin-bottom: 8px;">
                KEEPER SPORTS
              </div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; line-height: 1.25;">
                ${title}
              </h1>
              ${subtitle ? `<p style="margin: 8px 0 0 0; font-size: 14px; color: #8e94a4; line-height: 1.5;">${subtitle}</p>` : ''}
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 10px 36px 24px 36px; font-size: 14px; color: #d1d5db; line-height: 1.6;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Action Button -->
          ${buttonUrl ? `
          <tr>
            <td style="padding: 0 36px 32px 36px;" align="left">
              <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="background-color: #E10600; border-radius: 0;">
                    <a href="${buttonUrl}" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #ffffff; text-decoration: none; border: 1px solid #E10600;">
                      ${buttonText}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 36px 24px 36px; font-size: 12px; color: #6b7280; line-height: 1.5; word-break: break-all;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <a href="${buttonUrl}" style="color: #9ca3af; text-decoration: underline;">${buttonUrl}</a>
            </td>
          </tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 36px; background-color: #0d0e12; border-top: 1px solid #1c1f27; font-size: 12px; color: #535868; text-align: left; line-height: 1.5;">
              This is an automated message from Keeper Sports. If you did not make this request, you can safely ignore this email.<br><br>
              © ${new Date().getFullYear()} Keeper Sports (keepersportlb.com). All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

/**
 * Send Email Verification link to user
 */
const sendVerificationEmail = async ({ email, fullName, rawToken }) => {
  const frontendUrl = getFrontendUrl();
  const verifyUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;
  const resend = getResendClient();

  if (!resend) {
    console.warn(`[EmailService] RESEND_API_KEY is not configured. Verification email to ${email} skipped.`);
    return {
      success: false,
      reason: "RESEND_API_KEY_NOT_CONFIGURED",
      verifyUrl
    };
  }

  const html = renderEmailTemplate({
    title: "Verify Your Email",
    subtitle: `Welcome to Keeper Sports, ${fullName || 'Athlete'}.`,
    contentHtml: `
      <p style="margin: 0 0 16px 0;">
        Thank you for creating an account with Keeper Sports. To activate your account and start shopping authentic kits, please verify your email address.
      </p>
      <p style="margin: 0; color: #9ca3af; font-size: 13px;">
        This verification link will expire in <strong>24 hours</strong>.
      </p>
    `,
    buttonText: "Verify Email",
    buttonUrl: verifyUrl
  });

  const text = `Welcome to Keeper Sports, ${fullName}!\n\nPlease verify your email by clicking the link below:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you did not request this, please ignore this email.`;

  try {
    const data = await resend.emails.send({
      from: getSenderEmail(),
      to: email,
      subject: "Verify Your Keeper Sports Account",
      html,
      text
    });

    return { success: true, id: data.id };
  } catch (err) {
    console.error(`[EmailService] Failed to send verification email to ${email}:`, err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Send Password Reset link to user
 */
const sendPasswordResetEmail = async ({ email, fullName, rawToken }) => {
  const frontendUrl = getFrontendUrl();
  const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const resend = getResendClient();

  if (!resend) {
    console.warn(`[EmailService] RESEND_API_KEY is not configured. Password reset email to ${email} skipped.`);
    return {
      success: false,
      reason: "RESEND_API_KEY_NOT_CONFIGURED",
      resetUrl
    };
  }

  const html = renderEmailTemplate({
    title: "Reset Your Password",
    subtitle: `Hello ${fullName || 'Athlete'},`,
    contentHtml: `
      <p style="margin: 0 0 16px 0;">
        We received a request to reset the password for your Keeper Sports account. Click the button below to choose a new password.
      </p>
      <p style="margin: 0; color: #9ca3af; font-size: 13px;">
        For security, this link is valid for <strong>1 hour</strong> and can only be used once. If you did not request a password reset, no action is required.
      </p>
    `,
    buttonText: "Reset Password",
    buttonUrl: resetUrl
  });

  const text = `Hello ${fullName},\n\nWe received a request to reset your password for Keeper Sports.\nClick the link below to choose a new password:\n${resetUrl}\n\nThis link is valid for 1 hour.\nIf you did not request a password reset, you can safely ignore this email.`;

  try {
    const data = await resend.emails.send({
      from: getSenderEmail(),
      to: email,
      subject: "Reset Your Keeper Sports Password",
      html,
      text
    });

    return { success: true, id: data.id };
  } catch (err) {
    console.error(`[EmailService] Failed to send password reset email to ${email}:`, err.message);
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  getFrontendUrl
};
