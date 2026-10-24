import type { Bindings, Mailer } from "./env";

/** How long a sign-in link works. Shown in the email, and enforced in routes/auth.ts. */
const LINK_MINUTES = 15;

/** Local development only: prints the link so you can click it. Never enabled in production. */
const consoleMailer: Mailer = {
  async sendMagicLink(email, link) {
    // eslint-disable-next-line no-console -- the brief asks for console output in local development
    console.log(`[dev mail] Sign-in link for ${email}: ${link}`);
  },
};

/** Used when no email provider is configured. It sends nothing, so nothing can leak. */
const silentMailer: Mailer = {
  async sendMagicLink() {},
};

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Sends the sign-in email through Brevo's free transactional API.
 * It never writes the address or the link to the logs. A failure throws, and the route turns it into the same
 * answer as a success, so a person cannot learn anything from a failed send.
 */
export function brevoMailer(apiKey: string, senderEmail: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async sendMagicLink(email, link) {
      const text =
        `Hello,\n\nUse this link to sign in to Linkbeam. It works once and expires in ${LINK_MINUTES} minutes.\n\n${link}\n\n` +
        `If you did not ask for this, you can ignore this email. Nobody can sign in without the link.\n`;
      const html =
        `<p>Hello,</p><p>Use this link to sign in to Linkbeam. It works once and expires in ${LINK_MINUTES} minutes.</p>` +
        `<p><a href="${escapeHtml(link)}">Sign in to Linkbeam</a></p>` +
        `<p>If the button does not work, copy this address into your browser:<br>${escapeHtml(link)}</p>` +
        `<p>If you did not ask for this, you can ignore this email. Nobody can sign in without the link.</p>`;
      const response = await fetchImpl(BREVO_URL, {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: "Linkbeam", email: senderEmail },
          to: [{ email }],
          subject: "Your Linkbeam sign-in link",
          textContent: text,
          htmlContent: html,
        }),
      });
      if (!response.ok) {
        // Only the status number is logged. The reply body could repeat the address.
        // eslint-disable-next-line no-console -- the owner needs to see that sending is failing (for example a wrong key)
        console.error(`[mail] Brevo refused the message with status ${response.status}`);
        throw new Error(`Brevo status ${response.status}`);
      }
    },
  };
}

export function mailerFor(env: Bindings, fetchImpl: typeof fetch = fetch): Mailer {
  if (env.MAIL_MODE === "console") return consoleMailer;
  if (env.MAIL_MODE === "brevo") {
    if (env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL) return brevoMailer(env.BREVO_API_KEY, env.BREVO_SENDER_EMAIL, fetchImpl);
    // eslint-disable-next-line no-console -- a missing setting must be visible to the owner, or sign-in fails silently
    console.error("[mail] MAIL_MODE is brevo but BREVO_API_KEY or BREVO_SENDER_EMAIL is missing. No email will be sent.");
  }
  return silentMailer;
}
