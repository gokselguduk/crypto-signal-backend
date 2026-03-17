var rsiModule = require('../indicators/rsi');
var macdModule = require('../indicators/macd');
var bollModule = require('../indicators/bollinger');

function runBacktest(candles, config) {
  if (!config) config = {};
  var rsiOversold = config.rsiOversold || 30;
  var rsiOverbought = config.rsiOverbought || 70;
  var initialCapital = config.initialCapital || 1000;
  var stopLossPercent = config.stopLossPercent || 2;
  var takeProfitPercent = config.takeProfitPercent || 4;

  var closes = candles.map(function(c) { return c.close; });
  var rsi = rsiModule.calculateRSI(closes, 14);
  var macd = macdModule.calculateMACD(closes);
  var bollinger = bollModule.calculateBollinger(closes, 20);
  var offset = closes.length - rsi.length;

  var trades = [];
  var position = null;
  var capital = initialCapital;

  for (var i = 1; i < rsi.length; i++) {
    var price = closes[i + offset];
    var prevPrice = closes[i + offset - 1];
    var currRSI = rsi[i];
    var prevRSI = rsi[i - 1];
    var hist = macd.histogram[i] !== undefined ? macd.histogram[i] : 0;
    var prevHist = macd.histogram[i - 1] !== undefined ? macd.histogram[i - 1] : 0;
    var boll = bollinger[i] !== undefined ? bollinger[i] : null;

    if (position) {
      var pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;
      var shouldStop = pnlPercent <= -stopLossPercent;
      var shouldTP = pnlPercent >= takeProfitPercent;
      var sellSignal = currRSI > rsiOverbought || (hist < 0 && prevHist >= 0);

      if (shouldStop || shouldTP || sellSignal) {
        var pnl = (price - position.entryPrice) / position.entryPrice * capital;
        capital += pnl;
        trades.push({
          type: 'SELL',
          entryPrice: position.entryPrice,
          exitPrice: price,
          pnlPercent: parseFloat(pnlPercent.toFixed(2)),
          pnl: parseFloat(pnl.toFixed(2)),
          reason: shouldStop ? 'Stop-loss' : shouldTP ? 'Take-profit' : 'Sell sinyali',
          entryIndex: position.entryIndex,
          exitIndex: i + offset
        });
        position = null;
      }
    }

    if (!position) {
      var rsiBuy = currRSI < rsiOversold && prevRSI >= rsiOversold;
      var macdBuy = hist > 0 && prevHist <= 0;
      var bollBuy = boll && price < boll.lower;

      if (rsiBuy || macdBuy || bollBuy) {
        position = {
          entryPrice: price,
          entryIndex: i + offset,
          reason: rsiBuy ? 'RSI oversold' : macdBuy ? 'MACD crossover' : 'Bollinger alt bant'
        };
        trades.push({
          type: 'BUY',
          price: price,
          reason: position.reason,
          index: i + offset
        });
      }
    }
  }

  var closedTrades = trades.filter(function(t) { return t.type === 'SELL'; });
  var wins = closedTrades.filter(function(t) { return t.pnlPercent > 0; });
  var losses = closedTrades.filter(function(t) { return t.pnlPercent <= 0; });
  var totalPnl = closedTrades.reduce(function(sum, t) { return sum + t.pnl; }, 0);
  var winRate = closedTrades.length > 0
    ? ((wins.length / closedTrades.length) * 100).toFixed(1)
    : 0;

  return {
    summary: {
      initialCapital: initialCapital,
      finalCapital: parseFloat(capital.toFixed(2)),
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      totalPnlPercent: parseFloat(((capital - initialCapital) / initialCapital * 100).toFixed(2)),
      totalTrades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: parseFloat(winRate),
      stopLossPercent: stopLossPercent,
      takeProfitPercent: takeProfitPercent
    },
    trades: trades
  };
}

module.exports = { runBacktest: runBacktest };
