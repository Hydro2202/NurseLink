import { Platform } from 'react-native';
import { logAdminPrint } from '../services/api';
import { formatDateTime12 } from './time';

/**
 * Admin printing. Builds a print-only document (report title, scope and
 * filters, a table or detail sheet) and sends it to the browser's print
 * dialog through a hidden iframe, so the app's sidebar, header, buttons and
 * dialogs never end up on paper. Every print is logged first as an
 * administrator "print requested" event (the browser can't confirm that a
 * page actually came out of the printer).
 */

export interface PrintColumn<T> {
  label: string;
  value: (row: T) => string;
  /** Relative width, e.g. '30%'. */
  width?: string;
}

export interface PrintField {
  label: string;
  value: string;
  multiline?: boolean;
}

export interface PrintReport<T = unknown> {
  title: string;
  subtitle?: string;
  /** "Filters: …" style lines describing what the report covers. */
  scope?: string[];
  columns?: PrintColumn<T>[];
  rows?: T[];
  /** A single record's details (detail print). */
  fields?: PrintField[];
  /** Who printed it, shown in the header. */
  printedBy?: string;
}

export interface PrintAudit {
  recordType: string;
  scope: 'list' | 'detail';
  recordId?: string;
  label?: string;
  filters?: Record<string, unknown>;
}

export function canPrint(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined';
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PRINT_CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111827; font-size: 11px; margin: 0; }
  .brand { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 10px; }
  .brand-name { font-size: 18px; font-weight: 800; color: #1d4ed8; letter-spacing: 0.2px; }
  .brand-sub { font-size: 10px; color: #4b5563; }
  .meta { text-align: right; font-size: 10px; color: #4b5563; line-height: 1.5; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .subtitle { color: #4b5563; margin: 0 0 8px; }
  .scope { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; padding: 6px 8px; margin-bottom: 10px; }
  .scope div { margin: 1px 0; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { background: #eff6ff; color: #1e3a8a; text-align: left; font-weight: 700; white-space: nowrap; }
  th, td { border: 1px solid #d1d5db; padding: 5px 6px; vertical-align: top; }
  td { white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; hyphens: none; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  .num { width: 36px; text-align: right; color: #6b7280; white-space: nowrap; }
  .fields { width: 100%; border-collapse: collapse; }
  .fields th { width: 32%; background: #f9fafb; color: #374151; }
  .block { page-break-inside: avoid; break-inside: avoid; margin-bottom: 8px; }
  .block-label { font-weight: 700; color: #374151; margin-bottom: 2px; }
  .block-value { border: 1px solid #d1d5db; border-radius: 4px; padding: 6px; white-space: pre-wrap; }
  .footer { margin-top: 10px; font-size: 10px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 6px; }
  .empty { padding: 16px; text-align: center; color: #6b7280; border: 1px dashed #d1d5db; }
`;

export function buildReportHtml<T>(report: PrintReport<T>): string {
  const printedAt = formatDateTime12(new Date());
  const scope = (report.scope || []).filter(Boolean);
  let body = '';
  if (report.fields) {
    const short = report.fields.filter((f) => !f.multiline);
    const long = report.fields.filter((f) => f.multiline);
    body += `<table class="fields"><tbody>${short
      .map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(f.value || '—')}</td></tr>`)
      .join('')}</tbody></table>`;
    if (long.length) {
      body += `<div style="margin-top:10px">${long
        .map((f) => `<div class="block"><div class="block-label">${esc(f.label)}</div><div class="block-value">${esc(f.value || '—')}</div></div>`)
        .join('')}</div>`;
    }
  }
  if (report.columns && report.rows) {
    if (report.rows.length === 0) {
      body += '<div class="empty">No records match this report.</div>';
    } else {
      const head = `<tr><th class="num">#</th>${report.columns
        .map((c) => `<th${c.width ? ` style="width:${esc(c.width)}"` : ''}>${esc(c.label)}</th>`)
        .join('')}</tr>`;
      const rows = report.rows
        .map(
          (row, i) =>
            `<tr><td class="num">${i + 1}</td>${report.columns!.map((c) => `<td>${esc(c.value(row) || '—')}</td>`).join('')}</tr>`
        )
        .join('');
      body += `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }
  }
  const count = report.rows ? `${report.rows.length} record${report.rows.length === 1 ? '' : 's'}` : '1 record';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)} — NurseLink</title><style>${PRINT_CSS}</style></head><body>
    <div class="brand">
      <div><div class="brand-name">NurseLink</div><div class="brand-sub">Admin Console · Hospital Records</div></div>
      <div class="meta">Printed ${esc(printedAt)}${report.printedBy ? `<br>by ${esc(report.printedBy)}` : ''}</div>
    </div>
    <h1>${esc(report.title)}</h1>
    ${report.subtitle ? `<p class="subtitle">${esc(report.subtitle)}</p>` : ''}
    ${scope.length ? `<div class="scope">${scope.map((line) => `<div>${esc(line)}</div>`).join('')}</div>` : ''}
    ${body}
    <div class="footer">${esc(count)} · Confidential: for authorized hospital staff only.</div>
  </body></html>`;
}

/**
 * Logs the print request, then opens the print dialog for `report`.
 * Throws if printing isn't available here or the request couldn't be logged.
 */
export async function printReport<T>(report: PrintReport<T>, audit: PrintAudit): Promise<void> {
  if (!canPrint()) {
    throw new Error('Printing is available in the NurseLink web app.');
  }
  await logAdminPrint({
    recordType: audit.recordType,
    title: report.title,
    count: report.rows ? report.rows.length : 1,
    scope: audit.scope,
    recordId: audit.recordId,
    label: audit.label,
    filters: audit.filters,
  });

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) {
    iframe.remove();
    throw new Error('Could not open the print view.');
  }
  doc.open();
  doc.write(buildReportHtml(report));
  doc.close();
  const win = iframe.contentWindow;
  const cleanup = () => setTimeout(() => iframe.remove(), 1000);
  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    // Some browsers never fire afterprint; don't leave the frame behind.
    setTimeout(() => iframe.remove(), 60000);
  }, 250);
}
