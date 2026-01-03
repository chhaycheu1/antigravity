/**
 * NEAR Trading Dashboard - Backend Server
 * Multi-source API Proxy to guarantee data availability
 * Sources: Binance -> Binance US -> CryptoCompare -> CoinCap -> CoinGecko
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ===========================================
// CONFIGURATION
// ===========================================
const SOURCES = {
    BINANCE: 'https://api.binance.com/api/v3',
    BINANCE_US: 'https://api.binance.us/api/v3',
    COINGECKO: 'https://api.coingecko.com/api/v3',
    CRYPTOCOMPARE: 'https://min-api.cryptocompare.com/data',
    COINCAP: 'https://api.coincap.io/v2'
};

const SYMBOL_MAP = {
    'NEARUSDT': { binance: 'NEARUSDT', gecko: 'near', cc: 'NEAR', coincap: 'near-protocol' },
    'BTCUSDT': { binance: 'BTCUSDT', gecko: 'bitcoin', cc: 'BTC', coincap: 'bitcoin' },
    'ETHUSDT': { binance: 'ETHUSDT', gecko: 'ethereum', cc: 'ETH', coincap: 'ethereum' },
    'SOLUSDT': { binance: 'SOLUSDT', gecko: 'solana', cc: 'SOL', coincap: 'solana' },
};

// Axios instance with timeout and browser-like headers
const api = axios.create({
    timeout: 8000, // 8 seconds per request
    headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
});

// Helper for delays
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ===========================================
// FETCH STRATEGIES
// ===========================================

// Strategy 1: Binance (Global or US)
async function fetchBinancePrice(baseUrl, symbol) {
    const response = await api.get(`${baseUrl}/ticker/24hr`, { params: { symbol } });
    return {
        price: parseFloat(response.data.lastPrice),
        change: parseFloat(response.data.priceChangePercent),
        high: parseFloat(response.data.highPrice),
        low: parseFloat(response.data.lowPrice),
        vol: parseFloat(response.data.volume)
    };
}

// Strategy 2: CryptoCompare
async function fetchCryptoComparePrice(symbol) {
    // fsym=NEAR&tsyms=USD
    const response = await api.get(`${SOURCES.CRYPTOCOMPARE}/pricemultifull`, {
        params: { fsyms: symbol, tsyms: 'USD' }
    });
    const data = response.data.RAW[symbol].USD;
    return {
        price: data.PRICE,
        change: data.CHANGEPCT24HOUR,
        high: data.HIGH24HOUR,
        low: data.LOW24HOUR,
        vol: data.VOLUME24HOUR
    };
}

// Strategy 3: CoinCap
async function fetchCoinCapPrice(id) {
    const response = await api.get(`${SOURCES.COINCAP}/assets/${id}`);
    const data = response.data.data;
    return {
        price: parseFloat(data.priceUsd),
        change: parseFloat(data.changePercent24Hr),
        high: null, // Not readily avail
        low: null,
        vol: parseFloat(data.volumeUsd24Hr)
    };
}

// Strategy 4: CoinGecko
async function fetchCoinGeckoPrice(id) {
    const response = await api.get(`${SOURCES.COINGECKO}/simple/price`, {
        params: { ids: id, vs_currencies: 'usd', include_24hr_change: 'true' }
    });
    const data = response.data[id];
    return {
        price: data.usd,
        change: data.usd_24h_change,
        high: null,
        low: null,
        vol: null
    };
}

// ===========================================
// PRICE ENDPOINT
// ===========================================
app.get('/api/price/:symbol', async (req, res) => {
    const rawSymbol = req.params.symbol.toUpperCase();
    const map = SYMBOL_MAP[rawSymbol] || SYMBOL_MAP['NEARUSDT'];

    // 1. Try Binance Global
    try {
        const data = await fetchBinancePrice(SOURCES.BINANCE, map.binance);
        console.log(`[Binance] Price: ${data.price}`);
        return res.json({ source: 'binance', symbol: rawSymbol, price: data.price, priceChange: data.change });
    } catch (e) {
        console.log(`[Binance] Failed: ${e.message}`);
    }

    // 2. Try Binance US
    try {
        const data = await fetchBinancePrice(SOURCES.BINANCE_US, map.binance);
        console.log(`[Binance US] Price: ${data.price}`);
        return res.json({ source: 'binance_us', symbol: rawSymbol, price: data.price, priceChange: data.change });
    } catch (e) {
        console.log(`[Binance US] Failed: ${e.message}`);
    }

    // 3. Try CryptoCompare (Very reliable)
    try {
        const data = await fetchCryptoComparePrice(map.cc);
        console.log(`[CryptoCompare] Price: ${data.price}`);
        return res.json({ source: 'cryptocompare', symbol: rawSymbol, price: data.price, priceChange: data.change });
    } catch (e) {
        console.log(`[CryptoCompare] Failed: ${e.message}`);
    }

    // 4. Try CoinCap
    try {
        const data = await fetchCoinCapPrice(map.coincap);
        console.log(`[CoinCap] Price: ${data.price}`);
        return res.json({ source: 'coincap', symbol: rawSymbol, price: data.price, priceChange: data.change });
    } catch (e) {
        console.log(`[CoinCap] Failed: ${e.message}`);
    }

    // 5. Try CoinGecko
    try {
        const data = await fetchCoinGeckoPrice(map.gecko);
        console.log(`[CoinGecko] Price: ${data.price}`);
        return res.json({ source: 'coingecko', symbol: rawSymbol, price: data.price, priceChange: data.change });
    } catch (e) {
        console.log(`[CoinGecko] Failed: ${e.message}`);
    }

    res.status(500).json({ error: 'All price sources failed' });
});

// ===========================================
// KLINES STRATEGIES
// ===========================================

async function fetchBinanceKlines(baseUrl, symbol, interval, limit) {
    const response = await api.get(`${baseUrl}/klines`, {
        params: { symbol, interval, limit }
    });
    return response.data.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
    }));
}

async function fetchCryptoCompareKlines(symbol, interval, limit) {
    // Map intervals: 1m, 5m -> histominute; 1h -> histohour; 1d -> histoday
    let endpoint = 'histominute';
    let aggregate = 5; // default 5m

    if (interval === '1m') { aggregate = 1; }
    else if (interval === '5m') { aggregate = 5; }
    else if (interval === '15m') { aggregate = 15; }
    else if (interval === '30m') { aggregate = 30; }
    else if (interval === '1h') { endpoint = 'histohour'; aggregate = 1; }
    else if (interval === '4h') { endpoint = 'histohour'; aggregate = 4; }
    else if (interval === '1d') { endpoint = 'histoday'; aggregate = 1; }

    const response = await api.get(`${SOURCES.CRYPTOCOMPARE}/v2/${endpoint}`, {
        params: { fsym: symbol, tsym: 'USD', limit: limit, aggregate: aggregate }
    });

    return response.data.Data.Data.map(k => ({
        time: k.time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volumeto
    }));
}

async function fetchCoinCapKlines(id, interval, limit) {
    // CoinCap intervals: m1, m5, m15, m30, h1, h2, h6, h12, d1
    const map = {
        '1m': 'm1', '5m': 'm5', '15m': 'm15', '30m': 'm30',
        '1h': 'h1', '4h': 'h6', // Closest match
        '1d': 'd1'
    };

    const response = await api.get(`${SOURCES.COINCAP}/assets/${id}/history`, {
        params: { interval: map[interval] || 'm15', limit: limit } // CoinCap limit ignored mostly?
    });

    // CoinCap returns timestamps in ms
    return response.data.data.slice(-limit).map(k => ({
        time: Math.floor(k.time / 1000),
        open: parseFloat(k.priceUsd), // CoinCap history is price points, approximations
        high: parseFloat(k.priceUsd),
        low: parseFloat(k.priceUsd),
        close: parseFloat(k.priceUsd),
        volume: 0
    }));
}

// ===========================================
// KLINES ENDPOINT
// ===========================================
app.get('/api/klines/:symbol', async (req, res) => {
    const rawSymbol = req.params.symbol.toUpperCase();
    const interval = req.query.interval || '15m';
    const limit = parseInt(req.query.limit) || 100;
    const map = SYMBOL_MAP[rawSymbol] || SYMBOL_MAP['NEARUSDT'];

    // 1. Binance Global
    try {
        const candles = await fetchBinanceKlines(SOURCES.BINANCE, map.binance, interval, limit);
        console.log(`[Binance] Klines: ${candles.length}`);
        return res.json({ source: 'binance', symbol: rawSymbol, interval, count: candles.length, candles });
    } catch (e) { }

    // 2. Binance US
    try {
        const candles = await fetchBinanceKlines(SOURCES.BINANCE_US, map.binance, interval, limit);
        console.log(`[Binance US] Klines: ${candles.length}`);
        return res.json({ source: 'binance_us', symbol: rawSymbol, interval, count: candles.length, candles });
    } catch (e) { }

    // 3. CryptoCompare
    try {
        const candles = await fetchCryptoCompareKlines(map.cc, interval, limit);
        console.log(`[CryptoCompare] Klines: ${candles.length}`);
        return res.json({ source: 'cryptocompare', symbol: rawSymbol, interval, count: candles.length, candles });
    } catch (e) {
        console.log(`[CryptoCompare] Failed: ${e.message}`);
    }

    // 4. CoinGecko (OHLC Fallback)
    try {
        let days = 1;
        let actualInterval = '30m';
        if (['1h', '4h'].includes(interval)) { days = 7; actualInterval = '4h'; }

        const response = await api.get(`${SOURCES.COINGECKO}/coins/${map.gecko}/ohlc`, {
            params: { vs_currency: 'usd', days }
        });

        const candles = response.data.map(c => ({
            time: Math.floor(c[0] / 1000),
            open: c[1], high: c[2], low: c[3], close: c[4], volume: 0
        }));

        console.log(`[CoinGecko] Klines: ${candles.length}`);
        return res.json({ source: 'coingecko', symbol: rawSymbol, interval: actualInterval, count: candles.length, candles });
    } catch (e) { }

    res.status(500).json({ error: 'All kline sources failed' });
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), sources: Object.keys(SOURCES) });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Robust Multi-Source API Proxy Active');
});
