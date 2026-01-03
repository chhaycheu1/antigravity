/**
 * NEAR Trading Dashboard - Frontend
 * Fetches data from our backend server
 * Real 5-minute candles from Binance via backend proxy
 */

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    symbol: 'NEARUSDT',
    base: 'NEAR',
    interval: '5m',
    candleLimit: 100, // 100 x 5min = ~8 hours

    // Backend API (same origin, no CORS issues)
    apiBase: '/api',

    // Indicator settings
    ema: { fast: 9, slow: 21 },
    bollinger: { period: 20, stdDev: 2 },
    rsi: { period: 14, overbought: 70, oversold: 30 },

    // Risk management
    takeProfitPercent: 1.5,
    stopLossPercent: 0.8,
};

// ============================================
// STATE
// ============================================
const state = {
    candles: [],
    currentPrice: 0,
    priceChange: 0,
    indicators: {},
    signals: [],
    chart: null,
    candleSeries: null,
    ema9Line: null,
    ema21Line: null,
    bbUpperLine: null,
    bbLowerLine: null,
    bbMiddleLine: null
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
const formatPrice = (price, decimals = 4) => {
    const num = parseFloat(price);
    if (isNaN(num)) return '$0.0000';
    return '$' + num.toFixed(decimals);
};

const formatPercent = (percent) => {
    const num = parseFloat(percent);
    if (isNaN(num)) return '0.00%';
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
};

const formatDateTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
};

const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
};

// ============================================
// TECHNICAL INDICATORS
// ============================================
function calculateEMA(data, period) {
    const ema = [];
    const multiplier = 2 / (period + 1);

    let sum = 0;
    for (let i = 0; i < period && i < data.length; i++) {
        sum += data[i];
    }
    ema.push(sum / Math.min(period, data.length));

    for (let i = 1; i < data.length; i++) {
        const currentEMA = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
        ema.push(currentEMA);
    }

    return ema;
}

function calculateSMA(data, period) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            sma.push(null);
        } else {
            const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            sma.push(sum / period);
        }
    }
    return sma;
}

function calculateStdDev(data, period, sma) {
    const stdDev = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1 || sma[i] === null) {
            stdDev.push(null);
        } else {
            const slice = data.slice(i - period + 1, i + 1);
            const mean = sma[i];
            const squaredDiffs = slice.map(val => Math.pow(val - mean, 2));
            const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
            stdDev.push(Math.sqrt(variance));
        }
    }
    return stdDev;
}

function calculateBollingerBands(closes, period = 20, stdDevMultiplier = 2) {
    const sma = calculateSMA(closes, period);
    const stdDev = calculateStdDev(closes, period, sma);

    const upper = [], lower = [], middle = sma;

    for (let i = 0; i < closes.length; i++) {
        if (sma[i] === null || stdDev[i] === null) {
            upper.push(null);
            lower.push(null);
        } else {
            upper.push(sma[i] + stdDevMultiplier * stdDev[i]);
            lower.push(sma[i] - stdDevMultiplier * stdDev[i]);
        }
    }

    return { upper, middle, lower };
}

function calculateRSI(closes, period = 14) {
    const rsi = [];
    const gains = [], losses = [];

    for (let i = 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
    }

    for (let i = 0; i < period; i++) {
        rsi.push(50);
    }

    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) {
        rsi.push(100);
    } else {
        const rs = avgGain / avgLoss;
        rsi.push(100 - (100 / (1 + rs)));
    }

    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

        if (avgLoss === 0) {
            rsi.push(100);
        } else {
            const rs = avgGain / avgLoss;
            rsi.push(100 - (100 / (1 + rs)));
        }
    }

    return rsi;
}

// ============================================
// SIGNAL DETECTION
// ============================================
function detectSignals(candles, indicators) {
    const signals = [];
    const { ema9, ema21, bb, rsi } = indicators;

    if (candles.length < 25) return signals;

    for (let i = 22; i < candles.length; i++) {
        const candle = candles[i];
        const prevCandle = candles[i - 1];
        const price = candle.close;
        const time = candle.time * 1000;

        const currentEma9 = ema9[i];
        const currentEma21 = ema21[i];
        const prevEma9 = ema9[i - 1];
        const prevEma21 = ema21[i - 1];
        const currentRSI = rsi[i];
        const prevRSI = rsi[i - 1];
        const bbUpper = bb.upper[i];
        const bbLower = bb.lower[i];

        // LONG signals
        const emaGoldenCross = prevEma9 <= prevEma21 && currentEma9 > currentEma21;
        const bbLowerBounce = prevCandle.low <= bb.lower[i - 1] && price > bbLower && price > prevCandle.close;
        const rsiOversoldRecovery = prevRSI <= 30 && currentRSI > 30;

        if (emaGoldenCross || (bbLowerBounce && currentRSI < 50) || rsiOversoldRecovery) {
            let strength = 0, reasons = [];

            if (emaGoldenCross) { strength += 40; reasons.push('EMA Golden Cross'); }
            if (bbLowerBounce) { strength += 30; reasons.push('BB Lower Bounce'); }
            if (rsiOversoldRecovery) { strength += 30; reasons.push('RSI Oversold Recovery'); }
            if (currentEma9 > currentEma21) strength += 10;
            if (currentRSI < 50) strength += 10;

            if (strength >= 30) {
                signals.push({
                    type: 'LONG',
                    time: time,
                    price: price,
                    takeProfit: price * (1 + CONFIG.takeProfitPercent / 100),
                    stopLoss: price * (1 - CONFIG.stopLossPercent / 100),
                    strength: Math.min(strength, 100),
                    reasons: reasons,
                    rsi: currentRSI,
                    ema9: currentEma9,
                    ema21: currentEma21
                });
            }
        }

        // SHORT signals
        const emaDeathCross = prevEma9 >= prevEma21 && currentEma9 < currentEma21;
        const bbUpperReject = prevCandle.high >= bb.upper[i - 1] && price < bbUpper && price < prevCandle.close;
        const rsiOverboughtReject = prevRSI >= 70 && currentRSI < 70;

        if (emaDeathCross || (bbUpperReject && currentRSI > 50) || rsiOverboughtReject) {
            let strength = 0, reasons = [];

            if (emaDeathCross) { strength += 40; reasons.push('EMA Death Cross'); }
            if (bbUpperReject) { strength += 30; reasons.push('BB Upper Rejection'); }
            if (rsiOverboughtReject) { strength += 30; reasons.push('RSI Overbought Rejection'); }
            if (currentEma9 < currentEma21) strength += 10;
            if (currentRSI > 50) strength += 10;

            if (strength >= 30) {
                signals.push({
                    type: 'SHORT',
                    time: time,
                    price: price,
                    takeProfit: price * (1 - CONFIG.takeProfitPercent / 100),
                    stopLoss: price * (1 + CONFIG.stopLossPercent / 100),
                    strength: Math.min(strength, 100),
                    reasons: reasons,
                    rsi: currentRSI,
                    ema9: currentEma9,
                    ema21: currentEma21
                });
            }
        }
    }

    return signals;
}

// ============================================
// API FUNCTIONS - CALLS OUR BACKEND
// ============================================
async function fetchData() {
    try {
        console.log('Fetching data from backend...');

        // Fetch price
        const priceRes = await fetch(`${CONFIG.apiBase}/price/${CONFIG.symbol}`);
        if (!priceRes.ok) throw new Error('Price fetch failed');
        const priceData = await priceRes.json();

        console.log(`Current price: $${priceData.price}`);

        // Fetch candles
        const klineRes = await fetch(`${CONFIG.apiBase}/klines/${CONFIG.symbol}?interval=${CONFIG.interval}&limit=${CONFIG.candleLimit}`);
        if (!klineRes.ok) throw new Error('Klines fetch failed');
        const klineData = await klineRes.json();

        console.log(`Fetched ${klineData.count} candles (${CONFIG.interval} timeframe)`);

        return {
            candles: klineData.candles,
            currentPrice: priceData.price,
            priceChange: priceData.priceChange
        };

    } catch (error) {
        console.error('Backend API failed:', error);
        return null;
    }
}

// ============================================
// CHART CREATION
// ============================================
function createChart() {
    const container = document.getElementById('chartContainer');
    if (!container) return;

    container.innerHTML = '';

    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 450,
        layout: {
            background: { type: 'solid', color: '#0a0a0f' },
            textColor: 'rgba(255, 255, 255, 0.7)',
        },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: 'rgba(99, 102, 241, 0.5)', width: 1 },
            horzLine: { color: 'rgba(99, 102, 241, 0.5)', width: 1 },
        },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            scaleMargins: { top: 0.05, bottom: 0.05 },
        },
        timeScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 5,
        },
    });

    const candleSeries = chart.addCandlestickSeries({
        upColor: '#00ff88',
        downColor: '#ef4444',
        borderUpColor: '#00ff88',
        borderDownColor: '#ef4444',
        wickUpColor: '#00ff88',
        wickDownColor: '#ef4444',
    });

    const ema9Line = chart.addLineSeries({
        color: '#fbbf24',
        lineWidth: 2,
        title: 'EMA 9',
    });

    const ema21Line = chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        title: 'EMA 21',
    });

    const bbUpperLine = chart.addLineSeries({
        color: 'rgba(139, 92, 246, 0.6)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
    });

    const bbLowerLine = chart.addLineSeries({
        color: 'rgba(139, 92, 246, 0.6)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
    });

    const bbMiddleLine = chart.addLineSeries({
        color: 'rgba(139, 92, 246, 0.3)',
        lineWidth: 1,
    });

    const resizeObserver = new ResizeObserver(entries => {
        chart.applyOptions({ width: entries[0].contentRect.width });
    });
    resizeObserver.observe(container);

    state.chart = chart;
    state.candleSeries = candleSeries;
    state.ema9Line = ema9Line;
    state.ema21Line = ema21Line;
    state.bbUpperLine = bbUpperLine;
    state.bbLowerLine = bbLowerLine;
    state.bbMiddleLine = bbMiddleLine;
}

function updateChart(candles, indicators) {
    if (!state.candleSeries) return;

    state.candleSeries.setData(candles);

    const ema9Data = candles.map((c, i) => ({
        time: c.time,
        value: indicators.ema9[i]
    })).filter(d => d.value !== null && !isNaN(d.value));
    state.ema9Line.setData(ema9Data);

    const ema21Data = candles.map((c, i) => ({
        time: c.time,
        value: indicators.ema21[i]
    })).filter(d => d.value !== null && !isNaN(d.value));
    state.ema21Line.setData(ema21Data);

    const bbUpperData = candles.map((c, i) => ({
        time: c.time,
        value: indicators.bb.upper[i]
    })).filter(d => d.value !== null && !isNaN(d.value));
    state.bbUpperLine.setData(bbUpperData);

    const bbLowerData = candles.map((c, i) => ({
        time: c.time,
        value: indicators.bb.lower[i]
    })).filter(d => d.value !== null && !isNaN(d.value));
    state.bbLowerLine.setData(bbLowerData);

    const bbMiddleData = candles.map((c, i) => ({
        time: c.time,
        value: indicators.bb.middle[i]
    })).filter(d => d.value !== null && !isNaN(d.value));
    state.bbMiddleLine.setData(bbMiddleData);

    // Add signal markers
    const markers = state.signals.slice(-10).map(s => ({
        time: Math.floor(s.time / 1000),
        position: s.type === 'LONG' ? 'belowBar' : 'aboveBar',
        color: s.type === 'LONG' ? '#00ff88' : '#ef4444',
        shape: s.type === 'LONG' ? 'arrowUp' : 'arrowDown',
        text: s.type
    }));
    state.candleSeries.setMarkers(markers);

    state.chart.timeScale().fitContent();
}

// ============================================
// UI FUNCTIONS
// ============================================
function updateUI(candles, indicators) {
    document.getElementById('currentPrice').textContent = formatPrice(state.currentPrice);

    const changeEl = document.getElementById('priceChange');
    changeEl.textContent = formatPercent(state.priceChange);
    changeEl.className = `price-change ${state.priceChange >= 0 ? 'positive' : 'negative'}`;

    const lastIndex = candles.length - 1;
    document.getElementById('ema9Value').textContent = formatPrice(indicators.ema9[lastIndex]);
    document.getElementById('ema21Value').textContent = formatPrice(indicators.ema21[lastIndex]);
    document.getElementById('bbUpperValue').textContent = formatPrice(indicators.bb.upper[lastIndex]);
    document.getElementById('bbLowerValue').textContent = formatPrice(indicators.bb.lower[lastIndex]);

    const rsiValue = indicators.rsi[lastIndex];
    const rsiEl = document.getElementById('rsiValue');
    rsiEl.textContent = rsiValue.toFixed(1);
    rsiEl.className = `rsi-value ${rsiValue >= 70 ? 'overbought' : rsiValue <= 30 ? 'oversold' : ''}`;

    document.getElementById('rsiFill').style.width = `${rsiValue}%`;
    document.getElementById('rsiFill').className = `rsi-fill ${rsiValue >= 70 ? 'overbought' : rsiValue <= 30 ? 'oversold' : ''}`;

    document.getElementById('lastUpdate').textContent = formatTime(Date.now());

    updateLatestSignal();
    updateSignalHistory();
}

function updateLatestSignal() {
    const signalCard = document.getElementById('signalCard');
    const lastSignal = state.signals[state.signals.length - 1];

    if (!lastSignal) {
        signalCard.innerHTML = `
            <div class="no-signal">
                <div class="no-signal-icon">📊</div>
                <div class="no-signal-text">No recent signals</div>
                <div class="no-signal-sub">Waiting for setup...</div>
            </div>
        `;
        return;
    }

    const isLong = lastSignal.type === 'LONG';
    const timeSince = Math.floor((Date.now() - lastSignal.time) / 1000 / 60);
    const timeText = timeSince > 60 ? `${Math.floor(timeSince / 60)}h ${timeSince % 60}m ago` : `${timeSince}m ago`;

    signalCard.innerHTML = `
        <div class="signal-type ${isLong ? 'long' : 'short'}">
            <span class="signal-icon">${isLong ? '🚀' : '📉'}</span>
            <span class="signal-text">${lastSignal.type}</span>
            <span class="signal-strength">${lastSignal.strength}%</span>
        </div>
        
        <div class="signal-prices">
            <div class="signal-price-row entry">
                <span class="label">Entry Price</span>
                <span class="value">${formatPrice(lastSignal.price)}</span>
                <span class="time">${formatDateTime(lastSignal.time)}</span>
            </div>
            <div class="signal-price-row tp">
                <span class="label">Take Profit</span>
                <span class="value">${formatPrice(lastSignal.takeProfit)}</span>
                <span class="percent">+${CONFIG.takeProfitPercent}%</span>
            </div>
            <div class="signal-price-row sl">
                <span class="label">Stop Loss</span>
                <span class="value">${formatPrice(lastSignal.stopLoss)}</span>
                <span class="percent">-${CONFIG.stopLossPercent}%</span>
            </div>
        </div>
        
        <div class="signal-reasons">
            <div class="reasons-title">Signal Triggers:</div>
            ${lastSignal.reasons.map(r => `<span class="reason-tag">${r}</span>`).join('')}
        </div>
        
        <div class="signal-meta">
            <span class="meta-item">RSI: ${lastSignal.rsi.toFixed(1)}</span>
            <span class="meta-item">${timeText}</span>
        </div>
    `;
}

function updateSignalHistory() {
    const container = document.getElementById('signalHistory');
    const recentSignals = state.signals.slice(-5).reverse();

    if (recentSignals.length === 0) {
        container.innerHTML = '<div class="no-history">No signals detected</div>';
        return;
    }

    container.innerHTML = recentSignals.map(s => `
        <div class="history-item ${s.type.toLowerCase()}">
            <div class="history-type">${s.type}</div>
            <div class="history-price">${formatPrice(s.price)}</div>
            <div class="history-time">${formatDateTime(s.time)}</div>
        </div>
    `).join('');
}

// ============================================
// INITIALIZATION
// ============================================
async function init() {
    console.log('='.repeat(50));
    console.log('NEAR Trading Dashboard - Frontend');
    console.log('Using backend API for real Binance data');
    console.log('='.repeat(50));

    createChart();

    const data = await fetchData();

    if (!data || !data.candles || data.candles.length === 0) {
        document.getElementById('loadingOverlay').innerHTML = `
            <div class="no-signal">
                <div class="no-signal-icon">❌</div>
                <div class="no-signal-text">Failed to load data</div>
                <div class="no-signal-sub">Make sure backend server is running</div>
            </div>
        `;
        return;
    }

    state.candles = data.candles;
    state.currentPrice = data.currentPrice;
    state.priceChange = data.priceChange;

    const closes = data.candles.map(c => c.close);
    const ema9 = calculateEMA(closes, CONFIG.ema.fast);
    const ema21 = calculateEMA(closes, CONFIG.ema.slow);
    const bb = calculateBollingerBands(closes, CONFIG.bollinger.period, CONFIG.bollinger.stdDev);
    const rsi = calculateRSI(closes, CONFIG.rsi.period);

    const indicators = { ema9, ema21, bb, rsi };
    state.indicators = indicators;

    state.signals = detectSignals(data.candles, indicators);

    updateChart(data.candles, indicators);
    updateUI(data.candles, indicators);

    document.getElementById('loadingOverlay').classList.add('hidden');

    console.log(`Dashboard ready: ${data.candles.length} candles, ${state.signals.length} signals`);
    console.log('Refresh page to update data');
}

document.addEventListener('DOMContentLoaded', init);
