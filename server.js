/**
 * GOLD Trading Dashboard - Backend Server
 * Source: Yahoo Finance (Free, Reliable)
 * Symbol: XAUUSD=X (Gold Spot / USD)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Constants
const GOLD_SYMBOL = 'XAUUSD=X';

// Yahoo Finance instance (initialized async)
let yahooFinance = null;

async function initYahooFinance() {
    // Dynamic import for ESM module in CommonJS
    const YahooFinanceModule = await import('yahoo-finance2');
    const YahooFinance = YahooFinanceModule.default;
    yahooFinance = new YahooFinance();
    console.log('Yahoo Finance initialized');
}

// ===========================================
// PRICE ENDPOINT
// ===========================================
app.get('/api/price/:symbol', async (req, res) => {
    if (!yahooFinance) {
        return res.status(503).json({ error: 'Yahoo Finance not ready' });
    }

    try {
        const quote = await yahooFinance.quote(GOLD_SYMBOL);

        console.log(`[Yahoo] Gold Price: $${quote.regularMarketPrice}`);

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
    if (!yahooFinance) {
        return res.status(503).json({ error: 'Yahoo Finance not ready' });
    }

    const intervalArg = req.query.interval || '15m';

    // Map our frontend intervals to Yahoo
    const intervalMap = {
        '5m': '5m',
        '15m': '15m',
        '1h': '1h',
        '4h': '1h',
        '1d': '1d'
    };

    const interval = intervalMap[intervalArg] || '15m';

    // Calculate start date
    const now = new Date();
    let startDate;

    if (interval === '5m') startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    else if (interval === '15m') startDate = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
    else if (interval === '1h') startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    else startDate = new Date(now.getTime() - (100 * 24 * 60 * 60 * 1000));

    try {
        const result = await yahooFinance.chart(GOLD_SYMBOL, {
            period1: startDate,
            interval: interval,
        });

        // Transform to our format
        const quotes = result.quotes || [];
        const candles = quotes.map(k => ({
            time: Math.floor(new Date(k.date).getTime() / 1000),
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume || 0
        })).filter(c => c.close !== null && c.open !== null);

        console.log(`[Yahoo] Klines: ${candles.length} (${interval})`);

        res.json({
            source: 'yahoo',
            symbol: 'XAUUSD',
            interval: interval,
            count: candles.length,
            candles: candles
        });
    } catch (e) {
        console.error('[Yahoo] Chart Failed:', e.message);
        res.status(500).json({ error: 'Failed to fetch klines', details: e.message });
    }
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: yahooFinance ? 'ok' : 'initializing',
        source: 'Yahoo Finance',
        symbol: GOLD_SYMBOL
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server after initializing Yahoo Finance
initYahooFinance().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`GOLD Dashboard Active (${GOLD_SYMBOL})`);
    });
}).catch(err => {
    console.error('Failed to initialize Yahoo Finance:', err);
    process.exit(1);
});
