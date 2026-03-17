const { calculateRSI } = require('./rsi');

function calculateStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
  const rsi = calculateRSI(closes, rsiPeriod);
  if (rsi.length < stochPeriod) return { k: [], d: [] };

  const stoch = [];
  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    const slice = rsi.slice(i - stochPeriod + 1, i + 1);
    const minRSI = Math.min(...slice);
    const maxRSI = Math.max(...slice);
    const range = maxRSI - minRSI;
    stoch.push(range === 0 ? 0 : parseFloat(((rsi[i] - minRSI) / range * 100).toFixed(2)));
  }

  function sma(arr, period) {
    const result = [];
    for (let i = period - 1; i < arr.length; i++) {
      const slice = arr.slice(i - period + 1, i + 1);
      result.push(parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(2)));
    }
    return result;
  }

  const k = sma(stoch, kPeriod);
  const d = sma(k, dPeriod);

  return {
    k,
    d,
    lastK: k[k.length - 1],
    lastD: d[d.length - 1],
    prevK: k[k.length - 2],
    prevD: d[d.length - 2]
  };
}

module.exports = { calculateStochRSI };