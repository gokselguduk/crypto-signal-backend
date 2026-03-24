
/**
 * smartMoney.js — Katman 5
 * Smart Money Takibi
 * Funding + OI Korelasyonu · Dark Pool İzi · Kısa Sıkışma Tespiti
 */

var axios = require('axios');

// ─────────────────────────────────────────────
// 1. OPEN INTEREST DEĞİŞİMİ
//    OI artıyor + fiyat artıyor → gerçek alım
//    OI artıyor + fiyat düşüyor → short baskısı
//    OI azalıyor + fiyat artıyor → short sıkışması
// ─────────────────────────────────────────────
async function getOIChange(symbol) {
  try {
    var res = await axios.get('https://fapi.binance.com/fapi/v1/openInterestHist', {
      params: { symbol: symbol, period: '1h', limit: 6 },
      timeout: 4000
    });

    var data = res.data;
    if (!data || data.length < 2) return { oiChange: 0, oiTrend: 'NEUTRAL' };

    var oldest = parseFloat(data[0].sumOpenInterest);
    var newest = parseFloat(data[data.length - 1].sumOpenInterest);
    var oiChange = oldest > 0 ? ((newest - oldest) / oldest * 100) : 0;

    var oiTrend = 'NEUTRAL';
    if      (oiChange >  3) oiTrend = 'RISING';
    else if (oiChange < -3) oiTrend = 'FALLING';

    return {
      oiChange:  parseFloat(oiChange.toFixed(2)),
      oiTrend:   oiTrend,
      oiCurrent: parseFloat(newest.toFixed(2))
    };
  } catch (err) {
    return { oiChange: 0, oiTrend: 'NEUTRAL', oiCurrent: 0 };
  }
}

// ─────────────────────────────────────────────
// 2. KISA SIKIŞMASI TESPİTİ
//    Funding negatif + OI artıyor + fiyat yükseliyor
//    → Shortlar sıkışıyor, zorla kapanma yaklaşıyor
// ─────────────────────────────────────────────
function detectShortSqueeze(funding, oiData, priceChange) {
  var isShortSqueeze = false;
  var squeezeScore   = 0;

  // Funding negatif → piyasada çok short var
  if (funding && funding.isNegative) squeezeScore += 2;
  if (funding && funding.isVeryNegative) squeezeScore += 2;

  // OI artıyor → yeni pozisyonlar açılıyor
  if (oiData.oiTrend === 'RISING') squeezeScore += 2;

  // Fiyat yukarı gidiyor → shortlar baskı altında
  if (priceChange > 1) squeezeScore += 1;
  if (priceChange > 3) squeezeScore += 2;

  isShortSqueeze = squeezeScore >= 5;

  return {
    isShortSqueeze: isShortSqueeze,
    squeezeScore:   squeezeScore
  };
}

// ─────────────────────────────────────────────
// 3. DARK POOL İZİ
//    Spot/Futures hacim ayrışması
//    Futures hacmi spot'tan çok fazla artıyorsa
//    → Kurumsal pozisyon açılımı
// ─────────────────────────────────────────────
async function detectInstitutionalFlow(symbol) {
  try {
    // Futures 24h ticker
    var futRes = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', {
      params: { symbol: symbol },
      timeout: 4000
    });

    var futureVol = parseFloat(futRes.data.quoteVolume);
    var priceChange = parseFloat(futRes.data.priceChangePercent);

    // Hacim spike var mı? Son 1h OI ile karşılaştır
    var isInstitutional = futureVol > 500000000; // 500M USDT üzeri → kurumsal ilgi

    return {
      futureVolume:    parseFloat(futureVol.toFixed(0)),
      priceChange24h:  priceChange,
      isInstitutional: isInstitutional
    };
  } catch (err) {
    return { futureVolume: 0, priceChange24h: 0, isInstitutional: false };
  }
}

// ─────────────────────────────────────────────
// 4. LONG/SHORT ORANI
//    Büyük hesaplar ne tarafta?
// ─────────────────────────────────────────────
async function getLongShortRatio(symbol) {
  try {
    var res = await axios.get('https://fapi.binance.com/fapi/v1/globalLongShortAccountRatio', {
      params: { symbol: symbol, period: '1h', limit: 3 },
      timeout: 4000
    });

    if (!res.data || res.data.length === 0) {
      return { ratio: 1, topTraderRatio: 1, sentiment: 'NEUTRAL' };
    }

    var latest = res.data[res.data.length - 1];
    var ratio  = parseFloat(latest.longShortRatio);

    var sentiment = 'NEUTRAL';
    if      (ratio > 1.5) sentiment = 'CROWDED_LONG';   // Herkes long → tersine dön
    else if (ratio < 0.7) sentiment = 'CROWDED_SHORT';  // Herkes short → sıkışma yakın
    else                  sentiment = 'BALANCED';

    return { ratio: parseFloat(ratio.toFixed(2)), sentiment: sentiment };
  } catch (err) {
    return { ratio: 1, sentiment: 'NEUTRAL' };
  }
}

// ─────────────────────────────────────────────
// 5. SMART MONEY SKORU
// ─────────────────────────────────────────────
function calcSmartMoneyScore(oiData, squeeze, institutional, lsRatio, funding) {
  var score = 0;

  // Kısa sıkışması → güçlü AL sinyali
  if (squeeze.isShortSqueeze) score += 3;

  // OI + fiyat aynı yönde → trend onayı
  if (oiData.oiTrend === 'RISING') score += 1;

  // Herkes short → contrarian AL
  if (lsRatio.sentiment === 'CROWDED_SHORT') score += 2;

  // Herkes long → dikkat et
  if (lsRatio.sentiment === 'CROWDED_LONG') score -= 2;

  // Kurumsal ilgi
  if (institutional.isInstitutional) score += 1;

  // Fiyat yükseliyor
  if (institutional.priceChange24h > 5) score += 1;

  return Math.max(-4, Math.min(4, score));
}

// ─────────────────────────────────────────────
// 6. ANA FONKSİYON
// ─────────────────────────────────────────────
async function analyzeSmartMoney(symbol, funding, priceChange) {
  try {
    var [oiData, institutional, lsRatio] = await Promise.all([
      getOIChange(symbol),
      detectInstitutionalFlow(symbol),
      getLongShortRatio(symbol)
    ]);

    var squeeze        = detectShortSqueeze(funding, oiData, priceChange || 0);
    var smartMoneyScore = calcSmartMoneyScore(oiData, squeeze, institutional, lsRatio, funding);

    return {
      oiChange:        oiData.oiChange,
      oiTrend:         oiData.oiTrend,
      isShortSqueeze:  squeeze.isShortSqueeze,
      squeezeScore:    squeeze.squeezeScore,
      isInstitutional: institutional.isInstitutional,
      futureVolume:    institutional.futureVolume,
      lsRatio:         lsRatio.ratio,
      lsSentiment:     lsRatio.sentiment,
      smartMoneyScore: smartMoneyScore
    };
  } catch (err) {
    return {
      oiChange: 0, oiTrend: 'NEUTRAL',
      isShortSqueeze: false, squeezeScore: 0,
      isInstitutional: false, futureVolume: 0,
      lsRatio: 1, lsSentiment: 'NEUTRAL',
      smartMoneyScore: 0
    };
  }
}

module.exports = { analyzeSmartMoney: analyzeSmartMoney };