var axios = require('axios');

var cached = null;
var cacheTime = 0;

async function getFearGreed() {
  try {
    if (cached && Date.now() - cacheTime < 3600000) return cached;
    var res = await axios.get('https://api.alternative.me/fng/?limit=1');
    var data = res.data.data[0];
    var value = parseInt(data.value);
    cached = {
      value: value,
      label: data.value_classification,
      isExtremeFear: value <= 25,
      isFear: value <= 45,
      isGreed: value >= 55,
      isExtremeGreed: value >= 75,
      signal: value <= 25 ? 'EXTREME_FEAR_BUY' : value <= 45 ? 'FEAR_BUY' : value >= 75 ? 'EXTREME_GREED_SELL' : 'NEUTRAL'
    };
    cacheTime = Date.now();
    return cached;
  } catch (err) {
    return { value: 50, isExtremeFear: false, isFear: false, isGreed: false, signal: 'NEUTRAL' };
  }
}

module.exports = { getFearGreed: getFearGreed };