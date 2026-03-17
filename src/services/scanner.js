var axios = require('axios');
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
    'JASMYUSDT','WOOUSDT','RVNUSDT','ZILUSDT','HBARUSDT'
  ];
  console.log('Toplam parite: ' + allSymbols.length);
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
      if (Math.abs(analysis.score) >= 3) {
        results.push({
          symbol:        symbols[i],
          lastClose:     analysis.lastClose,
          score:         analysis.score,
          overallSignal: analysis.overallSignal,
          signals:       analysis.signals,
          atr:           analysis.atr,
          sr:            analysis.supportResistance,
          rsi:           analysis.rsi,
          trend:         analysis.trend,
          stochRSI:      analysis.stochRSI,
          scannedAt:     new Date().toISOString()
        });
      }
    } catch (err) {
      // sessizce gec
    }
    await new Promise(function(r) { setTimeout(r, 100); });
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
    console.log('Tarandi: ' + Math.min(i + batchSize, allSymbols.length) + '/' + allSymbols.length + ' — Guclu sinyal: ' + results.length);
  }

  results.sort(function(a, b) {
    return Math.abs(b.score) - Math.abs(a.score);
  });

  lastSignals = results;
  isScanning = false;

  broadcast({ type: 'scan_complete', data: results, time: new Date().toISOString() });
  console.log('Tarama tamamlandi — ' + results.length + ' guclu sinyal bulundu');
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