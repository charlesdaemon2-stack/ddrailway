const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Durum ve Metrikler
let isRunning = false;
let targetUrl = "";
let concurrency = 10;
let delay = 50;
let intervalId = null;

let metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    startTime: null,
    statusCodes: {}
};

let httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
let httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

function createAgents() {
    httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
    httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });
}

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

// Chrome Taklitli Gelişmiş İstek Fonksiyonu
function sendRequest(urlStr) {
    if (!isRunning) return;

    try {
        const parsedUrl = new URL(urlStr);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        const agent = isHttps ? httpsAgent : httpAgent;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            agent: agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
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
                'Cache-Control': 'no-cache'
            }
        };

        const req = client.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', () => {
                if (!isRunning) return;
                metrics.totalRequests++;
                if (res.statusCode >= 200 && res.statusCode < 400) {
                    metrics.successfulRequests++;
                } else {
                    metrics.failedRequests++;
                }
                metrics.statusCodes[res.statusCode] = (metrics.statusCodes[res.statusCode] || 0) + 1;
            });
        });

        req.on('error', () => {
            if (!isRunning) return;
            metrics.totalRequests++;
            metrics.failedRequests++;
        });

        req.end();
    } catch (err) {
        if (!isRunning) return;
        metrics.failedRequests++;
    }
}

// API Endpoints
app.get('/api/start', (req, res) => {
    const url = req.query.url;
    const reqConcurrency = parseInt(req.query.concurrency) || 5;
    const reqDelay = parseInt(req.query.delay) || 50;

    if (!url) return res.status(400).json({ error: "Hedef URL gerekli!" });

    stopCurrentTest();

    targetUrl = url;
    concurrency = reqConcurrency;
    delay = reqDelay;
    isRunning = true;
    metrics = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        startTime: new Date(),
        statusCodes: {}
    };

    intervalId = setInterval(() => {
        if (!isRunning) {
            clearInterval(intervalId);
            intervalId = null;
            return;
        }
        for (let i = 0; i < concurrency; i++) {
            sendRequest(targetUrl);
        }
    }, delay);

    res.json({ message: "Test başlatıldı", targetUrl, concurrency, delay });
});

app.get('/api/stop', (req, res) => {
    stopCurrentTest();
    const durationSec = metrics.startTime ? ((new Date() - metrics.startTime) / 1000).toFixed(2) : 0;
    res.json({ message: "Test durduruldu", durationSeconds: durationSec, metrics });
});

app.get('/api/status', (req, res) => {
    const durationSec = metrics.startTime && isRunning ? ((new Date() - metrics.startTime) / 1000).toFixed(2) : 0;
    const reqPerSec = durationSec > 0 ? (metrics.totalRequests / durationSec).toFixed(2) : 0;

    res.json({
        isRunning,
        targetUrl,
        concurrency,
        delay,
        durationSeconds: durationSec,
        requestsPerSecond: reqPerSec,
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
    <title>Sunucu Yük Testi Kontrol Paneli</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
        body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .container { background: #1e293b; width: 100%; max-width: 800px; padding: 30px; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); border: 1px solid #334155; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; border-bottom: 1px solid #334155; padding-bottom: 15px; }
        .title { font-size: 1.4rem; font-weight: 700; color: #38bdf8; }
        .badge { padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; }
        .badge-idle { background: #475569; color: #cbd5e1; }
        .badge-running { background: #10b981; color: #022c22; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; font-size: 0.85rem; color: #94a3b8; font-weight: 600; }
        input[type="url"], input[type="number"] { width: 100%; padding: 12px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 1rem; outline: none; transition: 0.2s; }
        input:focus { border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2); }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }

        .btn-group { display: flex; gap: 15px; margin-top: 25px; }
        button { flex: 1; padding: 14px; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: 0.2s; }
        .btn-start { background: #0284c7; color: white; }
        .btn-start:hover { background: #0369a1; }
        .btn-stop { background: #ef4444; color: white; }
        .btn-stop:hover { background: #dc2626; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }

        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-top: 30px; }
        .stat-card { background: #0f172a; padding: 15px; border-radius: 10px; border: 1px solid #334155; text-align: center; }
        .stat-val { font-size: 1.4rem; font-weight: 700; color: #f8fafc; margin-top: 5px; }
        .stat-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        
        .status-codes { margin-top: 20px; background: #0f172a; padding: 15px; border-radius: 8px; font-size: 0.85rem; color: #cbd5e1; }
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

        <div class="grid-2">
            <div class="form-group">
                <label for="concurrency">EŞZAMANLI İSTEK (CONCURRENCY)</label>
                <input type="number" id="concurrency" value="10" min="1" max="100">
            </div>
            <div class="form-group">
                <label for="delay">ARALIK SÜRESİ (MS)</label>
                <input type="number" id="delay" value="50" min="10" max="5000">
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
                <div class="stat-label">Başarılı</div>
                <div id="statSuccess" class="stat-val" style="color:#10b981">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-failed">
                    <div class="stat-label">Hatalı</div>
                    <div id="statFailed" class="stat-val" style="color:#ef4444">0</div>
                </div>
            </div>
        </div>

        <div id="statusCodes" class="status-codes">HTTP Durum Kodları: Henüz veri yok</div>
    </div>

    <script>
        let updateInterval = null;

        async function startTest() {
            const url = document.getElementById('targetUrl').value;
            const concurrency = document.getElementById('concurrency').value;
            const delay = document.getElementById('delay').value;

            if (!url) return alert('Lütfen geçerli bir URL girin!');

            try {
                const res = await fetch(\`/api/start?url=\${encodeURIComponent(url)}&concurrency=\${concurrency}&delay=\${delay}\`);
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
                document.getElementById('statSuccess').innerText = data.metrics.successfulRequests.toLocaleString();
                document.getElementById('statFailed').innerText = data.metrics.failedRequests.toLocaleString();

                const codes = Object.entries(data.metrics.statusCodes).map(([code, count]) => \`HTTP \${code}: \${count}\`).join(' | ');
                document.getElementById('statusCodes').innerText = codes ? \`HTTP Durum Dağılımı: \${codes}\` : 'Henüz HTTP yanıtı alınmadı';

                if (data.isRunning) {
                    setRunningUI(true);
                    if (!updateInterval) {
                        updateInterval = setInterval(fetchStatus, 1000);
                    }
                    if (data.targetUrl && !document.getElementById('targetUrl').getAttribute('data-user-edited')) {
                        document.getElementById('targetUrl').value = data.targetUrl;
                    }
                    if (data.concurrency && !document.getElementById('concurrency').getAttribute('data-user-edited')) {
                        document.getElementById('concurrency').value = data.concurrency;
                    }
                    if (data.delay && !document.getElementById('delay').getAttribute('data-user-edited')) {
                        document.getElementById('delay').value = data.delay;
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

        ['targetUrl', 'concurrency', 'delay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    el.setAttribute('data-user-edited', 'true');
                });
            }
        });

        fetchStatus();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`🖥️ Kontrol paneli ${PORT} portunda çalışıyor.`);
});
