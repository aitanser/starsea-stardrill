// 解密脚本
const DECRYPT_CONFIG = { iterations: 100000, cacheKey: 'starsea_quiz_password' };

function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes.buffer;
}

async function decryptQuizData(password) {
    if (!window._encrypted_quiz_data) return null;
    const { salt, iv, ciphertext } = window._encrypted_quiz_data;
    try {
        const saltBuffer = base64ToArrayBuffer(salt);
        const ivBuffer = base64ToArrayBuffer(iv);
        const ciphertextBuffer = base64ToArrayBuffer(ciphertext);
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: saltBuffer,
                iterations: DECRYPT_CONFIG.iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-CBC', length: 256 },
            false,
            ['decrypt']
        );
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv: ivBuffer },
            key,
            ciphertextBuffer
        );
        const plaintext = new TextDecoder('utf-8').decode(decrypted);
        const payload = JSON.parse(plaintext);
        const meta = payload.meta;
        const lines = payload.questions;
        const result = [];
        for (const line of lines) {
            if (!line.trim()) continue;
            const parts = line.split('|');
            const id = parseInt(parts[0]);
            const type = parseInt(parts[1]);
            const question = parts[2];
            const answer = parts[parts.length - 2];
            const explanation = parts[parts.length - 1];
            let options = [];
            let answerArr = answer;
            if (type === 1 || type === 2 || type === 5) {
                for (let i = 3; i < parts.length - 2; i++) {
                    if (parts[i] && parts[i].trim()) options.push(parts[i].trim());
                }
                if (type === 2) answerArr = answer.split(';');
            }
            const typeMap = { 1: 'choice', 2: 'multi', 3: 'fill', 4: 'essay', 5: 'judge' };
            // 确保 options 始终为数组（容错）
            result.push({
                id,
                type: typeMap[type] || 'choice',
                question,
                options: Array.isArray(options) ? options : [],
                answer: answerArr,
                explanation
            });
        }
        window.meta = meta;
        window.allQuestions = result;
        console.log(`✅ 题库解密成功，共 ${result.length} 题`);
        return result;
    } catch (e) {
        console.warn('⚠️ 解密失败:', e);
        return null;
    }
}

function createAuthUI() {
    if (document.getElementById('auth-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(10px);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:system-ui;';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:16px;padding:40px 36px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;';
    if (document.documentElement.getAttribute('data-theme') === 'dark') {
        card.style.background = '#1e293b';
        card.style.color = '#f1f5f9';
    }
    card.innerHTML = `
        <div style="font-size:48px;margin-bottom:12px;">📚</div>
        <h2 style="font-size:24px;margin:0 0 6px;">星习 · 刷题工具</h2>
        <p style="font-size:14px;color:#94a3b8;margin:0 0 20px;">请输入授权码以解锁题库</p>
        <div style="margin-bottom:16px;">
            <input id="auth-input" type="password" placeholder="输入授权码..." style="width:100%;padding:12px 16px;border:2px solid #e2e8f0;border-radius:10px;font-size:16px;background:#f8fafc;color:#0f172a;box-sizing:border-box;outline:none;">
            <div id="auth-error" style="color:#ef4444;font-size:13px;margin-top:6px;display:none;">授权码错误，请重新输入</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <label style="font-size:13px;color:#94a3b8;cursor:pointer;display:flex;align-items:center;gap:6px;">
                <input type="checkbox" id="auth-remember" checked> 记住授权码
            </label>
            <span style="font-size:13px;color:#94a3b8;">🔒 数据已加密</span>
        </div>
        <button id="auth-btn" style="width:100%;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;">解锁题库</button>
        <p style="font-size:12px;color:#94a3b8;margin:16px 0 0;">购买完整版题库请联系授权方</p>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const input = document.getElementById('auth-input');
    const btn = document.getElementById('auth-btn');
    const error = document.getElementById('auth-error');
    const remember = document.getElementById('auth-remember');

    input.addEventListener('input', () => {
        error.style.display = 'none';
        input.style.borderColor = '#e2e8f0';
    });

    async function handleAuth() {
        const password = input.value.trim();
        if (!password) {
            error.textContent = '请输入授权码';
            error.style.display = 'block';
            input.style.borderColor = '#ef4444';
            return;
        }
        btn.textContent = '解密中...';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        const result = await decryptQuizData(password);
        if (result) {
            if (remember.checked) {
                try { localStorage.setItem(DECRYPT_CONFIG.cacheKey, password); } catch (e) {}
            }
            document.getElementById('auth-overlay').remove();
            if (window.meta) {
                const mainTitle = document.getElementById('mainTitle');
                const subTitle = document.getElementById('subTitle');
                if (mainTitle) mainTitle.textContent = window.meta.title || '星习';
                if (subTitle) subTitle.textContent = window.meta.subtitle || '';
            }
            if (typeof UIModule !== 'undefined' && UIModule.renderQuestion) {
                const idx = window.CoreModule?.getCurrentIndex?.() || 0;
                UIModule.renderQuestion(idx);
                UIModule.updateStats?.();
            }
        } else {
            error.textContent = '授权码错误，请重新输入';
            error.style.display = 'block';
            input.style.borderColor = '#ef4444';
            input.value = '';
            input.focus();
        }
        btn.textContent = '解锁题库';
        btn.disabled = false;
        btn.style.opacity = '1';
    }

    btn.addEventListener('click', handleAuth);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAuth();
    });
    setTimeout(() => input.focus(), 100);
}

(async function() {
    let cached = null;
    try { cached = localStorage.getItem(DECRYPT_CONFIG.cacheKey); } catch (e) {}
    if (cached) {
        const result = await decryptQuizData(cached);
        if (result) {
            console.log('✅ 使用缓存的授权码自动解密成功');
            if (window.meta) {
                const mainTitle = document.getElementById('mainTitle');
                const subTitle = document.getElementById('subTitle');
                if (mainTitle) mainTitle.textContent = window.meta.title || '星习';
                if (subTitle) subTitle.textContent = window.meta.subtitle || '';
            }
            return;
        } else {
            try { localStorage.removeItem(DECRYPT_CONFIG.cacheKey); } catch (e) {}
        }
    }
    createAuthUI();
})();
