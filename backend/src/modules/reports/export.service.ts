import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { formatMoney } from '../../utils/money';
import type { ReportColumn, ReportResult } from './report.service';

function displayValue(
  value: unknown,
  column: ReportColumn,
  currency: string,
  forPlainText = false,
): string {
  if (value === null || value === undefined || value === '') return '';
  if (column.type === 'money') {
    return forPlainText
      ? Number(value).toFixed(2)
      : formatMoney(Math.round(Number(value) * 100), currency);
  }
  if (column.type === 'percent') return `${value}%`;
  return String(value);
}

/**
 * CSV export.
 *
 * Values are quoted and any leading `=`, `+`, `-` or `@` is prefixed with an
 * apostrophe so a member's name or description can never be interpreted as a formula
 * when the file is opened in a spreadsheet.
 */
export function toCsv(report: ReportResult, currency = 'NGN'): string {
  const escape = (raw: string): string => {
    const value = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${value.replace(/"/g, '""')}"`;
  };

  const header = report.columns.map((c) => escape(c.label)).join(',');
  const body = report.rows
    .map((row) =>
      report.columns
        .map((column) => escape(displayValue(row[column.key], column, currency, true)))
        .join(','),
    )
    .join('\n');

  return `${header}\n${body}`;
}

export async function toExcel(report: ReportResult, currency = 'NGN'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Church Homecell Management System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(report.title.slice(0, 31));

  sheet.mergeCells(1, 1, 1, Math.max(report.columns.length, 1));
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = report.title;
  titleCell.font = { size: 14, bold: true };

  sheet.mergeCells(2, 1, 2, Math.max(report.columns.length, 1));
  sheet.getCell(2, 1).value = `Generated ${new Date(report.generatedAt).toLocaleString('en-NG')}`;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF6B7280' } };

  const headerRow = sheet.getRow(4);
  report.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { vertical: 'middle' };
  });
  headerRow.commit();

  report.rows.forEach((row, rowIndex) => {
    const sheetRow = sheet.getRow(rowIndex + 5);
    report.columns.forEach((column, columnIndex) => {
      const cell = sheetRow.getCell(columnIndex + 1);
      const raw = row[column.key];
      if (column.type === 'money' || column.type === 'number') {
        cell.value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
        if (column.type === 'money') cell.numFmt = '#,##0.00';
      } else if (column.type === 'percent') {
        cell.value = raw === null || raw === undefined ? null : Number(raw) / 100;
        cell.numFmt = '0.0%';
      } else {
        cell.value = raw === null || raw === undefined ? '' : String(raw);
      }
    });
    sheetRow.commit();
  });

  // Size columns to their content, within sensible bounds.
  report.columns.forEach((column, index) => {
    const widest = report.rows.reduce(
      (max, row) => Math.max(max, String(row[column.key] ?? '').length),
      column.label.length,
    );
    sheet.getColumn(index + 1).width = Math.min(Math.max(widest + 2, 12), 42);
  });

  if (report.summary) {
    const summaryRow = sheet.rowCount + 2;
    sheet.getCell(summaryRow, 1).value = 'Summary';
    sheet.getCell(summaryRow, 1).font = { bold: true };
    Object.entries(report.summary).forEach(([key, value], index) => {
      sheet.getCell(summaryRow + index + 1, 1).value = key;
      sheet.getCell(summaryRow + index + 1, 2).value = value as never;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** PDF export laid out as a simple paginated table. */
export function toPdf(report: ReportResult, currency = 'NGN'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columnWidth = pageWidth / report.columns.length;

    doc.fontSize(16).fillColor('#111827').text(report.title, { align: 'left' });
    doc
      .fontSize(9)
      .fillColor('#6B7280')
      .text(`Generated ${new Date(report.generatedAt).toLocaleString('en-NG')}`);
    doc.moveDown(0.8);

    const drawHeader = () => {
      const y = doc.y;
      doc.rect(doc.page.margins.left, y - 2, pageWidth, 18).fill('#1F2937');
      doc.fillColor('#FFFFFF').fontSize(8);
      report.columns.forEach((column, index) => {
        doc.text(column.label, doc.page.margins.left + index * columnWidth + 4, y + 3, {
          width: columnWidth - 8,
          ellipsis: true,
        });
      });
      doc.moveDown(1.2);
      doc.fillColor('#111827');
    };

    drawHeader();

    doc.fontSize(8);
    report.rows.forEach((row, rowIndex) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage();
        drawHeader();
        doc.fontSize(8);
      }
      const y = doc.y;
      if (rowIndex % 2 === 1) {
        doc.rect(doc.page.margins.left, y - 2, pageWidth, 14).fill('#F9FAFB');
        doc.fillColor('#111827');
      }
      report.columns.forEach((column, index) => {
        doc.text(
          displayValue(row[column.key], column, currency),
          doc.page.margins.left + index * columnWidth + 4,
          y,
          { width: columnWidth - 8, ellipsis: true, lineBreak: false },
        );
      });
      doc.moveDown(0.9);
    });

    if (report.summary) {
      doc.moveDown(1);
      doc.fontSize(10).fillColor('#111827').text('Summary', { underline: true });
      doc.fontSize(8).fillColor('#374151');
      Object.entries(report.summary).forEach(([key, value]) => {
        doc.text(`${key}: ${String(value)}`);
      });
    }

    doc.end();
  });
}

export const EXPORT_CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

export type ExportFormat = keyof typeof EXPORT_CONTENT_TYPES;

export function exportFilename(report: ReportResult, format: ExportFormat): string {
  const slug = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${new Date().toISOString().slice(0, 10)}.${format}`;
}
