/**
 * NEAR Trading Dashboard - Backend Server
 * Tries Binance first, falls back to CoinGecko
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
};

// ===========================================
// PRICE ENDPOINT
// ===========================================
app.get('/api/price/:symbol', async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const mapping = SYMBOL_MAP[symbol] || { binance: symbol, gecko: symbol.toLowerCase().replace('usdt', '') };

    // Try Binance
    try {
        console.log(`[Binance] Fetching price for ${symbol}...`);
        const response = await fetch(`${BINANCE_API}/ticker/24hr?symbol=${mapping.binance}`);
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
    } catch (e) {
        console.log('[Binance] Failed, trying CoinGecko...');
    }

    // Fallback to CoinGecko
    try {
        console.log(`[CoinGecko] Fetching price for ${mapping.gecko}...`);
        const response = await fetch(`${COINGECKO_API}/simple/price?ids=${mapping.gecko}&vs_currencies=usd&include_24hr_change=true`);
        if (response.ok) {
            const data = await response.json();
            const geckoData = data[mapping.gecko];
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
        console.error('[CoinGecko] Also failed:', e.message);
    }

    res.status(500).json({ error: 'All price sources failed' });
});

// ===========================================
// KLINES ENDPOINT
// ===========================================
app.get('/api/klines/:symbol', async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const interval = req.query.interval || '5m';
    const limit = parseInt(req.query.limit) || 100;
    const mapping = SYMBOL_MAP[symbol] || { binance: symbol, gecko: symbol.toLowerCase().replace('usdt', '') };

    // Try Binance
    try {
        console.log(`[Binance] Fetching ${interval} klines for ${symbol}...`);
        const response = await fetch(`${BINANCE_API}/klines?symbol=${mapping.binance}&interval=${interval}&limit=${limit}`);
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
            console.log(`[Binance] Success: ${candles.length} candles`);
            return res.json({
                source: 'binance',
                symbol: symbol,
                interval: interval,
                count: candles.length,
                candles: candles
            });
        }
    } catch (e) {
        console.log('[Binance] Klines failed, trying CoinGecko...');
    }

    // Fallback to CoinGecko OHLC
    try {
        // CoinGecko: days=1 gives 30min candles, days=7 gives 4hr candles
        const days = interval === '5m' || interval === '15m' || interval === '30m' ? 1 : 7;
        console.log(`[CoinGecko] Fetching OHLC for ${mapping.gecko} (${days} days)...`);

        const response = await fetch(`${COINGECKO_API}/coins/${mapping.gecko}/ohlc?vs_currency=usd&days=${days}`);
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

            const actualInterval = days === 1 ? '30m' : '4h';
            console.log(`[CoinGecko] Success: ${candles.length} candles (${actualInterval})`);

            return res.json({
                source: 'coingecko',
                symbol: symbol,
                interval: actualInterval,
                count: candles.length,
                candles: candles
            });
        }
    } catch (e) {
        console.error('[CoinGecko] OHLC also failed:', e.message);
    }

    res.status(500).json({ error: 'All kline sources failed' });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
    console.log(`Data sources: Binance (primary) → CoinGecko (fallback)`);
    console.log('='.repeat(50));
});
