/**
 * binance.js — Binance Spot Data Provider
 * Endpoint: data-api.binance.vision (piyasa verisi için özel, daha hızlı)
 * TRY pariteleri destekli — BTCTRY, ETHTRY vb.
 * Rate limit: 6000 weight/dakika (Futures'tan çok daha cömert)
 */

const axios = require('axios');
const path  = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Binance piyasa verisi için özel endpoint — rate limit daha cömert
const BASE_URL = 'https://data-api.binance.vision';

class BinanceService {

  // ─────────────────────────────────────────────
  // TRY PARİTELERİNİ ÇEK
  // ─────────────────────────────────────────────
  async getTRYSymbols() {
    try {
      const res = await axios.get(`${BASE_URL}/api/v3/exchangeInfo`, {
        timeout: 8000
      });

      const ticker = await axios.get(`${BASE_URL}/api/v3/ticker/24hr`, {
        timeout: 8000
      });

      const hacimMap = {};
      ticker.data.forEach(t => {
        hacimMap[t.symbol] = parseFloat(t.quoteVolume);
      });

      const symbols = res.data.symbols
        .filter(s =>
          s.status === 'TRADING' &&
          s.quoteAsset === 'TRY' &&
          (hacimMap[s.symbol] || 0) > 1000000 // Min 1M TRY/gün
        )
        .map(s => s.symbol)
        .sort((a, b) => (hacimMap[b] || 0) - (hacimMap[a] || 0));

      return symbols;
    } catch (err) {
      console.error('TRY sembolleri alinamadi:', err.message);
      return ['BTCTRY', 'ETHTRY', 'BNBTRY', 'SOLTRY', 'XRPTRY'];
    }
  }

  // ─────────────────────────────────────────────
  // TARİHSEL MUMLAR (OHLCV)
  // ─────────────────────────────────────────────
  async getHistoricalCandles(symbol, interval, limit) {
    if (!limit) limit = 200;
    try {
      const res = await axios.get(`${BASE_URL}/api/v3/klines`, {
        params: {
          symbol:   symbol.toUpperCase(),
          interval: interval,
          limit:    limit
        },
        timeout: 8000
      });

      return res.data.map(k => ({
        time:   k[0],
        open:   parseFloat(k[1]),
        high:   parseFloat(k[2]),
        low:    parseFloat(k[3]),
        close:  parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closed: true
      }));
    } catch (err) {
      throw new Error(`Candle alinamadi ${symbol} ${interval}: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────
  // ANLIM FİYAT (TRY)
  // ─────────────────────────────────────────────
  async getCurrentPrice(symbol) {
    try {
      const res = await axios.get(`${BASE_URL}/api/v3/ticker/price`, {
        params: { symbol: symbol.toUpperCase() },
        timeout: 5000
      });
      return parseFloat(res.data.price);
    } catch (err) {
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // ORDER BOOK (20 seviye — hafif)
  // ─────────────────────────────────────────────
  async getOrderBook(symbol) {
    try {
      const res = await axios.get(`${BASE_URL}/api/v3/depth`, {
        params: { symbol: symbol.toUpperCase(), limit: 20 },
        timeout: 5000
      });
      return res.data;
    } catch (err) {
      return { bids: [], asks: [] };
    }
  }

  // ─────────────────────────────────────────────
  // 24S TICKER — hacim, fiyat değişimi
  // ─────────────────────────────────────────────
  async get24hTicker(symbol) {
    try {
      const res = await axios.get(`${BASE_URL}/api/v3/ticker/24hr`, {
        params: { symbol: symbol.toUpperCase() },
        timeout: 5000
      });
      return res.data;
    } catch (err) {
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // USD/TRY KURU — fiyat dönüşümü için
  // ─────────────────────────────────────────────
  async getUSDTRYRate() {
    try {
      const res = await axios.get(`${BASE_URL}/api/v3/ticker/price`, {
        params: { symbol: 'USDTTRY' },
        timeout: 5000
      });
      return parseFloat(res.data.price);
    } catch (err) {
      return null;
    }
  }

}

module.exports = new BinanceService();