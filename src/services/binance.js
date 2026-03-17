const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

class BinanceService {
  constructor() {
    this.ws = null;
    this.subscribers = new Map();
  }

  subscribeToCandles(symbol, interval, callback) {
    const key = symbol.toLowerCase() + '@kline_' + interval;
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, []);
    }
    this.subscribers.get(key).push(callback);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    } else {
      this.sendSubscription(key);
    }
  }

  connect() {
    this.ws = new WebSocket(process.env.BINANCE_WS_URL + '/stream');
    this.ws.on('open', () => {
      console.log('Binance WebSocket baglandi');
      for (const key of this.subscribers.keys()) {
        this.sendSubscription(key);
      }
    });
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.stream && msg.data) {
        const callbacks = this.subscribers.get(msg.stream) || [];
        const kline = msg.data.k;
        const candle = {
          time:   kline.t,
          open:   parseFloat(kline.o),
          high:   parseFloat(kline.h),
          low:    parseFloat(kline.l),
          close:  parseFloat(kline.c),
          volume: parseFloat(kline.v),
          closed: kline.x
        };
        callbacks.forEach(cb => cb(candle));
      }
    });
    this.ws.on('close', () => {
      console.log('Baglanti kesildi, yeniden baglanıyor...');
      setTimeout(() => this.connect(), 3000);
    });
    this.ws.on('error', (err) => {
      console.error('WebSocket hatasi:', err.message);
    });
  }

  sendSubscription(stream) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [stream],
        id: Date.now()
      }));
    }
  }

  async getHistoricalCandles(symbol, interval, limit) {
    if (!limit) limit = 200;
    var url = 'https://fapi.binance.com/fapi/v1/klines';
    var response = await axios.get(url, {
      params: { symbol: symbol.toUpperCase(), interval: interval, limit: limit }
    });
    return response.data.map(function(k) {
      return {
        time:   k[0],
        open:   parseFloat(k[1]),
        high:   parseFloat(k[2]),
        low:    parseFloat(k[3]),
        close:  parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closed: true
      };
    });
  }
}

module.exports = new BinanceService();