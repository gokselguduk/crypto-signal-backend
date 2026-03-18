var axios = require('axios');

var MEME_KEYWORDS = [
  'DOGE','SHIB','PEPE','FLOKI','BONK','WIF','MOODENG','NEIRO','TURBO',
  'GOAT','PNUT','ACT','MEW','BOME','DOGS','HMSTR','NOT','CATI','POPCAT',
  'COW','GRASS','BRETT','MEME','BABYDOGE','SAMO','HOGE','ELON','AKITA',
  'SATS','RATS','ORDI','MYRO','SLERF','WEN','WOJAK','BOB','TOSHI','MOG',
  'ANDY','PONKE','SPX','GIGA','MICHI','NYAN','LADYS','AIDOGE','CHEEMS',
  'BODEN','TREMP','HARAMBE','VOLT','PIG','STONKS','BRETT','POINTS',
  'ROUP','1000SHIB','1000PEPE','1000BONK','1000FLOKI','1000RATS',
  '1000SATS','PIZZA','BEER','CAT','DOG','FROG','MONKY','PANDA',
  'LION','BEAR','DUCK','COW','FISH','WHALE','MOON','MARS','SUN',
  'STAR','FIRE','WATER','EARTH','WIND','ICE','SNOW','RAIN',
  'LOVE','HEART','SMILE','LAUGH','CRY','ANGRY','COOL','HOT',
  'KING','QUEEN','PRINCE','NINJA','WIZARD','DRAGON','PHOENIX',
  'UNICORN','ZOMBIE','GHOST','ALIEN','ROBOT','CYBORG','MUTANT'
];

var MEME_COINS = [];
var lastFetch = 0;

async function fetchMemeCoins() {
  try {
    var res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
    var all = res.data.symbols.filter(function(s) {
      return s.status === 'TRADING' && s.quoteAsset === 'USDT';
    });

    var found = all.filter(function(s) {
      return MEME_KEYWORDS.some(function(k) {
        return s.baseAsset.toUpperCase().includes(k.replace('1000',''));
      });
    }).map(function(s) { return s.baseAsset + 'USDT'; });

    var dedupe = found.filter(function(v, i, a) { return a.indexOf(v) === i; });
    MEME_COINS = dedupe;
    lastFetch = Date.now();
    console.log('Meme coin listesi: ' + MEME_COINS.length + ' parite');
    return MEME_COINS;
  } catch(e) {
    console.error('Meme liste hatasi:', e.message);
    MEME_COINS = ['DOGEUSDT','SHIBUSDT','PEPEUSDT','FLOKIUSDT','BONKUSDT','WIFUSDT','MOODENGUSDT'];
    return MEME_COINS;
  }
}

async function getVolumeSurge(symbol) {
  try {
    var res = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
      params: { symbol: symbol, interval: '1h', limit: 168 },
      timeout: 5000
    });
    var candles = res.data;
    if (!candles || candles.length < 24) return null;

    var last     = candles[candles.length - 1];
    var prev     = candles.slice(0, candles.length - 1);
    var avgVol   = prev.reduce(function(t, c) { return t + parseFloat(c[5]); }, 0) / prev.length;
    var lastVol  = parseFloat(last[5]);
    var ratio    = avgVol > 0 ? parseFloat((lastVol / avgVol).toFixed(2)) : 0;

    var close    = parseFloat(last[4]);
    var open1h   = parseFloat(last[1]);
    var open4h   = parseFloat(candles[candles.length - 4][1]);
    var open24h  = parseFloat(candles[candles.length - 24][1]);

    var chg1h    = parseFloat(((close - open1h)  / open1h  * 100).toFixed(2));
    var chg4h    = parseFloat(((close - open4h)  / open4h  * 100).toFixed(2));
    var chg24h   = parseFloat(((close - open24h) / open24h * 100).toFixed(2));

    var high24h  = Math.max.apply(null, candles.slice(-24).map(function(c) { return parseFloat(c[2]); }));
    var low24h   = Math.min.apply(null, candles.slice(-24).map(function(c) { return parseFloat(c[3]); }));
    var volatility = parseFloat(((high24h - low24h) / low24h * 100).toFixed(2));

    var rsiCloses = candles.slice(-15).map(function(c) { return parseFloat(c[4]); });
    var gains = 0, losses = 0;
    for (var i = 1; i < rsiCloses.length; i++) {
      var diff = rsiCloses[i] - rsiCloses[i-1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    var avgGain = gains / 14;
    var avgLoss = losses / 14;
    var rsi = avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(1));

    return {
      symbol:       symbol,
      lastClose:    close,
      volume:       lastVol,
      avgVolume:    parseFloat(avgVol.toFixed(2)),
      volumeRatio:  ratio,
      chg1h:        chg1h,
      chg4h:        chg4h,
      chg24h:       chg24h,
      high24h:      high24h,
      low24h:       low24h,
      volatility:   volatility,
      rsi:          rsi,
      isSurge:      ratio >= 3,
      isHugeSurge:  ratio >= 6,
      isMomentum:   chg1h >= 3 || chg4h >= 8,
      riskLevel:    ratio >= 6 && chg1h >= 5 ? 'EKSTREM' : ratio >= 4 ? 'YUKSEK' : ratio >= 2 ? 'ORTA' : 'DUSUK'
    };
  } catch(e) {
    return null;
  }
}

async function getTrendingCoins() {
  try {
    var res = await axios.get('https://api.coingecko.com/api/v3/search/trending', { timeout: 5000 });
    return res.data.coins.map(function(c) {
      return { name: c.item.name, symbol: c.item.symbol.toUpperCase(), rank: c.item.market_cap_rank };
    });
  } catch(e) {
    return [];
  }
}

async function getBtcDominance() {
  try {
    var res = await axios.get('https://api.coingecko.com/api/v3/global', { timeout: 5000 });
    var dom = parseFloat(res.data.data.market_cap_percentage.btc.toFixed(1));
    var eth = parseFloat(res.data.data.market_cap_percentage.eth.toFixed(1));
    var totalMcap = res.data.data.total_market_cap.usd;
    return {
      dominance:          dom,
      ethDominance:       eth,
      totalMcap:          totalMcap,
      isAltSeason:        dom < 50,
      isStrongAltSeason:  dom < 45,
      isExtremeAltSeason: dom < 40
    };
  } catch(e) {
    return { dominance: 50, ethDominance: 18, isAltSeason: false, isStrongAltSeason: false, isExtremeAltSeason: false };
  }
}

async function getFearGreedMeme() {
  try {
    var res = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 });
    var val = parseInt(res.data.data[0].value);
    return {
      value: val,
      label: res.data.data[0].value_classification,
      isExtremeFear:  val <= 25,
      isFear:         val <= 45,
      isGreed:        val >= 55,
      isExtremeGreed: val >= 75
    };
  } catch(e) {
    return { value: 50, label: 'Neutral', isExtremeFear: false, isFear: false, isGreed: false, isExtremeGreed: false };
  }
}

async function scanMemeRadar() {
  if (MEME_COINS.length === 0 || Date.now() - lastFetch > 3600000) {
    await fetchMemeCoins();
  }

  var results  = [];
  var trending = await getTrendingCoins();
  var btcDom   = await getBtcDominance();
  var fearGreed = await getFearGreedMeme();

  for (var i = 0; i < MEME_COINS.length; i++) {
    var data = await getVolumeSurge(MEME_COINS[i]);
    if (!data) continue;

    var baseSymbol  = MEME_COINS[i].replace('USDT','').replace('1000','').toUpperCase();
    var isTrending  = trending.some(function(t) {
      return t.symbol.toUpperCase().includes(baseSymbol) || baseSymbol.includes(t.symbol.toUpperCase());
    });

    var score = 0;

    if (data.volumeRatio >= 8)      score += 4;
    else if (data.volumeRatio >= 5) score += 3;
    else if (data.volumeRatio >= 3) score += 2;
    else if (data.volumeRatio >= 2) score += 1;

    if (data.chg1h >= 8)            score += 4;
    else if (data.chg1h >= 5)       score += 3;
    else if (data.chg1h >= 3)       score += 2;
    else if (data.chg1h >= 1)       score += 1;

    if (data.chg4h >= 15)           score += 3;
    else if (data.chg4h >= 8)       score += 2;
    else if (data.chg4h >= 4)       score += 1;

    if (data.chg24h >= 30)          score += 3;
    else if (data.chg24h >= 15)     score += 2;
    else if (data.chg24h >= 8)      score += 1;

    if (isTrending)                 score += 3;

    if (btcDom.isExtremeAltSeason)  score += 3;
    else if (btcDom.isStrongAltSeason) score += 2;
    else if (btcDom.isAltSeason)    score += 1;

    if (fearGreed.isExtremeGreed)   score += 2;
    else if (fearGreed.isGreed)     score += 1;

    if (data.rsi > 50 && data.rsi < 75) score += 1;
    if (data.volatility > 10)       score += 1;

    if (data.chg1h < 0 && data.chg4h < 0) score -= 3;
    if (data.rsi > 85)              score -= 2;
    if (data.chg24h < -20)          score -= 3;

    var alert = score >= 10 ? 'ROKET' : score >= 7 ? 'ATES' : score >= 4 ? 'SICAK' : score >= 2 ? 'IZLE' : null;

    if (alert) {
      results.push(Object.assign({}, data, {
        isTrending:   isTrending,
        memeScore:    score,
        alert:        alert,
        btcDominance: btcDom,
        fearGreed:    fearGreed
      }));
    }

    await new Promise(function(r) { setTimeout(r, 150); });
  }

  results.sort(function(a, b) { return b.memeScore - a.memeScore; });

  return {
    coins:        results,
    btcDominance: btcDom,
    fearGreed:    fearGreed,
    trending:     trending,
    totalScanned: MEME_COINS.length,
    scannedAt:    new Date().toISOString()
  };
}

module.exports = {
  scanMemeRadar:  scanMemeRadar,
  fetchMemeCoins: fetchMemeCoins,
  MEME_COINS:     MEME_COINS
};