var binance = require('./binance');
var indicators = require('../indicators');

var lastSignals = [];
var subscribers = [];
var isScanning = false;
var allSymbols = [];

async function fetchAllSymbols() {
  allSymbols = [
    'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
    'ADAUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','DOTUSDT',
    'MATICUSDT','LTCUSDT','UNIUSDT','ATOMUSDT','NEARUSDT',
    'FTMUSDT','ALGOUSDT','VETUSDT','ICPUSDT','FILUSDT',
    'SANDUSDT','MANAUSDT','AXSUSDT','GALAUSDT','APEUSDT',
    'OPUSDT','ARBUSDT','INJUSDT','SUIUSDT','SEIUSDT',
    'TIAUSDT','WLDUSDT','FETUSDT','AGIXUSDT','RENDERUSDT',
    'LDOUSDT','STXUSDT','RUNEUSDT','AAVEUSDT','CRVUSDT',
    'MKRUSDT','COMPUSDT','SNXUSDT','DYDXUSDT','GMXUSDT',
    'TRXUSDT','EOSUSDT','ETCUSDT','BCHUSDT','XMRUSDT',
    'HBARUSDT','ZILUSDT','ONTUSDT','QTUMUSDT','OCEANUSDT',
    'ANKRUSDT','SKLUSDT','AUDIOUSDT','FLOWUSDT','ROSEUSDT',
    'IMXUSDT','LRCUSDT','MASKUSDT','ENSUSDT','JASMYUSDT',
    'RVNUSDT','BALUSDT','BANDUSDT','KNCUSDT','STORJUSDT',
    'SPELLUSDT','PERPUSDT','CFXUSDT','WOOUSDT','ICXUSDT',
    'KAVAUSDT','IOTAUSDT','CELOUSDT','ALPHAUSDT','COTIUSDT',
    'REQUSDT','OGNUSDT','KLAYUSDT','MINAUSDT','RNDRUSDT',
    'LOOKSUSDT','BLURUSDT','STGUSDT','MAGICUSDT','HIGHUSDT',
    'TUSDT','GALUSDT','IDUSDT','EDUUSDT','MNTUSDT',
    'CYBERUSDT','ARKUSDT','FRONTUSDT','POWRUSDT','COMBOUSDT',
    'WAXPUSDT','RIFUSDT','POLYXUSDT','GASUSDT','VIBUSDT',
    'THETAUSDT','XECUSDT','HOTUSDT','CHZUSDT','ENJUSDT',
    'CAKEUSDT','AXLUSDT','STRKUSDT','DYMUSDT','ALTUSDT',
    'JUPUSDT','WIFUSDT','BONKUSDT','PEPEUSDT','FLOKIUSDT',
    'TRBUSDT','PORTALUSDT','MANTAUSDT','RONINUSDT','TAOUSDT',
    'NOTUSDT','EIGENUSDT','MOVEUSDT','MEUSDT','VIRTUALUSDT',
    'MOODENGUSDT','ACTUSDT','COWUSDT','PNUTUSDT','GRASSUSDT',
    'GOATUSDT','HMSTRUSDT','DOGSUSDT','TURBOUSDT','NEIROUSDT',
    'KAIAUSDT','WUSDT','BOMEUSDT','MEWUSDT','SATSUSDT',
    'ACHUSDT','1000SHIBUSDT','1000PEPEUSDT','GALAUSDT','GRTUSDT',
    'CHRUSDT','CELRUSDT','MTLUSDT','CTSIUSDT','RLCUSDT',
    'USDCUSDT','BUSDUSDT','TUSDUSDT','FDUSDUSDT','USDTUSDT'
  ];
  console.log('Statik liste: ' + allSymbols.length + ' parite');
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
  var results = [];
  for (var i = 0; i < symbols.length; i++) {
    try {
      var candles = await binance.getHistoricalCandles(symbols[i], interval, 200);
      var analysis = indicators.analyzeCandles(candles);
      var tp1Pct = analysis.atr ? parseFloat((analysis.atr.lastATR * 2 / analysis.lastClose * 100).toFixed(2)) : 0;
      var tp2Pct = analysis.atr ? parseFloat((analysis.atr.lastATR * 3 / analysis.lastClose * 100).toFixed(2)) : 0;
      var tp3Pct = analysis.atr ? parseFloat((analysis.atr.lastATR * 5 / analysis.lastClose * 100).toFixed(2)) : 0;
      var stopLossPct = analysis.atr ? parseFloat((analysis.atr.lastATR * 1.5 / analysis.lastClose * 100).toFixed(2)) : 0;
      var riskReward = stopLossPct > 0 ? parseFloat((tp1Pct / stopLossPct).toFixed(2)) : 0;
      var isHighPotential = tp3Pct >= 5;

      if (analysis.atr) {
        analysis.atr.tp1Pct = tp1Pct;
        analysis.atr.tp2Pct = tp2Pct;
        analysis.atr.tp3Pct = tp3Pct;
        analysis.atr.stopLossPct = stopLossPct;
        analysis.atr.riskReward = riskReward;
      }

      results.push({
        symbol:          symbols[i],
        lastClose:       analysis.lastClose,
        score:           analysis.score,
        overallSignal:   analysis.overallSignal,
        signals:         analysis.signals,
        atr:             analysis.atr,
        sr:              analysis.supportResistance,
        rsi:             analysis.rsi,
        trend:           analysis.trend,
        stochRSI:        analysis.stochRSI,
        isHighPotential: isHighPotential,
        scannedAt:       new Date().toISOString()
      });
    } catch (err) {
  console.log('HATA ' + symbols[i] + ': ' + err.message);
}
    await new Promise(function(r) { setTimeout(r, 150); });
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

  var results = [];
  var batchSize = 20;

  for (var i = 0; i < allSymbols.length; i += batchSize) {
    var batch = allSymbols.slice(i, i + batchSize);
    var batchResults = await scanBatch(batch, interval);
    results = results.concat(batchResults);
    console.log('Tarandi: ' + Math.min(i + batchSize, allSymbols.length) + '/' + allSymbols.length + ' — Sinyal: ' + results.length);
  }

  results.sort(function(a, b) {
    if (a.isHighPotential && !b.isHighPotential) return -1;
    if (!a.isHighPotential && b.isHighPotential) return 1;
    return Math.abs(b.score) - Math.abs(a.score);
  });

  lastSignals = results;
  isScanning = false;

  broadcast({ type: 'scan_complete', data: results, time: new Date().toISOString() });
  console.log('Tarama tamamlandi — ' + results.length + ' sinyal');
  return results;
}

async function startAutoScan(interval, intervalMs) {
  if (!interval) interval = '1h';
  if (!intervalMs) intervalMs = 300000;

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