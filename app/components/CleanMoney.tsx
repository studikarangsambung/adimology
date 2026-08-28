'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Clean Money — validasi arus uang per broker
 * =============================================
 * Menampilkan uang masuk, uang keluar, selisih (clean money),
 * dan unrealized P&L per broker.
 *
 * Pakai:
 *   <CleanMoney emiten="BBRI" />
 */

interface BrokerRow {
  broker: string;
  uangMasuk: number;
  uangKeluar: number;
  cleanMoney: number;
  netLot: number;
  avgBeli: number;
  avgJual: number;
  hargaSekarang: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  status: string;
}

interface ApiResponse {
  emiten?: string;
  hargaSekarang?: number;
  ringkasan?: {
    totalUangMasuk: number;
    totalUangKeluar: number;
    netCleanMoney: number;
  };
  brokers?: BrokerRow[];
  error?: string;
}

const PERIODS = [
  { label: '1D', days: 1 },
  { label: '7D', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
] as const;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtRp(n: number): string {
  const abs = Math.abs(n);
  const sign = n >= 0 ? '+' : '-';
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `${sign}Rp ${(abs / 1_000).toFixed(1)}rb`;
  return `${sign}Rp ${abs}`;
}

function fmtLot(n: number): string {
  const abs = Math.abs(n);
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs}`;
}

function fmtPrice(n: number): string {
  return n > 0 ? `Rp ${n.toLocaleString('id-ID')}` : '–';
}

const MAX_ROWS = 15;

export default function CleanMoney({ emiten }: { emiten: string }) {
  const [periodIdx, setPeriodIdx] = useState(1);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!emiten || emiten.length < 4) return;
    setLoading(true);
    setError('');
    try {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - PERIODS[periodIdx].days);
      const res = await fetch(
        `/api/clean-money?emiten=${encodeURIComponent(emiten)}&from=${isoDate(from)}&to=${isoDate(to)}`
      );
      const json: ApiResponse = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [emiten, periodIdx]);

  useEffect(() => { load(); }, [load]);

  if (!emiten || emiten.length < 4) return null;

  const brokers = data?.brokers?.slice(0, MAX_ROWS) ?? [];
  const ring = data?.ringkasan;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
      {/* Header */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-200">
            Clean Money {emiten}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Uang masuk − uang keluar per broker, pasar reguler
          </p>
        </div>
        <div role="group" className="flex rounded-lg border border-white/10 p-0.5">
          {PERIODS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPeriodIdx(i)}
              aria-pressed={i === periodIdx}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                i === periodIdx
                  ? 'bg-violet-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {/* Ringkasan */}
      {!loading && ring && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <SummaryBox
            label="Uang Masuk"
            value={fmtRp(ring.totalUangMasuk)}
            color="text-emerald-400"
          />
          <SummaryBox
            label="Uang Keluar"
            value={fmtRp(Math.abs(ring.totalUangKeluar))}
            color="text-rose-400"
          />
          <SummaryBox
            label="Net Clean Money"
            value={fmtRp(ring.netCleanMoney)}
            color={ring.netCleanMoney >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-white/5" />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
          <p className="text-sm text-rose-300">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-md border border-white/15 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/5"
          >
            Muat ulang
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && brokers.length === 0 && (
        <p className="py-6 text-center text-sm text-gray-500">
          Tidak ada data broker pada periode ini.
        </p>
      )}

      {/* Tabel */}
      {!loading && !error && brokers.length > 0 && (
        <>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2 text-left font-medium">Broker</th>
                  <th className="px-3 py-2 text-right font-medium">Uang Masuk</th>
                  <th className="px-3 py-2 text-right font-medium">Uang Keluar</th>
                  <th className="px-3 py-2 text-right font-medium">Clean Money</th>
                  <th className="px-3 py-2 text-right font-medium">Net Lot</th>
                  <th className="px-3 py-2 text-right font-medium">Avg Beli</th>
                  <th className="px-3 py-2 text-right font-medium">Floating</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {brokers.map((b) => (
                  <tr
                    key={b.broker}
                    className="border-b border-white/5 last:border-0"
                  >
                    <td className="px-3 py-2.5 font-medium text-gray-200">
                      {b.broker}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-400/70">
                      {fmtRp(b.uangMasuk)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-rose-400/70">
                      {fmtRp(b.uangKeluar)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        b.cleanMoney > 0
                          ? 'text-emerald-400'
                          : b.cleanMoney < 0
                            ? 'text-rose-400'
                            : 'text-gray-500'
                      }`}
                    >
                      {fmtRp(b.cleanMoney)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${
                        b.netLot > 0
                          ? 'text-emerald-400'
                          : b.netLot < 0
                            ? 'text-rose-400'
                            : 'text-gray-500'
                      }`}
                    >
                      {fmtLot(b.netLot)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                      {fmtPrice(b.avgBeli)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {b.unrealizedPct !== 0 ? (
                        <span
                          className={
                            b.unrealizedPct > 0 ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {b.unrealizedPct > 0 ? '+' : ''}
                          {b.unrealizedPct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-gray-600">–</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="mt-4 space-y-1 border-t border-white/5 pt-3 text-[11px] leading-relaxed text-gray-500">
            <p>
              Clean Money = total beli − total jual. Positif berarti lebih banyak uang masuk ke saham.
            </p>
            <p>
              Floating dihitung dari harga rata-rata beli/jual terhadap harga terakhir ({fmtPrice(data?.hargaSekarang ?? 0)}).
              Ini perkiraan — posisi sebenarnya hanya diketahui oleh broker yang bersangkutan.
            </p>
          </footer>
        </>
      )}
    </section>
  );
}

// ─── Sub-komponen ──────────────────────────────────────────────────────

function SummaryBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  let bg = 'bg-gray-500/10 text-gray-400';
  if (status.includes('AKUMULASI') && status.includes('PROFIT'))
    bg = 'bg-emerald-500/10 text-emerald-400';
  else if (status.includes('AKUMULASI') && status.includes('RUGI'))
    bg = 'bg-amber-500/10 text-amber-400';
  else if (status.includes('AKUMULASI'))
    bg = 'bg-emerald-500/10 text-emerald-300';
  else if (status.includes('DISTRIBUSI') && status.includes('PROFIT'))
    bg = 'bg-violet-500/10 text-violet-400';
  else if (status.includes('DISTRIBUSI'))
    bg = 'bg-rose-500/10 text-rose-400';

  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${bg}`}>
      {status}
    </span>
  );
}
