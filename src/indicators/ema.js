function calculateEMA(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  ema.push(sum / period);
  for (let i = period; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema.map(v => parseFloat(v.toFixed(2)));
}

function detectTrend(closes) {
  const ema20  = calculateEMA(closes, 20);
  const ema50  = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  const last20  = ema20[ema20.length - 1];
  const last50  = ema50[ema50.length - 1];
  const last200 = ema200[ema200.length - 1];
  const price   = closes[closes.length - 1];

  let trend = 'NEUTRAL';
  let strength = 0;

  if (price > last20 && last20 > last50 && last50 > last200) {
    trend = 'STRONG_UP';
    strength = 3;
  } else if (price > last20 && last20 > last50) {
    trend = 'UP';
    strength = 2;
  } else if (price > last20) {
    trend = 'WEAK_UP';
    strength = 1;
  } else if (price < last20 && last20 < last50 && last50 < last200) {
    trend = 'STRONG_DOWN';
    strength = -3;
  } else if (price < last20 && last20 < last50) {
    trend = 'DOWN';
    strength = -2;
  } else if (price < last20) {
    trend = 'WEAK_DOWN';
    strength = -1;
  }

  const goldenCross = last50 > last200 &&
    ema50[ema50.length - 2] <= ema200[ema200.length - 2];
  const deathCross = last50 < last200 &&
    ema50[ema50.length - 2] >= ema200[ema200.length - 2];

  return {
    trend,
    strength,
    ema20:  last20,
    ema50:  last50,
    ema200: last200,
    goldenCross,
    deathCross
  };
}

module.exports = { calculateEMA, detectTrend };