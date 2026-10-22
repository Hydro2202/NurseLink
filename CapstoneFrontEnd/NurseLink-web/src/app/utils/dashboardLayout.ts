/**
 * Shared spacing tokens for the Nurse and Head Nurse dashboard shells
 * (DashboardPage.tsx's two role-branched layouts) — one place to edit
 * instead of two independently-drifted sets of hardcoded padding/gap
 * values. Tailwind's own scale (1 unit = 4px) already maps cleanly onto
 * the design spec's px targets, so these are just named, reusable
 * combinations of Tailwind's existing utilities, not a parallel token
 * system: px-6/py-6 = 24px (desktop baseline), p-5 = 20px (card padding),
 * gap-4 = 16px (card-grid gap), gap-6 = 24px (section gap), mobile uses a
 * smaller 16px baseline (`px-4`) that scales up to 24px at `sm:`.
 */

/** The page header band (title + context line). */
export const DASHBOARD_HEADER_CLASS = 'bg-card border-b border-border px-4 py-4 sm:px-6 sm:py-6';

/** Caps the header/content width and centers it — same max-w-7xl both
 * dashboards already converged on independently. */
export const DASHBOARD_CONTAINER_CLASS = 'max-w-7xl mx-auto';

/** The scrollable content area below the header: 24px gap between major
 * sections (Alerts, KPI grid, Quick Actions, chart grids, etc.) on
 * desktop, 16px on mobile, with matching horizontal padding. */
export const DASHBOARD_CONTENT_CLASS = 'max-w-7xl mx-auto px-4 py-4 space-y-4 sm:px-6 sm:py-6 sm:space-y-6';

/** Gap between cards inside a KPI/stat grid — 16px. */
export const DASHBOARD_CARD_GRID_GAP = 'gap-4';

/** Gap between larger peer cards (e.g. side-by-side chart cards) — 24px,
 * the same as the section gap, since a 2-up chart row reads as one
 * section split in half rather than a dense card grid. */
export const DASHBOARD_CHART_GRID_GAP = 'gap-6';

/** Internal padding for a compact KPI tile — deliberately lighter than a
 * standard content card: a KPI tile's content (icon + label + value) is
 * much shorter, and the spec itself warns against "excessive empty space
 * inside smaller KPI cards". A standard content card (Task Timeline, High-
 * Risk Patients, etc.) is NOT given its own token here — shadcn's Card/
 * CardContent already applies a consistent 24px (px-6) by default
 * throughout this app whenever no className override is passed, which is
 * the more consistent "existing design token" to keep reusing rather than
 * introducing a second, competing card-padding value. */
export const DASHBOARD_KPI_CARD_PADDING = 'p-4';
