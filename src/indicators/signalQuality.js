/**
 * signalQuality.js — Katman 4
 * Sinyal Kararlılık + Kalite + Dinamik Eşik + İptal Mekanizması
 *
 * Ürettiği değerler:
 *   stabilityScore  → sinyalin ne kadar kararlı olduğu (0-100)
 *   dynamicThreshold → o anki piyasa koşuluna göre min skor eşiği
 *   isStable        → true/false — sinyali gönder / gönderme
 *   qualityGrade    → 'A' | 'B' | 'C' | 'D'
 */

// ─────────────────────────────────────────────
// 1. KARIŞTIRMA SKORU
//    Birden fazla bağımsız kaynaktan onay var mı?
// ─────────────────────────────────────────────
function calcConfluenceScore(result) {
  var score = 0;
  var sources = 0;

  // Teknik analiz onayı
  if (result.score1h  > 0) { score += 2; sources++; }
  if (result.score4h  > 0) { score += 2; sources++; }
  if (result.score15m > 0) { score += 1; sources++; }
  if (result.score1d  > 0) { score += 2; sources++; }

  // Order Flow onayı
  if (result.orderFlow && result.orderFlow.score > 0) { score += 3; sources++; }

  // CVD onayı
  if (result.orderFlow && result.orderFlow.cvd && result.orderFlow.cvd.bullish) { score += 2; sources++; }

  // Whale onayı
  if (result.whale && result.whale.whaleBullish) { score += 2; sources++; }

  // Funding onayı
  if (result.funding && result.funding.isNegative) { score += 1; sources++; }

  // MTF hizalanma
  if (result.mtfDetay && result.mtfDetay.allAligned) { score += 3; sources++; }

  // Kaç kaynak onaylıyor?
  var sourceBonus = sources >= 5 ? 3 : sources >= 3 ? 1 : 0;

  return Math.min(100, score * 4 + sourceBonus * 5);
}

// ─────────────────────────────────────────────
// 2. DİNAMİK EŞİK
//    Piyasa koşuluna göre min skor değişir
//    Volatil piyasa → eşiği düşür (fırsatlar kısa sürer)
//    Sakin piyasa   → eşiği yükselt (daha seçici ol)
// ─────────────────────────────────────────────
function calcDynamicThreshold(regime, sentiment) {
  var base = 2; // Temel min skor

  if (regime === 'BREAKOUT') base = 1;      // Breakout'ta hızlı gir
  else if (regime === 'RANGE') base = 4;    // Range'de çok seçici ol
  else if (regime === 'TREND') base = 2;    // Normal

  // Ekstrem korku → fırsatçı ol, eşiği düşür
  if (sentiment && sentiment.isExtremeFear) base -= 1;

  // Ekstrem açgözlülük → riskli, eşiği yükselt
  if (sentiment && sentiment.isExtremeGreed) base += 1;

  return Math.max(1, base);
}

// ─────────────────────────────────────────────
// 3. KALİTE DERECESİ
// ─────────────────────────────────────────────
function calcQualityGrade(confluenceScore, netScore, mtfDetay) {
  var grade = 'D';

  if (confluenceScore >= 75 && netScore >= 8 && mtfDetay && mtfDetay.allAligned) {
    grade = 'A'; // Mükemmel — tüm sistemler yeşil
  } else if (confluenceScore >= 55 && netScore >= 5) {
    grade = 'B'; // İyi
  } else if (confluenceScore >= 35 && netScore >= 3) {
    grade = 'C'; // Orta
  } else {
    grade = 'D'; // Zayıf — gönderme
  }

  return grade;
}

// ─────────────────────────────────────────────
// 4. SİNYAL KARARLILIĞI
//    Risk/ödül oranı + sinyal yoğunluğu kontrolü
// ─────────────────────────────────────────────
function checkStability(result) {
  // Risk/ödül en az 1.5 olmalı
  if (result.atr && result.atr.riskReward < 1.5) {
    return { isStable: false, reason: 'DUSUK_RR' };
  }

  // Çok düşük ATR → fiyat hareket etmiyor
  if (result.atr && result.atr.lastATR / result.lastClose < 0.002) {
    return { isStable: false, reason: 'DUSUK_VOLATILITE' };
  }

  // Sinyal sayısı en az 2 olmalı
  if (!result.signals || result.signals.length < 2) {
    return { isStable: false, reason: 'YETERSIZ_SINYAL' };
  }

  return { isStable: true, reason: null };
}

// ─────────────────────────────────────────────
// 5. ANA FONKSİYON
// ─────────────────────────────────────────────
function analyzeQuality(result, regime, sentiment) {
  var confluenceScore   = calcConfluenceScore(result);
  var dynamicThreshold  = calcDynamicThreshold(regime, sentiment);
  var qualityGrade      = calcQualityGrade(confluenceScore, result.score, result.mtfDetay);
  var stability         = checkStability(result);

  // D kalitesi veya kararsız sinyal → gönderme
  var shouldSend = (
    qualityGrade !== 'D' &&
    stability.isStable &&
    result.score >= dynamicThreshold
  );

  return {
    confluenceScore:  confluenceScore,
    dynamicThreshold: dynamicThreshold,
    qualityGrade:     qualityGrade,
    isStable:         stability.isStable,
    stabilityReason:  stability.reason,
    shouldSend:       shouldSend
  };
}

module.exports = { analyzeQuality: analyzeQuality };