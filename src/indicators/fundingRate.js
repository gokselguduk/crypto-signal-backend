var axios = require('axios');

async function getFundingRate(symbol) {
  try {
    var res = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', {
      params: { symbol: symbol }
    });
    var rate = parseFloat(res.data.lastFundingRate);
    var ratePct = parseFloat((rate * 100).toFixed(4));
    return {
      fundingRate: ratePct,
      isNegative: rate < 0,
      isVeryNegative: rate < -0.001,
      isPositive: rate > 0,
      isVeryPositive: rate > 0.001,
      signal: rate < -0.001 ? 'LONG_SQUEEZE' : rate < 0 ? 'SLIGHT_LONG' : rate > 0.001 ? 'SHORT_SQUEEZE' : 'NEUTRAL'
    };
  } catch (err) {
    return { fundingRate: 0, isNegative: false, isVeryNegative: false, isPositive: false, isVeryPositive: false, signal: 'UNKNOWN' };
  }
}

module.exports = { getFundingRate: getFundingRate };