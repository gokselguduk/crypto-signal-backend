function calculateFibonacci(candles) {
  var slice = candles.slice(-50);
  var highs = slice.map(function(c) { return c.high; });
  var lows = slice.map(function(c) { return c.low; });
  var high = Math.max.apply(null, highs);
  var low = Math.min.apply(null, lows);
  var diff = high - low;
  var lastClose = candles[candles.length - 1].close;

  var levels = {
    fib0:    parseFloat(high.toFixed(4)),
    fib236:  parseFloat((high - diff * 0.236).toFixed(4)),
    fib382:  parseFloat((high - diff * 0.382).toFixed(4)),
    fib500:  parseFloat((high - diff * 0.500).toFixed(4)),
    fib618:  parseFloat((high - diff * 0.618).toFixed(4)),
    fib786:  parseFloat((high - diff * 0.786).toFixed(4)),
    fib100:  parseFloat(low.toFixed(4))
  };

  var nearestSupport = null;
  var nearestResistance = null;
  var minSupportDist = Infinity;
  var minResistDist = Infinity;

  Object.values(levels).forEach(function(lvl) {
    var dist = ((lvl - lastClose) / lastClose) * 100;
    if (dist < 0 && Math.abs(dist) < minSupportDist) {
      minSupportDist = Math.abs(dist);
      nearestSupport = lvl;
    }
    if (dist > 0 && dist < minResistDist) {
      minResistDist = dist;
      nearestResistance = lvl;
    }
  });

  var atSupport = nearestSupport && minSupportDist < 1.5;
  var atResistance = nearestResistance && minResistDist < 1.5;

  return {
    levels: levels,
    nearestSupport: nearestSupport,
    nearestResistance: nearestResistance,
    supportDistance: parseFloat(minSupportDist.toFixed(2)),
    resistanceDistance: parseFloat(minResistDist.toFixed(2)),
    atSupport: atSupport,
    atResistance: atResistance
  };
}

module.exports = { calculateFibonacci: calculateFibonacci };