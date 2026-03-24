/**
 * marketPsychology.js — Katman 6
 * Piyasa Psikolojisi + Döngü Motoru + Stop Avı + Sessizlik Dedektörü
 * Kimsenin kullanmadığı katman — hareketin psikolojik kökenini okur
 */

// ─────────────────────────────────────────────
// 1. PANİK / HIRSIZLIK DÖNGÜSÜ
//    Fear&Greed + CVD + Funding üçlüsünden
//    piyasanın duygusal durumunu hesapla
// ─────────────────────────────────────────────
function detectEmotionalState(sentiment, cvd, funding) {
  var state = 'NEUTRAL';
  var emotionScore = 0;

  // Fear & Greed
  var fearGreedValue = sentiment ? (sentiment.value || 50) : 50;

  if (fearGreedValue <= 20) emotionScore -= 3;      // Ekstrem korku
  else if (fearGreedValue <= 40) emotionScore -= 1; // Korku
  else if (fearGreedValue >= 80) emotionScore += 3; // Ekstrem açgözlülük
  else if (fearGreedValue >= 60) emotionScore += 1; // Açgözlülük

  // CVD piyasa baskısı
  if (cvd && cvd.strongBear) emotionScore -= 2;
  if (cvd && cvd.strongBull) emotionScore += 2;

  // Funding oranı
  if (funding && funding.isVeryNegative) emotionScore -= 2; // Herkes short → panik
  if (funding && funding.isVeryPositive) emotionScore += 2; // Herkes long → hırs

  // Duygusal durum kararı
  if      (emotionScore <= -4) state = 'EXTREME_PANIC';    // En iyi AL fırsatı
  else if (emotionScore <= -2) state = 'PANIC';            // İyi AL fırsatı
  else if (emotionScore === 0) state = 'NEUTRAL';
  else if (emotionScore >= 4)  state = 'EXTREME_GREED';   // SAT fırsatı
  else if (emotionScore >= 2)  state = 'GREED';           // Dikkatli ol

  // Contrarian sinyal: Ekstrem duygu = tersine hareket yakın
  var contrarianBuy  = (state === 'EXTREME_PANIC' || state === 'PANIC');
  var contrarianSell = (state === 'EXTREME_GREED' || state === 'GREED');

  return {
    state:          state,
    emotionScore:   emotionScore,
    fearGreedValue: fearGreedValue,
    contrarianBuy:  contrarianBuy,
    contrarianSell: contrarianSell
  };
}

// ─────────────────────────────────────────────
// 2. SESSİZLİK DEDEKTÖRİ
//    Hacim aniden düşüyor + fiyat sıkışıyor
//    → Büyük hareket öncesi sessizlik
//    Profesyoneller birikirken piyasa uyuyor
// ─────────────────────────────────────────────
function detectSilence(candles1h, volume) {
  if (!candles1h || candles1h.length < 20) {
    return { isSilent: false, silenceScore: 0 };
  }

  var volumes = candles1h.map(function(c) { return c.volume; });
  var closes  = candles1h.map(function(c) { return c.close; });

  // Son 5 mumun hacim ortalaması vs son 20 mumun ortalaması
  var avg20 = volumes.slice(-20).reduce(function(a,b){return a+b;},0) / 20;
  var avg5  = volumes.slice(-5).reduce(function(a,b){return a+b;},0)  / 5;
  var volDropRatio = avg20 > 0 ? avg5 / avg20 : 1;

  // Son 10 mumun fiyat aralığı daralıyor mu?
  var last10Closes = closes.slice(-10);
  var maxClose = Math.max.apply(null, last10Closes);
  var minClose = Math.min.apply(null, last10Closes);
  var priceRange = maxClose > 0 ? (maxClose - minClose) / maxClose : 0;

  var isSilent    = volDropRatio < 0.5 && priceRange < 0.02; // Hacim %50 düştü + fiyat %2 aralıkta
  var silenceScore = 0;

  if (volDropRatio < 0.3 && priceRange < 0.01) silenceScore = 3; // Çok derin sessizlik
  else if (isSilent)                            silenceScore = 2;
  else if (volDropRatio < 0.6)                  silenceScore = 1;

  return {
    isSilent:      isSilent,
    silenceScore:  silenceScore,
    volDropRatio:  parseFloat(volDropRatio.toFixed(2)),
    priceRangePct: parseFloat((priceRange * 100).toFixed(3))
  };
}

// ─────────────────────────────────────────────
// 3. STOP AVI TESPİTİ
//    Likidite haritasındaki stop cluster'larına
//    fiyat yaklaşıyor mu?
//    Büyük oyuncular küçük yatırımcıların
//    stoplarını vurup sonra gerçek yönde gider
// ─────────────────────────────────────────────
function detectStopHunt(currentPrice, liquidity, candles1h) {
  if (!liquidity || !candles1h || candles1h.length < 5) {
    return { isStopHunt: false, stopHuntScore: 0 };
  }

  var stopHuntScore = 0;
  var signals = [];

  // Son mumda ani wick (gölge) var mı?
  var lastCandle = candles1h[candles1h.length - 1];
  var candleBody = Math.abs(lastCandle.close - lastCandle.open);
  var upperWick  = lastCandle.high  - Math.max(lastCandle.open, lastCandle.close);
  var lowerWick  = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;

  var hasLongLowerWick = candleBody > 0 && lowerWick > candleBody * 2;
  var hasLongUpperWick = candleBody > 0 && upperWick > candleBody * 2;

  // Fiyat likidite cluster'ına yakın mı?
  var nearBidCluster = liquidity.nearestSupport && liquidity.nearestSupport.distPct <= 0.3;
  var nearAskCluster = liquidity.nearestResistance && liquidity.nearestResistance.distPct <= 0.3;

  // Alt stop avı: Fiyat dip yaptı, uzun alt wick + hemen geri döndü
  if (hasLongLowerWick && nearBidCluster) {
    stopHuntScore += 3;
    signals.push('ALT_STOP_AVI_TAMAMLANDI'); // Stoplar vuruldu → yukarı hareket gelebilir
  }

  // Üst stop avı: Fiyat tepe yaptı, uzun üst wick + geri döndü
  if (hasLongUpperWick && nearAskCluster) {
    stopHuntScore -= 3;
    signals.push('UST_STOP_AVI_TAMAMLANDI'); // Stoplar vuruldu → aşağı hareket gelebilir
  }

  // Sadece cluster'a yakın (wick olmadan)
  if (!hasLongLowerWick && nearBidCluster) stopHuntScore += 1;
  if (!hasLongUpperWick && nearAskCluster) stopHuntScore -= 1;

  return {
    isStopHunt:    Math.abs(stopHuntScore) >= 3,
    stopHuntScore: stopHuntScore,
    signals:       signals,
    hasLongLowerWick: hasLongLowerWick,
    hasLongUpperWick: hasLongUpperWick
  };
}

// ─────────────────────────────────────────────
// 4. PSİKOLOJİ SKORU
// ─────────────────────────────────────────────
function calcPsychologyScore(emotionalState, silence, stopHunt, dir1h) {
  var score = 0;

  // Contrarian fırsat
  if (emotionalState.contrarianBuy  && dir1h > 0) score += 3;
  if (emotionalState.contrarianSell && dir1h < 0) score -= 3;

  // Sessizlik → yaklaşan patlama
  score += silence.silenceScore;

  // Stop avı tamamlandı → gerçek yön başlıyor
  score += stopHunt.stopHuntScore;

  return Math.max(-5, Math.min(5, score));
}

// ─────────────────────────────────────────────
// 5. ANA FONKSİYON
// ─────────────────────────────────────────────
function analyzePsychology(sentiment, cvd, funding, candles1h, liquidity, dir1h) {
  try {
    var volume = candles1h ? {
      isHigh: false,
      ratio: 1
    } : null;

    var emotionalState = detectEmotionalState(sentiment, cvd, funding);
    var silence        = detectSilence(candles1h, volume);
    var stopHunt       = detectStopHunt(
      candles1h && candles1h.length > 0 ? candles1h[candles1h.length-1].close : 0,
      liquidity,
      candles1h
    );

    var psychologyScore = calcPsychologyScore(emotionalState, silence, stopHunt, dir1h);

    return {
      emotionalState:  emotionalState.state,
      fearGreedValue:  emotionalState.fearGreedValue,
      contrarianBuy:   emotionalState.contrarianBuy,
      contrarianSell:  emotionalState.contrarianSell,
      isSilent:        silence.isSilent,
      silenceScore:    silence.silenceScore,
      volDropRatio:    silence.volDropRatio,
      isStopHunt:      stopHunt.isStopHunt,
      stopHuntSignals: stopHunt.signals,
      stopHuntScore:   stopHunt.stopHuntScore,
      psychologyScore: psychologyScore
    };
  } catch (err) {
    return {
      emotionalState: 'NEUTRAL', fearGreedValue: 50,
      contrarianBuy: false, contrarianSell: false,
      isSilent: false, silenceScore: 0, volDropRatio: 1,
      isStopHunt: false, stopHuntSignals: [], stopHuntScore: 0,
      psychologyScore: 0
    };
  }
}

module.exports = { analyzePsychology: analyzePsychology };