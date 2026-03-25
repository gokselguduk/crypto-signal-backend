/**
 * scanner.js — v6.0 TRY ENGINE
 * Veri: Binance Spot — data-api.binance.vision
 * Para birimi: Türk Lirası (TRY)
 * Tarama: Sıralı, rate limit korumalı
 * Katman 1: Order Flow (orderbook analizi)
 * Katman 2: Multi-Timeframe Confluence (15m + 1h + 4h + 1d)
 * Katman 3: Piyasa Rejimi (candle tabanlı, ekstra API yok)
 * Katman 4: Sinyal Kalitesi
 * Katman 5: Smart Money (24h ticker tabanlı)
 * Katman 6: Psikoloji + Stop Avı (candle tabanlı)
 */

const binance        = require('./binance');
const indicators     = require('../indicators');
const sentimentModule = require('../indicators/sentiment');
const qualityModule  = require('../indicators/signalQuality');

let lastSignals  = [];
let subscribers  = [];
let isScanning   = false;
let allSymbols   = [];
let usdTryRate   = null;

// ─────────────────────────────────────────────
// YAPILANDIRMA
// ─────────────────────────────────────────────
const CONFIG = {
  SCAN_DELAY_MS:    1500,   // Her coin arası bekleme (ms)
  SCAN_INTERVAL_MS: 45 * 60 * 1000,
  MIN_SCORE:        2
};

// ─────────────────────────────────────────────
// SEMBOL LİSTESİ — BİNANCE TR TRY PAR İTELERİ
// ─────────────────────────────────────────────
async function fetchAllSymbols() {
  try {
    allSymbols = await binance.getTRYSymbols();
    usdTryRate = await binance.getUSDTRYRate();
    console.log(`Binance TR pariteleri: ${allSymbols.length} (TRY) — USD/TRY: ${usdTryRate}`);
  } catch (err) {
    console.error('Sembol listesi alinamadi:', err.message);
    allSymbols = ['BTCTRY','ETHTRY','BNBTRY','SOLTRY','XRPTRY'];
  }
}

// ─────────────────────────────────────────────
// BEKLEME
// ─────────────────────────────────────────────
function bekle(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────
// ORDER BOOK ANALİZİ (Katman 1 — basit, hızlı)
// ─────────────────────────────────────────────
function analyzeOrderBook(depth) {
  try {
    const bids = depth.bids.map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) }));
    const asks = depth.asks.map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }));

    const totalBid = bids.reduce((t, b) => t + b.qty, 0);
    const totalAsk = asks.reduce((t, a) => t + a.qty, 0);
    const ratio    = totalAsk > 0 ? parseFloat((totalBid / totalAsk).toFixed(3)) : 1;

    const maxBid = bids.reduce((max, b) => b.qty > max.qty ? b : max, bids[0] || {qty:0});
    const maxAsk = asks.reduce((max, a) => a.qty > max.qty ? a : max, asks[0] || {qty:0});

    const buyWall  = totalBid > 0 && maxBid.qty > totalBid * 0.3;
    const sellWall = totalAsk > 0 && maxAsk.qty > totalAsk * 0.3;

    // CVD taklidi — bid/ask dengesinden delta tahmini
    const deltaRatio = (totalBid - totalAsk) / (totalBid + totalAsk || 1);

    let orderFlowScore = 0;
    if (ratio > 1.5)   orderFlowScore += 2;
    if (ratio > 2.0)   orderFlowScore += 1;
    if (ratio < 0.67)  orderFlowScore -= 2;
    if (buyWall)       orderFlowScore += 1;
    if (sellWall)      orderFlowScore -= 1;

    return {
      bidAskRatio:    ratio,
      totalBid:       parseFloat(totalBid.toFixed(2)),
      totalAsk:       parseFloat(totalAsk.toFixed(2)),
      buyWall:        buyWall,
      sellWall:       sellWall,
      buyWallPrice:   buyWall  ? maxBid.price : null,
      sellWallPrice:  sellWall ? maxAsk.price : null,
      bullish:        ratio > 1.3 && !sellWall,
      bearish:        ratio < 0.7 && !buyWall,
      deltaRatio:     parseFloat(deltaRatio.toFixed(3)),
      orderFlowScore: orderFlowScore,
      cvd:            { deltaRatio: parseFloat(deltaRatio.toFixed(3)), bullish: deltaRatio > 0.1, bearish: deltaRatio < -0.1 },
      liquidity:      null,
      absorption:     null,
      signals:        []
    };
  } catch (err) {
    return { bidAskRatio:1, buyWall:false, sellWall:false, bullish:false, bearish:false, orderFlowScore:0, cvd:null, liquidity:null, absorption:null, signals:[] };
  }
}

// ─────────────────────────────────────────────
// PİYASA REJİMİ (Katman 3 — sadece candle, ekstra API yok)
// ─────────────────────────────────────────────
function analyzeRegime(candles1h) {
  try {
    if (!candles1h || candles1h.length < 20) return { regime: 'UNKNOWN', adx: 0, bbWidth: 0, regimeScore: 0, blocked: false };

    const closes = candles1h.map(c => c.close);
    const highs  = candles1h.map(c => c.high);
    const lows   = candles1h.map(c => c.low);

    // Basit ADX
    let trSum = 0;
    for (let i = 1; i < Math.min(15, candles1h.length); i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i-1]),
        Math.abs(lows[i]  - closes[i-1])
      );
      trSum += tr;
    }
    const avgTR = trSum / 14;
    const adxEst = closes[closes.length-1] > 0 ? (avgTR / closes[closes.length-1] * 100) : 0;

    // BB Genişliği
    const bb20 = closes.slice(-20);
    const bbMid = bb20.reduce((a,b) => a+b, 0) / 20;
    const bbStd = Math.sqrt(bb20.map(c => Math.pow(c-bbMid,2)).reduce((a,b)=>a+b,0)/20);
    const bbWidth = bbMid > 0 ? (bbStd * 2) / bbMid : 0;

    let regime = 'TREND';
    if      (adxEst > 2 && bbWidth > 0.04) regime = 'BREAKOUT';
    else if (adxEst < 1 && bbWidth < 0.02) regime = 'RANGE';

    let regimeScore = 0;
    if (regime === 'BREAKOUT') regimeScore = 3;
    if (regime === 'TREND')    regimeScore = 1;
    if (regime === 'RANGE')    regimeScore = -1;

    return {
      regime:      regime,
      adx:         parseFloat(adxEst.toFixed(2)),
      bbWidth:     parseFloat(bbWidth.toFixed(4)),
      regimeScore: regimeScore,
      blocked:     false,
      blockReason: null,
      manipulation: { isManipulated: false },
      washTrade:    { isWashTrade: false }
    };
  } catch (err) {
    return { regime: 'UNKNOWN', adx: 0, bbWidth: 0, regimeScore: 0, blocked: false };
  }
}

// ─────────────────────────────────────────────
// SMART MONEY (Katman 5 — 24h ticker tabanlı)
// ─────────────────────────────────────────────
function analyzeSmartMoney(ticker24h, funding) {
  try {
    if (!ticker24h) return { smartMoneyScore: 0, isShortSqueeze: false, oiTrend: 'NEUTRAL', lsSentiment: 'NEUTRAL' };

    const priceChange = parseFloat(ticker24h.priceChangePercent || 0);
    const volume      = parseFloat(ticker24h.quoteVolume || 0);
    const highLow     = parseFloat(ticker24h.highPrice || 0) / parseFloat(ticker24h.lowPrice || 1);

    let score = 0;

    // Güçlü yükseliş + yüksek hacim → kurumsal akış
    if (priceChange > 5  && volume > 10000000) score += 2;
    if (priceChange > 10 && volume > 50000000) score += 2;

    // Dar fiyat aralığı + yüksek hacim → birikim
    if (highLow < 1.02 && volume > 5000000) score += 1;

    // Funding negatif + fiyat yukarı → kısa sıkışma
    const isShortSqueeze = funding && funding.isNegative && priceChange > 2;
    if (isShortSqueeze) score += 3;

    return {
      smartMoneyScore: Math.max(-4, Math.min(4, score)),
      isShortSqueeze:  isShortSqueeze || false,
      oiTrend:         priceChange > 3 ? 'RISING' : priceChange < -3 ? 'FALLING' : 'NEUTRAL',
      lsSentiment:     priceChange > 5 ? 'CROWDED_LONG' : priceChange < -5 ? 'CROWDED_SHORT' : 'BALANCED',
      priceChange24h:  priceChange
    };
  } catch (err) {
    return { smartMoneyScore: 0, isShortSqueeze: false, oiTrend: 'NEUTRAL', lsSentiment: 'NEUTRAL' };
  }
}

// ─────────────────────────────────────────────
// PSİKOLOJİ + STOP AVI (Katman 6 — candle tabanlı)
// ─────────────────────────────────────────────
function analyzePsychology(candles1h, sentiment, funding, dir1h) {
  try {
    if (!candles1h || candles1h.length < 10) {
      return { psychologyScore: 0, isSilent: false, isStopHunt: false, stopHuntSignals: [], emotionalState: 'NEUTRAL' };
    }

    // Sessizlik dedektörü
    const volumes  = candles1h.map(c => c.volume);
    const avg20    = volumes.slice(-20).reduce((a,b)=>a+b,0)/20;
    const avg5     = volumes.slice(-5).reduce((a,b)=>a+b,0)/5;
    const volDrop  = avg20 > 0 ? avg5/avg20 : 1;
    const closes   = candles1h.map(c => c.close);
    const last10   = closes.slice(-10);
    const range    = (Math.max(...last10)-Math.min(...last10))/(closes[closes.length-1]||1);
    const isSilent = volDrop < 0.5 && range < 0.02;

    // Stop avı — uzun wick tespiti
    const last = candles1h[candles1h.length-1];
    const body  = Math.abs(last.close - last.open);
    const lwWick = Math.min(last.open,last.close) - last.low;
    const uwWick = last.high - Math.max(last.open,last.close);
    const hasLowerWick = body > 0 && lwWick > body * 2;
    const hasUpperWick = body > 0 && uwWick > body * 2;
    const stopHuntSignals = [];
    if (hasLowerWick) stopHuntSignals.push('ALT_STOP_AVI_TAMAMLANDI');
    if (hasUpperWick) stopHuntSignals.push('UST_STOP_AVI_TAMAMLANDI');

    // Duygusal durum
    const fgVal = sentiment ? (sentiment.value||50) : 50;
    let emotionalState = 'NEUTRAL';
    if      (fgVal <= 20) emotionalState = 'EXTREME_PANIC';
    else if (fgVal <= 40) emotionalState = 'PANIC';
    else if (fgVal >= 80) emotionalState = 'EXTREME_GREED';
    else if (fgVal >= 60) emotionalState = 'GREED';

    let score = 0;
    if (isSilent)          score += 2;
    if (hasLowerWick && dir1h > 0) score += 3;
    if (hasUpperWick && dir1h < 0) score -= 3;
    if (emotionalState === 'EXTREME_PANIC' && dir1h > 0)  score += 3;
    if (emotionalState === 'EXTREME_GREED' && dir1h < 0) score -= 3;

    return {
      psychologyScore: Math.max(-5, Math.min(5, score)),
      isSilent:        isSilent,
      isStopHunt:      stopHuntSignals.length > 0,
      stopHuntSignals: stopHuntSignals,
      emotionalState:  emotionalState,
      volDropRatio:    parseFloat(volDrop.toFixed(2))
    };
  } catch (err) {
    return { psychologyScore: 0, isSilent: false, isStopHunt: false, stopHuntSignals: [], emotionalState: 'NEUTRAL' };
  }
}

// ─────────────────────────────────────────────
// TL FİYAT FORMATI
// ─────────────────────────────────────────────
function calcPriceLevels(lastClose, atr) {
  if (!atr) return null;
  return {
    lastATR:      atr.lastATR,
    stopLoss:     parseFloat((lastClose - atr.lastATR * 1.5).toFixed(2)),
    takeProfit1:  parseFloat((lastClose + atr.lastATR * 2).toFixed(2)),
    takeProfit2:  parseFloat((lastClose + atr.lastATR * 3).toFixed(2)),
    takeProfit3:  parseFloat((lastClose + atr.lastATR * 5).toFixed(2)),
    stopLossPct:  parseFloat((atr.lastATR * 1.5 / lastClose * 100).toFixed(2)),
    tp1Pct:       parseFloat((atr.lastATR * 2   / lastClose * 100).toFixed(2)),
    tp2Pct:       parseFloat((atr.lastATR * 3   / lastClose * 100).toFixed(2)),
    tp3Pct:       parseFloat((atr.lastATR * 5   / lastClose * 100).toFixed(2)),
    riskReward:   parseFloat(((atr.lastATR * 2) / (atr.lastATR * 1.5)).toFixed(2))
  };
}

// ─────────────────────────────────────────────
// TEK SEMBOL TARAMA
// ─────────────────────────────────────────────
async function scanSingle(symbol, sentiment) {
  try {
    // Mumları sıralı çek (rate limit koruması)
    const candles1h  = await binance.getHistoricalCandles(symbol, '1h',  200);
    await bekle(300);
    const candles4h  = await binance.getHistoricalCandles(symbol, '4h',  100);
    await bekle(300);
    const candles15m = await binance.getHistoricalCandles(symbol, '15m', 100);
    await bekle(300);
    const candles1d  = await binance.getHistoricalCandles(symbol, '1d',   60);

    if (!candles1h  || candles1h.length  < 50) return null;
    if (!candles4h  || candles4h.length  < 20) return null;
    if (!candles15m || candles15m.length < 30) return null;

    // Teknik analiz
    let analysis1h = null, analysis4h = null, analysis15m = null, analysis1d = null;
    try { analysis1h  = indicators.analyzeCandles(candles1h);  } catch(e) { return null; }
    try { analysis4h  = indicators.analyzeCandles(candles4h);  } catch(e) { return null; }
    try { analysis15m = indicators.analyzeCandles(candles15m); } catch(e) { analysis15m = null; }
    try { analysis1d  = indicators.analyzeCandles(candles1d);  } catch(e) { analysis1d  = null; }

    if (!analysis1h || analysis1h.score === undefined) return null;

    // Order book + 24h ticker
    await bekle(200);
    const depth    = await binance.getOrderBook(symbol);
    await bekle(200);
    const ticker24 = await binance.get24hTicker(symbol);

    // ═══ KATMAN 2 — MTF ═══════════════════════
    const dir15m = analysis15m ? (analysis15m.score>0?1:analysis15m.score<0?-1:0) : 0;
    const dir1h  = analysis1h.score>0 ? 1 : analysis1h.score<0 ? -1 : 0;
    const dir4h  = analysis4h.score>0 ? 1 : analysis4h.score<0 ? -1 : 0;
    const dir1d  = analysis1d  ? (analysis1d.score>0?1:analysis1d.score<0?-1:0)  : 0;

    // Çelişki susturucu
    if (dir1h > 0 && dir4h < 0) return null;
    if (dir1h > 0 && dir1d < 0) return null;

    const mtfScore    = dir1d*4 + dir4h*3 + dir1h*2 + dir15m*1;
    const allAligned  = dir15m===dir1h && dir1h===dir4h && dir4h===dir1d && dir1d!==0;
    const threeAligned = dir15m===dir1h && dir1h===dir4h && dir4h!==0;
    const momentumBoost = allAligned ? 3 : threeAligned ? 1 : 0;
    const mtfKonfirm  = (dir4h>0 && dir1h>0) || allAligned;

    // ═══ KATMAN 1 — ORDER FLOW ════════════════
    const orderBook = analyzeOrderBook(depth);

    // ═══ KATMAN 3 — REJİM ════════════════════
    const regime = analyzeRegime(candles1h);

    // ═══ KATMAN 5 — SMART MONEY ══════════════
    // Funding yok (spot piyasası) — sentiment bazlı
    const fakeFunding = {
      isNegative:     sentiment && sentiment.isExtremeFear,
      isVeryNegative: false,
      isVeryPositive: sentiment && sentiment.isExtremeGreed,
      fundingRate:    0
    };
    const smartMoney = analyzeSmartMoney(ticker24, fakeFunding);

    // ═══ KATMAN 6 — PSİKOLOJİ ════════════════
    const psychology = analyzePsychology(candles1h, sentiment, fakeFunding, dir1h);

    // ═══ SKORLAR ══════════════════════════════
    let extraScore = 0;

    // Order Flow
    extraScore += Math.max(-4, Math.min(4, orderBook.orderFlowScore));

    // Sentiment
    if (sentiment && sentiment.isExtremeFear && dir1h>0)  extraScore += 2;
    if (sentiment && sentiment.isFear        && dir1h>0)  extraScore += 1;
    if (sentiment && sentiment.isExtremeGreed)             extraScore -= 1;

    // Rejim
    extraScore += regime.regimeScore;

    // Smart Money
    extraScore += smartMoney.smartMoneyScore;

    // Psikoloji
    extraScore += psychology.psychologyScore;

    const netScore = analysis1h.score + mtfScore + extraScore + momentumBoost;
    if (netScore < CONFIG.MIN_SCORE) return null;

    // ═══ TL FİYAT SEVİYELERİ ══════════════════
    const priceLevels = calcPriceLevels(analysis1h.lastClose, analysis1h.atr);
    if (priceLevels && analysis1h.atr) {
      analysis1h.atr = { ...analysis1h.atr, ...priceLevels };
    }

    // ═══ KATMAN 4 — KALİTE ════════════════════
    const result = {
      symbol:        symbol,
      currency:      'TRY',
      usdTryRate:    usdTryRate,
      lastClose:     analysis1h.lastClose,
      score:         netScore,
      score1h:       analysis1h.score,
      score4h:       analysis4h  ? analysis4h.score  : null,
      score15m:      analysis15m ? analysis15m.score : null,
      score1d:       analysis1d  ? analysis1d.score  : null,
      mtfKonfirm:    mtfKonfirm,
      mtfDetay: {
        dir15m, dir1h, dir4h, dir1d,
        allAligned, momentumBoost
      },
      regime: {
        type:        regime.regime,
        adx:         regime.adx,
        bbWidth:     regime.bbWidth,
        regimeScore: regime.regimeScore
      },
      smartMoney: {
        isShortSqueeze: smartMoney.isShortSqueeze,
        oiTrend:        smartMoney.oiTrend,
        lsSentiment:    smartMoney.lsSentiment,
        score:          smartMoney.smartMoneyScore,
        priceChange24h: smartMoney.priceChange24h
      },
      psychology: {
        emotionalState:  psychology.emotionalState,
        isSilent:        psychology.isSilent,
        isStopHunt:      psychology.isStopHunt,
        stopHuntSignals: psychology.stopHuntSignals,
        score:           psychology.psychologyScore
      },
      overallSignal:  analysis1h.overallSignal,
      signalStrength: analysis1h.signalStrength,
      signals:        analysis1h.signals,
      atr:            analysis1h.atr,
      sr:             analysis1h.supportResistance,
      fibonacci:      analysis1h.fibonacci,
      volume:         analysis1h.volume,
      orderBook:      orderBook,
      orderFlow: {
        score:     orderBook.orderFlowScore || 0,
        cvd:       orderBook.cvd            || null,
        signals:   orderBook.signals        || []
      },
      sentiment:      sentiment,
      rsi:            analysis1h.rsi,
      trend:          analysis1h.trend,
      stochRSI:       analysis1h.stochRSI,
      isHighPotential: priceLevels ? priceLevels.tp3Pct >= 5 : false,
      scannedAt:      new Date().toISOString()
    };

    const quality = qualityModule.analyzeQuality(result, regime.regime, sentiment);
    if (!quality.shouldSend) return null;

    result.quality = {
      grade:           quality.qualityGrade,
      confluenceScore: quality.confluenceScore,
      isStable:        quality.isStable
    };

    return result;

  } catch (err) {
    console.log(`HATA ${symbol}: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// ANA TARAMA — SIRALI
// ─────────────────────────────────────────────
async function scanMarket() {
  if (isScanning) {
    console.log('Tarama devam ediyor, atlaniyor...');
    return lastSignals;
  }

  isScanning = true;
  const startTime = Date.now();
  console.log(`Tarama basladi — ${allSymbols.length} TRY paritesi`);

  const sentiment = await sentimentModule.getFearGreed();
  const results   = [];

  for (let i = 0; i < allSymbols.length; i++) {
    const symbol = allSymbols[i];
    const result = await scanSingle(symbol, sentiment);
    if (result) results.push({...result, _idx: results.length});

    if ((i+1) % 20 === 0 || i+1 === allSymbols.length) {
      const elapsed = Math.round((Date.now()-startTime)/1000);
      const eta     = i+1 < allSymbols.length
        ? Math.round((elapsed/(i+1))*(allSymbols.length-i-1)) : 0;
      console.log(`Tarandi: ${i+1}/${allSymbols.length} — Sinyal: ${results.length} — Sure: ${elapsed}s${eta>0?' — Kalan: ~'+eta+'s':''}`);
    }

    // Rate limit koruması
    await bekle(CONFIG.SCAN_DELAY_MS);
  }

  // Sırala: A kalite > allAligned > highPotential > score
  results.sort((a, b) => {
    const go = {A:4,B:3,C:2,D:1};
    const ga = a.quality ? (go[a.quality.grade]||0) : 0;
    const gb = b.quality ? (go[b.quality.grade]||0) : 0;
    if (ga !== gb) return gb - ga;
    if (a.mtfDetay.allAligned && !b.mtfDetay.allAligned) return -1;
    if (!a.mtfDetay.allAligned && b.mtfDetay.allAligned) return 1;
    if (a.isHighPotential && !b.isHighPotential) return -1;
    if (!a.isHighPotential && b.isHighPotential) return 1;
    return b.score - a.score;
  });

  const totalTime = Math.round((Date.now()-startTime)/1000);
  lastSignals = results;
  isScanning  = false;

  broadcast({ type: 'scan_complete', data: results, time: new Date().toISOString() });

  const gradeA    = results.filter(r => r.quality?.grade==='A').length;
  const gradeB    = results.filter(r => r.quality?.grade==='B').length;
  const squeeze   = results.filter(r => r.smartMoney?.isShortSqueeze).length;
  const stopHunted = results.filter(r => r.psychology?.isStopHunt).length;

  console.log(`Tarama tamamlandi — ${results.length} sinyal — Sure: ${totalTime}s`);
  console.log(`Kalite: A=${gradeA} B=${gradeB} | Squeeze=${squeeze} | StopAvi=${stopHunted}`);

  return results;
}

// ─────────────────────────────────────────────
// OTOMATİK TARAMA
// ─────────────────────────────────────────────
async function startAutoScan() {
  await fetchAllSymbols();
  console.log(`Otomatik tarama basladi — her ${CONFIG.SCAN_INTERVAL_MS/60000} dakikada bir`);
  scanMarket();
  setInterval(scanMarket, CONFIG.SCAN_INTERVAL_MS);
}

function subscribe(cb)    { subscribers.push(cb); }
function broadcast(data)  { subscribers.forEach(cb => cb(data)); }
function getLastSignals() { return lastSignals; }

module.exports = { scanMarket, getLastSignals, startAutoScan, subscribe };