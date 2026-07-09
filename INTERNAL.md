# 星习刷题工具 · 内部技术文档

> **⚠️ 本文档仅供内部开发使用，请勿对外公开**

---

## 目录

1. [题库数据格式](#1-题库数据格式)
2. [build_data.py 使用手册](#2-build_datapy-使用手册)
3. [加密机制说明](#3-加密机制说明)
4. [题型扩展指南](#4-题型扩展指南)
5. [测试指南](#5-测试指南)
6. [常见问题](#6-常见问题)

---

## 1. 题库数据格式

### 1.1 标准化 TXT 格式（输入格式）

```
第1题
题干：题目内容
A. 选项A
B. 选项B
C. 选项C
D. 选项D
答案：A
详细解析：解析内容

第2题
题干：题目内容（多选）
A. 选项A
B. 选项B
C. 选项C
答案：A;B
详细解析：解析内容

第3题
题干：填空题，答案是______。
答案：答案内容
详细解析：解析内容

第4题
题干：问答题题目
答案：参考答案
详细解析：解析内容

第5题
题干：判断题题目
A. 正确
B. 错误
答案：A
详细解析：解析内容
```

### 1.2 字段规范

| 字段 | 必填 | 格式要求 |
|------|------|----------|
| 题号 | ✅ | `第X题`，X 为数字 |
| 题干 | ✅ | `题干：` 开头 |
| 选项 | 部分题型 | `A.` `B.` `C.` `D.` 开头，每个独占一行 |
| 答案 | ✅ | `答案：` 开头，多选用 `;` 分隔 |
| 详细解析 | ❌ | `详细解析：` 开头 |

### 1.3 题型判断逻辑

| 条件 | 判断结果 |
|------|----------|
| 有选项 + 答案含 `;` | `multi`（多选题） |
| 有选项 + 答案不含 `;` + 仅 A/B 选项且含正确/错误关键词 | `judge`（判断题） |
| 有选项 + 答案不含 `;` + 其他 | `choice`（单选题） |
| 无选项 + 题干含 `______` 或 `____` | `fill`（填空题） |
| 无选项 + 其他 | `essay`（问答题） |

---

## 2. `build_data.py` 使用手册

### 2.1 安装依赖

```bash
pip install cryptography
```

### 2.2 命令行参数

| 参数 | 说明 |
|------|------|
| `--interactive` / `-i` | 交互式录入模式 |
| `--input` / `-f` | 从 TXT 文件导入 |
| `--output` / `-o` | 输出文件路径（默认 `data.js`） |
| `--title` | 题库标题（默认 `星习`） |
| `--subtitle` | 题库副标题（默认 `交互式生成`） |
| `--plain` | 生成明文（不加密） |
| `--password` / `-p` | 指定授权码 |
| `--demo` | 生成加密示例题库 |
| `--save-txt` | 自动生成标准化 TXT（默认开启） |
| `--no-save-txt` | 不生成标准化 TXT |

### 2.3 使用示例

```bash
# 交互式录入
python build_data.py --interactive

# 从 TXT 导入（加密）
python build_data.py --input 题库.txt

# 从 TXT 导入（明文）
python build_data.py --input 题库.txt --plain

# 指定授权码
python build_data.py --input 题库.txt --password "ABC12-DEF34-GHI56"

# 自定义标题
python build_data.py --input 题库.txt --title "医学题库" --subtitle "执业医师版"

# 生成加密示例
python build_data.py --demo
```

### 2.4 交互式菜单

```bash
python build_data.py
```

菜单选项：
```
⭐ 星习 · 题库生成工具（规范TXT版）

  1. 交互式录入 — 逐题输入，生成题库
  2. 从规范化 TXT 导入 — 选择标准格式的文本文件
  3. 生成加密示例 — AES-256-CBC 加密，含解密脚本
  0. 退出
```

---

## 3. 加密机制说明

### 3.1 加密流程

```
题库数据（JSON） → AES-256-CBC 加密 → Base64 编码 → 写入 data.js
```

### 3.2 加密 Payload 结构

```json
{
  "meta": {
    "title": "题库标题",
    "subtitle": "副标题",
    "version": "1.0"
  },
  "questions": [
    "1|1|题目内容|选项A|选项B|答案|解析",
    "2|2|题目内容|选项A|选项B|选项C|A;B|解析"
  ]
}
```

### 3.3 字段编码说明

| 字段索引 | 说明 |
|----------|------|
| 0 | 题号 |
| 1 | 题型编号（1=choice, 2=multi, 3=fill, 4=essay, 5=judge） |
| 2 | 题干 |
| 3~N-2 | 选项（如果有） |
| N-1 | 答案 |
| N | 解析 |

### 3.4 加密参数

| 参数 | 值 |
|------|-----|
| 算法 | AES-256-CBC |
| 密钥派生 | PBKDF2-HMAC-SHA256 |
| 迭代次数 | 100000 |
| IV 长度 | 16 字节 |
| Salt 长度 | 16 字节 |
| 填充 | PKCS7 |

### 3.5 生成的文件

| 文件 | 说明 |
|------|------|
| `data.js` | 加密数据，挂载到 `window._encrypted_quiz_data` |
| `decrypt.js` | 解密脚本，使用 Web Crypto API |
| `key.txt` | 授权码（明文） |

---

## 4. 题型扩展指南

### 4.1 添加新题型步骤

1. **定义题型编号**：在 `type_to_num` 中添加映射
2. **更新解析逻辑**：在 `parse_standard_txt` 中增加识别规则
3. **更新前端显示**：在 `app.js` 的 `typeMap` 中添加标签
4. **更新 UI 渲染**：在 `renderQuestion` 中增加渲染分支

### 4.2 添加判断题（已完成）

| 文件 | 修改位置 |
|------|----------|
| `app.js` | `typeMap` 添加 `judge: '判断题'` |
| `app.js` | `isChoice` 判断包含 `judge` |
| `app.js` | `updateTypeChart` 添加 `judge` |
| `app.js` | 抽屉类型标签添加 `judge` |
| `build_data.py` | 题型判断逻辑增加判断题识别 |
| `build_data.py` | 交互式录入增加判断题选项 |

### 4.3 添加新题型代码模板

**在 `app.js` 中添加新题型：**

```javascript
// 1. 在 typeMap 中添加
const typeMap = { 
    choice: '单选题', 
    multi: '多选题', 
    fill: '填空题', 
    essay: '问答题', 
    judge: '判断题',
    // 新题型: '显示名称'
};

// 2. 在 renderQuestion 中添加渲染分支
if (q.type === 'new_type') {
    // 自定义渲染逻辑
}
```

**在 `build_data.py` 中添加新题型：**

```python
# 1. 在 type_to_num 中添加
type_to_num = {"choice": 1, "multi": 2, "fill": 3, "essay": 4, "judge": 5, "new_type": 6}

# 2. 在 parse_standard_txt 中添加识别逻辑
if 识别条件:
    q_type = 'new_type'
```

---

## 5. 测试指南

### 5.1 安装测试依赖

```bash
npm install --save-dev jest jsdom
```

### 5.2 运行测试

```bash
npm test
```

### 5.3 测试用例编写

**核心模块测试（`tests/core.test.js`）：**

```javascript
describe('核心模块测试', () => {
    beforeEach(() => {
        window.allQuestions = [
            { id: 1, type: 'choice', question: '测试题', options: ['A. 选项A', 'B. 选项B'], answer: 'A', explanation: '' }
        ];
    });

    test('记录正确答案时连续正确数递增', () => {
        CoreModule.initState();
        CoreModule.recordAnswer(0, true);
        const review = CoreModule.getReviewData(0);
        expect(review.consecutiveCorrect).toBe(1);
    });

    test('记录错误答案时连续正确数重置为0', () => {
        CoreModule.initState();
        CoreModule.recordAnswer(0, true);
        CoreModule.recordAnswer(0, false);
        const review = CoreModule.getReviewData(0);
        expect(review.consecutiveCorrect).toBe(0);
    });
});
```

### 5.4 手动测试清单

| 测试项 | 验证内容 |
|--------|----------|
| 所有题型渲染 | 单选题、多选题、填空题、问答题、判断题均正常显示 |
| 选项乱序 | 开启后选项顺序改变，提交答案判断正确 |
| 背诵模式 | 卡片翻转正常，显示答案和解析 |
| 模式切换 | 顺序/随机/错题/复习/收藏模式切换正常 |
| 统计更新 | 答题后统计面板数据实时更新 |
| 本地存储 | 刷新页面后进度恢复 |
| 导出功能 | TXT/CSV/JSON/笔记/错题集导出正常 |

---

## 6. 常见问题

### Q1: 解析 TXT 时提示“跳过无法识别题号的行”

**原因**：题号行格式不符合 `第X题` 规范。

**解决**：确保题号行格式为 `第1题`、`第2题` 等。

---

### Q2: 加密后解密失败

**可能原因**：
1. 授权码输入错误
2. `data.js` 和 `decrypt.js` 版本不匹配

**解决**：
1. 检查 `key.txt` 中的授权码
2. 重新运行 `build_data.py` 生成配套文件

---

### Q3: 添加新题型后前端不显示

**原因**：`app.js` 中的 `typeMap` 未更新。

**解决**：在 `typeMap` 中添加新题型的显示名称。

---

### Q4: 选项乱序后答案判断错误

**原因**：`q._shuffledAnswer` 未正确生成。

**解决**：检查 `renderQuestion` 中 `shuffledAnswerMap` 的生成逻辑，确保乱序后的答案标签正确映射。

---

### Q5: 本地存储数据丢失

**可能原因**：
1. 浏览器清理了缓存/本地存储
2. `STORAGE_KEY` 被修改

**解决**：
1. 定期导出数据备份
2. 保持 `STORAGE_KEY` 不变

---

## 附录 A：版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v9 | 2026-07 | 新增判断题支持；修复封装违规；Meta 纳入加密 Payload |
| v8 | - | 新增收藏模式 |
| v7 | - | 新增间隔复习算法 |
| v6 | - | 新增背诵模式 |

---

## 附录 B：文件依赖关系

```
build_data.py  →  data.js  (加密/明文)
               →  decrypt.js (加密时生成)
               →  key.txt (加密时生成)

index.html     →  data.js
               →  decrypt.js (加密版)
               →  app.js

app.js         →  window.meta
               →  window.allQuestions
               →  localStorage (进度数据)
```

---

**本文档仅供内部使用，请勿对外分发。**