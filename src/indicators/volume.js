function analyzeVolume(candles) {
  var volumes = candles.map(function(c) { return c.volume; });
  var avg = volumes.slice(-20).reduce(function(a, b) { return a + b; }, 0) / 20;
  var lastVol = volumes[volumes.length - 1];
  var ratio = lastVol / avg;
  return {
    lastVolume: lastVol,
    avgVolume: avg,
    ratio: parseFloat(ratio.toFixed(2)),
    isHigh: ratio >= 1.5,
    isMedium: ratio >= 1.0 && ratio < 1.5,
    isLow: ratio < 1.0
  };
}

module.exports = { analyzeVolume: analyzeVolume };