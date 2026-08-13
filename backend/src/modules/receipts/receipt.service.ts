import PDFDocument from 'pdfkit';
import { assertHomecellInScope } from '../../middleware/scope';
import {
  DuesInvoiceStatus,
  PaymentPurpose,
  PaymentStatus,
  RemittanceChannel,
  RemittanceStatus,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { dayjs } from '../../utils/dates';
import { ConflictError, NotFoundError } from '../../utils/errors';
import { idString } from '../../utils/ids';
import { amountToWords, formatMoney } from '../../utils/money';
import { Area } from '../areas/area.model';
import { DuesInvoice } from '../dues/dues.model';
import { Homecell } from '../homecells/homecell.model';
import { Payment } from '../payments/payment.model';
import { Remittance } from '../remittances/remittance.model';
import { getSettings } from '../settings/settings.service';
import { User } from '../users/user.model';
import { Zone } from '../zones/zone.model';

/**
 * Receipts.
 *
 * A receipt is evidence, so it is generated from the stored records at the moment it
 * is asked for rather than saved as a file — it can never drift from the ledger. It
 * is only issued once the money has actually settled; an unsettled remittance produces
 * a refusal, not a document that looks like proof of payment.
 */

export interface ReceiptLine {
  label: string;
  detail?: string;
  amountMinor: number;
}

export interface ReceiptModel {
  kind: 'REMITTANCE' | 'DUES' | 'PAYMENT';
  documentTitle: string;
  reference: string;
  status: string;
  settled: boolean;
  issuedAt: Date;
  paidAt: Date | null;

  churchName: string;
  payer: {
    homecellName: string;
    homecellCode: string;
    areaName: string;
    zoneName: string;
    coordinator: string | null;
  };
  payee: {
    accountName: string;
    accountNumber?: string | null;
    bankName?: string | null;
  };

  method: string;
  providerReference: string | null;
  paymentReference: string | null;

  lines: ReceiptLine[];
  totalMinor: number;
  currency: string;
  note?: string | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  [RemittanceChannel.MANUAL]: 'Bank transfer / cash (proof uploaded)',
  [RemittanceChannel.PROVIDER_TRANSFER]: 'Provider payout',
  [RemittanceChannel.PROVIDER_CHECKOUT]: 'Online payment',
};

async function orgNames(area: unknown, zone: unknown) {
  const [areaDoc, zoneDoc] = await Promise.all([
    Area.findById(area).select('name').lean(),
    Zone.findById(zone).select('name').lean(),
  ]);
  return { areaName: areaDoc?.name ?? '—', zoneName: zoneDoc?.name ?? '—' };
}

async function userName(id: unknown): Promise<string | null> {
  if (!id) return null;
  const user = await User.findById(id).select('firstName lastName').lean();
  return user ? `${user.firstName} ${user.lastName}` : null;
}

/** Receipt for a single remittance. */
export async function buildRemittanceReceipt(
  actor: AuthenticatedUser,
  id: string,
): Promise<ReceiptModel> {
  const remittance = await Remittance.findById(id).lean();
  if (!remittance) throw new NotFoundError('Remittance');
  await assertHomecellInScope(actor, remittance.homecell);

  if (remittance.status !== RemittanceStatus.SUCCESSFUL) {
    throw new ConflictError(
      'A receipt is only issued once the remittance has been confirmed and posted.',
    );
  }

  const [settings, homecell] = await Promise.all([
    getSettings(),
    Homecell.findById(remittance.homecell).select('name code').lean(),
  ]);
  const { areaName, zoneName } = await orgNames(remittance.area, remittance.zone);
  const coordinator = await userName(remittance.recordedBy);

  const provider = remittance.paymentProvider ? ` (${remittance.paymentProvider})` : '';

  return {
    kind: 'REMITTANCE',
    documentTitle: 'Remittance Receipt',
    reference: remittance.reference,
    status: remittance.status,
    settled: true,
    issuedAt: new Date(),
    paidAt: remittance.remittedAt ?? remittance.date,
    churchName: settings.churchName,
    payer: {
      homecellName: homecell?.name ?? '—',
      homecellCode: homecell?.code ?? '—',
      areaName,
      zoneName,
      coordinator,
    },
    payee: {
      accountName: remittance.receivingAccount || settings.generalPurseAccountName,
      accountNumber: settings.generalPurseAccountNumber,
      bankName: settings.generalPurseBankName,
    },
    method: `${CHANNEL_LABEL[remittance.channel] ?? remittance.channel}${provider}`,
    providerReference: remittance.providerReference ?? null,
    paymentReference: remittance.paymentReference ?? null,
    lines: [
      {
        label: 'Remittance to the General Homecell Purse',
        detail: remittance.description ?? undefined,
        amountMinor: remittance.amountMinor,
      },
    ],
    totalMinor: remittance.amountMinor,
    currency: remittance.currency,
  };
}

/** Receipt for a dues payment, itemised by the periods it cleared. */
export async function buildDuesReceipt(
  actor: AuthenticatedUser,
  reference: string,
): Promise<ReceiptModel> {
  const payment = await Payment.findOne({ reference, purpose: PaymentPurpose.DUES }).lean();
  if (!payment) throw new NotFoundError('Dues payment');
  await assertHomecellInScope(actor, payment.homecell);

  if (payment.status !== PaymentStatus.SUCCESSFUL) {
    throw new ConflictError('A receipt is only issued once the payment has been confirmed.');
  }

  const [settings, homecell, invoices] = await Promise.all([
    getSettings(),
    Homecell.findById(payment.homecell).select('name code').lean(),
    DuesInvoice.find({ payment: payment._id }).sort({ dueDate: 1 }).lean(),
  ]);
  const { areaName, zoneName } = await orgNames(payment.area, payment.zone);
  const coordinator = await userName(payment.initiatedBy);

  return {
    kind: 'DUES',
    documentTitle: 'Dues & Levies Receipt',
    reference: payment.reference,
    status: invoices.every((i) => i.status === DuesInvoiceStatus.PAID) ? 'PAID' : payment.status,
    settled: true,
    issuedAt: new Date(),
    paidAt: payment.completedAt ?? payment.updatedAt,
    churchName: settings.churchName,
    payer: {
      homecellName: homecell?.name ?? '—',
      homecellCode: homecell?.code ?? '—',
      areaName,
      zoneName,
      coordinator,
    },
    payee: {
      accountName: `${zoneName} — dues account`,
      accountNumber: settings.generalPurseAccountNumber,
      bankName: settings.generalPurseBankName,
    },
    method: `Online payment (${payment.provider})`,
    providerReference: payment.providerReference ?? null,
    paymentReference: payment.reference,
    lines: invoices.map((invoice) => ({
      label: invoice.name,
      detail: invoice.periodLabel,
      amountMinor: invoice.amountMinor,
    })),
    totalMinor: payment.amountMinor,
    currency: payment.currency,
    note:
      invoices.length > 1
        ? `${invoices.length} charges settled in a single payment.`
        : undefined,
  };
}

const PURPOSE_LABEL: Record<string, string> = {
  [PaymentPurpose.OFFERING]: 'Homecell offering',
  [PaymentPurpose.OTHER_INCOME]: 'Other income',
  [PaymentPurpose.REMITTANCE]: 'Remittance',
  [PaymentPurpose.DUES]: 'Dues & levies',
};

/**
 * The receipt for any settled online payment, whatever it was for.
 *
 * Remittances and dues have richer receipts of their own — a remittance names the
 * receiving account, a dues payment itemises the months it cleared — so this defers to
 * those when the payment is linked to one. Everything else (an offering, other income)
 * gets the general form.
 *
 * This is the entry point the UI uses, so a coordinator never has to know which of the
 * three shapes their payment produced.
 */
export async function buildPaymentReceipt(
  actor: AuthenticatedUser,
  reference: string,
): Promise<ReceiptModel> {
  const payment = await Payment.findOne({ reference }).lean();
  if (!payment) throw new NotFoundError('Payment');
  await assertHomecellInScope(actor, payment.homecell);

  if (payment.purpose === PaymentPurpose.DUES) return buildDuesReceipt(actor, reference);
  if (payment.relatedModel === 'Remittance' && payment.relatedId) {
    return buildRemittanceReceipt(actor, idString(payment.relatedId));
  }

  if (payment.status !== PaymentStatus.SUCCESSFUL) {
    throw new ConflictError('A receipt is only issued once the payment has been confirmed.');
  }

  const [settings, homecell] = await Promise.all([
    getSettings(),
    Homecell.findById(payment.homecell).select('name code').lean(),
  ]);
  const { areaName, zoneName } = await orgNames(payment.area, payment.zone);
  const initiator = await userName(payment.initiatedBy);

  const purposeLabel = PURPOSE_LABEL[payment.purpose] ?? 'Payment';

  return {
    kind: 'PAYMENT',
    documentTitle: 'Payment Receipt',
    reference: payment.reference,
    status: payment.status,
    settled: true,
    issuedAt: new Date(),
    paidAt: payment.completedAt ?? payment.updatedAt,
    churchName: settings.churchName,
    payer: {
      homecellName: homecell?.name ?? '—',
      homecellCode: homecell?.code ?? '—',
      areaName,
      zoneName,
      // The person who actually paid, falling back to whoever started it.
      coordinator: payment.customerName ?? initiator,
    },
    payee: {
      accountName: `${settings.churchName} — ${homecell?.name ?? 'Homecell'} purse`,
      accountNumber: settings.generalPurseAccountNumber,
      bankName: settings.generalPurseBankName,
    },
    method: `Online payment (${payment.provider})`,
    providerReference: payment.providerReference ?? null,
    paymentReference: payment.reference,
    lines: [
      {
        label: purposeLabel,
        detail: payment.description ?? undefined,
        amountMinor: payment.amountMinor,
      },
    ],
    totalMinor: payment.amountMinor,
    currency: payment.currency,
    note: payment.customerEmail ? `Confirmation sent to ${payment.customerEmail}.` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const INK = '#111827';
const MUTED = '#6B7280';
const LINE = '#E5E7EB';
const BRAND = '#1F3A93';
const SUCCESS = '#047857';

const FILENAME_PREFIX: Record<ReceiptModel['kind'], string> = {
  DUES: 'dues',
  REMITTANCE: 'remittance',
  PAYMENT: 'payment',
};

export function receiptFilename(model: ReceiptModel): string {
  return `${FILENAME_PREFIX[model.kind]}-receipt-${model.reference}.pdf`;
}

/**
 * Renders the receipt as an A4 PDF.
 *
 * Everything is drawn at explicit coordinates rather than with flowing text, so the
 * layout is stable whatever the content length — a receipt covering twelve months of
 * dues sits on the same grid as one covering a single remittance.
 */
export function renderReceiptPdf(model: ReceiptModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
      Title: `${model.documentTitle} ${model.reference}`,
      Author: model.churchName,
      Subject: 'Payment receipt',
    } });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // --- Header -------------------------------------------------------------
    doc.rect(0, 0, doc.page.width, 108).fill(BRAND);
    doc
      .fillColor('#FFFFFF')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(model.churchName, left, 34, { width: width - 180 });
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#D7DEF6')
      .text('Homecell Management System', left, 58, { width: width - 180 });

    doc
      .fontSize(15)
      .font('Helvetica-Bold')
      .fillColor('#FFFFFF')
      .text(model.documentTitle.toUpperCase(), left, 34, { width, align: 'right' });
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#D7DEF6')
      .text(`Receipt No. ${model.reference}`, left, 56, { width, align: 'right' });
    doc
      .fontSize(9)
      .text(
        `Issued ${dayjs(model.issuedAt).format('D MMM YYYY, HH:mm')}`,
        left,
        72,
        { width, align: 'right' },
      );

    // --- Paid stamp ---------------------------------------------------------
    let y = 136;
    doc.roundedRect(left, y, 92, 24, 4).fill(SUCCESS);
    doc
      .fillColor('#FFFFFF')
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('PAID', left, y + 7, { width: 92, align: 'center' });

    doc
      .fillColor(MUTED)
      .fontSize(9)
      .font('Helvetica')
      .text(
        model.paidAt
          ? `Payment date & time: ${dayjs(model.paidAt).format('dddd, D MMMM YYYY [at] HH:mm')}`
          : '',
        left + 104,
        y + 8,
        { width: width - 104 },
      );

    // --- Parties ------------------------------------------------------------
    y += 46;
    const columnWidth = (width - 24) / 2;

    const party = (
      x: number,
      heading: string,
      rows: [string, string | null | undefined][],
    ) => {
      let cursor = y;
      doc
        .fillColor(MUTED)
        .fontSize(8)
        .font('Helvetica-Bold')
        .text(heading.toUpperCase(), x, cursor, { width: columnWidth, characterSpacing: 0.6 });
      cursor += 15;
      for (const [label, value] of rows) {
        if (!value) continue;
        doc.fillColor(MUTED).fontSize(8.5).font('Helvetica').text(label, x, cursor, {
          width: columnWidth,
        });
        doc
          .fillColor(INK)
          .fontSize(10)
          .font('Helvetica-Bold')
          .text(value, x, cursor + 10, { width: columnWidth });
        cursor += 27;
      }
      return cursor;
    };

    const payerBottom = party(left, 'Paid by', [
      ['Homecell', `${model.payer.homecellName} (${model.payer.homecellCode})`],
      ['Area / Zone', `${model.payer.areaName} · ${model.payer.zoneName}`],
      ['Coordinator', model.payer.coordinator],
    ]);
    const payeeBottom = party(left + columnWidth + 24, 'Paid to', [
      ['Account', model.payee.accountName],
      ['Bank', model.payee.bankName],
      ['Account number', model.payee.accountNumber],
    ]);

    y = Math.max(payerBottom, payeeBottom) + 8;

    // --- Line items ---------------------------------------------------------
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 14;

    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font('Helvetica-Bold')
      .text('DESCRIPTION', left, y, { width: width - 130 })
      .text('AMOUNT', left, y, { width, align: 'right' });
    y += 16;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 10;

    for (const line of model.lines) {
      // Start a new page before the row rather than half-way through it.
      if (y > doc.page.height - 210) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.fillColor(INK).fontSize(10).font('Helvetica').text(line.label, left, y, {
        width: width - 130,
      });
      doc
        .fillColor(INK)
        .fontSize(10)
        .font('Helvetica-Bold')
        .text(formatMoney(line.amountMinor, model.currency), left, y, {
          width,
          align: 'right',
        });
      if (line.detail) {
        doc
          .fillColor(MUTED)
          .fontSize(8.5)
          .font('Helvetica')
          .text(line.detail, left, y + 13, { width: width - 130 });
        y += 13;
      }
      y += 20;
    }

    // --- Total --------------------------------------------------------------
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 12;

    doc.roundedRect(left, y, width, 42, 4).fill('#F3F4F6');
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('TOTAL PAID', left + 14, y + 9);
    doc
      .fillColor(BRAND)
      .fontSize(17)
      .font('Helvetica-Bold')
      .text(formatMoney(model.totalMinor, model.currency), left - 14, y + 11, {
        width,
        align: 'right',
      });
    y += 50;

    doc
      .fillColor(MUTED)
      .fontSize(8.5)
      .font('Helvetica-Oblique')
      .text(`Amount in words: ${amountToWords(model.totalMinor, model.currency)}`, left, y, {
        width,
      });
    y += 24;

    // --- Payment details ----------------------------------------------------
    const detail = (label: string, value: string | null | undefined) => {
      if (!value) return;
      doc.fillColor(MUTED).fontSize(8.5).font('Helvetica').text(label, left, y, { width: 150 });
      doc
        .fillColor(INK)
        .fontSize(9)
        .font('Helvetica')
        .text(value, left + 150, y, { width: width - 150 });
      y += 15;
    };

    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font('Helvetica-Bold')
      .text('PAYMENT DETAILS', left, y, { characterSpacing: 0.6 });
    y += 15;
    detail('Method', model.method);
    detail('Provider reference', model.providerReference);
    detail('Transaction reference', model.paymentReference);
    detail('Status', model.status);
    if (model.note) detail('Note', model.note);

    // --- Footer -------------------------------------------------------------
    const footerY = doc.page.height - doc.page.margins.bottom - 40;
    doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(LINE).stroke();
    doc
      .fillColor(MUTED)
      .fontSize(7.5)
      .font('Helvetica')
      .text(
        'This is a computer-generated receipt and is valid without a signature. ' +
          `Verify it against receipt number ${model.reference} in the Homecell Management System.`,
        left,
        footerY + 10,
        { width, align: 'center' },
      );
    doc.text(
      `${model.churchName} · Generated ${dayjs(model.issuedAt).format('D MMM YYYY, HH:mm')}`,
      left,
      footerY + 24,
      { width, align: 'center' },
    );

    doc.end();
  });
}

/** Convenience wrapper used by the controllers. */
export async function remittanceReceiptPdf(actor: AuthenticatedUser, id: string) {
  const model = await buildRemittanceReceipt(actor, id);
  return { model, buffer: await renderReceiptPdf(model), filename: receiptFilename(model) };
}

export async function duesReceiptPdf(actor: AuthenticatedUser, reference: string) {
  const model = await buildDuesReceipt(actor, reference);
  return { model, buffer: await renderReceiptPdf(model), filename: receiptFilename(model) };
}

/** Receipt for any settled online payment, whatever it was for. */
export async function paymentReceiptPdf(actor: AuthenticatedUser, reference: string) {
  const model = await buildPaymentReceipt(actor, reference);
  return { model, buffer: await renderReceiptPdf(model), filename: receiptFilename(model) };
}

/** Used by the UI to decide whether to offer the download at all. */
export function receiptUrlFor(kind: 'REMITTANCE' | 'DUES', key: string): string {
  return kind === 'DUES' ? `/dues/payments/${key}/receipt` : `/remittances/${idString(key)}/receipt`;
}
