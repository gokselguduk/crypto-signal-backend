var rsiModule = require('./rsi');
var macdModule = require('./macd');
var bollModule = require('./bollinger');
var emaModule = require('./ema');
var stochModule = require('./stochRSI');
var atrModule = require('./atr');
var srModule = require('./supportResistance');

function analyzeCandles(candles) {
  var closes = candles.map(function(c) { return c.close; });
  var rsi = rsiModule.calculateRSI(closes, 14);
  var macd = macdModule.calculateMACD(closes);
  var bollinger = bollModule.calculateBollinger(closes, 20);
  var trend = emaModule.detectTrend(closes);
  var stochRSI = stochModule.calculateStochRSI(closes);
  var atr = atrModule.calculateATR(candles);
  var sr = srModule.findSupportResistance(candles);
  var lastRSI = rsi[rsi.length - 1];
  var lastMACD = {
    macd: macd.macd[macd.macd.length - 1],
    signal: macd.signal[macd.signal.length - 1],
    histogram: macd.histogram[macd.histogram.length - 1]
  };
  var lastBoll = bollinger[bollinger.length - 1];
  var lastClose = closes[closes.length - 1];
  var signals = [];
  var score = 0;
  if (lastRSI < 30) { signals.push({ type: 'BUY', reason: 'RSI asiri satim: ' + lastRSI }); score += 2; }
  if (lastRSI > 70) { signals.push({ type: 'SELL', reason: 'RSI asiri alim: ' + lastRSI }); score -= 2; }
  if (stochRSI.lastK < 20 && stochRSI.lastK > stochRSI.prevK) { signals.push({ type: 'BUY', reason: 'Stoch RSI dondu: ' + stochRSI.lastK }); score += 2; }
  if (stochRSI.lastK > 80 && stochRSI.lastK < stochRSI.prevK) { signals.push({ type: 'SELL', reason: 'Stoch RSI dondu: ' + stochRSI.lastK }); score -= 2; }
  if (lastMACD.histogram > 0 && macd.histogram[macd.histogram.length - 2] < 0) { signals.push({ type: 'BUY', reason: 'MACD pozitife dondu' }); score += 1; }
  if (lastMACD.histogram < 0 && macd.histogram[macd.histogram.length - 2] > 0) { signals.push({ type: 'SELL', reason: 'MACD negatife dondu' }); score -= 1; }
  if (lastClose < lastBoll.lower) { signals.push({ type: 'BUY', reason: 'BB alt bandi' }); score += 1; }
  if (lastClose > lastBoll.upper) { signals.push({ type: 'SELL', reason: 'BB ust bandi' }); score -= 1; }
  if (trend.goldenCross) { signals.push({ type: 'BUY', reason: 'Golden Cross' }); score += 3; }
  if (trend.deathCross) { signals.push({ type: 'SELL', reason: 'Death Cross' }); score -= 3; }
  if (trend.strength >= 2) { signals.push({ type: 'BUY', reason: 'Guclu yukselis: ' + trend.trend }); score += 1; }
  if (trend.strength <= -2) { signals.push({ type: 'SELL', reason: 'Guclu dusus: ' + trend.trend }); score -= 1; }
  if (sr.nearestSupport && sr.supportDistance < 1) { signals.push({ type: 'BUY', reason: 'Destek: ' + sr.nearestSupport }); score += 1; }
  if (sr.nearestResistance && sr.resistanceDistance < 1) { signals.push({ type: 'SELL', reason: 'Direnc: ' + sr.nearestResistance }); score -= 1; }
  var overallSignal = 'NEUTRAL';
  if (score >= 3) overallSignal = 'STRONG_BUY';
  else if (score >= 1) overallSignal = 'BUY';
  else if (score <= -3) overallSignal = 'STRONG_SELL';
  else if (score <= -1) overallSignal = 'SELL';
  return {
    lastClose: lastClose,
    rsi: lastRSI,
    macd: lastMACD,
    bollinger: lastBoll,
    trend: trend,
    stochRSI: { k: stochRSI.lastK, d: stochRSI.lastD },
    atr: atr,
    supportResistance: sr,
    signals: signals,
    score: score,
    overallSignal: overallSignal
  };
}

module.exports = { analyzeCandles: analyzeCandles };