function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return [];

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low  = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  const atr = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trueRanges[i];
  atr.push(sum / period);

  for (let i = period; i < trueRanges.length; i++) {
    atr.push((atr[atr.length - 1] * (period - 1) + trueRanges[i]) / period);
  }

  const lastATR  = atr[atr.length - 1];
  const lastClose = candles[candles.length - 1].close;

  return {
  atr:           atr.map(v => parseFloat(v.toFixed(2))),
  lastATR:       parseFloat(lastATR.toFixed(2)),
  stopLoss:      parseFloat((lastClose - lastATR * 1.5).toFixed(2)),
  takeProfit1:   parseFloat((lastClose + lastATR * 2).toFixed(2)),
  takeProfit2:   parseFloat((lastClose + lastATR * 3).toFixed(2)),
  takeProfit3:   parseFloat((lastClose + lastATR * 5).toFixed(2)),
  atrPercent:    parseFloat((lastATR / lastClose * 100).toFixed(2)),
  stopLossPct:   parseFloat((lastATR * 1.5 / lastClose * 100).toFixed(2)),
  tp1Pct:        parseFloat((lastATR * 2 / lastClose * 100).toFixed(2)),
  tp2Pct:        parseFloat((lastATR * 3 / lastClose * 100).toFixed(2)),
  tp3Pct:        parseFloat((lastATR * 5 / lastClose * 100).toFixed(2)),
  riskReward:    parseFloat(((lastATR * 2) / (lastATR * 1.5)).toFixed(2))
};
}

module.exports = { calculateATR };