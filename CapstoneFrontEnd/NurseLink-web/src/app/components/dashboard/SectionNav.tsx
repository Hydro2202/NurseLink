export interface DashboardSection {
  key: string;
  label: string;
}

interface SectionNavProps {
  sections: DashboardSection[];
  activeKey: string;
  onSelect: (key: string) => void;
}

/**
 * "Alerts · Overview · Workload · Analytics" — jumps to that section of the
 * long head nurse dashboard instead of making it all scroll-and-hunt.
 * Sticky at the top on desktop; a horizontal-scroll chip row on phone
 * width (the sticky positioning still applies there too, it just has less
 * room, so it also scrolls horizontally).
 */
export function SectionNav({ sections, activeKey, onSelect }: SectionNavProps) {
  return (
    <div className="sticky top-0 z-20 bg-card border-b border-border shadow-sm">
      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto">
        {sections.map((section) => {
          const active = section.key === activeKey;
          return (
            <button
              key={section.key}
              type="button"
              onClick={() => onSelect(section.key)}
              aria-current={active ? 'true' : undefined}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-foreground border-border hover:bg-gray-50'
              }`}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
