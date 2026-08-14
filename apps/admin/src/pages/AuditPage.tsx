import { useCallback, useEffect, useState } from 'react';
import type { AuditLog } from '@cida/shared';
import { AUDIT_ACTION_LABELS, TH, fmtDate } from '@cida/shared';
import { api } from '../lib/api';
import { periodRange } from '../lib/period';
import PeriodPicker, { type PeriodState } from '../components/PeriodPicker';
import { Button, Card, EmptyRow, ErrorBar, Modal, Table } from '../components/ui';

const ENTITIES = ['sales', 'bank_import_batches', 'reconciliation_records', 'z_reports'];

function pretty(json: string | null): string {
  if (!json) return '—';
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export default function AuditPage() {
  const [range, setRange] = useState<PeriodState>({ period: '30d', from: '', to: '' });
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState<AuditLog[] | null>(null);
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { from, to } = periodRange(range.period, range.from, range.to);
    setRows(null);
    try {
      setRows(await api.audit({ from, to, entity: entity || undefined }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
      setRows([]);
    }
  }, [range, entity]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">🗒 {TH.auditLog}</h1>
          <p className="text-sm text-slate-500">บันทึกทุกการแก้ไขที่กระทบบัญชี ไม่สามารถลบหรือแก้ไขได้</p>
        </div>
        <PeriodPicker value={range} onChange={setRange}>
          <select value={entity} onChange={(e) => setEntity(e.target.value)} className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white">
            <option value="">— {TH.entity} —</option>
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <Button onClick={load}>↻ {TH.refresh}</Button>
        </PeriodPicker>
      </div>

      <ErrorBar message={error} onDismiss={() => setError('')} />

      <Card>
        <Table
          head={
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">{TH.date}</th>
              <th className="px-3 py-2 text-left font-medium">{TH.actor}</th>
              <th className="px-3 py-2 text-left font-medium">{TH.action}</th>
              <th className="px-3 py-2 text-left font-medium">{TH.entity}</th>
              <th className="px-3 py-2 text-left font-medium">{TH.reason}</th>
            </tr>
          }
        >
          {rows === null ? (
            <EmptyRow colSpan={6} label="…" />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={6} />
          ) : (
            rows.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(a)}>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-400">{a.id}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-xs">{fmtDate(a.created_at)}</td>
                <td className="px-3 py-1.5">{a.actor_name ?? '—'}</td>
                <td className="px-3 py-1.5 font-medium">{AUDIT_ACTION_LABELS[a.action] ?? a.action}</td>
                <td className="px-3 py-1.5 text-xs text-slate-500 font-mono">
                  {a.entity}
                  {a.entity_id ? ` #${a.entity_id}` : ''}
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-500 max-w-48 truncate">{a.reason ?? '—'}</td>
              </tr>
            ))
          )}
        </Table>
      </Card>

      {detail && (
        <Modal title={`${AUDIT_ACTION_LABELS[detail.action] ?? detail.action} · #${detail.id}`} onClose={() => setDetail(null)} wide>
          <dl className="text-xs space-y-1 mb-3">
            <div className="flex gap-2">
              <dt className="text-slate-400 w-24">{TH.date}</dt>
              <dd>{fmtDate(detail.created_at)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-slate-400 w-24">{TH.actor}</dt>
              <dd>{detail.actor_name ?? '—'} {detail.ip && <span className="text-slate-400 font-mono">· {detail.ip}</span>}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-slate-400 w-24">{TH.entity}</dt>
              <dd className="font-mono">{detail.entity}{detail.entity_id ? ` #${detail.entity_id}` : ''}</dd>
            </div>
            {detail.reason && (
              <div className="flex gap-2">
                <dt className="text-slate-400 w-24">{TH.reason}</dt>
                <dd className="text-rose-600">{detail.reason}</dd>
              </div>
            )}
          </dl>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">{TH.before}</div>
              <pre className="text-[10px] bg-slate-50 rounded-lg p-2 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">{pretty(detail.before_json)}</pre>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">{TH.after}</div>
              <pre className="text-[10px] bg-slate-50 rounded-lg p-2 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">{pretty(detail.after_json)}</pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
