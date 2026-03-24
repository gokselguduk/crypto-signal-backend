/**
 * orderBook.js — v2.0 ORDER FLOW ENGINE
 * CVD (Cumulative Volume Delta) + Likidite Cluster Haritası + Absorpsiyon
 *
 * Eski: 20 seviye basit bid/ask ratio
 * Yeni: 500 seviye depth + delta analizi + cluster tespiti + absorpsiyon
 */

var axios = require('axios');

// ─────────────────────────────────────────────
// YARDIMCI: Binance Futures depth çek
// ─────────────────────────────────────────────
async function fetchDepth(symbol, limit) {
  var res = await axios.get('https://fapi.binance.com/fapi/v1/depth', {
    params: { symbol: symbol.toUpperCase(), limit: limit || 500 },
    timeout: 5000
  });
  return res.data;
}

// ─────────────────────────────────────────────
// YARDIMCI: Binance Futures son trade'leri çek (CVD için)
// ─────────────────────────────────────────────
async function fetchRecentTrades(symbol, limit) {
  var res = await axios.get('https://fapi.binance.com/fapi/v1/aggTrades', {
    params: { symbol: symbol.toUpperCase(), limit: limit || 500 },
    timeout: 5000
  });
  return res.data;
}

// ─────────────────────────────────────────────
// 1. CVD HESAPLA
//    aggTrades üzerinden: alış delta + , satış delta -
//    Son 500 trade'in net delta'sı → piyasa niyetini gösterir
// ─────────────────────────────────────────────
function calcCVD(trades) {
  var cvd        = 0;
  var buyVolume  = 0;
  var sellVolume = 0;
  var totalVol   = 0;

  trades.forEach(function(t) {
    var qty = parseFloat(t.q);
    totalVol += qty;
    if (t.m === false) {       // maker = satıcı → alış baskısı
      cvd       += qty;
      buyVolume += qty;
    } else {                   // maker = alıcı → satış baskısı
      cvd        -= qty;
      sellVolume += qty;
    }
  });

  var deltaRatio = totalVol > 0 ? cvd / totalVol : 0; // -1 ile +1 arası

  return {
    cvd:          parseFloat(cvd.toFixed(4)),
    buyVolume:    parseFloat(buyVolume.toFixed(4)),
    sellVolume:   parseFloat(sellVolume.toFixed(4)),
    totalVolume:  parseFloat(totalVol.toFixed(4)),
    deltaRatio:   parseFloat(deltaRatio.toFixed(4)),   // + → alış baskısı, - → satış
    bullish:      deltaRatio >  0.15,                  // %15+ alış fazlası
    bearish:      deltaRatio < -0.15,                  // %15+ satış fazlası
    strongBull:   deltaRatio >  0.35,
    strongBear:   deltaRatio < -0.35
  };
}

// ─────────────────────────────────────────────
// 2. LİKİDİTE CLUSTER HARİTASI
//    500 seviye depth içinde hacim yoğunlaşması
//    Büyük cluster'lar fiyat için mıknatıs görevi görür
// ─────────────────────────────────────────────
function calcLiquidityClusters(bids, asks, currentPrice) {
  var totalBidVol = bids.reduce(function(s, b) { return s + b.qty; }, 0);
  var totalAskVol = asks.reduce(function(s, a) { return s + a.qty; }, 0);

  // Cluster eşiği: toplam hacmin %2.5'inden büyük seviyeler
  var bidThreshold = totalBidVol * 0.025;
  var askThreshold = totalAskVol * 0.025;

  var bidClusters = bids
    .filter(function(b) { return b.qty >= bidThreshold; })
    .sort(function(a, b) { return b.qty - a.qty; })
    .slice(0, 5)
    .map(function(b) {
      return {
        price:     b.price,
        qty:       parseFloat(b.qty.toFixed(4)),
        distPct:   parseFloat(((currentPrice - b.price) / currentPrice * 100).toFixed(3)),
        strength:  parseFloat((b.qty / totalBidVol * 100).toFixed(2)) // toplam içindeki pay %
      };
    });

  var askClusters = asks
    .filter(function(a) { return a.qty >= askThreshold; })
    .sort(function(a, b) { return b.qty - a.qty; })
    .slice(0, 5)
    .map(function(a) {
      return {
        price:     a.price,
        qty:       parseFloat(a.qty.toFixed(4)),
        distPct:   parseFloat(((a.price - currentPrice) / currentPrice * 100).toFixed(3)),
        strength:  parseFloat((a.qty / totalAskVol * 100).toFixed(2))
      };
    });

  // En yakın güçlü destek / direnç cluster'ı
  var nearestBidCluster = bidClusters.length > 0
    ? bidClusters.reduce(function(min, b) { return b.distPct < min.distPct ? b : min; }, bidClusters[0])
    : null;

  var nearestAskCluster = askClusters.length > 0
    ? askClusters.reduce(function(min, a) { return a.distPct < min.distPct ? a : min; }, askClusters[0])
    : null;

  // Fiyat bir cluster'a %0.5 yakın mı? (mıknatıs etkisi)
  var nearMagnetSupport    = nearestBidCluster && nearestBidCluster.distPct <= 0.5;
  var nearMagnetResistance = nearestAskCluster && nearestAskCluster.distPct <= 0.5;

  return {
    bidClusters:          bidClusters,
    askClusters:          askClusters,
    nearestSupport:       nearestBidCluster,
    nearestResistance:    nearestAskCluster,
    nearMagnetSupport:    nearMagnetSupport,
    nearMagnetResistance: nearMagnetResistance,
    totalBidVol:          parseFloat(totalBidVol.toFixed(2)),
    totalAskVol:          parseFloat(totalAskVol.toFixed(2)),
    bidAskRatio:          parseFloat((totalBidVol / totalAskVol).toFixed(3))
  };
}

// ─────────────────────────────────────────────
// 3. ABSORPSİYON TESPİTİ
//    Büyük satış var ama fiyat düşmüyor → güçlü alıcı absorbe ediyor
//    Büyük alış var ama fiyat yükselmiyor → güçlü satıcı absorbe ediyor
// ─────────────────────────────────────────────
function detectAbsorption(trades, cvd) {
  if (!trades || trades.length < 50) {
    return { buyAbsorption: false, sellAbsorption: false, absorptionScore: 0 };
  }

  // Son trade fiyat aralığı
  var prices     = trades.map(function(t) { return parseFloat(t.p); });
  var maxPrice   = Math.max.apply(null, prices);
  var minPrice   = Math.min.apply(null, prices);
  var priceRange = (maxPrice - minPrice) / prices[prices.length - 1];

  // Hacim ortalaması hesapla
  var volumes    = trades.map(function(t) { return parseFloat(t.q); });
  var avgVol     = volumes.reduce(function(s, v) { return s + v; }, 0) / volumes.length;
  var maxVol     = Math.max.apply(null, volumes);
  var hasLargeOrder = maxVol >= avgVol * 3; // Ortalamın 3x'i büyük emir sayılır

  var tightRange   = priceRange < 0.002; // Fiyat %0.2'den az hareket etti
  var absorptionScore = 0;

  // SATIŞ ABSORPSİYONU: Yüksek satış deltası ama fiyat düşmüyor
  // → Büyük alıcı piyasada, fiyat yukarı gidebilir
  var sellAbsorption = cvd.bearish && tightRange && hasLargeOrder;
  if (sellAbsorption) absorptionScore += 3;

  // ALIŞ ABSORPSİYONU: Yüksek alış deltası ama fiyat yükselmiyor
  // → Büyük satıcı piyasada, fiyat aşağı gidebilir
  var buyAbsorption = cvd.bullish && tightRange && hasLargeOrder;
  if (buyAbsorption) absorptionScore -= 3;

  // Güçlü versiyon
  if (cvd.strongBear && tightRange) absorptionScore += 2; // Çok güçlü alıcı absorpsiyon
  if (cvd.strongBull && tightRange) absorptionScore -= 2;

  return {
    sellAbsorption:    sellAbsorption,   // güçlü alıcı var → potansiyel yükseliş
    buyAbsorption:     buyAbsorption,    // güçlü satıcı var → potansiyel düşüş
    tightRange:        tightRange,
    hasLargeOrder:     hasLargeOrder,
    priceRangePct:     parseFloat((priceRange * 100).toFixed(4)),
    absorptionScore:   absorptionScore
  };
}

// ─────────────────────────────────────────────
// 4. ANA FONKSİYON — scanner.js'in çağırdığı yer
// ─────────────────────────────────────────────
async function analyzeOrderBook(symbol) {
  try {
    // Paralel çek — hız için
    var results = await Promise.all([
      fetchDepth(symbol, 500),
      fetchRecentTrades(symbol, 500)
    ]);

    var depthData = results[0];
    var trades    = results[1];

    var bids = depthData.bids.map(function(b) {
      return { price: parseFloat(b[0]), qty: parseFloat(b[1]) };
    });
    var asks = depthData.asks.map(function(a) {
      return { price: parseFloat(a[0]), qty: parseFloat(a[1]) };
    });

    var currentPrice = bids.length > 0 ? bids[0].price : 0;

    // 3 katman hesapla
    var cvd         = calcCVD(trades);
    var liquidity   = calcLiquidityClusters(bids, asks, currentPrice);
    var absorption  = detectAbsorption(trades, cvd);

    // ─── GENEL SKOR (scanner.js extraScore'una eklenir) ───
    var orderFlowScore = 0;

    // CVD sinyalleri
    if (cvd.strongBull)  orderFlowScore += 3;
    else if (cvd.bullish) orderFlowScore += 2;
    if (cvd.strongBear)  orderFlowScore -= 3;
    else if (cvd.bearish) orderFlowScore -= 2;

    // Likidite cluster sinyalleri
    if (liquidity.nearMagnetSupport)    orderFlowScore += 2; // Fiyat güçlü desteğe yakın
    if (liquidity.nearMagnetResistance) orderFlowScore -= 2; // Fiyat güçlü dirence yakın
    if (liquidity.bidAskRatio > 1.5)    orderFlowScore += 1;
    if (liquidity.bidAskRatio < 0.67)   orderFlowScore -= 1;

    // Absorpsiyon sinyalleri
    orderFlowScore += absorption.absorptionScore;

    // Eski sistem uyumluluğu (scanner.js bunları okuyordu)
    var buyWall  = liquidity.nearestSupport    && liquidity.nearestSupport.strength    > 10;
    var sellWall = liquidity.nearestResistance && liquidity.nearestResistance.strength > 10;

    return {
      // ── Eski alan adları (scanner.js için geriye dönük uyumlu) ──
      bidAskRatio:    liquidity.bidAskRatio,
      totalBid:       liquidity.totalBidVol,
      totalAsk:       liquidity.totalAskVol,
      buyWall:        buyWall,
      sellWall:       sellWall,
      buyWallPrice:   buyWall  ? liquidity.nearestSupport.price    : null,
      sellWallPrice:  sellWall ? liquidity.nearestResistance.price : null,
      bullish:        orderFlowScore >= 3,
      bearish:        orderFlowScore <= -3,

      // ── Yeni Order Flow alanları ──
      cvd:            cvd,
      liquidity:      liquidity,
      absorption:     absorption,
      orderFlowScore: orderFlowScore,

      // Sinyal özeti (index.js ve frontend için)
      signals: buildSignals(cvd, liquidity, absorption)
    };

  } catch (err) {
    // Hata durumunda eski sistem ile aynı boş dönüş
    return {
      bidAskRatio: 1, totalBid: 0, totalAsk: 0,
      buyWall: false, sellWall: false,
      buyWallPrice: null, sellWallPrice: null,
      bullish: false, bearish: false,
      cvd: null, liquidity: null, absorption: null,
      orderFlowScore: 0, signals: []
    };
  }
}

// ─────────────────────────────────────────────
// 5. SİNYAL METİNLERİ ÜRET
// ─────────────────────────────────────────────
function buildSignals(cvd, liquidity, absorption) {
  var signals = [];

  if (cvd.strongBull)
    signals.push({ type: 'BUY',  source: 'CVD', reason: 'Cok guclu alis baskisi: delta ' + cvd.deltaRatio });
  else if (cvd.bullish)
    signals.push({ type: 'BUY',  source: 'CVD', reason: 'Alis baskisi hakim: delta ' + cvd.deltaRatio });

  if (cvd.strongBear)
    signals.push({ type: 'SELL', source: 'CVD', reason: 'Cok guclu satis baskisi: delta ' + cvd.deltaRatio });
  else if (cvd.bearish)
    signals.push({ type: 'SELL', source: 'CVD', reason: 'Satis baskisi hakim: delta ' + cvd.deltaRatio });

  if (liquidity.nearMagnetSupport)
    signals.push({ type: 'BUY', source: 'LIQUIDITY',
      reason: 'Buyuk likidite destegi: ' + liquidity.nearestSupport.price +
              ' (%' + liquidity.nearestSupport.strength + ' hacim)' });

  if (liquidity.nearMagnetResistance)
    signals.push({ type: 'SELL', source: 'LIQUIDITY',
      reason: 'Buyuk likidite direnci: ' + liquidity.nearestResistance.price +
              ' (%' + liquidity.nearestResistance.strength + ' hacim)' });

  if (absorption.sellAbsorption)
    signals.push({ type: 'BUY', source: 'ABSORPTION',
      reason: 'Satis absorpsiyonu: Buyuk alici var, fiyat tutunuyor' });

  if (absorption.buyAbsorption)
    signals.push({ type: 'SELL', source: 'ABSORPTION',
      reason: 'Alis absorpsiyonu: Buyuk satici var, fiyat tutunuyor' });

  return signals;
}

module.exports = { analyzeOrderBook: analyzeOrderBook };