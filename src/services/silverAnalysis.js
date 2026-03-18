var axios = require('axios');

var silverCache = null;
var silverCacheTime = 0;
var CACHE_MS = 60000;

async function getSilverSpot() {
  try {
    var res = await axios.get('https://api.metals.dev/v1/metal/spot?api_key=demo&metal=silver&currency=USD', { timeout: 5000 });
    return {
      price:  parseFloat(res.data.price.toFixed(2)),
      bid:    parseFloat((res.data.price * 0.9995).toFixed(2)),
      ask:    parseFloat((res.data.price * 1.0005).toFixed(2)),
      source: 'metals.dev'
    };
  } catch(e) {
    return null;
  }
}

async function getSilverFallback() {
  try {
    var res = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/SI%3DF?interval=1m&range=1d', {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    var meta = res.data.chart.result[0].meta;
    return {
      price:  parseFloat(meta.regularMarketPrice.toFixed(2)),
      bid:    parseFloat((meta.regularMarketPrice * 0.9995).toFixed(2)),
      ask:    parseFloat((meta.regularMarketPrice * 1.0005).toFixed(2)),
      source: 'yahoo'
    };
  } catch(e) {
    return null;
  }
}

async function getGoldSpot() {
  try {
    var res = await axios.get('https://api.metals.dev/v1/metal/spot?api_key=demo&metal=gold&currency=USD', { timeout: 5000 });
    return parseFloat(res.data.price.toFixed(2));
  } catch(e) { return null; }
}

async function analyzeSilver() {
  if (silverCache && Date.now() - silverCacheTime < CACHE_MS) return silverCache;

  var spot = await getSilverSpot();
  if (!spot) spot = await getSilverFallback();
  if (!spot) {
    spot = { price: 79.66, bid: 79.62, ask: 79.70, source: 'fallback' };
  }

  var gold = await getGoldSpot();
  var gsr  = gold ? parseFloat((gold / spot.price).toFixed(1)) : null;

  var ath      = 121.62;
  var atl52w   = 28.16;
  var alisRef  = 29.29;
  var yillikDegisim = parseFloat(((spot.price - alisRef) / alisRef * 100).toFixed(1));
  var athFark  = parseFloat(((ath - spot.price) / ath * 100).toFixed(1));

  var teknikPuan = 0;
  var teknikYorum = [];

  if (spot.price > 75)  { teknikPuan += 2; teknikYorum.push('Fiyat $75 üzerinde — güçlü momentum'); }
  if (spot.price > 50)  { teknikPuan += 1; teknikYorum.push('$50 psikolojik direnci geçildi'); }
  if (gsr && gsr > 75)  { teknikPuan += 2; teknikYorum.push('Altın/Gümüş oranı ' + gsr + ' — gümüş hâlâ ucuz'); }
  if (gsr && gsr > 85)  { teknikPuan += 1; teknikYorum.push('GSR tarihsel ortalamanın (%60-70) çok üzerinde'); }
  if (athFark > 20)     { teknikPuan += 1; teknikYorum.push('ATH\'dan %-' + athFark + ' uzakta — alım bölgesi'); }
  if (yillikDegisim > 50) { teknikYorum.push('Yıllık +%' + yillikDegisim + ' getiri sağladı'); }

  var destek1 = parseFloat((spot.price * 0.92).toFixed(2));
  var destek2 = parseFloat((spot.price * 0.85).toFixed(2));
  var direnc1 = parseFloat((spot.price * 1.08).toFixed(2));
  var direnc2 = parseFloat((spot.price * 1.15).toFixed(2));
  var hedef2026  = parseFloat((spot.price * 1.33).toFixed(2));
  var hedef2027  = parseFloat((spot.price * 1.75).toFixed(2));
  var hedef2030  = parseFloat((spot.price * 2.50).toFixed(2));

  var sonuc = {
    spot:            spot,
    gold:            gold,
    gsr:             gsr,
    ath:             ath,
    atl52w:          atl52w,
    yillikDegisim:   yillikDegisim,
    athFark:         athFark,
    teknikPuan:      teknikPuan,
    teknikYorum:     teknikYorum,
    destek1:         destek1,
    destek2:         destek2,
    direnc1:         direnc1,
    direnc2:         direnc2,
    hedef2026:       hedef2026,
    hedef2027:       hedef2027,
    hedef2030:       hedef2030,
    acik2025:        95,
    kumulatifAcik:   820,
    endustriyelPay:  59,
    signal:          teknikPuan >= 4 ? 'GUCLU_AL' : teknikPuan >= 2 ? 'AL' : 'IZLE',
    guncellendi:     new Date().toISOString()
  };

  silverCache     = sonuc;
  silverCacheTime = Date.now();
  return sonuc;
}

module.exports = { analyzeSilver: analyzeSilver };