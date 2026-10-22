import type { ChartingNote } from '../types/domain';
import type { FDARNoteView, StructuredNursingNoteView } from './chartingStructured';
import { resolveNoteForDisplay } from './chartingStructured';

/**
 * Prints one nursing documentation record as a dedicated, standalone
 * document — not a screenshot of the "Complete Nursing Documentation"
 * modal. Building a full print-only HTML document in a hidden iframe (the
 * same technique Expo's utils/print.ts already uses for admin reports)
 * sidesteps the real risk a plain `window.print()` on the live page would
 * have here: the modal's note body is `overflow-y-auto` with a capped
 * height, so printing the page as-is would silently clip to whatever is
 * currently scrolled into view instead of the complete note.
 */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Preserves the note's own line breaks without risking injected markup. */
function escMultiline(value: unknown): string {
  return esc(value).replace(/\n/g, '<br>');
}

const PRINT_CSS = `
  @page { size: A4 portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111827; font-size: 12px; margin: 0; background: #fff; }
  .brand { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 10px; }
  .brand-name { font-size: 18px; font-weight: 800; color: #1d4ed8; letter-spacing: 0.2px; }
  .brand-sub { font-size: 11px; color: #4b5563; }
  .meta { text-align: right; font-size: 10px; color: #4b5563; line-height: 1.5; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .badges { margin-bottom: 10px; }
  .badge { display: inline-block; font-size: 10px; font-weight: 700; border: 1px solid #d1d5db; border-radius: 999px; padding: 2px 8px; margin-right: 6px; color: #374151; }
  .badge-confirmed { border-color: #bbf7d0; background: #f0fdf4; color: #15803d; }
  .badge-ai { border-color: #bfdbfe; background: #eff6ff; color: #1d4ed8; }
  .section { page-break-inside: avoid; break-inside: avoid; margin-bottom: 10px; }
  .section-title { font-size: 11px; font-weight: 700; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.3px; margin: 0 0 4px; border-bottom: 1px solid #e5e7eb; padding-bottom: 2px; }
  table.fields { width: 100%; border-collapse: collapse; }
  table.fields th { width: 30%; background: #f9fafb; color: #374151; text-align: left; font-weight: 600; }
  table.fields th, table.fields td { border: 1px solid #d1d5db; padding: 5px 8px; vertical-align: top; }
  .vitals-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .vital-cell { border: 1px solid #d1d5db; border-radius: 4px; padding: 6px; text-align: center; }
  .vital-label { font-size: 9px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.3px; }
  .vital-value { font-size: 14px; font-weight: 700; color: #111827; margin-top: 2px; }
  .block-value { border: 1px solid #d1d5db; border-radius: 4px; padding: 8px; white-space: pre-wrap; overflow-wrap: break-word; line-height: 1.5; }
  .empty { color: #9ca3af; font-style: italic; }
  .footer { margin-top: 12px; font-size: 10px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 6px; }
`;

function fieldsTable(rows: [string, string][]): string {
  const present = rows.filter(([, value]) => value && value.trim());
  if (!present.length) return '';
  return `<table class="fields"><tbody>${present
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function vitalsGrid(vitals: StructuredNursingNoteView['vitalSigns']): string {
  // Each value already carries its own unit by the time it gets here —
  // normalizeVitalSigns/formatVitalValue (chartingStructured.ts) bakes
  // "bpm"/"mmHg"/"°C"/"%"/"breaths/min" into the string itself (or passes
  // through whatever unit the client preview path already attached), so
  // appending a unit here would double it up (e.g. "98% %").
  const cells: [string, string][] = [
    ['Heart Rate', vitals.heartRate],
    ['Blood Pressure', vitals.bloodPressure],
    ['Temperature', vitals.temperature],
    ['SpO₂', vitals.oxygenSaturation],
    ['Resp. Rate', vitals.respiratoryRate],
  ];
  const any = cells.some(([, value]) => value && value.trim());
  if (!any) return '<p class="empty">No vital signs were recorded with this note.</p>';
  return `<div class="vitals-grid">${cells
    .map(
      ([label, value]) =>
        `<div class="vital-cell"><div class="vital-label">${esc(label)}</div><div class="vital-value">${
          value && value.trim() ? esc(value) : '—'
        }</div></div>`
    )
    .join('')}</div>`;
}

function block(label: string, value: string): string {
  const trimmed = (value || '').trim();
  return `<div class="section"><div class="section-title">${esc(label)}</div><div class="block-value">${
    trimmed ? escMultiline(trimmed) : '<span class="empty">Not recorded.</span>'
  }</div></div>`;
}

function badges(note: ChartingNote): string {
  const items: string[] = [];
  if (note.noteFormat === 'legacy') items.push('<span class="badge">Legacy Note</span>');
  if (note.confirmed) items.push('<span class="badge badge-confirmed">Confirmed</span>');
  if (note.aiGenerated) items.push('<span class="badge badge-ai">AI-Assisted Documentation</span>');
  if (note.edited) items.push('<span class="badge">Manually Edited</span>');
  return items.length ? `<div class="badges">${items.join('')}</div>` : '';
}

export function buildNursingNoteHtml(note: ChartingNote): string {
  const resolved = resolveNoteForDisplay(note);
  const view = resolved.view;
  const printedAt = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  const patientInfo = fieldsTable([
    ['Patient Name', view.patientName],
    ['Patient ID', view.patientId],
    ['Room', view.room],
    ['Attending Physician', view.attendingPhysician],
    ['Documenting Nurse', view.nurseName],
    ['Recorded', `${view.date}${view.time ? ` · ${view.time}` : ''}`.trim()],
    ['Diagnosis', view.diagnosis],
    ['Risk Level', view.riskLevel],
  ]);

  const clinicalContext = fieldsTable([
    ['Allergies', view.allergies],
    ['Medications', view.medications],
    ['Alerts', view.alerts],
  ]);

  let noteSections = '';
  if (resolved.kind === 'fdar') {
    const fdar = view as FDARNoteView;
    noteSections =
      block('Focus', fdar.focus) +
      block('Data', fdar.data) +
      block('Action', fdar.action) +
      block('Response', fdar.response) +
      (fdar.plan.trim() ? block('Plan', fdar.plan) : '') +
      (fdar.clinicalSummary.trim() ? block('Clinical Summary', fdar.clinicalSummary) : '');
  } else {
    const legacy = view as StructuredNursingNoteView;
    noteSections =
      block('Assessment', legacy.assessment) +
      (legacy.interventions.length
        ? block('Interventions', legacy.interventions.join('\n'))
        : '') +
      (legacy.patientResponse.trim() ? block('Patient Response', legacy.patientResponse) : '') +
      (legacy.plan.trim() ? block('Plan', legacy.plan) : '') +
      (legacy.clinicalSummary.trim() ? block('Clinical Summary', legacy.clinicalSummary) : '');
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>Nursing Documentation Note — ${esc(
    view.patientName
  )}</title><style>${PRINT_CSS}</style></head><body>
    <div class="brand">
      <div><div class="brand-name">NurseLink</div><div class="brand-sub">Nursing Documentation Note</div></div>
      <div class="meta">Printed ${esc(printedAt)}</div>
    </div>
    <h1>Nursing Documentation Note</h1>
    ${badges(note)}
    <div class="section"><div class="section-title">Patient Information</div>${patientInfo || '<p class="empty">No patient information recorded.</p>'}</div>
    <div class="section"><div class="section-title">Vital Signs</div>${vitalsGrid(view.vitalSigns)}</div>
    ${clinicalContext ? `<div class="section"><div class="section-title">Clinical Context</div>${clinicalContext}</div>` : ''}
    ${noteSections}
    <div class="footer">Confidential patient record — for authorized hospital staff only.</div>
  </body></html>`;
}

/**
 * Opens the browser's native print dialog for `note` via a hidden iframe,
 * so the printed output is the dedicated document above, never the
 * surrounding NurseLink page or modal chrome. Throws instead of silently
 * "succeeding" if the browser won't let a print view open at all.
 */
export async function printNursingNote(note: ChartingNote): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Printing is not available in this environment.');
  }
  const html = buildNursingNoteHtml(note);

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
  doc.write(html);
  doc.close();

  const win = iframe.contentWindow;
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      setTimeout(() => iframe.remove(), 1000);
      resolve();
    };
    win.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(() => {
      win.focus();
      win.print();
      // Some browsers never fire afterprint (e.g. the user cancels via a
      // route that skips it) — don't leave the iframe behind forever.
      setTimeout(cleanup, 60000);
    }, 250);
  });
}
