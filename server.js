/**
 * GOLD Trading Dashboard - Backend Server
 * Source: Yahoo Finance (Free, Reliable)
 * Symbol: XAUUSD=X (Gold Spot / USD)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { YahooFinance } = require('yahoo-finance2');
const yahooFinance = new YahooFinance();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Constants
const GOLD_SYMBOL = 'XAUUSD=X';

// ===========================================
// PRICE ENDPOINT
// ===========================================
app.get('/api/price/:symbol', async (req, res) => {
    // We ignore the param and always fetch Gold for now, or map it if we expand later
    try {
        const quote = await yahooFinance.quote(GOLD_SYMBOL);

        console.log(`[Yahoo] Gold Price: $${quote.regularMarketPrice}`);

        // Yahoo Finance format -> Our dashboard format
        res.json({
            source: 'yahoo',
            symbol: 'XAUUSD',
            price: quote.regularMarketPrice,
            priceChange: quote.regularMarketChangePercent,
            high24h: quote.regularMarketDayHigh,
            low24h: quote.regularMarketDayLow,
            vol: quote.regularMarketVolume
        });
    } catch (e) {
        console.error('[Yahoo] Quote Failed:', e.message);
        res.status(500).json({ error: 'Failed to fetch price', details: e.message });
    }
});

// ===========================================
// KLINES ENDPOINT
// ===========================================
app.get('/api/klines/:symbol', async (req, res) => {
    const intervalArg = req.query.interval || '15m'; // 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo
    // Yahoo intervals: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo

    // Map our frontend intervals to Yahoo
    const intervalMap = {
        '5m': '5m',
        '15m': '15m',
        '1h': '1h',
        '4h': '1h', // Yahoo doesn't have 4h, use 1h and client can aggregate or just show 1h
        '1d': '1d'
    };

    const interval = intervalMap[intervalArg] || '15m';

    // Calculate start date based on interval to get enough candles
    // 100 candles * interval in minutes
    const now = new Date();
    const rangeInMinutes = 1500; // default
    let startDate = new Date(now.getTime() - (rangeInMinutes * 60 * 1000));

    if (interval === '5m') startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 1 day
    if (interval === '15m') startDate = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)); // 3 days
    if (interval === '1h') startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)); // 7 days
    if (interval === '1d') startDate = new Date(now.getTime() - (100 * 24 * 60 * 60 * 1000)); // 100 days

    try {
        const queryOptions = {
            period1: startDate, // Start date
            interval: interval,  // Interval
        };

        const result = await yahooFinance.historical(GOLD_SYMBOL, queryOptions);

        // Transform to our format
        // Yahoo returns: { date, open, high, low, close, adjClose, volume }
        const candles = result.map(k => ({
            time: Math.floor(new Date(k.date).getTime() / 1000),
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume
        })).filter(c => c.close !== null && c.open !== null); // Filter incomplete candles

        console.log(`[Yahoo] Klines: ${candles.length} (${interval})`);

        res.json({
            source: 'yahoo',
            symbol: 'XAUUSD',
            interval: interval,
            count: candles.length,
            candles: candles
        });
    } catch (e) {
        console.error('[Yahoo] Historical Failed:', e.message);
        res.status(500).json({ error: 'Failed to fetch klines', details: e.message });
    }
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', source: 'Yahoo Finance', symbol: GOLD_SYMBOL });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`GOLD Dashboard Active (${GOLD_SYMBOL})`);
});
