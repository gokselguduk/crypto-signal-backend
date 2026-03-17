function calculateBollinger(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return [];

  const results = [];

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    results.push({
      middle: parseFloat(mean.toFixed(2)),
      upper:  parseFloat((mean + multiplier * stdDev).toFixed(2)),
      lower:  parseFloat((mean - multiplier * stdDev).toFixed(2)),
      bandwidth: parseFloat(((multiplier * 2 * stdDev) / mean * 100).toFixed(2))
    });
  }

  return results;
}

module.exports = { calculateBollinger };