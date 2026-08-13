/**
 * The celebration email.
 *
 * Email clients are not browsers. This template is written to the constraints that
 * actually matter in 2026 rather than to modern CSS:
 *
 *   - **Tables, not flex or grid.** Outlook on Windows renders through Word, which
 *     supports neither. Nested tables are the only layout that survives everywhere.
 *   - **Inline styles.** Gmail strips `<style>` blocks in some contexts, and clipping
 *     rules reward a smaller head. Every rule that must hold is on the element.
 *   - **Explicit colours everywhere.** A dark-mode client inverts anything it thinks
 *     is default, so a background left unstated turns black under a dark palette while
 *     the text stays dark too.
 *   - **Preheader text.** The inbox preview line is chosen deliberately instead of
 *     leaking whatever the first visible words happen to be.
 *   - **600px wide.** Still the safe maximum; below 600 it scales down cleanly on a
 *     phone with the fluid width set here.
 */

export type CelebrationKind = 'BIRTHDAY' | 'ANNIVERSARY';

export interface CelebrationEmailInput {
  kind: CelebrationKind;
  /** What the person is called — a preferred name when they have one. */
  name: string;
  churchName: string;
  /** The configured message, already rendered with name and church substituted. */
  message: string;
  /** Optional line under the church name, e.g. the homecell they belong to. */
  homecellName?: string | null;
  /** Where "visit the portal" points. Omitted entirely when absent. */
  portalUrl?: string | null;
}

const NAVY = '#122043';
const NAVY_SOFT = '#1B2E5C';
const GOLD = '#E3BE55';
const INK = '#1F2937';
const MUTED = '#6B7280';
const PAGE = '#F4F6FA';
const CARD = '#FFFFFF';
const HAIRLINE = '#E5E7EB';

const COPY: Record<CelebrationKind, { emoji: string; eyebrow: string; heading: (name: string) => string; closing: string }> = {
  BIRTHDAY: {
    emoji: '🎂',
    eyebrow: 'A special day',
    heading: (name) => `Happy Birthday, ${name}!`,
    closing: 'Wishing you a wonderful year ahead.',
  },
  ANNIVERSARY: {
    emoji: '💍',
    eyebrow: 'A special day',
    heading: (name) => `Happy Anniversary, ${name}!`,
    closing: 'Wishing you many more years together.',
  },
};

/** Escapes text so a name containing `&` or `<` cannot break the markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function celebrationSubject(input: CelebrationEmailInput): string {
  const copy = COPY[input.kind];
  return input.kind === 'BIRTHDAY'
    ? `${copy.emoji} Happy Birthday, ${input.name}!`
    : `${copy.emoji} Happy Anniversary, ${input.name}!`;
}

/** The plain-text alternative. Never optional: a message with no text part scores as spam. */
export function celebrationText(input: CelebrationEmailInput): string {
  const copy = COPY[input.kind];
  return [
    copy.heading(input.name),
    '',
    input.message,
    '',
    copy.closing,
    '',
    `— ${input.churchName}`,
    input.homecellName ? `${input.homecellName}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function celebrationHtml(input: CelebrationEmailInput): string {
  const copy = COPY[input.kind];
  const name = escapeHtml(input.name);
  const church = escapeHtml(input.churchName);
  const message = escapeHtml(input.message).replace(/\n/g, '<br />');
  const homecell = input.homecellName ? escapeHtml(input.homecellName) : null;
  const heading = escapeHtml(copy.heading(input.name));

  // The monogram avoids hosting an image: a remote logo is blocked by default in most
  // clients, and a broken image is worse than none.
  const monogram = escapeHtml(
    input.churchName
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? '')
      .join('')
      .toUpperCase() || 'C',
  );

  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${heading}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  /* Progressive enhancement only — nothing here is load-bearing. */
  @media only screen and (max-width: 620px) {
    .sm-p-24 { padding: 24px !important; }
    .sm-heading { font-size: 26px !important; line-height: 34px !important; }
    .sm-full { width: 100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE};-webkit-font-smoothing:antialiased;">
  <!-- Inbox preview line, hidden in the body itself. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
    ${escapeHtml(copy.closing)} — from everyone at ${church}.
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE};">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" class="sm-full" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${CARD};border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,0.08);">

          <!-- Masthead -->
          <tr>
            <td style="background-color:${NAVY};padding:28px 32px;" class="sm-p-24">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="44" style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="40" height="40" align="center" style="width:40px;height:40px;background-color:${NAVY_SOFT};border-radius:10px;color:${GOLD};font-family:Georgia,'Times New Roman',serif;font-size:16px;font-weight:700;letter-spacing:0.5px;">
                          ${monogram}
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="vertical-align:middle;padding-left:12px;">
                    <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#FFFFFF;line-height:20px;">${church}</div>
                    <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#AFBCDA;line-height:16px;">${escapeHtml(copy.eyebrow)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Gold rule: the one flourish, and it costs nothing to render. -->
          <tr><td style="height:3px;background-color:${GOLD};line-height:3px;font-size:0;">&nbsp;</td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 32px 8px;" class="sm-p-24">
              <div style="font-size:40px;line-height:44px;margin-bottom:16px;">${copy.emoji}</div>
              <h1 class="sm-heading" style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:38px;font-weight:400;color:${NAVY};letter-spacing:-0.2px;">
                ${heading}
              </h1>
              <p style="margin:0 0 20px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${INK};">
                ${message}
              </p>
              <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${INK};">
                ${escapeHtml(copy.closing)}
              </p>
            </td>
          </tr>

          <!-- Signature -->
          <tr>
            <td style="padding:24px 32px 32px;" class="sm-p-24">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="height:1px;background-color:${HAIRLINE};line-height:1px;font-size:0;">&nbsp;</td></tr>
              </table>
              <p style="margin:20px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:${MUTED};">
                With love from everyone at<br />
                <span style="color:${NAVY};font-weight:600;">${church}</span>${homecell ? `<br /><span style="color:${MUTED};">${homecell}</span>` : ''}
              </p>
            </td>
          </tr>

          ${
            input.portalUrl
              ? `<tr>
            <td style="padding:0 32px 32px;" class="sm-p-24">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:${NAVY};border-radius:8px;">
                    <a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;padding:12px 24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                      Visit the church portal
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
              : ''
          }
        </table>

        <!-- Footer, outside the card so it reads as metadata rather than message -->
        <table role="presentation" class="sm-full" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
          <tr>
            <td style="padding:20px 32px;text-align:center;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${MUTED};">
              You are receiving this because you are a member of ${church}.<br />
              This message was sent automatically — there is no need to reply.
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
