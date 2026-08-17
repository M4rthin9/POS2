import type { AdminProduct } from '../lib/api';
import { PriceTag } from './PriceTag';
import { LStandSign } from './LStandSign';
import { perSheet, type TagLayout } from './tagLayouts';

/**
 * The printable root. `#tag-print` is what printNode() clones and what the
 * @media print rules reveal — same isolation contract as `#report-print`.
 *
 * Pages are chunked explicitly rather than left to grid fragmentation, so the
 * break lands between rows on every engine.
 */
export function PriceTagSheet({ tags, layout, logoUrl }: { tags: AdminProduct[]; layout: TagLayout; logoUrl?: string | null }) {
  const size = perSheet(layout);
  const pages: AdminProduct[][] = [];
  for (let i = 0; i < tags.length; i += size) pages.push(tags.slice(i, i + size));

  return (
    <div id="tag-print" className="tag-print">
      {pages.map((page, pi) => (
        <div
          key={pi}
          className={`tag-sheet ${layout.kind === 'lstand' ? 'tag-sheet--lstand' : ''}`}
          style={{
            ['--tag-w' as string]: `${layout.w}mm`,
            ['--tag-h' as string]: `${layout.h}mm`,
            ['--tag-cols' as string]: String(layout.cols),
          }}
        >
          {page.map((p, i) =>
            layout.kind === 'lstand' ? (
              <LStandSign key={`${p.id}-${i}`} product={p} layout={layout} logoUrl={logoUrl} />
            ) : (
              <PriceTag key={`${p.id}-${i}`} product={p} layout={layout} logoUrl={logoUrl} />
            ),
          )}
        </div>
      ))}
    </div>
  );
}
