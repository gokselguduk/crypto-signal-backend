var axios = require('axios');

var silverCache = null;
var silverCacheTime = 0;
var CACHE_MS = 60000;

async function getSilverSpot() {
  try {
    var res = await axios.get('https://api.metals.dev/v1/metal/spot?api_key=demo&metal=silver&currency=USD', { timeout: 5000 });
    return { price: parseFloat(res.data.price.toFixed(2)), bid: parseFloat((res.data.price * 0.9995).toFixed(2)), ask: parseFloat((res.data.price * 1.0005).toFixed(2)), source: 'metals.dev' };
  } catch(e) { return null; }
}

async function getSilverFallback() {
  try {
    var res = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/SI%3DF?interval=1m&range=1d', { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    var meta = res.data.chart.result[0].meta;
    return { price: parseFloat(meta.regularMarketPrice.toFixed(2)), bid: parseFloat((meta.regularMarketPrice * 0.9995).toFixed(2)), ask: parseFloat((meta.regularMarketPrice * 1.0005).toFixed(2)), source: 'yahoo' };
  } catch(e) { return null; }
}

async function getGoldSpot() {
  try {
    var res = await axios.get('https://api.metals.dev/v1/metal/spot?api_key=demo&metal=gold&currency=USD', { timeout: 5000 });
    return parseFloat(res.data.price.toFixed(2));
  } catch(e) { return null; }
}

function hesaplaGerceklesme(spot, gsr, yillikDegisim, athFark) {
  var puan = 0;
  var max  = 100;

  if (gsr && gsr > 85)       puan += 25;
  else if (gsr && gsr > 75)  puan += 15;
  else if (gsr && gsr > 65)  puan += 8;

  if (athFark > 40)          puan += 20;
  else if (athFark > 20)     puan += 12;
  else if (athFark > 10)     puan += 6;

  if (spot.price < 60)       puan += 20;
  else if (spot.price < 80)  puan += 12;
  else if (spot.price < 100) puan += 6;

  if (yillikDegisim > 100)   puan += 15;
  else if (yillikDegisim > 50) puan += 10;
  else if (yillikDegisim > 20) puan += 5;

  puan += 20;

  return Math.min(Math.round(puan), max);
}

function hesaplaGirisCikis(price) {
  var atr = price * 0.04;

  return {
    alisZoneDusuk:  parseFloat((price - atr * 0.5).toFixed(2)),
    alisZoneYuksek: parseFloat((price + atr * 0.3).toFixed(2)),
    stopLoss:       parseFloat((price - atr * 1.5).toFixed(2)),
    stopLossPct:    parseFloat((atr * 1.5 / price * 100).toFixed(1)),
    tp1:            parseFloat((price + atr * 2).toFixed(2)),
    tp1Pct:         parseFloat((atr * 2 / price * 100).toFixed(1)),
    tp2:            parseFloat((price + atr * 3.5).toFixed(2)),
    tp2Pct:         parseFloat((atr * 3.5 / price * 100).toFixed(1)),
    tp3:            parseFloat((price + atr * 6).toFixed(2)),
    tp3Pct:         parseFloat((atr * 6 / price * 100).toFixed(1)),
    riskReward:     parseFloat((atr * 2 / (atr * 1.5)).toFixed(2))
  };
}

async function analyzeSilver() {
  if (silverCache && Date.now() - silverCacheTime < CACHE_MS) return silverCache;

  var spot = await getSilverSpot();
  if (!spot) spot = await getSilverFallback();
  if (!spot) spot = { price: 79.66, bid: 79.62, ask: 79.70, source: 'fallback' };

  var gold            = await getGoldSpot();
  var gsr             = gold ? parseFloat((gold / spot.price).toFixed(1)) : null;
  var ath             = 121.62;
  var atl52w          = 28.16;
  var alisRef         = 29.29;
  var yillikDegisim   = parseFloat(((spot.price - alisRef) / alisRef * 100).toFixed(1));
  var athFark         = parseFloat(((ath - spot.price) / ath * 100).toFixed(1));
  var gerceklesme     = hesaplaGerceklesme(spot, gsr, yillikDegisim, athFark);
  var seviyeler       = hesaplaGirisCikis(spot.price);

  var teknikYorum = [];
  if (spot.price > 75)      teknikYorum.push('Fiyat $75 üzerinde — güçlü momentum devam ediyor');
  if (gsr && gsr > 85)      teknikYorum.push('GSR ' + gsr + ' — gümüş tarihsel olarak ucuz, alım fırsatı');
  if (athFark > 20)         teknikYorum.push('ATH\'dan %-' + athFark + ' uzakta — birikim bölgesi');
  if (yillikDegisim > 50)   teknikYorum.push('2025 başından +%' + yillikDegisim + ' getiri sağladı');
  teknikYorum.push('5 ardışık yıl arz açığı — yapısal destek güçlü');
  teknikYorum.push('Solar, EV ve AI talebi 2030\'a kadar artış trendinde');

  var signal = gerceklesme >= 70 ? 'GUCLU_AL' : gerceklesme >= 50 ? 'AL' : gerceklesme >= 35 ? 'IZLE' : 'DIKKAT';
  var oncekiSignal = silverCache ? silverCache.signal : null;
  var uyariTetiklendi = oncekiSignal && oncekiSignal !== signal && (signal === 'GUCLU_AL' || signal === 'AL');

  var sonuc = {
    spot, gold, gsr,
    ath, atl52w, yillikDegisim, athFark,
    gerceklesme,
    seviyeler,
    teknikYorum,
    signal,
    uyariTetiklendi,
    destek1:        parseFloat((spot.price * 0.92).toFixed(2)),
    destek2:        parseFloat((spot.price * 0.85).toFixed(2)),
    direnc1:        parseFloat((spot.price * 1.08).toFixed(2)),
    direnc2:        parseFloat((spot.price * 1.15).toFixed(2)),
    hedef2026:      parseFloat((spot.price * 1.33).toFixed(2)),
    hedef2027:      parseFloat((spot.price * 1.75).toFixed(2)),
    hedef2030:      parseFloat((spot.price * 2.50).toFixed(2)),
    acik2025:       95,
    kumulatifAcik:  820,
    endustriyelPay: 59,
    guncellendi:    new Date().toISOString()
  };

  silverCache     = sonuc;
  silverCacheTime = Date.now();
  return sonuc;
}

module.exports = { analyzeSilver };