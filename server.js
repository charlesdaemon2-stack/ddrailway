const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Test Durumu ve Metrikler
let isRunning = false;
let targetUrl = "";
let intervalId = null;

let metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    startTime: null,
    statusCodes: {}
};

// HTTP/HTTPS Keep-Alive Agent (Bağlantıların tekrar kullanılmasını sağlar - Performans Anahtarı)
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

// Gerçekçi Yük Testi için User-Agent Listesi
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
];

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
            agent: agent, // Keep-Alive bağlantı havuzunu kullan
            headers: {
                'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8',
                'Cache-Control': 'no-cache'
            }
        };

        const req = client.request(options, (res) => {
            res.on('data', () => {}); // Akışı tüket ki soket serbest kalsın
            res.on('end', () => {
                metrics.totalRequests++;
                metrics.successfulRequests++;
                metrics.statusCodes[res.statusCode] = (metrics.statusCodes[res.statusCode] || 0) + 1;
            });
        });

        req.on('error', () => {
            metrics.totalRequests++;
            metrics.failedRequests++;
        });

        req.end();
    } catch (err) {
        metrics.failedRequests++;
    }
}

// Testi Başlat: /start?url=https://hedef.com&concurrency=10&delay=50
app.get('/start', (req, res) => {
    const url = req.query.url;
    const concurrency = parseInt(req.query.concurrency) || 5; // Her döngüdeki paralel istek sayısı
    const delay = parseInt(req.query.delay) || 50; //ms cinsinden aralık

    if (!url) {
        return res.status(400).json({ error: "URL parametresi gerekli!" });
    }

    if (isRunning) {
        return res.status(400).json({ error: "Zaten çalışıyor. Önce /stop yapın." });
    }

    targetUrl = url;
    isRunning = true;
    metrics = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        startTime: new Date(),
        statusCodes: {}
    };

    // Zamanlayıcı: Her `delay` milisaniyede `concurrency` adet istek gönderir
    intervalId = setInterval(() => {
        for (let i = 0; i < concurrency; i++) {
            sendRequest(targetUrl);
        }
    }, delay);

    res.json({
        message: "Yük testi başlatıldı.",
        target: targetUrl,
        concurrency,
        delayMs: delay
    });
});

// Testi Durdur: /stop
app.get('/stop', (req, res) => {
    if (!isRunning) {
        return res.status(400).json({ message: "Test zaten çalışmıyor." });
    }

    isRunning = false;
    if (intervalId) clearInterval(intervalId);

    const durationSec = metrics.startTime ? ((new Date() - metrics.startTime) / 1000).toFixed(2) : 0;

    res.json({
        message: "Test durduruldu.",
        durationSeconds: durationSec,
        metrics
    });
});

// Canlı Durum ve İstatistikler: /status
app.get('/status', (req, res) => {
    const durationSec = metrics.startTime && isRunning ? ((new Date() - metrics.startTime) / 1000).toFixed(2) : 0;
    const reqPerSec = durationSec > 0 ? (metrics.totalRequests / durationSec).toFixed(2) : 0;

    res.json({
        isRunning,
        targetUrl,
        durationSeconds: durationSec,
        requestsPerSecond: reqPerSec,
        metrics
    });
});

app.get('/', (req, res) => {
    res.send("⚡ Sunucu Yük Testi Servisi Aktif!<br><br>Kullanım Örneği:<br>/start?url=https://hedef-site.com&concurrency=10&delay=50<br>/status<br>/stop");
});

app.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda çalışıyor.`);
});
