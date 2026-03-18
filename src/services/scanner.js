var binance         = require('./binance');
var indicators      = require('../indicators');
var fundingModule   = require('../indicators/fundingRate');
var orderBookModule = require('../indicators/orderBook');
var whaleModule     = require('../indicators/whaleAlert');
var sentimentModule = require('../indicators/sentiment');

var lastSignals = [];
var subscribers = [];
var isScanning  = false;
var allSymbols  = [];

async function fetchAllSymbols() {
  try {
    var axios = require('axios');
    var res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
    var tumSymboller = res.data.symbols
      .filter(function(s) { return s.status === 'TRADING' && s.quoteAsset === 'USDT'; })
      .map(function(s) { return s.baseAsset + 'USDT'; });

    var ticker = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr');
    var hacimMap = {};
    ticker.data.forEach(function(t) { hacimMap[t.symbol] = parseFloat(t.quoteVolume); });

    allSymbols = tumSymboller
      .filter(function(s) { return (hacimMap[s] || 0) > 5000000; })
      .sort(function(a, b) { return (hacimMap[b] || 0) - (hacimMap[a] || 0); });

    console.log('Hacim filtreli parite: ' + allSymbols.length + ' (min 3M USDT/gun)');
  } catch (err) {
    console.error('Sembol listesi alinamadi:', err.message);
    allSymbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT'];
  }
}

function subscribe(callback) {
  subscribers.push(callback);
}

function broadcast(data) {
  subscribers.forEach(function(cb) { cb(data); });
}

function getLastSignals() {
  return lastSignals;
}

async function scanBatch(symbols, interval) {
  var results   = [];
  var sentiment = await sentimentModule.getFearGreed();

  for (var i = 0; i < symbols.length; i++) {
    try {
      var candles1h  = await binance.getHistoricalCandles(symbols[i], '1h', 200);
      var candles4h  = await binance.getHistoricalCandles(symbols[i], '4h', 100);

      if (!candles1h || candles1h.length < 50) continue;
      if (!candles4h || candles4h.length < 20) continue;

      var analysis1h = null;
      var analysis4h = null;

      try { analysis1h = indicators.analyzeCandles(candles1h); } catch(e) { console.log('1h analiz hatasi ' + symbols[i] + ': ' + e.message); continue; }
      try { analysis4h = indicators.analyzeCandles(candles4h); } catch(e) { console.log('4h analiz hatasi ' + symbols[i] + ': ' + e.message); continue; }

      if (!analysis1h || analysis1h.score === undefined) continue;
      if (!analysis4h || analysis4h.score === undefined) continue;

      var funding   = await fundingModule.getFundingRate(symbols[i]);
      var orderBook = await orderBookModule.analyzeOrderBook(symbols[i]);
      var whale     = await whaleModule.getWhaleActivity(symbols[i]);

      var mtfScore = 0;
      if (analysis1h.score > 0 && analysis4h.score > 0)                               mtfScore = 2;
      if (analysis1h.score > 0 && analysis4h.score <= 0)                              mtfScore = -1;
      if (analysis1h.score > 0 && analysis4h.trend && analysis4h.trend.strength >= 2) mtfScore += 1;

      var extraScore = 0;
      if (funding.isVeryNegative)                          extraScore += 2;
      if (funding.isNegative)                              extraScore += 1;
      if (funding.isVeryPositive)                          extraScore -= 2;
      if (orderBook.bullish)                               extraScore += 2;
      if (orderBook.buyWall)                               extraScore += 1;
      if (orderBook.bearish)                               extraScore -= 2;
      if (orderBook.sellWall)                              extraScore -= 1;
      if (whale.whaleBullish)                              extraScore += 2;
      if (whale.whaleBearish)                              extraScore -= 2;
      if (sentiment.isExtremeFear && analysis1h.score > 0) extraScore += 2;
      if (sentiment.isFear        && analysis1h.score > 0) extraScore += 1;
      if (sentiment.isExtremeGreed)                        extraScore -= 1;

      var netScore = analysis1h.score + mtfScore + extraScore;

      var konfirmSayisi = 0;
      if (mtfScore >= 2)                                          konfirmSayisi++;
      if (whale.whaleBullish)                                     konfirmSayisi++;
      if (funding.isNegative)                                     konfirmSayisi++;
      if (orderBook.bullish)                                      konfirmSayisi++;
      if (analysis1h.fibonacci && analysis1h.fibonacci.atSupport) konfirmSayisi++;
      if (analysis1h.volume    && analysis1h.volume.isHigh)       konfirmSayisi++;
      if (sentiment.isExtremeFear || sentiment.isFear)            konfirmSayisi++;

      if (netScore < 1)           continue;

      var finalScore      = netScore;
      var tp1Pct          = analysis1h.atr ? parseFloat((analysis1h.atr.lastATR * 2   / analysis1h.lastClose * 100).toFixed(2)) : 0;
      var tp2Pct          = analysis1h.atr ? parseFloat((analysis1h.atr.lastATR * 3   / analysis1h.lastClose * 100).toFixed(2)) : 0;
      var tp3Pct          = analysis1h.atr ? parseFloat((analysis1h.atr.lastATR * 5   / analysis1h.lastClose * 100).toFixed(2)) : 0;
      var stopLossPct     = analysis1h.atr ? parseFloat((analysis1h.atr.lastATR * 1.5 / analysis1h.lastClose * 100).toFixed(2)) : 0;
      var riskReward      = stopLossPct > 0 ? parseFloat((tp1Pct / stopLossPct).toFixed(2)) : 0;
      var isHighPotential = tp3Pct >= 5;

      if (analysis1h.atr) {
        analysis1h.atr.tp1Pct      = tp1Pct;
        analysis1h.atr.tp2Pct      = tp2Pct;
        analysis1h.atr.tp3Pct      = tp3Pct;
        analysis1h.atr.stopLossPct = stopLossPct;
        analysis1h.atr.riskReward  = riskReward;
      }

      results.push({
        symbol:          symbols[i],
        lastClose:       analysis1h.lastClose,
        score:           finalScore,
        score1h:         analysis1h.score,
        score4h:         analysis4h.score,
        mtfKonfirm:      mtfScore >= 2,
        konfirmSayisi:   konfirmSayisi,
        overallSignal:   analysis1h.overallSignal,
        signalStrength:  analysis1h.signalStrength,
        signals:         analysis1h.signals,
        atr:             analysis1h.atr,
        sr:              analysis1h.supportResistance,
        fibonacci:       analysis1h.fibonacci,
        volume:          analysis1h.volume,
        funding:         funding,
        orderBook:       orderBook,
        whale:           whale,
        sentiment:       sentiment,
        rsi:             analysis1h.rsi,
        trend:           analysis1h.trend,
        stochRSI:        analysis1h.stochRSI,
        isHighPotential: isHighPotential,
        scannedAt:       new Date().toISOString()
      });

    } catch (err) {
      console.log('HATA ' + symbols[i] + ': ' + err.message);
    }
    await new Promise(function(r) { setTimeout(r, 800); });
  }
  return results;
}

async function scanMarket(interval) {
  if (!interval) interval = '1h';
  if (isScanning) {
    console.log('Tarama devam ediyor, atlaniyor...');
    return lastSignals;
  }

  isScanning = true;
  console.log('Tarama basladi — ' + allSymbols.length + ' parite');

  var results   = [];
  var batchSize = 1;

  for (var i = 0; i < allSymbols.length; i += batchSize) {
    var batch        = allSymbols.slice(i, i + batchSize);
    var batchResults = await scanBatch(batch, interval);
    results          = results.concat(batchResults);
    console.log('Tarandi: ' + Math.min(i + batchSize, allSymbols.length) + '/' + allSymbols.length + ' — Sinyal: ' + results.length);
  }

  results.sort(function(a, b) {
    if (a.isHighPotential && !b.isHighPotential) return -1;
    if (!a.isHighPotential && b.isHighPotential) return 1;
    return Math.abs(b.score) - Math.abs(a.score);
  });

  lastSignals = results;
  isScanning  = false;

  broadcast({ type: 'scan_complete', data: results, time: new Date().toISOString() });
  console.log('Tarama tamamlandi — ' + results.length + ' sinyal');
  return results;
}

async function startAutoScan(interval, intervalMs) {
  if (!interval)   interval   = '1h';
  if (!intervalMs) intervalMs = 2700000;

  await fetchAllSymbols();
  console.log('Otomatik tarama basladi — her ' + (intervalMs / 60000) + ' dakikada bir');
  scanMarket(interval);

  setInterval(function() {
    scanMarket(interval);
  }, intervalMs);
}

module.exports = {
  scanMarket:     scanMarket,
  getLastSignals: getLastSignals,
  startAutoScan:  startAutoScan,
  subscribe:      subscribe
};