/**
 * GOLD Trading Dashboard - Backend Server
 * Source: Yahoo Finance (Free, Reliable)
 * Symbol: GC=F (Gold Futures - COMEX)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Constants - Using Gold Futures (GC=F) which works with Yahoo Finance
const GOLD_SYMBOL = 'GC=F';

// Yahoo Finance instance (initialized async)
let yahooFinance = null;

async function initYahooFinance() {
    const YahooFinanceModule = await import('yahoo-finance2');
    const YahooFinance = YahooFinanceModule.default;
    yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
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

        if (!quote || !quote.regularMarketPrice) {
            throw new Error('No quote data returned');
        }

        console.log(`[Yahoo] Gold Price: $${quote.regularMarketPrice}`);

        res.json({
            source: 'yahoo',
            symbol: 'GOLD',
            price: quote.regularMarketPrice,
            priceChange: quote.regularMarketChangePercent || 0,
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

    // Map our frontend intervals to Yahoo Finance intervals
    const intervalMap = {
        '5m': '5m',
        '15m': '15m',
        '1h': '1h',
        '4h': '1h',  // Yahoo doesn't have 4h, use 1h
        '1d': '1d'
    };

    const interval = intervalMap[intervalArg] || '15m';

    // Calculate period based on interval
    const now = new Date();
    let period1;

    if (interval === '5m') {
        period1 = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000)); // 2 days
    } else if (interval === '15m') {
        period1 = new Date(now.getTime() - (5 * 24 * 60 * 60 * 1000)); // 5 days
    } else if (interval === '1h') {
        period1 = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000)); // 14 days
    } else {
        period1 = new Date(now.getTime() - (100 * 24 * 60 * 60 * 1000)); // 100 days
    }

    try {
        const result = await yahooFinance.chart(GOLD_SYMBOL, {
            period1: period1,
            interval: interval,
        });

        if (!result || !result.quotes || result.quotes.length === 0) {
            throw new Error('No chart data returned');
        }

        // Transform to our format
        const candles = result.quotes
            .map(k => ({
                time: Math.floor(new Date(k.date).getTime() / 1000),
                open: k.open,
                high: k.high,
                low: k.low,
                close: k.close,
                volume: k.volume || 0
            }))
            .filter(c => c.close !== null && c.open !== null && !isNaN(c.close));

        console.log(`[Yahoo] Klines: ${candles.length} candles (${interval})`);

        res.json({
            source: 'yahoo',
            symbol: 'GOLD',
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
