/**
 * marketRegime.js — Katman 3
 * Piyasa Rejimi Tespiti + Manipülasyon + Wash Trade Dedektörü
 *
 * Ürettiği değerler:
 *   regime        → 'TREND' | 'RANGE' | 'BREAKOUT' | 'UNKNOWN'
 *   isManipulated → true/false (yeni coin + anormal pump)
 *   isWashTrade   → true/false (yapay hacim)
 *   regimeScore   → scanner netScore'una eklenir (-3 ile +3)
 *   blocked       → true ise bu coin için sinyal üretme
 */

var axios = require('axios');

// ─────────────────────────────────────────────
// 1. PİYASA REJİMİ TESPİTİ
//    ADX + Bollinger genişliği ile trend/range/patlama
// ─────────────────────────────────────────────
function detectRegime(candles) {
  if (!candles || candles.length < 30) {
    return { regime: 'UNKNOWN', adx: 0, bbWidth: 0 };
  }

  var closes = candles.map(function(c) { return c.close; });
  var highs  = candles.map(function(c) { return c.high; });
  var lows   = candles.map(function(c) { return c.low; });

  // ── ADX Hesapla (basit 14 periyot) ────────────────────
  var period = 14;
  var trList = [], plusDM = [], minusDM = [];

  for (var i = 1; i < candles.length; i++) {
    var tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i]  - closes[i-1])
    );
    trList.push(tr);

    var upMove   = highs[i]  - highs[i-1];
    var downMove = lows[i-1] - lows[i];
    plusDM.push(upMove   > downMove && upMove   > 0 ? upMove   : 0);
    minusDM.push(downMove > upMove  && downMove > 0 ? downMove : 0);
  }

  // Wilder smoothing
  function wilderSmooth(arr, p) {
    var sum = arr.slice(0, p).reduce(function(a,b){return a+b;}, 0);
    var result = [sum];
    for (var i = p; i < arr.length; i++) {
      sum = sum - (sum / p) + arr[i];
      result.push(sum);
    }
    return result;
  }

  var smoothTR    = wilderSmooth(trList,  period);
  var smoothPlus  = wilderSmooth(plusDM,  period);
  var smoothMinus = wilderSmooth(minusDM, period);

  var dxList = [];
  for (var j = 0; j < smoothTR.length; j++) {
    if (smoothTR[j] === 0) continue;
    var plusDI  = (smoothPlus[j]  / smoothTR[j]) * 100;
    var minusDI = (smoothMinus[j] / smoothTR[j]) * 100;
    var diSum   = plusDI + minusDI;
    if (diSum === 0) continue;
    dxList.push(Math.abs(plusDI - minusDI) / diSum * 100);
  }

  var adx = dxList.length >= period
    ? dxList.slice(-period).reduce(function(a,b){return a+b;},0) / period
    : 0;

  // ── Bollinger Band Genişliği ────────────────────────────
  var bbPeriod = 20;
  var recentCloses = closes.slice(-bbPeriod);
  var bbMid  = recentCloses.reduce(function(a,b){return a+b;},0) / bbPeriod;
  var bbStd  = Math.sqrt(recentCloses.map(function(c){return Math.pow(c-bbMid,2);})
               .reduce(function(a,b){return a+b;},0) / bbPeriod);
  var bbWidth = bbMid > 0 ? (bbStd * 2) / bbMid : 0;

  // ── Rejim Kararı ───────────────────────────────────────
  var regime = 'UNKNOWN';
  if      (adx > 30 && bbWidth > 0.04)  regime = 'BREAKOUT'; // Güçlü trend + geniş BB
  else if (adx > 20)                     regime = 'TREND';    // Trend var
  else if (adx < 20 && bbWidth < 0.03)  regime = 'RANGE';    // Yatay piyasa
  else                                   regime = 'TREND';    // Varsayılan

  return {
    regime:  regime,
    adx:     parseFloat(adx.toFixed(2)),
    bbWidth: parseFloat(bbWidth.toFixed(4))
  };
}

// ─────────────────────────────────────────────
// 2. MANİPÜLASYON DEDEKTÖRÜ
//    Yeni coin + anormal fiyat hareketi → engelle
// ─────────────────────────────────────────────
async function detectManipulation(symbol) {
  try {
    var axios = require('axios');

    // Son 7 günlük günlük mumları çek
    var res = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
      params: { symbol: symbol, interval: '1d', limit: 90 },
      timeout: 4000
    });

    var klines = res.data;
    if (!klines || klines.length < 7) {
      return { isManipulated: false, reason: null, listingAgeDays: 999 };
    }

    var listingAgeDays = klines.length; // kaç günlük veri var = listelenme yaşı

    // ── Yeni Coin Filtresi ─────────────────────────────────
    if (listingAgeDays < 30) {
      return { isManipulated: true, reason: 'YENI_COIN', listingAgeDays: listingAgeDays };
    }

    // ── Anormal Pump Tespiti ───────────────────────────────
    // Son 3 günde %40'tan fazla yükseliş → manipülasyon şüphesi
    var last3 = klines.slice(-3);
    var open3  = parseFloat(last3[0][1]);
    var close3 = parseFloat(last3[last3.length-1][4]);
    var pumpPct = open3 > 0 ? ((close3 - open3) / open3 * 100) : 0;

    if (pumpPct > 40) {
      return { isManipulated: true, reason: 'ANORMAL_PUMP', pumpPct: pumpPct.toFixed(1), listingAgeDays: listingAgeDays };
    }

    // ── Anormal Dump Tespiti ───────────────────────────────
    if (pumpPct < -40) {
      return { isManipulated: true, reason: 'ANORMAL_DUMP', pumpPct: pumpPct.toFixed(1), listingAgeDays: listingAgeDays };
    }

    return { isManipulated: false, reason: null, listingAgeDays: listingAgeDays };

  } catch (err) {
    return { isManipulated: false, reason: null, listingAgeDays: 999 };
  }
}

// ─────────────────────────────────────────────
// 3. WASH TRADE TESPİTİ
//    Yüksek hacim ama CVD ~0 → yapay hacim
// ─────────────────────────────────────────────
function detectWashTrade(orderBook, volume) {
  if (!orderBook || !orderBook.cvd || !volume) {
    return { isWashTrade: false };
  }

  var deltaRatio = Math.abs(orderBook.cvd.deltaRatio || 0);
  var isHighVol  = volume.isHigh;

  // Yüksek hacim var ama delta neredeyse sıfır → alış=satış → wash trade
  var isWashTrade = isHighVol && deltaRatio < 0.02;

  return {
    isWashTrade: isWashTrade,
    deltaRatio:  deltaRatio
  };
}

// ─────────────────────────────────────────────
// 4. REJİM SKORU HESAPLA
//    Doğru modda doğru strateji → skor boost
//    Yanlış modda → skor ceza
// ─────────────────────────────────────────────
function calcRegimeScore(regime, dir1h) {
  var regimeScore = 0;

  if (regime === 'BREAKOUT') {
    // Breakout + aynı yönde sinyal → çok güçlü
    if (dir1h !== 0) regimeScore = 3;
  } else if (regime === 'TREND') {
    // Trend + sinyal → normal
    regimeScore = 1;
  } else if (regime === 'RANGE') {
    // Range piyasasında trend sinyali → güvenilmez
    regimeScore = -1;
  }

  return regimeScore;
}

// ─────────────────────────────────────────────
// 5. ANA FONKSİYON — scanner.js'in çağırdığı yer
// ─────────────────────────────────────────────
async function analyzeRegime(symbol, candles1h, orderBook, volume, dir1h) {
  try {
    var regimeData     = detectRegime(candles1h);
    var manipulation   = await detectManipulation(symbol);
    var washTrade      = detectWashTrade(orderBook, volume);

    var regimeScore    = calcRegimeScore(regimeData.regime, dir1h);

    // Engelleme kararı
    var blocked = manipulation.isManipulated || washTrade.isWashTrade;
    var blockReason = null;
    if (manipulation.isManipulated) blockReason = manipulation.reason;
    if (washTrade.isWashTrade)      blockReason = 'WASH_TRADE';

    return {
      regime:          regimeData.regime,
      adx:             regimeData.adx,
      bbWidth:         regimeData.bbWidth,
      manipulation:    manipulation,
      washTrade:       washTrade,
      regimeScore:     regimeScore,
      blocked:         blocked,
      blockReason:     blockReason
    };

  } catch (err) {
    return {
      regime: 'UNKNOWN', adx: 0, bbWidth: 0,
      manipulation: { isManipulated: false },
      washTrade:    { isWashTrade: false },
      regimeScore:  0,
      blocked:      false,
      blockReason:  null
    };
  }
}

module.exports = { analyzeRegime: analyzeRegime };