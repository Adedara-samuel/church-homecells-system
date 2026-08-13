/**
 * Renders the celebration emails to disk so they can be opened in a browser.
 *
 *   npm run preview:email
 *
 * A browser is not an email client, so this shows layout and colour rather than
 * proving how Outlook will render it — but it catches the things that actually go
 * wrong day to day: a name that breaks the markup, a message longer than the design
 * anticipated, a missing substitution.
 *
 * Nothing is sent and no database is touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  celebrationHtml,
  celebrationSubject,
  celebrationText,
  type CelebrationEmailInput,
} from '../modules/mail/templates/celebration';

const OUTPUT_DIR = path.resolve(__dirname, '../../preview');

const SAMPLES: CelebrationEmailInput[] = [
  {
    kind: 'BIRTHDAY',
    name: 'Chiamaka',
    churchName: 'Grace Assembly',
    message:
      'Happy birthday Chiamaka! The whole family at Grace Assembly is celebrating with you today. May this new year be filled with grace, joy and every good thing.',
    homecellName: 'Overcomers Homecell',
    portalUrl: 'https://example.org',
  },
  {
    kind: 'ANNIVERSARY',
    name: 'Tunde & Bisi',
    churchName: 'Grace Assembly',
    message:
      'Happy wedding anniversary! Thank you for the example your marriage sets for our church family. May God continue to bless your home.',
    homecellName: 'Mount Zion Homecell',
  },
  // A long name and a long message, to check the layout does not depend on the text
  // being the length the designer had in mind.
  {
    kind: 'BIRTHDAY',
    name: 'Oluwadamilareoluwa',
    churchName: 'The Redeemed Evangelical Assembly of Grace',
    message:
      'Happy birthday! '.repeat(18).trim(),
    homecellName: 'Grace Homecell',
  },
];

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const index: string[] = [];

SAMPLES.forEach((sample, position) => {
  const file = `${sample.kind.toLowerCase()}-${position + 1}.html`;
  fs.writeFileSync(path.join(OUTPUT_DIR, file), celebrationHtml(sample));

  console.log(`\n  ${file}`);
  console.log(`    subject : ${celebrationSubject(sample)}`);
  console.log(`    text    : ${celebrationText(sample).split('\n')[0]}…`);

  index.push(
    `<li><a href="./${file}">${sample.kind} — ${sample.name}</a></li>`,
  );
});

fs.writeFileSync(
  path.join(OUTPUT_DIR, 'index.html'),
  `<!doctype html><meta charset="utf-8" /><title>Email previews</title>
<body style="font-family:system-ui;padding:32px;line-height:1.6">
<h1>Celebration email previews</h1><ul>${index.join('')}</ul></body>`,
);

console.log(`\n  Open ${path.join(OUTPUT_DIR, 'index.html')}\n`);
