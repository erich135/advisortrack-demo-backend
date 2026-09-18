import PDFDocument from 'pdfkit';
import { env } from '../config/env';
import { centsToRand } from '../features/invoiceMoney';
import { sellerChargesVat } from '../features/advisortrackVat';
import { presentationStatus, toDateOnly } from '../features/invoiceLifecycle';
import type { InvoiceLineRow, InvoiceRow } from '../repositories/invoice.repository';

const BRAND_BLUE = '#0E51E4';
const NAVY = '#020921';
const MUTED = '#5B6170';
const RULE = '#E6E8EE';

const formatZar = (cents: number): string => {
  const [whole, fraction = '00'] = centsToRand(cents).split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '-' : ''}R${grouped}.${fraction}`;
};

const formatDisplayDate = (value: Date | string): string => {
  const iso = toDateOnly(value);
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const statusLabel = (invoice: InvoiceRow): string => {
  const shown = presentationStatus(invoice.status, invoice.due_date);
  return shown.charAt(0).toUpperCase() + shown.slice(1);
};

/**
 * Snapshot-only AdvisorTrack invoice PDF. Does not read live customer records.
 */
export const renderInvoicePdf = (
  invoice: InvoiceRow,
  lines: InvoiceLineRow[]
): Promise<{ buffer: Buffer; filename: string }> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      compress: false,
      info: {
        Title: invoice.invoice_number,
        Author: 'AdvisorTrack',
        Subject: invoice.snapshot_registered_name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () =>
      resolve({
        buffer: Buffer.concat(chunks),
        filename: `${invoice.invoice_number}.pdf`,
      })
    );
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const left = 48;
    const right = pageWidth - 48;

    doc.rect(0, 0, pageWidth, 8).fill(BRAND_BLUE);

    doc.fillColor(BRAND_BLUE).font('Helvetica-Bold').fontSize(18).text('AdvisorTrack', left, 28, {
      continued: false,
    });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(env.mailFromEmail, left, 50);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(sellerChargesVat() ? 'TAX INVOICE' : 'INVOICE', left, 28, {
      width: right - left,
      align: 'right',
    });
    doc.fillColor(BRAND_BLUE).font('Helvetica-Bold').fontSize(12).text(invoice.invoice_number, left, 50, {
      width: right - left,
      align: 'right',
    });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(statusLabel(invoice), left, 66, {
      width: right - left,
      align: 'right',
    });

    doc.moveTo(left, 88).lineTo(right, 88).lineWidth(2).strokeColor(BRAND_BLUE).stroke();

    const billToY = 108;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('BILL TO', left, billToY);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(invoice.snapshot_registered_name, left, billToY + 14, {
      width: 280,
    });
    let partyY = billToY + 30;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    const partyLines = [
      invoice.snapshot_trading_name && invoice.snapshot_trading_name !== invoice.snapshot_registered_name
        ? `Trading as ${invoice.snapshot_trading_name}`
        : null,
      invoice.snapshot_registration_number ? `Reg ${invoice.snapshot_registration_number}` : null,
      sellerChargesVat() && invoice.snapshot_vat_number ? `VAT ${invoice.snapshot_vat_number}` : null,
      invoice.snapshot_billing_contact_name,
      invoice.snapshot_billing_email,
      invoice.snapshot_telephone,
      invoice.snapshot_address,
      [invoice.snapshot_city, invoice.snapshot_province, invoice.snapshot_postal_code].filter(Boolean).join(', ') ||
        null,
      invoice.snapshot_country,
    ].filter((line): line is string => Boolean(line && String(line).trim()));
    for (const line of partyLines) {
      doc.text(line, left, partyY, { width: 280 });
      partyY += 12;
    }

    const metaX = 340;
    const meta = [
      ['Invoice date', formatDisplayDate(invoice.invoice_date)],
      ['Due date', formatDisplayDate(invoice.due_date)],
      ['PO / reference', invoice.po_reference || '—'],
      ['Currency', invoice.currency],
    ];
    if (invoice.snapshot_plan_name) {
      meta.push(['Plan', invoice.snapshot_plan_name]);
    }
    if (invoice.payment_date) {
      meta.push(['Payment date', formatDisplayDate(invoice.payment_date)]);
    }
    let metaY = billToY;
    for (const [label, value] of meta) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label.toUpperCase(), metaX, metaY, { width: 90 });
      doc.fillColor(NAVY).font('Helvetica').fontSize(9).text(value, metaX + 90, metaY, { width: 120, align: 'right' });
      metaY += 16;
    }

    const showVat = sellerChargesVat();
    const tableTop = Math.max(partyY, metaY) + 24;
    const cols = {
      description: left,
      qty: 320,
      unit: 370,
      discount: 430,
      vat: 490,
      amount: right,
    };

    doc.moveTo(left, tableTop).lineTo(right, tableTop).lineWidth(1).strokeColor(RULE).stroke();
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPTION', cols.description, tableTop + 8, { width: 250 });
    doc.text('QTY', cols.qty, tableTop + 8, { width: 44, align: 'right' });
    doc.text('UNIT', cols.unit, tableTop + 8, { width: 54, align: 'right' });
    doc.text('DISC.', cols.discount, tableTop + 8, { width: 54, align: 'right' });
    if (showVat) {
      doc.text('VAT', cols.vat, tableTop + 8, { width: 48, align: 'right' });
    }
    doc.text('AMOUNT', cols.amount - 70, tableTop + 8, { width: 70, align: 'right' });
    doc.moveTo(left, tableTop + 24).lineTo(right, tableTop + 24).strokeColor(NAVY).lineWidth(1).stroke();

    let rowY = tableTop + 32;
    doc.font('Helvetica').fontSize(9).fillColor(NAVY);
    for (const line of lines) {
      const qty = String(line.quantity);
      const vatRate = `${Number(line.vat_rate_percent).toFixed(2)}%`;
      doc.text(line.description, cols.description, rowY, { width: 250 });
      const rowHeight = Math.max(16, doc.heightOfString(line.description, { width: 250 }));
      doc.text(qty, cols.qty, rowY, { width: 44, align: 'right' });
      doc.text(formatZar(Number(line.unit_price_cents)), cols.unit, rowY, { width: 54, align: 'right' });
      doc.text(formatZar(Number(line.discount_cents)), cols.discount, rowY, { width: 54, align: 'right' });
      if (showVat) {
        doc.text(vatRate, cols.vat, rowY, { width: 48, align: 'right' });
      }
      doc.text(formatZar(Number(line.line_total_cents)), cols.amount - 70, rowY, { width: 70, align: 'right' });
      rowY += rowHeight + 10;
      if (rowY > 700) {
        doc.addPage();
        rowY = 48;
      }
    }

    doc.moveTo(left, rowY).lineTo(right, rowY).strokeColor(RULE).lineWidth(1).stroke();
    const totalsX = 360;
    let totalsY = rowY + 16;
    const totals = showVat
      ? [
          ['Subtotal', formatZar(Number(invoice.subtotal_cents))],
          ['VAT', formatZar(Number(invoice.vat_cents))],
          ['Total', formatZar(Number(invoice.total_cents))],
        ]
      : [
          ['Amount', formatZar(Number(invoice.subtotal_cents))],
          ['Total Due', formatZar(Number(invoice.total_cents))],
        ];
    for (const [label, value] of totals) {
      const grand = label === 'Total' || label === 'Total Due';
      doc.font(grand ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(grand ? 12 : 9)
        .fillColor(NAVY)
        .text(label, totalsX, totalsY, { width: 80 });
      doc.text(value, totalsX + 80, totalsY, { width: 114, align: 'right' });
      totalsY += grand ? 20 : 16;
    }

    const notes = [invoice.payment_terms, invoice.notes].filter((value) => value && value.trim());
    if (notes.length > 0) {
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('NOTES / PAYMENT TERMS', left, totalsY + 12);
      doc.fillColor(NAVY).font('Helvetica').fontSize(9).text(notes.join('\n\n'), left, totalsY + 26, { width: 300 });
    }

    doc.fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(
        `Thank you for partnering with AdvisorTrack. Payment due by ${formatDisplayDate(invoice.due_date)}.`,
        left,
        780,
        { width: right - left, align: 'center' }
      );

    doc.end();
  });
