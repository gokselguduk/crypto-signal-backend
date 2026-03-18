var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
var express = require('express');
var http = require('http');
var socketio = require('socket.io');
var cors = require('cors');
var binance = require('./services/binance');
var indicators = require('./indicators');
var backtest = require('./strategies/backtest');
var scanner = require('./services/scanner');
var app = express();
var server = http.createServer(app);
var io = new socketio.Server(server, { cors: { origin: '*' } });
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', function(req, res) { res.json({ status: 'ok' }); });
app.get('/api/candles/:symbol/:interval', function(req, res) {
  binance.getHistoricalCandles(req.params.symbol, req.params.interval, 200).then(function(c) {
    res.json({ symbol: req.params.symbol, interval: req.params.interval, count: c.length, candles: c });
  }).catch(function(e) { res.status(500).json({ error: e.message }); });
});
app.get('/api/analyze/:symbol/:interval', function(req, res) {
  binance.getHistoricalCandles(req.params.symbol, req.params.interval, 200).then(function(c) {
    res.json(Object.assign({ symbol: req.params.symbol, interval: req.params.interval }, indicators.analyzeCandles(c)));
  }).catch(function(e) { res.status(500).json({ error: e.message }); });
});
app.get('/api/backtest/:symbol/:interval', function(req, res) {
  binance.getHistoricalCandles(req.params.symbol, req.params.interval, 1000).then(function(c) {
    res.json(Object.assign({ symbol: req.params.symbol, interval: req.params.interval }, backtest.runBacktest(c, { stopLossPercent: parseFloat(req.query.stopLoss||2), takeProfitPercent: parseFloat(req.query.takeProfit||4), initialCapital: parseFloat(req.query.capital||1000) })));
  }).catch(function(e) { res.status(500).json({ error: e.message }); });
});
app.get('/api/scan/latest', function(req, res) { res.json({ signals: scanner.getLastSignals() }); });
app.get('/api/scan/:interval', function(req, res) {
  scanner.scanMarket(req.params.interval).then(function(r) {
    res.json({ interval: req.params.interval, count: r.length, signals: r });
  }).catch(function(e) { res.status(500).json({ error: e.message }); });
});
io.on('connection', function(socket) {
  socket.emit('scan_update', { type: 'scan_complete', data: scanner.getLastSignals(), time: new Date().toISOString() });
  socket.on('subscribe', function(data) {
    binance.subscribeToCandles(data.symbol, data.interval, function(candle) {
      socket.emit('candle', { symbol: data.symbol, interval: data.interval, candle: candle });
    });
  });
  socket.on('disconnect', function() {});
});
scanner.subscribe(function(data) { io.emit('scan_update', data); });
scanner.startAutoScan('1h', 1800000);
var PORT = process.env.PORT || 3000;
server.listen(PORT, function() { console.log('Sunucu calisiyor: http://localhost:' + PORT); });
