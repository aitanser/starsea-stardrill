#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# build_data.py
# 作者: 鸿渚 | 蓝域星河
# 版权: © 2026 鸿渚 - 蓝域星河. All rights reserved.

import re
import argparse
import os
import sys
import base64
import json
import random
import string
from pathlib import Path

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    import secrets
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

# 默认值，仅当用户完全未指定时使用
META_TITLE = "星习"
META_SUBTITLE = "交互式生成"
META_VERSION = "1.0"
DEMO_PASSWORD = "demo-key-2026"

def print_header(text):
    print("\n" + "=" * 56)
    print(f"  {text}")
    print("=" * 56)

def print_success(text):
    print(f"✅ {text}")

def print_error(text):
    print(f"❌ {text}")

def print_info(text):
    print(f"📖 {text}")

def print_warning(text):
    print(f"⚠️  {text}")

def generate_random_key():
    chars = string.ascii_uppercase + string.digits
    return '-'.join(''.join(random.choices(chars, k=5)) for _ in range(5))

def encrypt_data(plaintext, password):
    if not CRYPTO_AVAILABLE:
        raise RuntimeError("cryptography 库未安装")
    salt = secrets.token_bytes(16)
    iv = secrets.token_bytes(16)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
        backend=default_backend()
    )
    key = kdf.derive(password.encode('utf-8'))
    padder = padding.PKCS7(128).padder()
    padded_data = padder.update(plaintext.encode('utf-8')) + padder.finalize()
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded_data) + encryptor.finalize()
    return {
        'salt': base64.b64encode(salt).decode('utf-8'),
        'iv': base64.b64encode(iv).decode('utf-8'),
        'ciphertext': base64.b64encode(ciphertext).decode('utf-8')
    }

# ========== 新增：交互式询问题库名称 ==========
def prompt_meta():
    """交互式获取题库标题和副标题"""
    print_info("请为题库命名（支持中文）")
    title = input("📌 题库标题（默认：星习）：").strip()
    if not title:
        title = META_TITLE
    subtitle = input("📎 副标题（可选，直接回车跳过）：").strip()
    if not subtitle:
        subtitle = ""
    return title, subtitle

# ----- 核心解析：读取规范化 TXT -----
def parse_standard_txt(file_path):
    """
    解析严格遵循以下格式的 TXT：
    第X题
    题干：<内容>
    A. <选项>
    B. <选项>
    ...
    答案：<答案>
    详细解析：<解析>

    注意：每个字段独占一行，题与题之间用空行分隔。
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # 按空行分割成题目块
    blocks = []
    current_block = []
    for line in lines:
        stripped = line.strip()
        if stripped == '':
            if current_block:
                blocks.append(current_block)
                current_block = []
        else:
            current_block.append(stripped)
    if current_block:
        blocks.append(current_block)

    questions = []
    for block in blocks:
        if not block:
            continue
        # 提取题号行
        title_line = block[0]
        match = re.match(r'^第\s*(\d+)\s*题', title_line)
        if not match:
            print_warning(f"跳过无法识别题号的行: {title_line}")
            continue
        qid = int(match.group(1))

        # 逐行解析
        question_text = ''
        options = []
        answer = ''
        explanation = ''
        current_section = None

        for line in block[1:]:
            if line.startswith('题干：') or line.startswith('题干:'):
                question_text = line.split('：', 1)[-1].split(':', 1)[-1].strip()
                current_section = 'question'
            elif re.match(r'^[A-E]\s*[．.、\)）]\s*', line):
                options.append(line)
                current_section = 'options'
            elif line.startswith('答案：') or line.startswith('答案:'):
                answer = line.split('：', 1)[-1].split(':', 1)[-1].strip()
                current_section = 'answer'
            elif line.startswith('详细解析：') or line.startswith('解析：') or line.startswith('详细解析:'):
                explanation = line.split('：', 1)[-1].split(':', 1)[-1].strip()
                current_section = 'explanation'
            else:
                if current_section == 'question':
                    question_text += ' ' + line
                elif current_section == 'options':
                    if options:
                        options[-1] += ' ' + line
                elif current_section == 'answer':
                    answer += ' ' + line
                elif current_section == 'explanation':
                    explanation += ' ' + line

        # 清理多余空白
        question_text = re.sub(r'\s+', ' ', question_text).strip()
        answer = re.sub(r'\s+', ' ', answer).strip()
        explanation = re.sub(r'\s+', ' ', explanation).strip()

        if not question_text:
            print_warning(f"第 {qid} 题缺少题干，已跳过")
            continue
        if not answer:
            print_warning(f"第 {qid} 题缺少答案，已跳过")
            continue

        # ---- 判断题型 ----
        if options:
            if len(options) == 2:
                opt_texts = [re.sub(r'^[A-B]\s*[\.．、\s)]+\s*', '', opt) for opt in options]
                judge_keywords = ['正确', '错误', '对', '错', '√', '×', '是', '否']
                if all(any(kw in text for kw in judge_keywords) for text in opt_texts):
                    q_type = 'judge'
                elif ';' in answer or len(answer.replace(';', '')) > 1:
                    q_type = 'multi'
                else:
                    q_type = 'choice'
            else:
                q_type = 'multi' if (';' in answer or len(answer.replace(';', '')) > 1) else 'choice'
        else:
            if '______' in question_text or '____' in question_text or '填空' in question_text:
                q_type = 'fill'
            else:
                q_type = 'essay'

        questions.append({
            'id': qid,
            'type': q_type,
            'question': question_text,
            'options': options,
            'answer': answer,
            'explanation': explanation
        })

    return questions

# ----- 导出标准化 .txt（从题目列表生成）-----
def export_standard_txt(questions, output_path):
    with open(output_path, 'w', encoding='utf-8') as f:
        for q in questions:
            f.write(f"第{q['id']}题\n")
            f.write(f"题干：{q['question']}\n")
            if q['options']:
                for opt in q['options']:
                    f.write(f"{opt}\n")
            f.write(f"答案：{q['answer']}\n")
            f.write(f"详细解析：{q['explanation']}\n")
            f.write("\n")
    print_success(f"标准化文本已保存：{output_path}")

# ----- 生成 data.js（明文）-----
def generate_data_js(questions, meta=None):
    if meta is None:
        meta = {"title": META_TITLE, "subtitle": META_SUBTITLE, "version": META_VERSION}
    lines = [
        "(function() {",
        f"    const meta = {{ title: '{meta.get('title', META_TITLE)}', subtitle: '{meta.get('subtitle', META_SUBTITLE)}', version: '{meta.get('version', META_VERSION)}' }};",
        f"    const compressed = `",
    ]
    type_to_num = {"choice": 1, "multi": 2, "fill": 3, "essay": 4, "judge": 5}
    for q in questions:
        q_type = q.get("type", "choice")
        q_type_num = type_to_num.get(q_type, 1)
        q_text = q.get("question", "").strip()
        answer = q.get("answer", "")
        if isinstance(answer, list):
            answer = ";".join(answer)
        elif isinstance(answer, str) and re.search(r'[，、,]', answer):
            parts = re.split(r'[，、,]\s*', answer)
            if len(parts) > 1:
                answer = ";".join(parts)
        explanation = q.get("explanation", "").strip()
        parts = [str(q.get("id", 0)), str(q_type_num), q_text]
        options = q.get("options", [])
        if q_type in ["choice", "multi", "judge"] and options:
            for opt in options:
                opt_clean = re.sub(r'^[A-E]\s*[\.．、\s)]+\s*', '', opt)
                parts.append(opt_clean)
            parts.append(answer)
        else:
            parts.append("")
            parts.append(answer)
        parts.append(explanation)
        lines.append("|".join(parts))
    lines.append("`;")
    lines.append("    function parseData(raw) {")
    lines.append("        const lines = raw.trim().split('\\n');")
    lines.append("        const result = [];")
    lines.append("        for (const line of lines) {")
    lines.append("            if (!line.trim()) continue;")
    lines.append("            const parts = line.split('|');")
    lines.append("            const id = parseInt(parts[0]);")
    lines.append("            const type = parseInt(parts[1]);")
    lines.append("            const question = parts[2];")
    lines.append("            const answer = parts[parts.length - 2];")
    lines.append("            const explanation = parts[parts.length - 1];")
    lines.append("            let options = [];")
    lines.append("            let answerArr = answer;")
    lines.append("            if (type === 1 || type === 2 || type === 5) {")
    lines.append("                for (let i = 3; i < parts.length - 2; i++) {")
    lines.append("                    if (parts[i] && parts[i].trim()) options.push(parts[i].trim());")
    lines.append("                }")
    lines.append("                if (type === 2) answerArr = answer.split(';');")
    lines.append("            }")
    lines.append("            const typeMap = {1:'choice', 2:'multi', 3:'fill', 4:'essay', 5:'judge'};")
    lines.append("            result.push({ id, type: typeMap[type] || 'choice', question, options, answer: answerArr, explanation });")
    lines.append("        }")
    lines.append("        return result;")
    lines.append("    }")
    lines.append("    window.meta = meta;")
    lines.append("    window.allQuestions = parseData(compressed);")
    lines.append("})();")
    return "\n".join(lines)

# ----- 生成加密 data.js + decrypt.js（Meta 纳入 Payload）-----
def generate_encrypted_from_questions(questions, password, output_dir=".", meta=None):
    if not CRYPTO_AVAILABLE:
        print_error("cryptography 未安装，无法加密")
        return False
    if meta is None:
        meta = {"title": META_TITLE, "subtitle": META_SUBTITLE, "version": META_VERSION}

    type_to_num = {"choice": 1, "multi": 2, "fill": 3, "essay": 4, "judge": 5}
    compressed_lines = []
    for q in questions:
        q_type_num = type_to_num.get(q["type"], 1)
        parts = [str(q["id"]), str(q_type_num), q["question"]]
        if q["type"] in ["choice", "multi", "judge"] and q["options"]:
            for opt in q["options"]:
                parts.append(opt)
            answer = q["answer"]
            if isinstance(answer, list):
                answer = ";".join(answer)
            parts.append(answer)
        else:
            parts.append("")
            parts.append(q["answer"])
        parts.append(q.get("explanation", ""))
        compressed_lines.append("|".join(parts))

    payload = {
        "meta": meta,
        "questions": compressed_lines
    }
    plaintext = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    encrypted = encrypt_data(plaintext, password)

    data_js_content = f"""// 加密题库数据
(function() {{
    window._encrypted_quiz_data = {{
        salt: '{encrypted['salt']}',
        iv: '{encrypted['iv']}',
        ciphertext: '{encrypted['ciphertext']}'
    }};
    window.meta = null;
    window.allQuestions = null;
}})();
"""

    # decrypt.js 模板（无需修改，它始终从 payload 中读取 meta）
    decrypt_js_content = f"""// 解密脚本
const DECRYPT_CONFIG = {{ iterations: 100000, cacheKey: 'starsea_quiz_password' }};

function base64ToArrayBuffer(base64) {{
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes.buffer;
}}

async function decryptQuizData(password) {{
    if (!window._encrypted_quiz_data) return null;
    const {{ salt, iv, ciphertext }} = window._encrypted_quiz_data;
    try {{
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
            {{
                name: 'PBKDF2',
                salt: saltBuffer,
                iterations: DECRYPT_CONFIG.iterations,
                hash: 'SHA-256'
            }},
            keyMaterial,
            {{ name: 'AES-CBC', length: 256 }},
            false,
            ['decrypt']
        );
        const decrypted = await crypto.subtle.decrypt(
            {{ name: 'AES-CBC', iv: ivBuffer }},
            key,
            ciphertextBuffer
        );
        const plaintext = new TextDecoder('utf-8').decode(decrypted);
        const payload = JSON.parse(plaintext);
        const meta = payload.meta;
        const lines = payload.questions;
        const result = [];
        for (const line of lines) {{
            if (!line.trim()) continue;
            const parts = line.split('|');
            const id = parseInt(parts[0]);
            const type = parseInt(parts[1]);
            const question = parts[2];
            const answer = parts[parts.length - 2];
            const explanation = parts[parts.length - 1];
            let options = [];
            let answerArr = answer;
            if (type === 1 || type === 2 || type === 5) {{
                for (let i = 3; i < parts.length - 2; i++) {{
                    if (parts[i] && parts[i].trim()) options.push(parts[i].trim());
                }}
                if (type === 2) answerArr = answer.split(';');
            }}
            const typeMap = {{ 1: 'choice', 2: 'multi', 3: 'fill', 4: 'essay', 5: 'judge' }};
            // 确保 options 始终为数组（容错）
            result.push({{
                id,
                type: typeMap[type] || 'choice',
                question,
                options: Array.isArray(options) ? options : [],
                answer: answerArr,
                explanation
            }});
        }}
        window.meta = meta;
        window.allQuestions = result;
        console.log(`✅ 题库解密成功，共 ${{result.length}} 题`);
        return result;
    }} catch (e) {{
        console.warn('⚠️ 解密失败:', e);
        return null;
    }}
}}

function createAuthUI() {{
    if (document.getElementById('auth-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(10px);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:system-ui;';
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:16px;padding:40px 36px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;';
    if (document.documentElement.getAttribute('data-theme') === 'dark') {{
        card.style.background = '#1e293b';
        card.style.color = '#f1f5f9';
    }}
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

    input.addEventListener('input', () => {{
        error.style.display = 'none';
        input.style.borderColor = '#e2e8f0';
    }});

    async function handleAuth() {{
        const password = input.value.trim();
        if (!password) {{
            error.textContent = '请输入授权码';
            error.style.display = 'block';
            input.style.borderColor = '#ef4444';
            return;
        }}
        btn.textContent = '解密中...';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        const result = await decryptQuizData(password);
        if (result) {{
            if (remember.checked) {{
                try {{ localStorage.setItem(DECRYPT_CONFIG.cacheKey, password); }} catch (e) {{}}
            }}
            document.getElementById('auth-overlay').remove();
            if (window.meta) {{
                const mainTitle = document.getElementById('mainTitle');
                const subTitle = document.getElementById('subTitle');
                if (mainTitle) mainTitle.textContent = window.meta.title || '星习';
                if (subTitle) subTitle.textContent = window.meta.subtitle || '';
            }}
            if (typeof UIModule !== 'undefined' && UIModule.renderQuestion) {{
                const idx = window.CoreModule?.getCurrentIndex?.() || 0;
                UIModule.renderQuestion(idx);
                UIModule.updateStats?.();
            }}
        }} else {{
            error.textContent = '授权码错误，请重新输入';
            error.style.display = 'block';
            input.style.borderColor = '#ef4444';
            input.value = '';
            input.focus();
        }}
        btn.textContent = '解锁题库';
        btn.disabled = false;
        btn.style.opacity = '1';
    }}

    btn.addEventListener('click', handleAuth);
    input.addEventListener('keydown', (e) => {{
        if (e.key === 'Enter') handleAuth();
    }});
    setTimeout(() => input.focus(), 100);
}}

(async function() {{
    let cached = null;
    try {{ cached = localStorage.getItem(DECRYPT_CONFIG.cacheKey); }} catch (e) {{}}
    if (cached) {{
        const result = await decryptQuizData(cached);
        if (result) {{
            console.log('✅ 使用缓存的授权码自动解密成功');
            if (window.meta) {{
                const mainTitle = document.getElementById('mainTitle');
                const subTitle = document.getElementById('subTitle');
                if (mainTitle) mainTitle.textContent = window.meta.title || '星习';
                if (subTitle) subTitle.textContent = window.meta.subtitle || '';
            }}
            return;
        }} else {{
            try {{ localStorage.removeItem(DECRYPT_CONFIG.cacheKey); }} catch (e) {{}}
        }}
    }}
    createAuthUI();
}})();
"""
    data_path = Path(output_dir) / "data.js"
    decrypt_path = Path(output_dir) / "decrypt.js"
    try:
        with open(data_path, "w", encoding="utf-8") as f:
            f.write(data_js_content)
        with open(decrypt_path, "w", encoding="utf-8") as f:
            f.write(decrypt_js_content)
        print_success(f"已生成加密 data.js: {data_path}")
        print_success(f"已生成解密脚本: {decrypt_path}")
        print_info(f"授权码：{password}")
        return True
    except Exception as e:
        print_error(f"写入失败：{e}")
        return False

# ----- 生成加密示例（演示用）-----
def generate_demo(password):
    demo = [
        {
            "id": 1,
            "type": "choice",
            "question": "示例单选题：1+1 等于多少？",
            "options": ["A. 1", "B. 2", "C. 3", "D. 4"],
            "answer": "B",
            "explanation": "1+1=2，这是最基本的算术。"
        },
        {
            "id": 2,
            "type": "multi",
            "question": "示例多选题：以下哪些是编程语言？",
            "options": ["A. Python", "B. 咖啡", "C. Java", "D. 水"],
            "answer": "A;C",
            "explanation": "Python 和 Java 是编程语言。"
        },
        {
            "id": 3,
            "type": "fill",
            "question": "中国的首都是______。",
            "options": [],
            "answer": "北京",
            "explanation": "北京是中华人民共和国的首都。"
        },
        {
            "id": 4,
            "type": "judge",
            "question": "地球是圆的。",
            "options": ["A. 正确", "B. 错误"],
            "answer": "A",
            "explanation": "地球是一个近似球体的天体。"
        }
    ]
    # 示例题库也允许用户自定义标题
    print_info("示例题库命名")
    title, subtitle = prompt_meta()
    meta = {"title": title, "subtitle": subtitle, "version": "1.0"}
    return generate_encrypted_from_questions(demo, password, meta=meta)

# ----- 导入主流程（支持交互式询问标题）-----
def handle_import(file_path, output_path, args, interactive_meta=None):
    if not os.path.exists(file_path):
        print_error(f"找不到文件: {file_path}")
        return False

    ext = Path(file_path).suffix.lower()
    if ext != '.txt':
        print_error("仅支持 .txt 格式，请先使用 AI 将文档整理为标准化格式。")
        return False

    print_info(f"正在读取规范化 TXT: {file_path}")
    try:
        questions = parse_standard_txt(file_path)
    except Exception as e:
        print_error(f"解析失败：{e}")
        return False

    if not questions:
        print_warning("未解析出任何题目，请检查文件是否符合标准格式。")
        return False

    type_counts = {"choice": 0, "multi": 0, "fill": 0, "essay": 0, "judge": 0}
    for q in questions:
        type_counts[q.get("type", "choice")] += 1
    print_success(f"解析成功，共 {len(questions)} 题")
    print(f"   📊 题型分布：单选 {type_counts['choice']}，多选 {type_counts['multi']}，填空 {type_counts['fill']}，问答 {type_counts['essay']}，判断 {type_counts['judge']}")

    # 可选：重新生成标准化 txt（用于确认），随后自动删除
    if args.save_txt:
        base = Path(file_path).stem
        txt_path = f"{base}_reformatted.txt"
        export_standard_txt(questions, txt_path)
        try:
            os.remove(txt_path)
            print_info(f"已删除过程文件 {txt_path}")
        except OSError as e:
            print_warning(f"删除过程文件失败：{e}")

    # 确定 meta：优先使用 interactive_meta（交互式传入），否则使用命令行参数
    if interactive_meta:
        meta = interactive_meta
    else:
        meta = {"title": args.title, "subtitle": args.subtitle, "version": META_VERSION}

    if args.plain:
        content = generate_data_js(questions, meta)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(content)
        print_success(f"已生成明文 data.js: {output_path}")
        return True
    else:
        password = args.password
        if not password:
            password = generate_random_key()
            key_file = "key.txt"
            with open(key_file, "w", encoding="utf-8") as f:
                f.write(password + "\n")
            print_info(f"🔑 已生成随机授权码并保存到 {key_file}")
        return generate_encrypted_from_questions(questions, password, output_dir=".", meta=meta)

# ----- 交互式录入（增加判断题选项）-----
def interactive_generate(meta):
    print_header("交互式题库录入")
    print_info("请按提示输入题目，输入 'done' 或空行结束")
    questions = []
    q_num = 1
    while True:
        print(f"\n--- 第 {q_num} 题 ---")
        question = input("📝 题干内容：").strip()
        if question.lower() == 'done' or question == '':
            if questions:
                break
            else:
                print_warning("至少输入一道题")
                continue
        print("   题型选择：1.单选 2.多选 3.填空 4.问答 5.判断 0.自动识别")
        type_choice = input("   请输入序号 (0-5，默认 0)：").strip() or "0"
        type_map = {"0": "auto", "1": "choice", "2": "multi", "3": "fill", "4": "essay", "5": "judge"}
        q_type = type_map.get(type_choice, "auto")
        if q_type == "auto":
            q_type = "choice"
        options = []
        answer = ""
        explanation = ""

        if q_type in ["choice", "multi", "judge"]:
            if q_type == "judge":
                print_info("判断题自动生成选项：A. 正确  B. 错误")
                options = ["A. 正确", "B. 错误"]
            else:
                print_info("请输入选项（每行一个，空行结束）：")
                opt_labels = ['A', 'B', 'C', 'D', 'E']
                opt_idx = 0
                while opt_idx < len(opt_labels):
                    opt_text = input(f"   {opt_labels[opt_idx]}. ").strip()
                    if opt_text == '':
                        break
                    options.append(f"{opt_labels[opt_idx]}. {opt_text}")
                    opt_idx += 1
                if not options:
                    print_warning("至少需要一个选项，已自动调整为问答题")
                    q_type = "essay"

        if q_type in ["choice", "multi"]:
            if not options:
                q_type = "essay"
            else:
                answer = input("✅ 正确答案（如 A 或 A,B,C）：").strip()
                if q_type == "multi" and answer:
                    parts = re.split(r'[，、,;；\s]+', answer)
                    if len(parts) > 1:
                        cleaned = [p.strip() for p in parts if p.strip() and p.strip() in 'ABCDE']
                        if cleaned:
                            answer = ';'.join(cleaned)
        elif q_type == "judge":
            answer = input("✅ 正确答案（A 或 B）：").strip().upper()
            if answer not in ['A', 'B']:
                print_warning("判断题答案必须为 A 或 B，已自动设为 A")
                answer = 'A'
        elif q_type == "fill":
            answer = input("✅ 正确答案：").strip()
        elif q_type == "essay":
            answer = input("📝 参考答案：").strip()

        explanation = input("📖 解析（可选）：").strip()
        if not answer:
            print_warning("未输入答案，跳过")
            continue

        questions.append({
            "id": q_num,
            "type": q_type,
            "question": question,
            "options": options,
            "answer": answer,
            "explanation": explanation,
        })
        print_success(f"第 {q_num} 题已录入（{q_type}）")
        q_num += 1
        if input("\n继续录入下一题？ (Y/n)：").strip().lower() == 'n':
            break
    return questions

# ----- 主程序（交互式菜单增强）-----
def main():
    parser = argparse.ArgumentParser(description="星习刷题工具（规范化 TXT 版本）")
    parser.add_argument("--interactive", "-i", action="store_true", help="交互式录入")
    parser.add_argument("--input", "-f", help="从规范化 TXT 文件导入（必须符合标准格式）")
    parser.add_argument("--output", "-o", default="data.js", help="输出文件（明文模式）")
    parser.add_argument("--title", default=META_TITLE, help="题库标题")
    parser.add_argument("--subtitle", default=META_SUBTITLE, help="题库副标题")
    parser.add_argument("--plain", action="store_true", help="生成明文（不加密）")
    parser.add_argument("--password", "-p", help="指定授权码（加密时使用）")
    parser.add_argument("--save-txt", action="store_true", default=True, help="自动生成标准化 .txt（默认开启）")
    parser.add_argument("--no-save-txt", dest="save_txt", action="store_false", help="不生成标准化 .txt")
    parser.add_argument("--demo", action="store_true", help="生成加密示例题库（含解密脚本）")
    args = parser.parse_args()

    # ---- 处理 --demo ----
    if args.demo:
        password = args.password or DEMO_PASSWORD
        if password == DEMO_PASSWORD:
            print_info("使用演示密钥：demo-key-2026（仅供测试）")
        generate_demo(password)
        return

    # ---- 交互式录入（命令行模式）----
    if args.interactive:
        print_info("将使用命令行参数中的标题（如需自定义，请使用 --title 和 --subtitle）")
        meta = {"title": args.title, "subtitle": args.subtitle, "version": META_VERSION}
        questions = interactive_generate(meta)
        if questions:
            password = args.password or generate_random_key()
            if not args.password:
                key_file = "key.txt"
                with open(key_file, "w", encoding="utf-8") as f:
                    f.write(password + "\n")
                print_info(f"🔑 授权码已保存到 {key_file}")
            generate_encrypted_from_questions(questions, password, output_dir=".", meta=meta)
        return

    # ---- 从文件导入（命令行模式）----
    if args.input:
        handle_import(args.input, args.output, args)
        return

    # ---- 交互式菜单（主界面）----
    while True:
        print_header("星习 · 题库生成工具（规范TXT版）")
        print("  1. 交互式录入")
        print("  2. 从规范化 TXT 导入")
        print("  3. 生成加密示例（演示）")
        print("  0. 退出")
        choice = input("请选择 (0-3)：").strip()
        if choice == "0":
            break
        elif choice == "1":
            # 询问题库名称
            title, subtitle = prompt_meta()
            meta = {"title": title, "subtitle": subtitle, "version": META_VERSION}
            questions = interactive_generate(meta)
            if questions:
                password = args.password or generate_random_key()
                if not args.password:
                    with open("key.txt", "w", encoding="utf-8") as f:
                        f.write(password + "\n")
                    print_info(f"授权码已保存到 key.txt")
                generate_encrypted_from_questions(questions, password, meta=meta)
            input("\n按 Enter 继续...")
        elif choice == "2":
            file_path = input("📁 请输入规范化 TXT 文件路径：").strip()
            if not file_path:
                print_warning("未输入路径")
                continue
            if not os.path.exists(file_path):
                print_error("文件不存在")
                continue
            # 询问题库名称
            title, subtitle = prompt_meta()
            meta = {"title": title, "subtitle": subtitle, "version": META_VERSION}
            # 临时构造 args，保留其他参数
            args.plain = False
            args.password = None
            args.save_txt = True
            # 传递自定义 meta
            handle_import(file_path, "data.js", args, interactive_meta=meta)
            input("\n按 Enter 继续...")
        elif choice == "3":
            password = input("请输入授权码（留空使用演示密钥）：").strip() or DEMO_PASSWORD
            generate_demo(password)
            input("\n按 Enter 继续...")
        else:
            print_warning("无效选项")

if __name__ == "__main__":
    main()