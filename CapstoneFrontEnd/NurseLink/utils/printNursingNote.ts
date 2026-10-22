import type { ChartingNote } from '../types/domain';
import { buildNursingNoteHtml } from './nursingNoteHtml';
import { printHtml } from './print';

/**
 * Opens the browser's native print dialog for `note`. Throws instead of
 * silently "succeeding" if printing isn't available (native iOS/Android —
 * see canPrint() in utils/print.ts — or the iframe can't be created).
 */
export async function printNursingNote(note: ChartingNote): Promise<void> {
  await printHtml(buildNursingNoteHtml(note));
}
