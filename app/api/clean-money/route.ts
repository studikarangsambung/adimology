import { NextRequest, NextResponse } from 'next/server';
import { fetchMarketDetector, fetchOrderbook } from '@/lib/stockbit';

/**
 * Clean Money — validasi arus uang per broker
 * =============================================
 * GET /api/clean-money?emiten=BBRI&from=2026-07-01&to=2026-08-28
 *
 * Menampilkan per broker:
 * - Uang masuk (total buy value)
 * - Uang keluar (total sell value)
 * - Clean money (selisihnya)
 * - Net lot (posisi bersih)
 * - Harga rata-rata beli
 * - Unrealized P&L (laba/rugi mengambang dari posisi yang masih dipegang)
 */

type Row = Record<string, unknown>;

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function pick(row: Row | undefined, keys: string[]): unknown {
  if (!row) return undefined;
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const F = {
  code:    ['netbs_broker_code', 'broker_code', 'code'],
  buyLot:  ['blot', 'netbs_buy_lot', 'buy_lot'],
  buyVal:  ['bval', 'netbs_buy_val', 'buy_val'],
  buyAvg:  ['netbs_buy_avg_price', 'bavg', 'buy_avg_price'],
  sellLot: ['slot', 'netbs_sell_lot', 'sell_lot'],
  sellVal: ['sval', 'netbs_sell_val', 'sell_val'],
  sellAvg: ['netbs_sell_avg_price', 'savg', 'sell_avg_price'],
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const emiten = (sp.get('emiten') || '').trim().toUpperCase();
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';

  if (emiten.length < 4 || !from || !to) {
    return NextResponse.json(
      { error: 'Kirim parameter: emiten (min 4 huruf), from, to (YYYY-MM-DD).' },
      { status: 400 }
    );
  }

  try {
    const raw = (await fetchMarketDetector(emiten, from, to)) as unknown as {
      data?: {
        broker_summary?: { brokers_buy?: Row[]; brokers_sell?: Row[] };
      };
    };

    const buys = raw?.data?.broker_summary?.brokers_buy ?? [];
    const sells = raw?.data?.broker_summary?.brokers_sell ?? [];

    // Ambil harga terakhir
    let currentPrice = 0;
    try {
      const ob = (await fetchOrderbook(emiten)) as unknown as {
        data?: { last?: number; close?: number; lastTradedPrice?: number };
      };
      currentPrice = ob?.data?.last ?? ob?.data?.close ?? ob?.data?.lastTradedPrice ?? 0;
    } catch { /* tidak fatal */ }

    // Gabung per broker
    interface Accum {
      code: string;
      buyLot: number;
      buyVal: number;
      buyAvg: number;
      sellLot: number;
      sellVal: number;
      sellAvg: number;
    }

    const map = new Map<string, Accum>();
    const blank = (code: string): Accum => ({
      code, buyLot: 0, buyVal: 0, buyAvg: 0, sellLot: 0, sellVal: 0, sellAvg: 0,
    });

    for (const r of buys) {
      const code = String(pick(r, F.code) ?? '').trim().toUpperCase();
      if (!code) continue;
      const row = map.get(code) ?? blank(code);
      row.buyLot += toNum(pick(r, F.buyLot));
      row.buyVal += toNum(pick(r, F.buyVal));
      row.buyAvg = toNum(pick(r, F.buyAvg)) || row.buyAvg;
      map.set(code, row);
    }

    for (const r of sells) {
      const code = String(pick(r, F.code) ?? '').trim().toUpperCase();
      if (!code) continue;
      const row = map.get(code) ?? blank(code);
      row.sellLot += toNum(pick(r, F.sellLot));
      row.sellVal += toNum(pick(r, F.sellVal));
      row.sellAvg = toNum(pick(r, F.sellAvg)) || row.sellAvg;
      map.set(code, row);
    }

    const brokers = Array.from(map.values()).map(b => {
      const netLot = b.buyLot - b.sellLot;
      const cleanMoney = b.buyVal - b.sellVal;

      // Unrealized P&L: posisi yang masih dipegang × selisih harga
      // 1 lot = 100 lembar saham
      let unrealizedPnl = 0;
      let unrealizedPct = 0;
      if (netLot > 0 && b.buyAvg > 0 && currentPrice > 0) {
        unrealizedPnl = netLot * 100 * (currentPrice - b.buyAvg);
        unrealizedPct = ((currentPrice - b.buyAvg) / b.buyAvg) * 100;
      } else if (netLot < 0 && b.sellAvg > 0 && currentPrice > 0) {
        // Net seller: profit kalau menjual di atas harga sekarang
        unrealizedPnl = Math.abs(netLot) * 100 * (b.sellAvg - currentPrice);
        unrealizedPct = ((b.sellAvg - currentPrice) / currentPrice) * 100;
      }

      // Status jelas
      let status: string;
      if (netLot > 0 && unrealizedPct > 0) status = 'AKUMULASI · PROFIT';
      else if (netLot > 0 && unrealizedPct < 0) status = 'AKUMULASI · RUGI';
      else if (netLot > 0) status = 'AKUMULASI';
      else if (netLot < 0 && unrealizedPct > 0) status = 'DISTRIBUSI · PROFIT';
      else if (netLot < 0 && unrealizedPct < 0) status = 'DISTRIBUSI · RUGI';
      else if (netLot < 0) status = 'DISTRIBUSI';
      else status = 'FLAT';

      return {
        broker: b.code,
        uangMasuk: Math.round(b.buyVal),
        uangKeluar: Math.round(b.sellVal),
        cleanMoney: Math.round(cleanMoney),
        netLot: Math.round(netLot),
        avgBeli: Math.round(b.buyAvg),
        avgJual: Math.round(b.sellAvg),
        hargaSekarang: currentPrice,
        unrealizedPnl: Math.round(unrealizedPnl),
        unrealizedPct: Number(unrealizedPct.toFixed(2)),
        status,
      };
    });

    // Urutkan: clean money terbesar di atas
    brokers.sort((a, b) => b.cleanMoney - a.cleanMoney);

    // Ringkasan
    const totalMasuk = brokers.reduce((s, b) => s + b.uangMasuk, 0);
    const totalKeluar = brokers.reduce((s, b) => s + b.uangKeluar, 0);

    return NextResponse.json({
      emiten,
      periode: { dari: from, sampai: to },
      hargaSekarang: currentPrice,
      ringkasan: {
        totalUangMasuk: totalMasuk,
        totalUangKeluar: totalKeluar,
        netCleanMoney: totalMasuk - totalKeluar,
        keterangan: 'Positif = lebih banyak uang mengalir masuk ke saham ini. Semua nilai dalam Rupiah.',
      },
      brokers,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal mengambil data.' },
      { status: 502 }
    );
  }
}