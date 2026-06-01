// ===== CONFIG =====
const API_URL = 'https://farm-indicator-rocky-undergraduate.trycloudflare.com/api/tx';
const MAX_SESSIONS = 100;  // 👈 ĐÃ ĐỔI THÀNH 100 PHIÊN
const CHECK_INTERVAL = 5000; // 5 giây kiểm tra 1 lần
const HISTORY_FILE = './dice_history.json';
const LAST_HASH_FILE = './last_hash.txt';
const PORT = process.env.PORT || 3000;

const fs = require('fs');
const https = require('https');
const http = require('http');
const url = require('url');
const express = require('express');

// ===== BIẾN TOÀN CỤC =====
let history = [];
let lastJsonHash = null;
let checkCount = 0;
let savedCount = 0;
let skippedCount = 0;
let lastError = null;
let lastCheckTime = null;

// ===== KHỞI TẠO EXPRESS APP =====
const app = express();

// ===== API ENDPOINTS =====
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        uptime: process.uptime(),
        historyCount: history.length,
        maxSessions: MAX_SESSIONS,
        savedCount: savedCount,
        skippedCount: skippedCount,
        checkCount: checkCount,
        lastCheckTime: lastCheckTime,
        lastError: lastError,
        apiUrl: API_URL,
        timestamp: new Date().toISOString()
    });
});

app.get('/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({
        total: history.length,
        maxSessions: MAX_SESSIONS,
        sessions: history.slice(0, limit)
    });
});

app.get('/stats', (req, res) => {
    if (history.length === 0) {
        res.json({ message: 'Chưa có dữ liệu' });
        return;
    }
    
    // Thống kê đơn giản
    const totals = history.map(s => s.total);
    const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
    
    res.json({
        totalSessions: history.length,
        maxSessions: MAX_SESSIONS,
        averageTotal: avgTotal.toFixed(2),
        minTotal: Math.min(...totals),
        maxTotal: Math.max(...totals),
        lastSession: history[0],
        firstSession: history[history.length - 1]
    });
});

// ===== KHỞI TẠO =====
function init() {
    console.log('='.repeat(60));
    console.log('🎲  DICE TRACKER - LẤY PHIÊN TỪ API GỐC');
    console.log('='.repeat(60));
    console.log(`📡 API: ${API_URL}`);
    console.log(`💾 Lưu tối đa: ${MAX_SESSIONS} phiên`);
    console.log(`🔄 Kiểm tra mỗi: ${CHECK_INTERVAL / 1000}s`);
    console.log(`📁 File lịch sử: ${HISTORY_FILE}`);
    console.log(`🌐 Web server port: ${PORT}`);
    console.log('='.repeat(60));
    
    // Load lịch sử cũ nếu có
    loadHistory();
    loadLastHash();
    
    console.log(`📊 Đã load ${history.length} phiên từ lịch sử`);
    console.log(`🔑 Hash cuối: ${lastJsonHash ? lastJsonHash.substring(0, 12) + '...' : 'Chưa có'}`);
    console.log('='.repeat(60));
    console.log('🚀 Bắt đầu theo dõi...\n');
    
    // Khởi động web server
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Web server đang chạy trên cổng ${PORT}`);
        console.log(`📊 Xem trạng thái: http://localhost:${PORT}/`);
        console.log(`📜 Xem lịch sử: http://localhost:${PORT}/history`);
        console.log(`📈 Xem thống kê: http://localhost:${PORT}/stats`);
        console.log('='.repeat(60));
    });
    
    // Bắt đầu vòng lặp
    fetchAndCheck();
    setInterval(fetchAndCheck, CHECK_INTERVAL);
}

// ===== LOAD/SAVE FILE =====
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            history = JSON.parse(data);
            // Đảm bảo không quá MAX_SESSIONS
            if (history.length > MAX_SESSIONS) {
                history = history.slice(0, MAX_SESSIONS);
            }
        }
    } catch (error) {
        console.log('⚠️  Không thể load lịch sử, bắt đầu mới');
        history = [];
    }
}

function saveHistory() {
    try {
        // Giới hạn 100 phiên
        if (history.length > MAX_SESSIONS) {
            history = history.slice(0, MAX_SESSIONS);
        }
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    } catch (error) {
        console.error('❌ Lỗi lưu lịch sử:', error.message);
        lastError = error.message;
    }
}

function loadLastHash() {
    try {
        if (fs.existsSync(LAST_HASH_FILE)) {
            lastJsonHash = fs.readFileSync(LAST_HASH_FILE, 'utf8').trim();
        }
    } catch (error) {
        lastJsonHash = null;
    }
}

function saveLastHash(hash) {
    try {
        fs.writeFileSync(LAST_HASH_FILE, hash, 'utf8');
    } catch (error) {
        console.error('❌ Lỗi lưu hash:', error.message);
        lastError = error.message;
    }
}

// ===== FETCH API =====
function fetchAPI() {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(API_URL);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.path,
            method: 'GET',
            timeout: 10000,
            headers: {
                'User-Agent': 'DiceTracker/1.0',
                'Accept': 'application/json'
            }
        };
        
        const req = client.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

// ===== HASH FUNCTION =====
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// ===== PARSE DỮ LIỆU TỪ API GỐC =====
function parseDiceData(rawData) {
    try {
        const jsonData = JSON.parse(rawData);
        
        // Hàm tìm tất cả số 1-6 trong object (kể cả nested)
        function findAllDiceNumbers(obj, depth = 0) {
            if (depth > 20) return [];
            if (!obj || typeof obj !== 'object') return [];
            
            let numbers = [];
            
            if (Array.isArray(obj)) {
                for (const item of obj) {
                    if (typeof item === 'number' && item >= 1 && item <= 6) {
                        numbers.push({ value: item, source: 'array' });
                    } else if (typeof item === 'object') {
                        numbers = numbers.concat(findAllDiceNumbers(item, depth + 1));
                    }
                }
                return numbers;
            }
            
            for (const key in obj) {
                const val = obj[key];
                
                if (typeof val === 'number' && val >= 1 && val <= 6) {
                    numbers.push({ value: val, source: key });
                }
                else if (typeof val === 'string' && /^[1-6]$/.test(val)) {
                    numbers.push({ value: parseInt(val), source: key });
                }
                else if (Array.isArray(val)) {
                    for (const item of val) {
                        if (typeof item === 'number' && item >= 1 && item <= 6) {
                            numbers.push({ value: item, source: `${key}[]` });
                        } else if (typeof item === 'object') {
                            numbers = numbers.concat(findAllDiceNumbers(item, depth + 1));
                        }
                    }
                }
                else if (typeof val === 'object' && val !== null) {
                    numbers = numbers.concat(findAllDiceNumbers(val, depth + 1));
                }
            }
            
            return numbers;
        }
        
        const allDiceNumbers = findAllDiceNumbers(jsonData);
        
        if (allDiceNumbers.length >= 3) {
            let sessionFromApi = null;
            
            function findSession(obj, depth = 0) {
                if (depth > 20) return null;
                if (!obj || typeof obj !== 'object') return null;
                
                for (const key in obj) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey.includes('session') || lowerKey.includes('phien') || 
                        lowerKey.includes('round') || lowerKey.includes('turn') ||
                        lowerKey.includes('game_id') || lowerKey.includes('tx_id')) {
                        const val = obj[key];
                        if (typeof val === 'number' || typeof val === 'string') {
                            return val;
                        }
                    }
                }
                
                for (const key in obj) {
                    if (typeof obj[key] === 'object' && obj[key] !== null) {
                        const result = findSession(obj[key], depth + 1);
                        if (result) return result;
                    }
                }
                
                return null;
            }
            
            sessionFromApi = findSession(jsonData);
            
            if (!sessionFromApi) {
                for (const key in jsonData) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey.includes('time') || lowerKey.includes('date') || lowerKey.includes('created')) {
                        sessionFromApi = jsonData[key];
                        break;
                    }
                }
                if (!sessionFromApi) {
                    sessionFromApi = new Date().toISOString();
                }
            }
            
            return {
                phien: sessionFromApi,
                dice1: allDiceNumbers[0].value,
                dice2: allDiceNumbers[1].value,
                dice3: allDiceNumbers[2].value,
                timestamp: new Date().toISOString(),
                rawData: jsonData
            };
        }
        
        return null;
    } catch (error) {
        console.error('❌ Parse error:', error.message);
        lastError = error.message;
        return null;
    }
}

// ===== HÀM CHÍNH: KIỂM TRA VÀ LƯU =====
async function fetchAndCheck() {
    checkCount++;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN');
    lastCheckTime = now.toISOString();
    
    try {
        const rawData = await fetchAPI();
        const newHash = hashString(rawData);
        
        if (newHash === lastJsonHash) {
            skippedCount++;
            if (skippedCount % 10 === 0) {
                console.log(`[${timeStr}] ⏭️  Đã bỏ qua ${skippedCount} lần (JSON không đổi)`);
            }
        } else {
            const diceData = parseDiceData(rawData);
            
            if (diceData) {
                savedCount++;
                
                const total = diceData.dice1 + diceData.dice2 + diceData.dice3;
                
                const session = {
                    phien: diceData.phien,
                    dice1: diceData.dice1,
                    dice2: diceData.dice2,
                    dice3: diceData.dice3,
                    total: total,
                    timestamp: diceData.timestamp,
                    fetchedAt: now.toISOString(),
                    jsonHash: newHash
                };
                
                history.unshift(session);
                
                if (history.length > MAX_SESSIONS) {
                    history = history.slice(0, MAX_SESSIONS);
                }
                
                saveHistory();
                lastJsonHash = newHash;
                saveLastHash(newHash);
                lastError = null;
                
                const diceDisplay = `[${diceData.dice1}] [${diceData.dice2}] [${diceData.dice3}]`;
                console.log(`[${timeStr}] 🆕 PHIÊN: ${diceData.phien} | ${diceDisplay} | Tổng: ${total} | Đã lưu: ${savedCount}/${MAX_SESSIONS}`);
                
                if (savedCount % 5 === 0 || history.length <= 5) {
                    displayTable();
                }
                
                if (history.length >= MAX_SESSIONS) {
                    console.log('\n' + '='.repeat(60));
                    console.log(`🎯 ĐÃ ĐỦ ${MAX_SESSIONS} PHIÊN!`);
                    console.log('='.repeat(60));
                }
            } else {
                console.log(`[${timeStr}] ⚠️  JSON thay đổi nhưng không parse được dữ liệu`);
                lastError = 'Cannot parse dice data from API response';
            }
        }
    } catch (error) {
        console.log(`[${timeStr}] ❌ Lỗi: ${error.message}`);
        lastError = error.message;
    }
}

// ===== HIỂN THỊ BẢNG =====
function displayTable() {
    const count = Math.min(10, history.length);
    
    console.log('\n' + '┌'.padEnd(61, '─') + '┐');
    console.log('│' + '📊 LỊCH SỬ PHIÊN GẦN NHẤT'.padEnd(60) + '│');
    console.log('├'.padEnd(17, '─') + '┬'.padEnd(13, '─') + '┬'.padEnd(13, '─') + '┬'.padEnd(13, '─') + '┤');
    console.log('│ PHIÊN (API)   │ XÚC XẮC 1 │ XÚC XẮC 2 │ XÚC XẮC 3 │ TỔNG │');
    console.log('├'.padEnd(17, '─') + '┼'.padEnd(13, '─') + '┼'.padEnd(13, '─') + '┼'.padEnd(13, '─') + '┼'.padEnd(7, '─') + '┤');
    
    for (let i = 0; i < count; i++) {
        const s = history[i];
        const phienStr = String(s.phien || 'N/A').substring(0, 14);
        console.log(`│ ${phienStr.padEnd(14)} │     ${s.dice1}     │     ${s.dice2}     │     ${s.dice3}     │   ${String(s.total).padStart(2)} │`);
    }
    
    console.log('└'.padEnd(17, '─') + '┴'.padEnd(13, '─') + '┴'.padEnd(13, '─') + '┴'.padEnd(13, '─') + '┴'.padEnd(7, '─') + '┘');
    console.log(`  📊 Tổng: ${history.length}/${MAX_SESSIONS} phiên | Đã lưu: ${savedCount} | Đã bỏ qua: ${skippedCount}\n`);
}

// ===== XỬ LÝ THOÁT =====
process.on('SIGINT', () => {
    console.log('\n\n🛑 Đang dừng tracker...');
    saveHistory();
    console.log(`💾 Đã lưu ${history.length} phiên vào ${HISTORY_FILE}`);
    console.log(`📊 Tổng kết: ${savedCount} lưu | ${skippedCount} bỏ qua | ${checkCount} kiểm tra`);
    
    if (history.length > 0) {
        displayTable();
    }
    
    console.log('👋 Tạm biệt!\n');
    process.exit(0);
});

process.on('SIGTERM', () => {
    saveHistory();
    process.exit(0);
});

// ===== START =====
init();