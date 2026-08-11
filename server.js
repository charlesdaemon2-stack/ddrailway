const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Gerçekçi User-Agent Havuzu (Anti-Bot Bypass Rotasyonu)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
];

// Durum ve Metrikler
let isRunning = false;
let targetUrl = "";
let concurrency = 10;
let delay = 50;
let timeoutMs = 3000;
let httpMethod = "GET";
let enableUARotation = true;
let intervalId = null;

let metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    activeRequests: 0,
    totalLatencyMs: 0,
    minLatencyMs: null,
    maxLatencyMs: 0,
    startTime: null,
    statusCodes: {}
};

let httpAgent = null;
let httpsAgent = null;

function createAgents() {
    httpAgent = new http.Agent({ keepAlive: true, maxSockets: 500 });
    httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 500 });
}
createAgents();

function stopCurrentTest() {
    isRunning = false;
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    if (httpAgent) {
        try { httpAgent.destroy(); } catch (err) {}
    }
    if (httpsAgent) {
        try { httpsAgent.destroy(); } catch (err) {}
    }
    createAgents();
}

function getRandomUserAgent() {
    if (!enableUARotation) return USER_AGENTS[0];
    const index = Math.floor(Math.random() * USER_AGENTS.length);
    return USER_AGENTS[index];
}

function sendRequest(urlStr) {
    if (!isRunning) return;

    metrics.activeRequests++;
    const startTime = Date.now();

    try {
        const parsedUrl = new URL(urlStr);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        const agent = isHttps ? httpsAgent : httpAgent;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: httpMethod,
            agent: agent,
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': parsedUrl.origin + '/',
                'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'cross-site',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        };

        let handled = false;

        const req = client.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => {
                if (handled) return;
                handled = true;
                metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
                if (!isRunning) return;

                const latency = Date.now() - startTime;
                metrics.totalRequests++;
                metrics.totalLatencyMs += latency;
                if (metrics.minLatencyMs === null || latency < metrics.minLatencyMs) metrics.minLatencyMs = latency;
                if (latency > metrics.maxLatencyMs) metrics.maxLatencyMs = latency;

                if (res.statusCode >= 200 && res.statusCode < 400) {
                    metrics.successfulRequests++;
                } else {
                    metrics.failedRequests++;
                }
                metrics.statusCodes[res.statusCode] = (metrics.statusCodes[res.statusCode] || 0) + 1;
            });
        });

        // Yanıt vermeyen soketler için Zaman Aşımı (Timeout) Koruması
        req.setTimeout(timeoutMs, () => {
            if (handled) return;
            handled = true;
            req.destroy();
            metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
            if (!isRunning) return;

            metrics.totalRequests++;
            metrics.failedRequests++;
            metrics.statusCodes['Timeout (408)'] = (metrics.statusCodes['Timeout (408)'] || 0) + 1;
        });

        req.on('error', (err) => {
            if (handled) return;
            handled = true;
            metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
            if (!isRunning) return;

            metrics.totalRequests++;
            metrics.failedRequests++;
            const errCode = err.code || 'Hata';
            metrics.statusCodes[errCode] = (metrics.statusCodes[errCode] || 0) + 1;
        });

        req.end();
    } catch (err) {
        metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
        if (!isRunning) return;
        metrics.totalRequests++;
        metrics.failedRequests++;
        metrics.statusCodes['Geçersiz URL'] = (metrics.statusCodes['Geçersiz URL'] || 0) + 1;
    }
}

// API Endpoints
app.get('/api/start', (req, res) => {
    const url = req.query.url;
    const reqConcurrency = parseInt(req.query.concurrency) || 10;
    const reqDelay = parseInt(req.query.delay) || 50;
    const reqTimeout = parseInt(req.query.timeout) || 3000;
    const reqMethod = (req.query.method || 'GET').toUpperCase();
    const reqUARotation = req.query.uaRotation === 'true';

    if (!url) return res.status(400).json({ error: "Hedef URL gerekli!" });

    stopCurrentTest();

    targetUrl = url;
    concurrency = reqConcurrency;
    delay = reqDelay;
    timeoutMs = reqTimeout;
    httpMethod = ['GET', 'HEAD', 'POST'].includes(reqMethod) ? reqMethod : 'GET';
    enableUARotation = reqUARotation;
    isRunning = true;

    metrics = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        activeRequests: 0,
        totalLatencyMs: 0,
        minLatencyMs: null,
        maxLatencyMs: 0,
        startTime: new Date(),
        statusCodes: {}
    };

    intervalId = setInterval(() => {
        if (!isRunning) {
            clearInterval(intervalId);
            intervalId = null;
            return;
        }
        // Eğer havuzda halihazırda çok fazla yanıt bekleyen istek biriktiyse (örneğin concurrency * 10), yenilerini yığma
        if (metrics.activeRequests > concurrency * 10) {
            return;
        }
        for (let i = 0; i < concurrency; i++) {
            sendRequest(targetUrl);
        }
    }, delay);

    res.json({ message: "Test başlatıldı", targetUrl, concurrency, delay, timeoutMs, httpMethod, enableUARotation });
});

app.get('/api/stop', (req, res) => {
    stopCurrentTest();
    const durationSec = metrics.startTime ? ((new Date() - metrics.startTime) / 1000).toFixed(2) : 0;
    res.json({ message: "Test durduruldu", durationSeconds: durationSec, metrics });
});

app.get('/api/status', (req, res) => {
    const durationSec = metrics.startTime && isRunning ? ((new Date() - metrics.startTime) / 1000).toFixed(2) : 0;
    const reqPerSec = durationSec > 0 ? (metrics.totalRequests / durationSec).toFixed(2) : 0;
    const avgLatency = metrics.totalRequests > 0 ? Math.round(metrics.totalLatencyMs / metrics.totalRequests) : 0;

    const mem = process.memoryUsage();
    const ramHeapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const ramRssMb = (mem.rss / 1024 / 1024).toFixed(1);

    res.json({
        isRunning,
        targetUrl,
        concurrency,
        delay,
        timeoutMs,
        httpMethod,
        enableUARotation,
        durationSeconds: durationSec,
        requestsPerSecond: reqPerSec,
        avgLatencyMs: avgLatency,
        system: {
            ramHeapMb,
            ramRssMb
        },
        metrics
    });
});

// Modern Web Arayüzü (Ana Sayfa)
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>⚡ Gelişmiş Sunucu Yük Testi Kontrol Paneli</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
        body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .container { background: #1e293b; width: 100%; max-width: 950px; padding: 30px; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border: 1px solid #334155; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; border-bottom: 1px solid #334155; padding-bottom: 15px; }
        .title { font-size: 1.5rem; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 10px; }
        .badge { padding: 6px 14px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .badge-idle { background: #334155; color: #94a3b8; }
        .badge-running { background: #10b981; color: #022c22; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; font-size: 0.85rem; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        input[type="url"], input[type="number"], select { width: 100%; padding: 12px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 0.95rem; outline: none; transition: 0.2s; }
        input:focus, select:focus { border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2); }
        
        .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        
        .checkbox-group { display: flex; align-items: center; gap: 10px; background: #0f172a; padding: 12px 16px; border-radius: 8px; border: 1px solid #334155; margin-top: 24px; cursor: pointer; }
        .checkbox-group input { width: 18px; height: 18px; cursor: pointer; accent-color: #38bdf8; }
        .checkbox-group label { margin: 0; cursor: pointer; font-size: 0.9rem; text-transform: none; color: #e2e8f0; }

        .btn-group { display: flex; gap: 15px; margin-top: 25px; }
        button { flex: 1; padding: 14px; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: 0.2s; }
        .btn-start { background: #0284c7; color: white; }
        .btn-start:hover { background: #0369a1; }
        .btn-stop { background: #ef4444; color: white; }
        .btn-stop:hover { background: #dc2626; }
        button:disabled { opacity: 0.4; cursor: not-allowed; }

        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-top: 25px; }
        .stat-card { background: #0f172a; padding: 16px; border-radius: 10px; border: 1px solid #334155; text-align: center; }
        .stat-val { font-size: 1.5rem; font-weight: 700; color: #f8fafc; margin-top: 4px; }
        .stat-label { font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        
        .chart-box { margin-top: 25px; background: #0f172a; padding: 20px; border-radius: 10px; border: 1px solid #334155; }
        .chart-title { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; color: #94a3b8; margin-bottom: 12px; letter-spacing: 0.5px; }

        .status-codes { margin-top: 20px; background: #0f172a; padding: 18px; border-radius: 10px; border: 1px solid #334155; font-size: 0.9rem; color: #cbd5e1; }
        .status-codes-title { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; color: #94a3b8; margin-bottom: 10px; letter-spacing: 0.5px; }
        .code-pill { display: inline-block; background: #1e293b; border: 1px solid #334155; padding: 4px 10px; border-radius: 6px; margin-right: 8px; margin-bottom: 6px; font-size: 0.85rem; font-weight: 600; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="title">⚡ Yük Testi Kontrol Paneli</div>
            <div id="statusBadge" class="badge badge-idle">BEKLEMEDE</div>
        </div>

        <div class="form-group">
            <label for="targetUrl">HEDEF WEB SİTESİ URL</label>
            <input type="url" id="targetUrl" placeholder="https://hedef-site.com" value="https://google.com">
        </div>

        <div class="grid-3">
            <div class="form-group">
                <label for="concurrency">EŞZAMANLI İSTEK (CONCURRENCY)</label>
                <input type="number" id="concurrency" value="10" min="1" max="500">
            </div>
            <div class="form-group">
                <label for="delay">ARALIK SÜRESİ (MS)</label>
                <input type="number" id="delay" value="50" min="5" max="5000">
            </div>
            <div class="form-group">
                <label for="timeout">ZAMAN AŞIMI (TIMEOUT MS)</label>
                <input type="number" id="timeout" value="3000" min="100" max="30000">
            </div>
        </div>

        <div class="grid-2">
            <div class="form-group">
                <label for="method">HTTP METODU</label>
                <select id="method">
                    <option value="GET" selected>GET</option>
                    <option value="HEAD">HEAD</option>
                    <option value="POST">POST</option>
                </select>
            </div>
            <div class="checkbox-group" onclick="document.getElementById('uaRotation').click();">
                <input type="checkbox" id="uaRotation" checked onclick="event.stopPropagation();">
                <label for="uaRotation">User-Agent Rotasyonu (Anti-Bot Bypass)</label>
            </div>
        </div>

        <div class="btn-group">
            <button id="btnStart" class="btn-start" onclick="startTest()">🚀 Testi Başlat</button>
            <button id="btnStop" class="btn-stop" onclick="stopTest()" disabled>🛑 Durdur</button>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Toplam İstek</div>
                <div id="statTotal" class="stat-val">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">İstek / Saniye (RPS)</div>
                <div id="statRps" class="stat-val" style="color:#38bdf8">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Ortalama Gecikme</div>
                <div id="statLatency" class="stat-val" style="color:#a855f7">0 ms</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Aktif Bekleyen</div>
                <div id="statActive" class="stat-val" style="color:#f59e0b">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Başarılı İstekler</div>
                <div id="statSuccess" class="stat-val" style="color:#10b981">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Hatalı / Zaman Aşımı</div>
                <div id="statFailed" class="stat-val" style="color:#ef4444">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Sunucu RAM Kullanımı</div>
                <div id="statRam" class="stat-val" style="color:#ec4899">0 MB</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Test Süresi</div>
                <div id="statDuration" class="stat-val" style="color:#cbd5e1">0s</div>
            </div>
        </div>

        <!-- Canlı Grafik (Chart.js) -->
        <div class="chart-box">
            <div class="chart-title">📈 Canlı Performans Grafiği (RPS & Gecikme)</div>
            <canvas id="liveChart" height="90"></canvas>
        </div>

        <div class="status-codes">
            <div class="status-codes-title">HTTP Durum Dağılımı:</div>
            <div id="statusCodes">Henüz veri yok</div>
        </div>
    </div>

    <script>
        let updateInterval = null;
        let chartInstance = null;

        // Chart.js Kurulumu
        function initChart() {
            const ctx = document.getElementById('liveChart').getContext('2d');
            chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'RPS (İstek/sn)',
                            data: [],
                            borderColor: '#38bdf8',
                            backgroundColor: 'rgba(56, 189, 248, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Gecikme (ms)',
                            data: [],
                            borderColor: '#a855f7',
                            backgroundColor: 'rgba(168, 85, 247, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    animation: false,
                    scales: {
                        x: {
                            ticks: { color: '#64748b', font: { size: 10 } },
                            grid: { color: 'rgba(51, 65, 85, 0.5)' }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: { display: true, text: 'RPS', color: '#38bdf8' },
                            ticks: { color: '#38bdf8' },
                            grid: { color: 'rgba(51, 65, 85, 0.5)' },
                            beginAtZero: true
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            title: { display: true, text: 'Gecikme (ms)', color: '#a855f7' },
                            ticks: { color: '#a855f7' },
                            grid: { drawOnChartArea: false },
                            beginAtZero: true
                        }
                    },
                    plugins: {
                        legend: { labels: { color: '#cbd5e1' } }
                    }
                }
            });
        }

        async function startTest() {
            const url = document.getElementById('targetUrl').value;
            const concurrency = document.getElementById('concurrency').value;
            const delay = document.getElementById('delay').value;
            const timeout = document.getElementById('timeout').value;
            const method = document.getElementById('method').value;
            const uaRotation = document.getElementById('uaRotation').checked;

            if (!url) return alert('Lütfen geçerli bir URL girin!');

            try {
                const res = await fetch(\`/api/start?url=\${encodeURIComponent(url)}&concurrency=\${concurrency}&delay=\${delay}&timeout=\${timeout}&method=\${method}&uaRotation=\${uaRotation}\`);
                const data = await res.json();
                if (res.ok) {
                    setRunningUI(true);
                    if (!updateInterval) {
                        updateInterval = setInterval(fetchStatus, 1000);
                    }
                    fetchStatus();
                } else {
                    alert(data.error || 'Hata oluştu');
                }
            } catch (err) {
                alert('Sunucuya bağlanılamadı!');
            }
        }

        async function stopTest() {
            try {
                const res = await fetch('/api/stop');
                await res.json();
                setRunningUI(false);
                if (updateInterval) {
                    clearInterval(updateInterval);
                    updateInterval = null;
                }
                fetchStatus();
            } catch (err) {
                alert('Durdururken hata oluştu!');
            }
        }

        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                
                document.getElementById('statTotal').innerText = data.metrics.totalRequests.toLocaleString();
                document.getElementById('statRps').innerText = data.requestsPerSecond;
                document.getElementById('statLatency').innerText = data.avgLatencyMs + ' ms';
                document.getElementById('statActive').innerText = data.metrics.activeRequests.toLocaleString();
                document.getElementById('statSuccess').innerText = data.metrics.successfulRequests.toLocaleString();
                document.getElementById('statFailed').innerText = data.metrics.failedRequests.toLocaleString();
                document.getElementById('statDuration').innerText = (data.durationSeconds || 0) + 's';
                
                if (data.system) {
                    document.getElementById('statRam').innerText = data.system.ramHeapMb + ' MB';
                }

                // Grafik Güncelleme (Son 20 saniyelik zaman serisi)
                if (chartInstance) {
                    const timeStr = new Date().toLocaleTimeString('tr-TR', { hour12: false });
                    chartInstance.data.labels.push(timeStr);
                    chartInstance.data.datasets[0].data.push(parseFloat(data.requestsPerSecond) || 0);
                    chartInstance.data.datasets[1].data.push(data.avgLatencyMs || 0);

                    if (chartInstance.data.labels.length > 20) {
                        chartInstance.data.labels.shift();
                        chartInstance.data.datasets[0].data.shift();
                        chartInstance.data.datasets[1].data.shift();
                    }
                    chartInstance.update();
                }

                const codeEntries = Object.entries(data.metrics.statusCodes);
                if (codeEntries.length > 0) {
                    document.getElementById('statusCodes').innerHTML = codeEntries.map(([code, count]) => {
                        const isSuccess = code >= 200 && code < 400;
                        const color = isSuccess ? '#10b981' : '#ef4444';
                        return \`<span class="code-pill" style="border-color:\${color}; color:\${color}">HTTP \${code}: \${count.toLocaleString()}</span>\`;
                    }).join('');
                } else {
                    document.getElementById('statusCodes').innerText = 'Henüz HTTP yanıtı alınmadı';
                }

                if (data.isRunning) {
                    setRunningUI(true);
                    if (!updateInterval) {
                        updateInterval = setInterval(fetchStatus, 1000);
                    }
                } else {
                    setRunningUI(false);
                    if (updateInterval) {
                        clearInterval(updateInterval);
                        updateInterval = null;
                    }
                }
            } catch (err) {}
        }

        function setRunningUI(running) {
            const badge = document.getElementById('statusBadge');
            const btnStart = document.getElementById('btnStart');
            const btnStop = document.getElementById('btnStop');

            if (running) {
                badge.innerText = 'ÇALIŞIYOR';
                badge.className = 'badge badge-running';
                btnStart.disabled = true;
                btnStop.disabled = false;
            } else {
                badge.innerText = 'BEKLEMEDE';
                badge.className = 'badge badge-idle';
                btnStart.disabled = false;
                btnStop.disabled = true;
            }
        }

        initChart();
        fetchStatus();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`🖥️ Kontrol paneli ${PORT} portunda çalışıyor.`);
});
