var axios = require('axios');

async function getWhaleActivity(symbol) {
  try {
    var res = await axios.get('https://fapi.binance.com/fapi/v1/trades', {
      params: { symbol: symbol, limit: 100 }
    });
    var trades = res.data;
    var avgSize = trades.reduce(function(t, tr) { return t + parseFloat(tr.qty); }, 0) / trades.length;
    var whaleTreshold = avgSize * 10;

    var whaleBuys = trades.filter(function(tr) { return !tr.isBuyerMaker && parseFloat(tr.qty) > whaleTreshold; });
    var whaleSells = trades.filter(function(tr) { return tr.isBuyerMaker && parseFloat(tr.qty) > whaleTreshold; });

    var whaleVolumeBuy = whaleBuys.reduce(function(t, tr) { return t + parseFloat(tr.qty); }, 0);
    var whaleVolumeSell = whaleSells.reduce(function(t, tr) { return t + parseFloat(tr.qty); }, 0);

    return {
      whaleBuyCount: whaleBuys.length,
      whaleSellCount: whaleSells.length,
      whaleVolumeBuy: parseFloat(whaleVolumeBuy.toFixed(2)),
      whaleVolumeSell: parseFloat(whaleVolumeSell.toFixed(2)),
      whaleBullish: whaleBuys.length >= 3 && whaleBuys.length > whaleSells.length * 1.5,
      whaleBearish: whaleSells.length >= 3 && whaleSells.length > whaleBuys.length * 1.5
    };
  } catch (err) {
    return { whaleBuyCount: 0, whaleSellCount: 0, whaleBullish: false, whaleBearish: false };
  }
}

module.exports = { getWhaleActivity: getWhaleActivity };