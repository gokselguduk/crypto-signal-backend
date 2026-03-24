var axios = require('axios');

async function analyzeOrderBook(symbol) {
  try {
    var res = await axios.get('https://fapi.binance.com/fapi/v1/depth', {
      params: { symbol: symbol, limit: 20 },
      timeout: 4000
    });
    var bids = res.data.bids.map(function(b) { return { price: parseFloat(b[0]), qty: parseFloat(b[1]) }; });
    var asks = res.data.asks.map(function(a) { return { price: parseFloat(a[0]), qty: parseFloat(a[1]) }; });
    var totalBid = bids.reduce(function(t, b) { return t + b.qty; }, 0);
    var totalAsk = asks.reduce(function(t, a) { return t + a.qty; }, 0);
    var ratio = parseFloat((totalBid / totalAsk).toFixed(2));
    var maxBid = bids.reduce(function(max, b) { return b.qty > max.qty ? b : max; }, bids[0]);
    var maxAsk = asks.reduce(function(max, a) { return a.qty > max.qty ? a : max; }, asks[0]);
    var buyWall = maxBid.qty > totalBid * 0.3;
    var sellWall = maxAsk.qty > totalAsk * 0.3;
    return {
      bidAskRatio: ratio,
      totalBid: parseFloat(totalBid.toFixed(2)),
      totalAsk: parseFloat(totalAsk.toFixed(2)),
      buyWall: buyWall,
      sellWall: sellWall,
      buyWallPrice: buyWall ? maxBid.price : null,
      sellWallPrice: sellWall ? maxAsk.price : null,
      bullish: ratio > 1.3 && !sellWall,
      bearish: ratio < 0.7 && !buyWall,
      orderFlowScore: 0,
      cvd: null,
      liquidity: null,
      absorption: null,
      signals: []
    };
  } catch (err) {
    return { bidAskRatio: 1, buyWall: false, sellWall: false, bullish: false, bearish: false, orderFlowScore: 0, cvd: null, liquidity: null, absorption: null, signals: [] };
  }
}

module.exports = { analyzeOrderBook: analyzeOrderBook };