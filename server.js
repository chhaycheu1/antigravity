/**
 * NEAR Trading Dashboard - Backend Server
 * Uses axios for reliable API calls
 * Binance (primary) → CoinGecko (fallback)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

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

// Axios instance with timeout
const api = axios.create({
    timeout: 15000,
    headers: {
        'Accept': 'application/json',
        'User-Agent': 'NEAR-Trading-Dashboard/1.0'
    }
});

// ===========================================
// PRICE ENDPOINT
// ===========================================
app.get('/api/price/:symbol', async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const mapping = SYMBOL_MAP[symbol] || {
        binance: symbol,
        gecko: symbol.toLowerCase().replace('usdt', '')
    };

    // Try Binance first
    try {
        console.log(`[Binance] Fetching price for ${symbol}...`);
        const response = await api.get(`${BINANCE_API}/ticker/24hr`, {
            params: { symbol: mapping.binance }
        });

        console.log(`[Binance] Success: $${response.data.lastPrice}`);
        return res.json({
            source: 'binance',
            symbol: symbol,
            price: parseFloat(response.data.lastPrice),
            priceChange: parseFloat(response.data.priceChangePercent),
            high24h: parseFloat(response.data.highPrice),
            low24h: parseFloat(response.data.lowPrice)
        });
    } catch (e) {
        console.log(`[Binance] Failed: ${e.message}`);
    }

    // Fallback to CoinGecko
    try {
        console.log(`[CoinGecko] Fetching price for ${mapping.gecko}...`);
        const response = await api.get(`${COINGECKO_API}/simple/price`, {
            params: {
                ids: mapping.gecko,
                vs_currencies: 'usd',
                include_24hr_change: 'true'
            }
        });

        const geckoData = response.data[mapping.gecko];
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
    } catch (e) {
        console.log(`[CoinGecko] Failed: ${e.message}`);
    }

    res.status(500).json({
        error: 'All price sources failed',
        details: 'Could not reach Binance or CoinGecko APIs'
    });
});

// ===========================================
// KLINES ENDPOINT
// ===========================================
app.get('/api/klines/:symbol', async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const interval = req.query.interval || '15m';
    const limit = parseInt(req.query.limit) || 100;
    const mapping = SYMBOL_MAP[symbol] || {
        binance: symbol,
        gecko: symbol.toLowerCase().replace('usdt', '')
    };

    // Validate interval
    const validIntervals = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    const cleanInterval = validIntervals.includes(interval) ? interval : '15m';

    // Try Binance first
    try {
        console.log(`[Binance] Fetching ${cleanInterval} klines for ${symbol}...`);
        const response = await api.get(`${BINANCE_API}/klines`, {
            params: {
                symbol: mapping.binance,
                interval: cleanInterval,
                limit: limit
            }
        });

        const candles = response.data.map(k => ({
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
    } catch (e) {
        console.log(`[Binance] Klines failed: ${e.message}`);
    }

    // Fallback to CoinGecko OHLC
    try {
        // CoinGecko: days=1 gives 30min candles, days=7 gives 4hr candles
        let days = 7;
        let actualInterval = '4h';

        if (['5m', '15m', '30m'].includes(cleanInterval)) {
            days = 1;
            actualInterval = '30m';
        } else if (cleanInterval === '1h') {
            days = 2;
            actualInterval = '1h';
        }

        console.log(`[CoinGecko] Fetching OHLC for ${mapping.gecko} (${days} days)...`);
        const response = await api.get(`${COINGECKO_API}/coins/${mapping.gecko}/ohlc`, {
            params: {
                vs_currency: 'usd',
                days: days
            }
        });

        const candles = response.data.map(c => ({
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
            note: `CoinGecko: ${actualInterval} candles`
        });
    } catch (e) {
        console.log(`[CoinGecko] OHLC failed: ${e.message}`);
    }

    res.status(500).json({
        error: 'All kline sources failed',
        details: 'Could not reach Binance or CoinGecko APIs'
    });
});

// Health check with API connectivity test
app.get('/api/health', async (req, res) => {
    let binanceStatus = 'unknown';
    let coingeckoStatus = 'unknown';

    try {
        await api.get(`${BINANCE_API}/ping`);
        binanceStatus = 'up';
    } catch (e) {
        binanceStatus = 'down: ' + e.message;
    }

    try {
        await api.get(`${COINGECKO_API}/ping`);
        coingeckoStatus = 'up';
    } catch (e) {
        coingeckoStatus = 'down: ' + e.message;
    }

    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        node_version: process.version,
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
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Node: ${process.version}`);
    console.log(`Timeframes: 5m, 15m, 30m, 1h, 4h`);
    console.log(`APIs: Binance (primary) → CoinGecko (fallback)`);
    console.log('='.repeat(50));
});
