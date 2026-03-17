function calculateEMA(closes, period) {
  const k = 2 / (period + 1);
  const ema = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { macd: [], signal: [], histogram: [] };

  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);

  const macdLine = emaFast.map((v, i) => parseFloat((v - emaSlow[i]).toFixed(2)));
  const signalLine = calculateEMA(macdLine.slice(slow - 1), signal);

  const histogram = signalLine.map((v, i) =>
    parseFloat((macdLine[slow - 1 + i] - v).toFixed(2))
  );

  return {
    macd: macdLine.slice(slow - 1),
    signal: signalLine,
    histogram
  };
}

module.exports = { calculateMACD };