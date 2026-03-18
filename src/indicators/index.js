console.log('INDICATORS VERSION: 4.0 - FULL ANALYSIS');

var rsiModule     = require('./rsi');
var macdModule    = require('./macd');
var bollModule    = require('./bollinger');
var emaModule     = require('./ema');
var stochModule   = require('./stochRSI');
var atrModule     = require('./atr');
var srModule      = require('./supportResistance');
var volModule     = require('./volume');
var fibModule     = require('./fibonacci');

function analyzeCandles(candles) {
  var closes  = candles.map(function(c) { return c.close; });
  var rsi     = rsiModule.calculateRSI(closes, 14);
  var macd    = macdModule.calculateMACD(closes);
  var boll    = bollModule.calculateBollinger(closes, 20);
  var trend   = emaModule.detectTrend(closes);
  var stoch   = stochModule.calculateStochRSI(closes);
  var atr     = atrModule.calculateATR(candles);
  var sr      = srModule.findSupportResistance(candles);
  var vol     = volModule.analyzeVolume(candles);
  var fib     = fibModule.calculateFibonacci(candles);

  var lastRSI   = rsi[rsi.length - 1];
  var lastMACD  = {
    macd:      macd.macd[macd.macd.length - 1],
    signal:    macd.signal[macd.signal.length - 1],
    histogram: macd.histogram[macd.histogram.length - 1]
  };
  var lastBoll  = boll[boll.length - 1];
  var lastClose = closes[closes.length - 1];

  var signals = [];
  var score   = 0;

  if (lastRSI < 30) { signals.push({ type: 'BUY',  reason: 'RSI asiri satim: ' + lastRSI.toFixed(1) }); score += 2; }
  if (lastRSI > 70) { signals.push({ type: 'SELL', reason: 'RSI asiri alim: '  + lastRSI.toFixed(1) }); score -= 2; }
  if (stoch.lastK < 20 && stoch.lastK > stoch.prevK) { signals.push({ type: 'BUY',  reason: 'Stoch RSI dondu: ' + stoch.lastK.toFixed(1) }); score += 2; }
  if (stoch.lastK > 80 && stoch.lastK < stoch.prevK) { signals.push({ type: 'SELL', reason: 'Stoch RSI dondu: ' + stoch.lastK.toFixed(1) }); score -= 2; }
  if (lastMACD.histogram > 0 && macd.histogram[macd.histogram.length - 2] < 0) { signals.push({ type: 'BUY',  reason: 'MACD pozitife dondu' }); score += 1; }
  if (lastMACD.histogram < 0 && macd.histogram[macd.histogram.length - 2] > 0) { signals.push({ type: 'SELL', reason: 'MACD negatife dondu' }); score -= 1; }
  if (lastClose < lastBoll.lower) { signals.push({ type: 'BUY',  reason: 'BB alt bandi' }); score += 1; }
  if (lastClose > lastBoll.upper) { signals.push({ type: 'SELL', reason: 'BB ust bandi' }); score -= 1; }
  if (trend.goldenCross) { signals.push({ type: 'BUY',  reason: 'Golden Cross' }); score += 3; }
  if (trend.deathCross)  { signals.push({ type: 'SELL', reason: 'Death Cross'  }); score -= 3; }
  if (trend.strength >= 2)  { signals.push({ type: 'BUY',  reason: 'Guclu yukselis: ' + trend.trend }); score += 1; }
  if (trend.strength <= -2) { signals.push({ type: 'SELL', reason: 'Guclu dusus: '   + trend.trend }); score -= 1; }
  if (sr.nearestSupport    && sr.supportDistance    < 1) { signals.push({ type: 'BUY',  reason: 'Destek: '  + sr.nearestSupport    }); score += 1; }
  if (sr.nearestResistance && sr.resistanceDistance < 1) { signals.push({ type: 'SELL', reason: 'Direnc: '  + sr.nearestResistance }); score -= 1; }
  if (fib.atSupport)    { signals.push({ type: 'BUY',  reason: 'Fibonacci destek: ' + fib.nearestSupport    }); score += 2; }
  if (fib.atResistance) { signals.push({ type: 'SELL', reason: 'Fibonacci direnc: ' + fib.nearestResistance }); score -= 2; }
  if (vol.isHigh && score > 0) { signals.push({ type: 'BUY',  reason: 'Yuksek hacim: ' + vol.ratio + 'x' }); score += 1; }
  if (vol.isHigh && score < 0) { signals.push({ type: 'SELL', reason: 'Yuksek hacim: ' + vol.ratio + 'x' }); score -= 1; }
  if (vol.isLow && Math.abs(score) > 0) { score = Math.round(score * 0.7); }

  var overallSignal  = 'NEUTRAL';
  var signalStrength = 'NOTR';
  if      (score >= 6)  { overallSignal = 'STRONG_BUY';  signalStrength = 'COK_GUCLU_AL';  }
  else if (score >= 4)  { overallSignal = 'STRONG_BUY';  signalStrength = 'GUCLU_AL';      }
  else if (score >= 2)  { overallSignal = 'BUY';         signalStrength = 'ORTA_AL';       }
  else if (score >= 1)  { overallSignal = 'BUY';         signalStrength = 'ZAYIF_AL';      }
  else if (score <= -6) { overallSignal = 'STRONG_SELL'; signalStrength = 'COK_GUCLU_SAT'; }
  else if (score <= -4) { overallSignal = 'STRONG_SELL'; signalStrength = 'GUCLU_SAT';     }
  else if (score <= -2) { overallSignal = 'SELL';        signalStrength = 'ORTA_SAT';      }
  else if (score <= -1) { overallSignal = 'SELL';        signalStrength = 'ZAYIF_SAT';     }

  return {
    lastClose:         lastClose,
    rsi:               parseFloat(lastRSI.toFixed(2)),
    macd:              lastMACD,
    bollinger:         lastBoll,
    trend:             trend,
    stochRSI:          { k: stoch.lastK, d: stoch.lastD },
    atr:               atr,
    supportResistance: sr,
    fibonacci:         fib,
    volume:            vol,
    signals:           signals,
    score:             score,
    overallSignal:     overallSignal,
    signalStrength:    signalStrength
  };
}

module.exports = { analyzeCandles: analyzeCandles };