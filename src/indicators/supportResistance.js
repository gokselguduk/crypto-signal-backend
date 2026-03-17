function findSupportResistance(candles, lookback = 10) {
  const supports   = [];
  const resistances = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const slice = candles.slice(i - lookback, i + lookback + 1);
    const lows   = slice.map(c => c.low);
    const highs  = slice.map(c => c.high);
    const minLow  = Math.min(...lows);
    const maxHigh = Math.max(...highs);

    if (candles[i].low === minLow) {
      supports.push(parseFloat(candles[i].low.toFixed(2)));
    }
    if (candles[i].high === maxHigh) {
      resistances.push(parseFloat(candles[i].high.toFixed(2)));
    }
  }

  const price = candles[candles.length - 1].close;

  const nearSupports = supports
    .filter(s => s < price)
    .sort((a, b) => b - a)
    .slice(0, 3);

  const nearResistances = resistances
    .filter(r => r > price)
    .sort((a, b) => a - b)
    .slice(0, 3);

  const nearestSupport    = nearSupports[0] || null;
  const nearestResistance = nearResistances[0] || null;

  const supportDistance = nearestSupport
    ? parseFloat(((price - nearestSupport) / price * 100).toFixed(2))
    : null;

  const resistanceDistance = nearestResistance
    ? parseFloat(((nearestResistance - price) / price * 100).toFixed(2))
    : null;

  return {
    supports:            nearSupports,
    resistances:         nearResistances,
    nearestSupport,
    nearestResistance,
    supportDistance,
    resistanceDistance
  };
}

module.exports = { findSupportResistance };