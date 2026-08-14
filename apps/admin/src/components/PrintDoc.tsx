import { useEffect, type ReactNode } from 'react';
import { TH, fmtDate } from '@cida/shared';

// Everything inside #report-print is what the printer sees; the rest of the app
// is hidden by the visibility isolation in index.css.

/**
 * Print document shell. `orientation` drives the @page rule via a data attribute
 * on <html>, mirroring how the POS app switches receipt widths on `print_size`.
 */
export function PrintDoc({
  orientation = 'portrait',
  children,
}: {
  orientation?: 'portrait' | 'landscape';
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.setAttribute('data-print-orientation', orientation);
    return () => document.documentElement.removeAttribute('data-print-orientation');
  }, [orientation]);

  return (
    <div id="report-print" className="gov-doc">
      {children}
    </div>
  );
}

/**
 * Formal header for a document that will be stapled behind a บันทึกข้อความ and
 * forwarded to the Commander. Centred agency block, report title, period in
 * Buddhist era, and a reference line the registry can quote.
 */
export function GovDocHeader({
  settings,
  title,
  subtitle,
  periodText,
}: {
  settings: Record<string, string>;
  title: string;
  subtitle?: string;
  periodText: string;
}) {
  const logo = settings.logo_url || '/icon-192.svg';
  const printedAt = fmtDate(new Date().toISOString());

  return (
    <header className="gov-header avoid-break">
      <div className="border-t-[3px] border-emerald-600 mb-3" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {logo && (
            <div className="flex-none border border-slate-300 rounded-xl p-1.5 bg-white shadow-sm">
              <img src={logo} alt="" className="h-14 w-14 object-contain" />
            </div>
          )}
          <div className="min-w-0 text-left">
            <div className="font-bold text-[15pt] leading-tight text-slate-900">{settings.org_name || 'ทัณฑสถานบำบัดพิเศษกลาง'}</div>
            {settings.org_subtitle && <div className="text-[10.5pt] text-slate-700 mt-0.5">{settings.org_subtitle}</div>}
            {settings.org_address && <div className="text-[9pt] text-slate-600 mt-0.5">{settings.org_address}</div>}
          </div>
        </div>
        <div className="text-right text-[9pt] text-slate-600 flex-none tabular-nums leading-relaxed">
          {settings.tax_id && (
            <div>
              {TH.taxId} {settings.tax_id}
            </div>
          )}
          <div>
            {TH.terminalId} {settings.terminal_id || 'POS-01'}
          </div>
          <div>
            {TH.printedAt} {printedAt}
          </div>
        </div>
      </div>

      <div className="text-center border-y-2 border-slate-900 bg-slate-50 py-2.5 my-3">
        <h2 className="font-bold text-[16pt] leading-snug tracking-wide">{title}</h2>
        {subtitle && <div className="text-[11pt] mt-0.5 text-slate-800">{subtitle}</div>}
        <div className="text-[11pt] mt-1 text-slate-700">
          {TH.reportPeriod} {periodText}
        </div>
      </div>
    </header>
  );
}

/** Numbered section, matching the numbered-clause convention of Thai official documents. */
export function GovSection({
  no,
  title,
  breakBefore,
  children,
}: {
  no: number;
  title: string;
  breakBefore?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`gov-section ${breakBefore ? 'page-break' : ''}`}>
      <h3 className="font-bold text-[12.5pt] mb-1.5 flex items-center gap-2">
        <span className="gov-section-no">{no}</span>
        <span>{title}</span>
      </h3>
      {children}
    </section>
  );
}

/**
 * Approval chain. Print-only — on screen these blank rules are noise.
 * The right-hand column is the Commander, who signs last.
 */
export function SignatureBlock() {
  const roles = [
    { name: TH.preparedBy, note: 'เจ้าหน้าที่ผู้จัดทำรายงาน' },
    { name: TH.checkedBy, note: 'หัวหน้าฝ่ายฝึกวิชาชีพผู้ต้องขัง' },
    { name: TH.approvedBy, note: TH.commander },
  ];
  return (
    <div className="print-only avoid-break gov-signatures">
      <div className="grid grid-cols-3 gap-6 pt-12">
        {roles.map((r) => (
          <div key={r.name} className="text-center">
            <div className="border-b border-dotted border-slate-800 h-8" />
            <div className="text-[10pt] mt-1">(............................................)</div>
            <div className="text-[10pt] font-semibold mt-1.5">{r.name}</div>
            <div className="text-[9pt] text-slate-600">{r.note}</div>
            <div className="text-[9pt] mt-2">วันที่ ......... / ......... / .........</div>
          </div>
        ))}
      </div>
    </div>
  );
}
