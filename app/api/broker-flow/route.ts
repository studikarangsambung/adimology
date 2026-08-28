import { NextRequest, NextResponse } from 'next/server';
import { fetchMarketDetector, fetchOrderbook } from '@/lib/stockbit';
import type { BrokerFlowActivity, BrokerFlowResponse } from '@/lib/types';

/**
 * Broker Flow — pengganti tradersaham.com
 * ========================================
 * Mengambil data dari endpoint marketdetectors Stockbit yang sudah dipakai
 * kalkulator Adimology, lalu mengklasifikasi tiap broker ke kategori
 * Bandar/Whale/Retail/Mix.
 *
 * Format respons identik dengan versi tradersaham supaya
 * BrokerFlowCard.tsx tidak perlu diubah.
 *
 * Keterbatasan dibanding versi tradersaham:
 * - daily_data kosong (butuh N panggilan terpisah, terlalu berat).
 *   Kalau kartu menampilkan chart harian, bagian itu akan kosong.
 * - buy_days, active_days, consistency_pct diisi "–" karena data
 *   agregat dari Stockbit tidak memiliki informasi per-hari per-broker.
 * - Klasifikasi broker bersifat statis dan bisa diperbarui di
 *   konstanta BROKER_MAP di bawah.
 */

// ─── Klasifikasi Broker ───────────────────────────────────────────────
// Daftar ini adalah pendekatan terbaik berdasarkan profil klien dominan
// tiap sekuritas. Tidak ada otoritas resmi yang menetapkannya — setiap
// situs punya versi sendiri. Sesuaikan kalau kamu merasa ada yang salah.

const BROKER_MAP: Record<string, 'Bandar' | 'Whale' | 'Retail' | 'Mix'> = {
  // Bandar (Smart): sekuritas dengan prop desk aktif / klien institusi besar
  CC: 'Bandar', // Mandiri Sekuritas
  YP: 'Bandar', // Mirae Asset
  AK: 'Bandar', // UBS Sekuritas
  KS: 'Bandar', // Ciptadana Sekuritas
  MS: 'Bandar', // Morgan Stanley
  DB: 'Bandar', // Deutsche Sekuritas
  JP: 'Bandar', // J.P. Morgan
  ML: 'Bandar', // Merrill Lynch (BofA)
  GS: 'Bandar', // Goldman Sachs
  CG: 'Bandar', // CGS-CIMB Sekuritas
  LG: 'Bandar', // NH Korindo Sekuritas
  AF: 'Bandar', // Samuel Internasional
  GI: 'Bandar', // Verdhana Sekuritas
  FS: 'Bandar', // Trimegah Sekuritas
  EP: 'Bandar', // MNC Sekuritas

  // Whale: sekuritas premium / high-net-worth individual
  ZP: 'Whale', // Maybank Sekuritas
  RX: 'Whale', // Macquarie Sekuritas
  BK: 'Whale', // BNI Sekuritas
  KZ: 'Whale', // Panin Sekuritas
  DX: 'Whale', // Bahana Sekuritas
  XA: 'Whale', // Lotus Andalan Sekuritas
  AI: 'Whale', // Mega Capital Sekuritas
  YJ: 'Whale', // Henan Putihrai Sekuritas
  CP: 'Whale', // RHB Sekuritas

  // Retail: sekuritas dengan basis ritel massal / aplikasi populer
  PD: 'Retail', // Indo Premier (IPOT)
  GR: 'Retail', // Mahakarya Artha (Stockbit/Bibit)
  IF: 'Retail', // IndoFirst Capital (Indodax Sekuritas)
  OD: 'Retail', // Kresna Sekuritas
  NI: 'Retail', // BRI Danareksa Sekuritas
  TP: 'Retail', // Phintraco Sekuritas (Ajaib)
  SQ: 'Retail', // Samuel Sekuritas
  KI: 'Retail', // Mandiri Sekuritas Online
  AG: 'Retail', // Artha Graha Sekuritas
  YO: 'Retail', // OCBC Sekuritas
  FZ: 'Retail', // Investindo Nusantara
  PG: 'Retail', // Phillip Sekuritas
  ID: 'Retail', // Jasa Utama Capital
};

function classifyBroker(code: string): 'Bandar' | 'Whale' | 'Retail' | 'Mix' {
  return BROKER_MAP[code.toUpperCase()] ?? 'Mix';
}

// ─── Utilitas ─────────────────────────────────────────────────────────

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

interface BrokerAccum {
  code: string;
  buyLot: number;
  buyVal: number;
  buyAvg: number;
  sellLot: number;
  sellVal: number;
  sellAvg: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Route handler ────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const emiten = sp.get('emiten');
  const lookbackDays = Number(sp.get('lookback_days') || '7');
  const brokerStatusFilter = (sp.get('broker_status') || 'Bandar,Whale,Retail,Mix')
    .split(',')
    .map(s => s.trim());

  if (!emiten) {
    return NextResponse.json(
      { success: false, error: 'Missing emiten parameter' },
      { status: 400 }
    );
  }

  try {
    // Hitung rentang tanggal
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - lookbackDays);
    const fromStr = isoDate(from);
    const toStr = isoDate(to);

    // Satu panggilan — data yang sama yang sudah dipakai kalkulator
    const raw = (await fetchMarketDetector(emiten.toUpperCase(), fromStr, toStr)) as unknown as {
      data?: {
        broker_summary?: { brokers_buy?: Row[]; brokers_sell?: Row[] };
      };
    };

    const buys = raw?.data?.broker_summary?.brokers_buy ?? [];
    const sells = raw?.data?.broker_summary?.brokers_sell ?? [];

    // Gabung sisi beli dan jual per broker
    const map = new Map<string, BrokerAccum>();

    const blank = (code: string): BrokerAccum => ({
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

    // Ambil harga terakhir dari orderbook (opsional, tidak fatal kalau gagal)
    let currentPrice = 0;
    try {
      const ob = (await fetchOrderbook(emiten.toUpperCase())) as unknown as {
        data?: { last?: number; close?: number; lastTradedPrice?: number };
      };
      currentPrice = ob?.data?.last ?? ob?.data?.close ?? ob?.data?.lastTradedPrice ?? 0;
    } catch {
      // Tidak fatal — float_pl_pct akan "0.00"
    }

    // Bangun activities dalam format BrokerFlowActivity
    const activities: BrokerFlowActivity[] = [];

    for (const b of map.values()) {
      const status = classifyBroker(b.code);
      if (!brokerStatusFilter.includes(status)) continue;

      const netVal = b.buyVal - b.sellVal;
      const avgPrice = b.buyAvg || b.sellAvg;
      const floatPl =
        avgPrice > 0 && currentPrice > 0
          ? (((currentPrice - avgPrice) / avgPrice) * 100).toFixed(2)
          : '0.00';

      activities.push({
        broker_code: b.code,
        stock_code: emiten.toUpperCase(),
        broker_status: status,
        stock_name: emiten.toUpperCase(),
        net_value: netVal.toFixed(0),
        total_buy_value: b.buyVal.toFixed(0),
        total_buy_volume: b.buyLot.toFixed(0),
        buy_days: '–',           // tidak tersedia dari data agregat
        active_days: '–',        // tidak tersedia dari data agregat
        consistency_pct: '–',    // tidak tersedia dari data agregat
        daily_data: [],          // butuh N panggilan terpisah, terlalu berat
        current_price: currentPrice > 0 ? currentPrice.toFixed(0) : '0',
        float_pl_pct: floatPl,
      });
    }

    // Urutkan: net_value terbesar (akumulasi) di atas
    activities.sort((a, b) => Number(b.net_value) - Number(a.net_value));

    // Bangun trading_dates (daftar hari kerja kasar dalam rentang)
    const tradingDates: string[] = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        tradingDates.push(isoDate(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const payload: BrokerFlowResponse = {
      trading_dates: tradingDates,
      total_trading_days: tradingDates.length,
      sort_by: 'net_value',
      activities,
    };

    return NextResponse.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    console.error('Broker Flow API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch broker flow data',
      },
      { status: 500 }
    );
  }
}