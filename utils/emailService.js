const { Resend } = require("resend");

const getFrontendUrl = () => {
  const url = process.env.FRONTEND_URL || "https://keepersportlb.com";
  return url.replace(/\/+$/, "");
};

const getResendClient = () => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) return null;
  return new Resend(apiKey);
};

const getSenderEmail = () => {
  return process.env.RESEND_FROM_EMAIL || "Keeper Sports <no-reply@keepersportlb.com>";
};

/**
 * Base email layout for Keeper Sports
 * Uses official Keeper Red (#E10600), dark sports aesthetics, rectangular CTA button
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
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #111216; border: 1px solid #1c1f27; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Top Accent Bar in Keeper Red -->
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

          <!-- Action Button: Rectangular CTA without rounded corners -->
          ${buttonUrl ? `
          <tr>
            <td style="padding: 0 36px 28px 36px;" align="left">
              <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="background-color: #E10600; border-radius: 0;">
                    <a href="${buttonUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 28px; font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #ffffff; text-decoration: none; border: 1px solid #E10600; border-radius: 0;">
                      ${buttonText}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 36px 24px 36px; font-size: 12px; color: #6b7280; line-height: 1.5; word-break: break-all;">
              If the button does not work, copy and paste this secure link into your browser:<br>
              <a href="${buttonUrl}" style="color: #9ca3af; text-decoration: underline;">${buttonUrl}</a>
            </td>
          </tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 36px; background-color: #0d0e12; border-top: 1px solid #1c1f27; font-size: 12px; color: #535868; text-align: left; line-height: 1.5;">
              This is an automated authentication email from Keeper Sports. If you did not make this request, you can safely ignore this message.<br><br>
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
 * Send Email Verification link to customer
 * Expiration: exactly 5 minutes
 */
const sendVerificationEmail = async ({ email, fullName, rawToken }) => {
  const frontendUrl = getFrontendUrl();
  const verifyUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;
  const resend = getResendClient();

  if (!resend) {
    console.warn(`[EmailService] RESEND_API_KEY is not configured. Verification email skipped.`);
    return {
      success: false,
      reason: "RESEND_API_KEY_NOT_CONFIGURED",
      error: "RESEND_API_KEY is not configured on the server."
    };
  }

  const html = renderEmailTemplate({
    title: "Verify your Keeper Sports email",
    subtitle: `Welcome to Keeper Sports, ${fullName || 'Athlete'}.`,
    contentHtml: `
      <p style="margin: 0 0 16px 0;">
        Thank you for creating an account with Keeper Sports. To activate your account and start shopping authentic kits, please verify your email address.
      </p>
      <div style="background-color: #17181f; border-left: 3px solid #E10600; padding: 12px 16px; margin: 0 0 16px 0; font-size: 13px; color: #e5e7eb;">
        <strong>Notice:</strong> For your security, this verification link will expire in exactly <strong>5 minutes</strong>.
      </div>
      <p style="margin: 0; color: #9ca3af; font-size: 13px;">
        If you did not register for an account at Keeper Sports, please ignore this email.
      </p>
    `,
    buttonText: "Verify Email",
    buttonUrl: verifyUrl
  });

  const text = `Welcome to Keeper Sports, ${fullName || 'Athlete'}!\n\nPlease verify your email by clicking the link below:\n${verifyUrl}\n\nFor your security, this verification link expires in exactly 5 minutes.\n\nIf you did not create an account, please ignore this email.`;

  try {
    const { data, error } = await resend.emails.send({
      from: getSenderEmail(),
      to: email,
      subject: "Verify your Keeper Sports email",
      html,
      text
    });

    if (error) {
      console.error(`[EmailService] Resend API error for verification email:`, error.message);
      return { success: false, error: error.message };
    }

    if (!data || !data.id) {
      return { success: false, error: "Provider did not return message id." };
    }

    return {
      success: true,
      messageId: data.id,
      accepted: true
    };
  } catch (err) {
    console.error(`[EmailService] Failed to send verification email:`, err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Send Password Reset link to customer
 * Expiration: exactly 5 minutes
 */
const sendPasswordResetEmail = async ({ email, fullName, rawToken }) => {
  const frontendUrl = getFrontendUrl();
  const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const resend = getResendClient();

  if (!resend) {
    console.warn(`[EmailService] RESEND_API_KEY is not configured. Password reset email skipped.`);
    return {
      success: false,
      reason: "RESEND_API_KEY_NOT_CONFIGURED",
      error: "RESEND_API_KEY is not configured on the server."
    };
  }

  const html = renderEmailTemplate({
    title: "Reset your Keeper Sports password",
    subtitle: `Hello ${fullName || 'Athlete'},`,
    contentHtml: `
      <p style="margin: 0 0 16px 0;">
        We received a request to reset the password for your Keeper Sports account. Click the button below to choose a new password.
      </p>
      <div style="background-color: #17181f; border-left: 3px solid #E10600; padding: 12px 16px; margin: 0 0 16px 0; font-size: 13px; color: #e5e7eb;">
        <strong>Notice:</strong> For your security, this password reset link will expire in exactly <strong>5 minutes</strong> and can only be used once.
      </div>
      <p style="margin: 0; color: #9ca3af; font-size: 13px;">
        If you did not request a password reset, you can safely ignore this email. Your current password remains active.
      </p>
    `,
    buttonText: "Reset Password",
    buttonUrl: resetUrl
  });

  const text = `Hello ${fullName || 'Athlete'},\n\nWe received a request to reset your Keeper Sports password.\nClick the link below to choose a new password:\n${resetUrl}\n\nFor your security, this link expires in exactly 5 minutes and can only be used once.\n\nIf you did not request a password reset, you can safely ignore this email.`;

  try {
    const { data, error } = await resend.emails.send({
      from: getSenderEmail(),
      to: email,
      subject: "Reset your Keeper Sports password",
      html,
      text
    });

    if (error) {
      console.error(`[EmailService] Resend API error for password reset email:`, error.message);
      return { success: false, error: error.message };
    }

    if (!data || !data.id) {
      return { success: false, error: "Provider did not return message id." };
    }

    return {
      success: true,
      messageId: data.id,
      accepted: true
    };
  } catch (err) {
    console.error(`[EmailService] Failed to send password reset email:`, err.message);
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  getFrontendUrl,
  getSenderEmail,
  getResendClient
};
