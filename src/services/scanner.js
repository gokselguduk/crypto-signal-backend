/**
 * scanner.js — v4.0 FULL ENGINE
 * Katman 1: Order Flow (CVD + Likidite + Absorpsiyon)
 * Katman 2: Multi-Timeframe Confluence (15m + 1h + 4h + 1d)
 * Katman 3: Piyasa Rejimi + Manipülasyon + Wash Trade
 * Katman 4: Sinyal Kararlılık + Kalite + Dinamik Eşik
 */

var binance         = require('./binance');
var indicators      = require('../indicators');
var fundingModule   = require('../indicators/fundingRate');
var orderBookModule = require('../indicators/orderBook');
var whaleModule     = require('../indicators/whaleAlert');
var sentimentModule = require('../indicators/sentiment');
var regimeModule    = require('../indicators/marketRegime');
var qualityModule   = require('../indicators/signalQuality');

var lastSignals = [];
var subscribers = [];
var isScanning  = false;
var allSymbols  = [];

// ─────────────────────────────────────────────
// YAPILANDIRMA
// ─────────────────────────────────────────────
var CONFIG = {
  MIN_VOLUME_USDT:  1000000,
  PARALLEL_LIMIT:   3,
  REQUEST_DELAY_MS: 1200,
  SCAN_INTERVAL_MS: 45 * 60 * 1000
};

// ─────────────────────────────────────────────
// SEMBOL LİSTESİ
// ─────────────────────────────────────────────
async function fetchAllSymbols() {
  try {
    var axios = require('axios');
    var [infoRes, tickerRes] = await Promise.all([
      axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo'),
      axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr')
    ]);

    var hacimMap = {};
    tickerRes.data.forEach(function(t) {
      hacimMap[t.symbol] = parseFloat(t.quoteVolume);
    });

    allSymbols = infoRes.data.symbols
      .filter(function(s) {
        return s.status === 'TRADING' &&
               s.quoteAsset === 'USDT' &&
               s.contractType === 'PERPETUAL' &&
               (hacimMap[s.symbol] || 0) > CONFIG.MIN_VOLUME_USDT;
      })
      .map(function(s) { return s.symbol; })
      .sort(function(a, b) { return (hacimMap[b] || 0) - (hacimMap[a] || 0); });

    console.log('Tum Binance Futures pariteleri: ' + allSymbols.length + ' (min 1M USDT/gun)');
  } catch (err) {
    console.error('Sembol listesi alinamadi:', err.message);
    allSymbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT'];
  }
}

// ─────────────────────────────────────────────
// PARALEL ÇALIŞTIRICI
// ─────────────────────────────────────────────
async function runParallel(items, limit, fn) {
  var results = [];
  for (var i = 0; i < items.length; i += limit) {
    var batch = items.slice(i, i + limit);
    var batchResults = await Promise.all(batch.map(fn));
    results = results.concat(batchResults);
    if (i + limit < items.length) {
      await new Promise(function(r) { setTimeout(r, CONFIG.REQUEST_DELAY_MS); });
    }
  }
  return results;
}

// ─────────────────────────────────────────────
// TEK SEMBOL TARAMA
// ─────────────────────────────────────────────
async function scanSingle(symbol, sentiment) {
  try {

    // ── Mumları paralel çek ───────────────────────────────
    var candleResults = await Promise.all([
      binance.getHistoricalCandles(symbol, '15m', 100),
      binance.getHistoricalCandles(symbol, '1h',  200),
      binance.getHistoricalCandles(symbol, '4h',  100),
      binance.getHistoricalCandles(symbol, '1d',   60)
    ]);

    var candles15m = candleResults[0];
    var candles1h  = candleResults[1];
    var candles4h  = candleResults[2];
    var candles1d  = candleResults[3];

    if (!candles1h  || candles1h.length  < 50) return null;
    if (!candles4h  || candles4h.length  < 20) return null;
    if (!candles15m || candles15m.length < 30) return null;

    // ── Teknik analiz ─────────────────────────────────────
    var analysis15m = null;
    var analysis1h  = null;
    var analysis4h  = null;
    var analysis1d  = null;

    try { analysis1h  = indicators.analyzeCandles(candles1h);  } catch(e) { return null; }
    try { analysis4h  = indicators.analyzeCandles(candles4h);  } catch(e) { return null; }
    try { analysis15m = indicators.analyzeCandles(candles15m); } catch(e) { analysis15m = null; }
    try { analysis1d  = indicators.analyzeCandles(candles1d);  } catch(e) { analysis1d  = null; }

    if (!analysis1h || analysis1h.score === undefined) return null;

    // ── Dış veri paralel ─────────────────────────────────
    var extResults = await Promise.all([
      fundingModule.getFundingRate(symbol),
      orderBookModule.analyzeOrderBook(symbol),
      whaleModule.getWhaleActivity(symbol)
    ]);

    var funding   = extResults[0];
    var orderBook = extResults[1];
    var whale     = extResults[2];

    // ═══════════════════════════════════════════════════════
    // KATMAN 2 — Multi-Timeframe Confluence Engine
    // ═══════════════════════════════════════════════════════
    var dir15m = analysis15m ? (analysis15m.score > 0 ? 1 : analysis15m.score < 0 ? -1 : 0) : 0;
    var dir1h  = analysis1h.score > 0 ? 1 : analysis1h.score < 0 ? -1 : 0;
    var dir4h  = analysis4h.score > 0 ? 1 : analysis4h.score < 0 ? -1 : 0;
    var dir1d  = analysis1d ? (analysis1d.score > 0 ? 1 : analysis1d.score < 0 ? -1 : 0) : 0;

    // Çelişki Susturucu
    if (dir1h > 0 && dir4h < 0) return null;
    if (dir1h > 0 && dir1d < 0) return null;

    // Ağırlıklı MTF Skoru
    var mtfScore = 0;
    mtfScore += dir1d  * 4;
    mtfScore += dir4h  * 3;
    mtfScore += dir1h  * 2;
    mtfScore += dir15m * 1;

    // Momentum Hızlanma
    var momentumBoost = 0;
    var allAligned    = (dir15m === dir1h && dir1h === dir4h && dir4h === dir1d && dir1d !== 0);
    var threeAligned  = (dir15m === dir1h && dir1h === dir4h && dir4h !== 0);
    if (allAligned)           momentumBoost = 3;
    else if (threeAligned)    momentumBoost = 1;

    var mtfKonfirm = (dir4h > 0 && dir1h > 0) || allAligned;

    // ═══════════════════════════════════════════════════════
    // KATMAN 3 — Piyasa Rejimi + Manipülasyon + Wash Trade
    // ═══════════════════════════════════════════════════════
    var regime = await regimeModule.analyzeRegime(
      symbol, candles1h, orderBook, analysis1h.volume, dir1h
    );

    // Manipülasyon veya wash trade → sinyali öldür
    if (regime.blocked) {
      console.log('BLOK [' + regime.blockReason + '] ' + symbol);
      return null;
    }

    // Mumları temizle (bellek)
    candles15m = null; candles1h = null; candles4h = null; candles1d = null;

    // ═══════════════════════════════════════════════════════
    // KATMAN 1 — Order Flow + Ekstra Skorlar
    // ═══════════════════════════════════════════════════════
    var extraScore = 0;

    if (funding.isVeryNegative) extraScore += 2;
    if (funding.isNegative)     extraScore += 1;
    if (funding.isVeryPositive) extraScore -= 2;

    if (orderBook.orderFlowScore) {
      extraScore += Math.max(-4, Math.min(4, orderBook.orderFlowScore));
    } else {
      if (orderBook.bullish)  extraScore += 2;
      if (orderBook.buyWall)  extraScore += 1;
      if (orderBook.bearish)  extraScore -= 2;
      if (orderBook.sellWall) extraScore -= 1;
    }

    if (whale.whaleBullish) extraScore += 2;
    if (whale.whaleBearish) extraScore -= 2;

    if (sentiment.isExtremeFear && analysis1h.score > 0) extraScore += 2;
    if (sentiment.isFear        && analysis1h.score > 0) extraScore += 1;
    if (sentiment.isExtremeGreed)                        extraScore -= 1;

    // Rejim skoru ekle
    extraScore += regime.regimeScore;

    // ── Net Skor ──────────────────────────────────────────
    var netScore = analysis1h.score + mtfScore + extraScore + momentumBoost;
    if (netScore < 1) return null; // Ön filtre

    // ── TP / SL ───────────────────────────────────────────
    var tp1Pct      = analysis1h.atr ? parseFloat((analysis1h.atr.lastATR * 2   / analysis1h.lastClose * 100).toFixed(2)) : 0;
    var tp2Pct      = analysis1h.atr ? parseFloat((analysis1h.atr.lastATR * 3   / analysis1h.lastClose * 100).toFixed(2)) : 0;
    var tp3Pct      = analysis1h.atr ? parseFloat((analysis1h.atr.lastATR * 5   / analysis1h.lastClose * 100).toFixed(2)) : 0;
    var stopLossPct = analysis1h.atr ? parseFloat((analysis1h.atr.lastATR * 1.5 / analysis1h.lastClose * 100).toFixed(2)) : 0;
    var riskReward  = stopLossPct > 0 ? parseFloat((tp1Pct / stopLossPct).toFixed(2)) : 0;

    if (analysis1h.atr) {
      analysis1h.atr.tp1Pct      = tp1Pct;
      analysis1h.atr.tp2Pct      = tp2Pct;
      analysis1h.atr.tp3Pct      = tp3Pct;
      analysis1h.atr.stopLossPct = stopLossPct;
      analysis1h.atr.riskReward  = riskReward;
    }

    // ── Sonuç objesi ─────────────────────────────────────
    var result = {
      symbol:          symbol,
      lastClose:       analysis1h.lastClose,
      score:           netScore,
      score1h:         analysis1h.score,
      score4h:         analysis4h ? analysis4h.score : null,
      score15m:        analysis15m ? analysis15m.score : null,
      score1d:         analysis1d  ? analysis1d.score  : null,
      mtfKonfirm:      mtfKonfirm,
      mtfDetay: {
        dir15m:        dir15m,
        dir1h:         dir1h,
        dir4h:         dir4h,
        dir1d:         dir1d,
        allAligned:    allAligned,
        momentumBoost: momentumBoost
      },
      regime: {
        type:          regime.regime,
        adx:           regime.adx,
        bbWidth:       regime.bbWidth,
        regimeScore:   regime.regimeScore,
        listingAge:    regime.manipulation ? regime.manipulation.listingAgeDays : null
      },
      overallSignal:   analysis1h.overallSignal,
      signalStrength:  analysis1h.signalStrength,
      signals:         analysis1h.signals,
      atr:             analysis1h.atr,
      sr:              analysis1h.supportResistance,
      fibonacci:       analysis1h.fibonacci,
      volume:          analysis1h.volume,
      funding:         funding,
      orderBook:       orderBook,
      orderFlow: {
        score:      orderBook.orderFlowScore || 0,
        cvd:        orderBook.cvd            || null,
        liquidity:  orderBook.liquidity      || null,
        absorption: orderBook.absorption     || null,
        signals:    orderBook.signals        || []
      },
      whale:           whale,
      sentiment:       sentiment,
      rsi:             analysis1h.rsi,
      trend:           analysis1h.trend,
      stochRSI:        analysis1h.stochRSI,
      isHighPotential: tp3Pct >= 5,
      scannedAt:       new Date().toISOString()
    };

    // ═══════════════════════════════════════════════════════
    // KATMAN 4 — Sinyal Kalite + Kararlılık Motoru
    // ═══════════════════════════════════════════════════════
    var quality = qualityModule.analyzeQuality(result, regime.regime, sentiment);

    // Kalite filtresi geçemedi → gönderme
    if (!quality.shouldSend) {
      return null;
    }

    // Kalite bilgilerini sonuca ekle
    result.quality = {
      grade:            quality.qualityGrade,
      confluenceScore:  quality.confluenceScore,
      dynamicThreshold: quality.dynamicThreshold,
      isStable:         quality.isStable
    };

    // Belleği temizle
    analysis15m = null; analysis1h = null; analysis4h = null; analysis1d = null;
    funding = null; orderBook = null; whale = null;

    return result;

  } catch (err) {
    console.log('HATA ' + symbol + ': ' + err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// ANA TARAMA
// ─────────────────────────────────────────────
async function scanMarket() {
  if (isScanning) {
    console.log('Tarama devam ediyor, atlaniyor...');
    return lastSignals;
  }

  isScanning = true;
  var startTime = Date.now();
  console.log('Tarama basladi — ' + allSymbols.length + ' parite (paralel: ' + CONFIG.PARALLEL_LIMIT + ')');

  var sentiment = await sentimentModule.getFearGreed();
  var results   = [];
  var scanned   = 0;

  await runParallel(allSymbols, CONFIG.PARALLEL_LIMIT, async function(symbol) {
    var result = await scanSingle(symbol, sentiment);
    scanned++;
    if (result) results.push(result);

    if (scanned % 20 === 0 || scanned === allSymbols.length) {
      var elapsed = Math.round((Date.now() - startTime) / 1000);
      var eta     = scanned < allSymbols.length
        ? Math.round((elapsed / scanned) * (allSymbols.length - scanned))
        : 0;
      console.log('Tarandi: ' + scanned + '/' + allSymbols.length +
                  ' — Sinyal: ' + results.length +
                  ' — Sure: ' + elapsed + 's' +
                  (eta > 0 ? ' — Kalan: ~' + eta + 's' : ''));
    }

    if (global.gc) global.gc();
  });

  // Sırala: A kalitesi > allAligned > highPotential > score
  results.sort(function(a, b) {
    var gradeOrder = { 'A': 4, 'B': 3, 'C': 2, 'D': 1 };
    var ga = a.quality ? (gradeOrder[a.quality.grade] || 0) : 0;
    var gb = b.quality ? (gradeOrder[b.quality.grade] || 0) : 0;
    if (ga !== gb) return gb - ga;
    if (a.mtfDetay.allAligned && !b.mtfDetay.allAligned) return -1;
    if (!a.mtfDetay.allAligned && b.mtfDetay.allAligned) return 1;
    if (a.isHighPotential && !b.isHighPotential) return -1;
    if (!a.isHighPotential && b.isHighPotential) return 1;
    return b.score - a.score;
  });

  var totalTime = Math.round((Date.now() - startTime) / 1000);
  lastSignals = results;
  isScanning  = false;

  broadcast({ type: 'scan_complete', data: results, time: new Date().toISOString() });

  // Kalite özeti
  var gradeA = results.filter(function(r){ return r.quality && r.quality.grade === 'A'; }).length;
  var gradeB = results.filter(function(r){ return r.quality && r.quality.grade === 'B'; }).length;
  var gradeC = results.filter(function(r){ return r.quality && r.quality.grade === 'C'; }).length;

  console.log('Tarama tamamlandi — ' + results.length + ' sinyal — Sure: ' + totalTime + 's');
  console.log('Kalite dagilimi: A=' + gradeA + ' B=' + gradeB + ' C=' + gradeC);

  return results;
}

// ─────────────────────────────────────────────
// OTOMATİK TARAMA
// ─────────────────────────────────────────────
async function startAutoScan() {
  await fetchAllSymbols();
  console.log('Otomatik tarama basladi — her ' + (CONFIG.SCAN_INTERVAL_MS / 60000) + ' dakikada bir');
  scanMarket();
  setInterval(scanMarket, CONFIG.SCAN_INTERVAL_MS);
}

function subscribe(callback) { subscribers.push(callback); }
function broadcast(data)     { subscribers.forEach(function(cb) { cb(data); }); }
function getLastSignals()    { return lastSignals; }

module.exports = {
  scanMarket:     scanMarket,
  getLastSignals: getLastSignals,
  startAutoScan:  startAutoScan,
  subscribe:      subscribe
};