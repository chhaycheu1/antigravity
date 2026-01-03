/**
 * NEAR Trading Dashboard - Backend Server
 * Binance API (primary) with CoinGecko fallback
 * Supports multiple timeframes: 5m, 15m, 1h, 4h
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// API URLs
const BINANCE_API = 'https://api.binance.com/api/v3';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Symbol mapping
const SYMBOL_MAP = {
    'NEARUSDT': { binance: 'NEARUSDT', gecko: 'near' },
    'BTCUSDT': { binance: 'BTCUSDT', gecko: 'bitcoin' },
    'SOLUSDT': { binance: 'SOLUSDT', gecko: 'solana' },
    'ETHUSDT': { binance: 'ETHUSDT', gecko: 'ethereum' },
};

// Helper to make fetch requests with timeout
async function fetchWithTimeout(url, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// ===========================================
// PRICE ENDPOINT
// ===========================================
app.get('/api/price/:symbol', async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const mapping = SYMBOL_MAP[symbol] || { binance: symbol, gecko: symbol.toLowerCase().replace('usdt', '') };

    // Try Binance first
    try {
        console.log(`[Binance] Fetching price for ${symbol}...`);
        const response = await fetchWithTimeout(`${BINANCE_API}/ticker/24hr?symbol=${mapping.binance}`);
        if (response.ok) {
            const data = await response.json();
            console.log(`[Binance] Success: $${data.lastPrice}`);
            return res.json({
                source: 'binance',
                symbol: symbol,
                price: parseFloat(data.lastPrice),
                priceChange: parseFloat(data.priceChangePercent),
                high24h: parseFloat(data.highPrice),
                low24h: parseFloat(data.lowPrice)
            });
        }
        console.log(`[Binance] Response not OK: ${response.status}`);
    } catch (e) {
        console.log(`[Binance] Failed: ${e.message}`);
    }

    // Fallback to CoinGecko
    try {
        console.log(`[CoinGecko] Fetching price for ${mapping.gecko}...`);
        const response = await fetchWithTimeout(`${COINGECKO_API}/simple/price?ids=${mapping.gecko}&vs_currencies=usd&include_24hr_change=true`);
        if (response.ok) {
            const data = await response.json();
            const geckoData = data[mapping.gecko];
            if (geckoData) {
                console.log(`[CoinGecko] Success: $${geckoData.usd}`);
                return res.json({
                    source: 'coingecko',
                    symbol: symbol,
                    price: geckoData.usd,
                    priceChange: geckoData.usd_24h_change || 0,
                    high24h: null,
                    low24h: null
                });
            }
        }
        console.log(`[CoinGecko] Response not OK: ${response.status}`);
    } catch (e) {
        console.error(`[CoinGecko] Failed: ${e.message}`);
    }

    res.status(500).json({ error: 'All price sources failed' });
});

// ===========================================
// KLINES ENDPOINT - Supports 5m, 15m, 1h, 4h
// ===========================================
app.get('/api/klines/:symbol', async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const interval = req.query.interval || '15m'; // Default to 15 minutes
    const limit = parseInt(req.query.limit) || 100;
    const mapping = SYMBOL_MAP[symbol] || { binance: symbol, gecko: symbol.toLowerCase().replace('usdt', '') };

    // Validate interval
    const validIntervals = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    const cleanInterval = validIntervals.includes(interval) ? interval : '15m';

    // Try Binance first (best for 5m, 15m candles)
    try {
        console.log(`[Binance] Fetching ${cleanInterval} klines for ${symbol}...`);
        const response = await fetchWithTimeout(`${BINANCE_API}/klines?symbol=${mapping.binance}&interval=${cleanInterval}&limit=${limit}`);
        if (response.ok) {
            const data = await response.json();
            const candles = data.map(k => ({
                time: Math.floor(k[0] / 1000),
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5])
            }));
            console.log(`[Binance] Success: ${candles.length} candles (${cleanInterval})`);
            return res.json({
                source: 'binance',
                symbol: symbol,
                interval: cleanInterval,
                count: candles.length,
                candles: candles
            });
        }
        console.log(`[Binance] Response not OK: ${response.status}`);
    } catch (e) {
        console.log(`[Binance] Klines failed: ${e.message}`);
    }

    // Fallback to CoinGecko OHLC
    try {
        // CoinGecko granularity: days=1 gives ~30min, days=7 gives ~4hr candles
        let days = 7;
        let actualInterval = '4h';

        if (cleanInterval === '5m' || cleanInterval === '15m' || cleanInterval === '30m') {
            days = 1;
            actualInterval = '30m';
        } else if (cleanInterval === '1h') {
            days = 2;
            actualInterval = '1h';
        }

        console.log(`[CoinGecko] Fetching OHLC for ${mapping.gecko} (${days} days)...`);
        const response = await fetchWithTimeout(`${COINGECKO_API}/coins/${mapping.gecko}/ohlc?vs_currency=usd&days=${days}`);

        if (response.ok) {
            const data = await response.json();
            const candles = data.map(c => ({
                time: Math.floor(c[0] / 1000),
                open: c[1],
                high: c[2],
                low: c[3],
                close: c[4],
                volume: 0
            }));

            console.log(`[CoinGecko] Success: ${candles.length} candles (${actualInterval})`);
            return res.json({
                source: 'coingecko',
                symbol: symbol,
                interval: actualInterval,
                count: candles.length,
                candles: candles,
                note: `CoinGecko fallback: ${actualInterval} candles instead of ${cleanInterval}`
            });
        }
        console.log(`[CoinGecko] Response not OK: ${response.status}`);
    } catch (e) {
        console.error(`[CoinGecko] OHLC failed: ${e.message}`);
    }

    res.status(500).json({ error: 'All kline sources failed' });
});

// Health check with API status
app.get('/api/health', async (req, res) => {
    let binanceStatus = 'unknown';
    let coingeckoStatus = 'unknown';

    try {
        const response = await fetchWithTimeout(`${BINANCE_API}/ping`, 5000);
        binanceStatus = response.ok ? 'up' : 'down';
    } catch (e) {
        binanceStatus = 'down';
    }

    try {
        const response = await fetchWithTimeout(`${COINGECKO_API}/ping`, 5000);
        coingeckoStatus = response.ok ? 'up' : 'down';
    } catch (e) {
        coingeckoStatus = 'down';
    }

    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        apis: {
            binance: binanceStatus,
            coingecko: coingeckoStatus
        }
    });
});

// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('NEAR Trading Dashboard - Backend Server');
    console.log('='.repeat(50));
    console.log(`Server running at: http://localhost:${PORT}`);
    console.log(`Timeframes available: 5m, 15m, 30m, 1h, 4h`);
    console.log(`Data sources: Binance (primary) → CoinGecko (fallback)`);
    console.log('='.repeat(50));
});
