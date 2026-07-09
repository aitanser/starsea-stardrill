// ================================================================
// 配置模块
// ================================================================
const CONFIG = {
    STORAGE_KEY: 'quiz_progress_v9',
    MAX_INTERVAL: 30,
    MASTERED_THRESHOLD: { consecutiveCorrect: 3, interval: 7 },
    MAX_HISTORY: 500,
    DEFAULT_MODE: 'sequential',
    DEFAULT_SHUFFLE_OPTIONS: false,
    DEFAULT_RECITE_MODE: false,
    DEFAULT_DAILY_GOAL: 10,
    APP_TITLE_SUFFIX: ' · 刷题工具',
    FONT_LEVELS: ['small', 'medium', 'large', 'xlarge'],
    TIMER_PRESETS: [15, 25, 45],
};

// ================================================================
// 数据模块 —— 动态读取 window 中的数据
// ================================================================
const DataModule = (function() {
    function getQuestions() {
        const raw = window.allQuestions || [];
        return raw.map((q, i) => ({
            id: q.id || (i + 1),
            type: q.type || 'choice',
            question: q.question || '（题目内容缺失）',
            options: Array.isArray(q.options) ? q.options : [],
            answer: q.answer || '',
            explanation: q.explanation || '',
            tags: [],
            difficulty: 0.5,
            lastReview: null,
            interval: 1,
            ease: 2.5,
            consecutiveCorrect: 0,
            createdAt: Date.now(),
        }));
    }

    function getMeta() {
        const defaultMeta = { title: '星习', subtitle: '', version: '1.0' };
        if (!window.meta) return { ...defaultMeta };
        return { ...defaultMeta, ...window.meta };
    }

    function getTotal() {
        return getQuestions().length;
    }

    return {
        get questions() { return getQuestions(); },
        get meta() { return getMeta(); },
        getTotal,
    };
})();

// ================================================================
// 存储模块
// ================================================================
const StorageModule = (function() {
    const KEY = CONFIG.STORAGE_KEY;
    const VERSION = '9';
    const defaultData = {
        version: VERSION,
        currentIndex: 0,
        userAnswers: {},
        questionStatus: {},
        correctTotal: 0,
        wrongTotal: 0,
        answeredTotal: 0,
        reviewData: {},
        historyLog: [],
        currentStreak: 0,
        darkMode: false,
        shuffleOptions: CONFIG.DEFAULT_SHUFFLE_OPTIONS,
        reciteMode: CONFIG.DEFAULT_RECITE_MODE,
        dailyGoal: CONFIG.DEFAULT_DAILY_GOAL,
        todayProgress: 0,
        todayDate: null,
        timeLog: {},
        totalStudyTime: 0,
        mode: CONFIG.DEFAULT_MODE,
        modeQueue: [],
        queueIndex: 0,
        essayExpanded: {},
        favorites: [],
        fontLevel: 'medium',
        timerPresetIndex: 0,
        timerRemaining: 1500,
        timerRunning: false,
        statsOpen: false,
    };
    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return { ...defaultData };
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') return { ...defaultData };
            const merged = { ...defaultData, ...data };
            const today = new Date().toDateString();
            if (merged.todayDate !== today) { merged.todayProgress = 0; merged.todayDate = today; }
            if (!Array.isArray(merged.modeQueue)) merged.modeQueue = [];
            if (typeof merged.essayExpanded !== 'object' || merged.essayExpanded === null) merged.essayExpanded = {};
            if (!Array.isArray(merged.favorites)) merged.favorites = [];
            if (!merged.fontLevel || !CONFIG.FONT_LEVELS.includes(merged.fontLevel)) merged.fontLevel = 'medium';
            if (typeof merged.timerRemaining !== 'number' || merged.timerRemaining < 0) merged.timerRemaining = 1500;
            return merged;
        } catch (_) { return { ...defaultData }; }
    }
    function save(data) {
        try { data.version = VERSION; data.timestamp = Date.now(); localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (_) { return false; }
    }
    function clear() { localStorage.removeItem(KEY); }
    return { load, save, clear };
})();

// ================================================================
// 核心模块
// ================================================================
const CoreModule = (function() {
    let state = {};
    let shuffledOptionsCache = {};

    function initState() {
        const saved = StorageModule.load();
        const total = DataModule.getTotal();
        if (saved.currentIndex >= total) saved.currentIndex = 0;
        state = saved;
        if (!state.modeQueue || state.modeQueue.length === 0) {
            state.modeQueue = buildModeQueue(state.mode || CONFIG.DEFAULT_MODE);
            state.queueIndex = 0;
        }
        if (!state.modeQueue.includes(state.currentIndex) && state.modeQueue.length > 0) {
            state.currentIndex = state.modeQueue[0];
        }
        recalcStats();
        return state;
    }

    function saveState() { StorageModule.save(state); }

    function recalcStats() {
        let c = 0, w = 0, a = 0;
        for (const idx in state.questionStatus) {
            const st = state.questionStatus[idx];
            if (st === 'correct') c++;
            else if (st === 'wrong') w++;
            a++;
        }
        state.correctTotal = c; state.wrongTotal = w; state.answeredTotal = a;
        let streak = 0;
        for (let i = state.historyLog.length - 1; i >= 0; i--) {
            if (state.historyLog[i].correct) streak++;
            else break;
        }
        state.currentStreak = streak;
        let totalTime = 0;
        for (const idx in state.timeLog) { totalTime += state.timeLog[idx] || 0; }
        state.totalStudyTime = totalTime;
    }

    function buildModeQueue(mode) {
        const total = DataModule.getTotal();
        let queue = [];
        const qs = DataModule.questions;
        switch (mode) {
            case 'sequential': queue = Array.from({ length: total }, (_, i) => i); break;
            case 'random':
                queue = Array.from({ length: total }, (_, i) => i);
                for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));
                    [queue[i], queue[j]] = [queue[j], queue[i]]; }
                break;
            case 'wrong':
                queue = qs.map((_, i) => i).filter(i => state.questionStatus[i] === 'wrong');
                break;
            case 'review':
                const due = getDueReviews();
                queue = due.length > 0 ? due : [];
                break;
            case 'favorite':
                queue = state.favorites.filter(i => i < total);
                break;
            default:
                queue = Array.from({ length: total }, (_, i) => i);
        }
        return [...new Set(queue)];
    }

    function getDueReviews() {
        const now = Date.now();
        const due = [];
        for (const idx in state.reviewData) {
            const r = state.reviewData[idx];
            const daysSince = (now - r.lastReview) / (1000 * 60 * 60 * 24);
            if (daysSince >= r.interval && state.questionStatus[idx] !== 'wrong') due.push(parseInt(idx));
            if (state.questionStatus[idx] === 'wrong') { if (!due.includes(parseInt(idx))) due.push(parseInt(idx)); }
        }
        return due;
    }

    function getMasteredCount() {
        let count = 0;
        for (const idx in state.reviewData) {
            const r = state.reviewData[idx];
            if (r.consecutiveCorrect >= CONFIG.MASTERED_THRESHOLD.consecutiveCorrect &&
                r.interval >= CONFIG.MASTERED_THRESHOLD.interval) count++;
        }
        return count;
    }

    function switchMode(mode) {
        state.mode = mode;
        state.modeQueue = buildModeQueue(mode);
        state.queueIndex = 0;
        if (state.modeQueue.length > 0) state.currentIndex = state.modeQueue[0];
        else {
            if (['wrong', 'review', 'favorite'].includes(mode)) {
                state.mode = 'sequential';
                state.modeQueue = buildModeQueue('sequential');
                state.currentIndex = 0;
            }
        }
        saveState();
        return { mode: state.mode, queue: state.modeQueue, index: state.currentIndex };
    }

    function navigate(direction) {
        if (state.modeQueue.length === 0) state.modeQueue = buildModeQueue(state.mode || 'sequential');
        let pos = state.modeQueue.indexOf(state.currentIndex);
        if (pos === -1) { pos = 0;
            state.currentIndex = state.modeQueue[0] !== undefined ? state.modeQueue[0] : 0; }
        pos = pos + direction;
        if (pos < 0) pos = state.modeQueue.length - 1;
        if (pos >= state.modeQueue.length) pos = 0;
        const newIdx = state.modeQueue[pos];
        const total = DataModule.getTotal();
        if (newIdx !== undefined && newIdx < total) { state.currentIndex = newIdx;
            state.queueIndex = pos;
            saveState(); return state.currentIndex; }
        return state.currentIndex;
    }

    function shuffleQueue() {
        if (state.modeQueue.length <= 1) return;
        const current = state.currentIndex;
        const shuffled = [...state.modeQueue];
        for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
        const pos = shuffled.indexOf(current);
        if (pos > -1) { shuffled.splice(pos, 1);
            shuffled.unshift(current); }
        state.modeQueue = shuffled;
        state.queueIndex = 0;
        state.currentIndex = shuffled[0];
        saveState();
        return state.currentIndex;
    }

    function startTimer(index) { if (!state.timeLog[index]) state.timeLog[index] = 0;
        window._currentTimerStart = Date.now(); }

    function stopTimer(index) {
        if (window._currentTimerStart) {
            const elapsed = (Date.now() - window._currentTimerStart) / 1000;
            if (elapsed > 0.5) { state.timeLog[index] = (state.timeLog[index] || 0) + elapsed;
                state.totalStudyTime = (state.totalStudyTime || 0) + elapsed;
                saveState(); }
            window._currentTimerStart = null;
        }
    }

    function recordAnswer(index, isCorrect) {
        const q = DataModule.questions[index];
        if (!q) return;
        stopTimer(index);
        state.questionStatus[index] = isCorrect ? 'correct' : 'wrong';
        if (isCorrect) { state.correctTotal++;
            state.currentStreak++; } else { state.wrongTotal++;
            state.currentStreak = 0; }
        state.answeredTotal++;
        const today = new Date().toDateString();
        if (state.todayDate !== today) { state.todayDate = today;
            state.todayProgress = 0; }
        state.todayProgress++;
        state.historyLog.push({ timestamp: Date.now(), index, correct: isCorrect, type: q.type });
        if (state.historyLog.length > CONFIG.MAX_HISTORY) state.historyLog = state.historyLog.slice(-CONFIG.MAX_HISTORY);
        if (!state.reviewData[index]) state.reviewData[index] = { lastReview: Date.now(), interval: 1, ease: 2.5,
            consecutiveCorrect: 0 };
        const r = state.reviewData[index];
        if (isCorrect) {
            r.consecutiveCorrect += 1;
            if (r.consecutiveCorrect === 1) r.interval = 1;
            else if (r.consecutiveCorrect === 2) r.interval = 3;
            else r.interval = Math.round(r.interval * r.ease);
            r.interval = Math.min(r.interval, CONFIG.MAX_INTERVAL);
            r.ease = Math.max(1.3, r.ease + 0.1);
        } else { r.consecutiveCorrect = 0;
            r.interval = 1;
            r.ease = Math.max(1.3, r.ease - 0.2); }
        r.lastReview = Date.now();
        if (['wrong', 'review', 'favorite'].includes(state.mode)) {
            state.modeQueue = buildModeQueue(state.mode);
            state.queueIndex = 0;
        }
        saveState();
        return state;
    }

    function resetQuestion(index) {
        if (state.questionStatus[index]) {
            const old = state.questionStatus[index];
            if (old === 'correct') state.correctTotal--;
            else if (old === 'wrong') state.wrongTotal--;
            state.answeredTotal--;
            delete state.questionStatus[index];
            delete state.userAnswers[index];
            if (state.reviewData[index]) { state.reviewData[index].consecutiveCorrect = 0;
                state.reviewData[index].interval = 1; }
            recalcStats();
            saveState();
        }
    }

    // ---- 修复：resetAll 重置 dailyGoal ----
    function resetAll() {
        state.userAnswers = {};
        state.questionStatus = {};
        state.reviewData = {};
        state.historyLog = [];
        state.timeLog = {};
        state.essayExpanded = {};
        state.favorites = [];
        state.correctTotal = 0;
        state.wrongTotal = 0;
        state.answeredTotal = 0;
        state.currentStreak = 0;
        state.totalStudyTime = 0;
        state.currentIndex = 0;
        state.todayProgress = 0;
        const today = new Date().toDateString();
        state.todayDate = today;
        state.mode = CONFIG.DEFAULT_MODE;
        state.modeQueue = buildModeQueue(state.mode);
        state.queueIndex = 0;
        state.dailyGoal = CONFIG.DEFAULT_DAILY_GOAL;  // 确保重置每日目标
        shuffledOptionsCache = {};
        saveState();
        return state;
    }

    function toggleFavorite(index) {
        const idx = state.favorites.indexOf(index);
        if (idx > -1) state.favorites.splice(idx, 1);
        else state.favorites.push(index);
        saveState();
        if (state.mode === 'favorite') {
            state.modeQueue = buildModeQueue('favorite');
            state.queueIndex = 0;
            if (state.modeQueue.length > 0) state.currentIndex = state.modeQueue[0];
            else { state.mode = 'sequential';
                state.modeQueue = buildModeQueue('sequential');
                state.currentIndex = 0; }
        }
        return state.favorites.includes(index);
    }

    function isFavorite(index) { return state.favorites.includes(index); }

    function getFontLevel() { return state.fontLevel || 'medium'; }

    function setFontLevel(level) {
        if (CONFIG.FONT_LEVELS.includes(level)) { state.fontLevel = level;
            saveState(); return level; }
        return state.fontLevel;
    }

    function getNextFontLevel(direction) {
        const levels = CONFIG.FONT_LEVELS;
        const idx = levels.indexOf(state.fontLevel || 'medium');
        let newIdx = idx + direction;
        if (newIdx < 0) newIdx = 0;
        if (newIdx >= levels.length) newIdx = levels.length - 1;
        return levels[newIdx];
    }

    function getTimerState() {
        return {
            remaining: state.timerRemaining || 1500,
            running: state.timerRunning || false,
            presetIndex: state.timerPresetIndex || 0,
        };
    }

    function setTimerRemaining(seconds) {
        state.timerRemaining = Math.max(0, seconds);
        saveState();
        return state.timerRemaining;
    }

    function setTimerRunning(running) {
        state.timerRunning = running;
        saveState();
        return state.timerRunning;
    }

    function cycleTimerPreset() {
        const presets = CONFIG.TIMER_PRESETS;
        let idx = (state.timerPresetIndex || 0) + 1;
        if (idx >= presets.length) idx = 0;
        state.timerPresetIndex = idx;
        state.timerRemaining = presets[idx] * 60;
        state.timerRunning = false;
        saveState();
        return { remaining: state.timerRemaining, presetIndex: idx };
    }

    function getStats() {
        const total = DataModule.getTotal();
        const answered = state.answeredTotal;
        const rate = answered ? Math.round((state.correctTotal / answered) * 100) : 0;
        const avgTime = answered ? Math.round((state.totalStudyTime / answered) * 10) / 10 : 0;
        return {
            total,
            correct: state.correctTotal,
            wrong: state.wrongTotal,
            answered,
            remaining: total - answered,
            rate,
            streak: state.currentStreak,
            mastered: getMasteredCount(),
            totalTime: state.totalStudyTime || 0,
            avgTime,
            todayProgress: state.todayProgress || 0,
            dailyGoal: state.dailyGoal || CONFIG.DEFAULT_DAILY_GOAL,
            mode: state.mode,
            queueLength: state.modeQueue.length,
            queueIndex: state.queueIndex,
        };
    }

    function getQuestionStatus(index) { return state.questionStatus[index] || null; }
    function getUserAnswer(index) { return state.userAnswers[index] ?? null; }
    function setUserAnswer(index, answer) { state.userAnswers[index] = answer;
        saveState(); }
    function getCurrentIndex() { return state.currentIndex; }
    function setCurrentIndex(index) { state.currentIndex = index;
        saveState(); }
    function getShuffleOptions() { return state.shuffleOptions || false; }
    function toggleShuffleOptions() {
        state.shuffleOptions = !state.shuffleOptions;
        if (!state.shuffleOptions) {
            shuffledOptionsCache = {};
        }
        saveState();
        return state.shuffleOptions;
    }
    function getReciteMode() { return state.reciteMode || false; }
    function toggleReciteMode() { state.reciteMode = !state.reciteMode;
        saveState(); return state.reciteMode; }
    function getReviewData(index) { return state.reviewData[index] || null; }
    function getHistoryLog() { return state.historyLog; }
    function getMode() { return state.mode; }
    function getModeQueue() { return state.modeQueue; }
    function getState() { return { ...state }; }
    function getTimeLog(index) { return state.timeLog[index] || 0; }

    // ---- 修复：setDailyGoal 正确处理 0 ----
    function setDailyGoal(goal) {
        const parsed = parseInt(goal);
        let val;
        if (isNaN(parsed) || parsed < 1) {
            val = 1;  // 修正：小于1时设为1
        } else {
            val = Math.min(parsed, 999);
        }
        state.dailyGoal = val;
        saveState();
        return state.dailyGoal;
    }

    function toggleEssayExpanded(index) {
        state.essayExpanded[index] = !state.essayExpanded[index];
        saveState();
        return state.essayExpanded[index];
    }

    function getShuffledOptions(index) {
        return shuffledOptionsCache[index] || null;
    }
    function setShuffledOptions(index, options) {
        shuffledOptionsCache[index] = options;
    }
    function clearShuffledCache() {
        shuffledOptionsCache = {};
    }

    function _resetForTest() {
        StorageModule.clear();
        shuffledOptionsCache = {};
        state = {
            version: '9',
            currentIndex: 0,
            userAnswers: {},
            questionStatus: {},
            correctTotal: 0,
            wrongTotal: 0,
            answeredTotal: 0,
            reviewData: {},
            historyLog: [],
            currentStreak: 0,
            darkMode: false,
            shuffleOptions: false,
            reciteMode: false,
            dailyGoal: CONFIG.DEFAULT_DAILY_GOAL,
            todayProgress: 0,
            todayDate: new Date().toDateString(),
            timeLog: {},
            totalStudyTime: 0,
            mode: CONFIG.DEFAULT_MODE,
            modeQueue: [],
            queueIndex: 0,
            essayExpanded: {},
            favorites: [],
            fontLevel: 'medium',
            timerPresetIndex: 0,
            timerRemaining: 1500,
            timerRunning: false,
            statsOpen: false,
        };
        const total = DataModule.getTotal();
        if (total > 0) {
            state.modeQueue = buildModeQueue(CONFIG.DEFAULT_MODE);
            state.currentIndex = state.modeQueue[0] || 0;
        }
        saveState();
        return state;
    }

    return {
        initState, saveState, getStats, getQuestionStatus, getUserAnswer, setUserAnswer,
        getCurrentIndex, setCurrentIndex, getShuffleOptions, toggleShuffleOptions,
        getReciteMode, toggleReciteMode, getReviewData, getHistoryLog, getMode, getModeQueue,
        getState, getTimeLog, startTimer, stopTimer, recordAnswer, resetQuestion, resetAll,
        switchMode, navigate, shuffleQueue, getDueReviews, getMasteredCount, setDailyGoal,
        toggleEssayExpanded, toggleFavorite, isFavorite, getFontLevel, setFontLevel,
        getNextFontLevel, getTimerState, setTimerRemaining, setTimerRunning, cycleTimerPreset,
        getShuffledOptions, setShuffledOptions, clearShuffledCache,
        _resetForTest,
    };
})();

// ================================================================
// UI 模块
// ================================================================
const UIModule = (function() {
    const LABELS = 'ABCDEFGHIJ'.split('');

    // ---- 修复：在 renderQuestion 内部获取 container ----
    const progressFill = document.getElementById('progressFill');
    const progressLabel = document.getElementById('progressLabel');
    const progressBadge = document.getElementById('progressBadge');
    const mainTitle = document.getElementById('mainTitle');
    const subTitle = document.getElementById('subTitle');

    const dashTotal = document.getElementById('dashTotal');
    const dashCorrect = document.getElementById('dashCorrect');
    const dashWrong = document.getElementById('dashWrong');
    const dashRate = document.getElementById('dashRate');
    const dashStreak = document.getElementById('dashStreak');
    const dashMastered = document.getElementById('dashMastered');
    const dashTotalTime = document.getElementById('dashTotalTime');
    const dashAvgTime = document.getElementById('dashAvgTime');
    const typeChart = document.getElementById('typeChart');
    const masteryChart = document.getElementById('masteryChart');
    const todayProgress = document.getElementById('todayProgress');
    const dailyGoalInput = document.getElementById('dailyGoalInput');
    const heatmapGrid = document.getElementById('heatmapGrid');

    const TYPE_MAP = {
        choice: '单选题',
        multi: '多选题',
        fill: '填空题',
        essay: '问答题',
        judge: '判断题'
    };

    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function formatTime(seconds) {
        if (seconds < 60) return Math.round(seconds) + 's';
        if (seconds < 3600) return Math.round(seconds / 60) + 'm';
        return (seconds / 3600).toFixed(1) + 'h';
    }

    function renderHeatmap() {
        const history = CoreModule.getHistoryLog();
        const today = new Date();
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toDateString();
            const count = history.filter(h => new Date(h.timestamp).toDateString() === key).length;
            days.push({ date: d, count: Math.min(count, 5) });
        }
        let html = '';
        days.forEach(day => {
            const level = day.count;
            html += `<div class="heatmap-cell level-${level}" title="${day.date.toLocaleDateString()}: ${day.count}题"></div>`;
        });
        heatmapGrid.innerHTML = html;
    }

    // ---- 修复：renderQuestion 增加 container 空值保护 ----
    function renderQuestion(index, options) {
        const container = document.getElementById('questionContainer');
        if (!container) {
            console.warn('questionContainer 不存在，无法渲染');
            return;
        }

        const { shuffleOptions = CoreModule.getShuffleOptions(), reciteMode = CoreModule.getReciteMode() } = options || {};
        const qs = DataModule.questions;
        const q = qs[index];
        if (!q || !q.question) {
            container.innerHTML =
                `<div class="question-card" style="text-align:center;padding:48px 20px;color:var(--text-muted);"><i class="fas fa-exclamation-triangle" style="font-size:48px;display:block;margin-bottom:16px;"></i><h3>题目数据异常（第 ${index+1} 题）</h3><p style="font-size:14px;">请检查题库文件</p></div>`;
            return;
        }

        const currentAnswer = CoreModule.getUserAnswer(index);
        const status = CoreModule.getQuestionStatus(index);
        const review = CoreModule.getReviewData(index);
        const timeSpent = CoreModule.getTimeLog(index);
        const isFav = CoreModule.isFavorite(index);
        const isDue = review && (Date.now() - review.lastReview) / (1000 * 60 * 60 * 24) >= (review.interval || 1);

        const typeLabel = TYPE_MAP[q.type] || q.type;

        let diffLabel = '';
        if (review) {
            if (review.consecutiveCorrect >= CONFIG.MASTERED_THRESHOLD.consecutiveCorrect &&
                review.interval >= CONFIG.MASTERED_THRESHOLD.interval) diffLabel = '⭐ 已掌握';
            else if (review.consecutiveCorrect >= 2) diffLabel = '🟢 熟悉';
            else if (review.consecutiveCorrect === 1) diffLabel = '🟡 一般';
            else if (status === 'wrong') diffLabel = '🔴 需复习';
        }

        let cardHtml = '';
        if (reciteMode) {
            const answerDisplay = Array.isArray(q.answer) ? q.answer.join('、') : q.answer;
            cardHtml = `
                <div class="card-flip" id="flipCard">
                    <div class="front">
                        <div class="q-text">${q.question}</div>
                        <div class="flip-hint"><i class="fas fa-hand-pointer"></i> 点击卡片显示答案</div>
                    </div>
                    <div class="back">
                        <div class="q-text" style="font-weight:600;">${q.question}</div>
                        <div style="margin-top:12px;padding:12px 16px;background:var(--primary-light);border-radius:var(--radius);">
                            <span style="font-weight:600;">答案：</span> ${answerDisplay}
                        </div>
                        ${q.explanation ? `<div style="margin-top:10px;padding:10px 14px;background:var(--bg);border-radius:var(--radius);font-size:calc(var(--base-font-size) - 2px);color:var(--text-secondary);"><i class="fas fa-lightbulb"></i> ${q.explanation}</div>` : ''}
                        <div class="flip-hint"><i class="fas fa-hand-pointer"></i> 再次点击翻转</div>
                    </div>
                </div>
            `;
        } else {
            let optionsHtml = '';
            let actionHtml = '';
            const isChoice = (q.type === 'choice' || q.type === 'multi' || q.type === 'judge');

            if (isChoice) {
                const isMulti = (q.type === 'multi');
                let rawOptions = (q.options || []).map((opt, i) => ({
                    label: LABELS[i] || String.fromCharCode(65 + i),
                    text: opt || '（空选项）',
                    originalIndex: i,
                }));

                if (q.type === 'judge' && rawOptions.length === 0) {
                    rawOptions = [
                        { label: 'A', text: '正确', originalIndex: 0 },
                        { label: 'B', text: '错误', originalIndex: 1 }
                    ];
                }

                if (rawOptions.length === 0) {
                    rawOptions = [{ label: 'A', text: '（无选项）', originalIndex: 0 }];
                }

                let optionList = rawOptions;
                if (shuffleOptions) {
                    const cacheKey = index;
                    let cached = CoreModule.getShuffledOptions(cacheKey);
                    if (!cached) {
                        cached = shuffleArray(rawOptions);
                        CoreModule.setShuffledOptions(cacheKey, cached);
                    }
                    optionList = cached;
                }

                let answerLabels = Array.isArray(q.answer) ? q.answer : [q.answer];
                let shuffledAnswerMap = {};
                if (shuffleOptions) {
                    let idxToNewLabel = {};
                    optionList.forEach((item, idx) => { idxToNewLabel[item.originalIndex] = item.label; });
                    let newAnswerLabels = answerLabels.map(label => {
                        let origIdx = LABELS.indexOf(label);
                        return idxToNewLabel[origIdx] || label;
                    });
                    shuffledAnswerMap = { isMulti: isMulti, labels: newAnswerLabels.length === 1 ? newAnswerLabels[0] :
                            newAnswerLabels };
                } else {
                    shuffledAnswerMap = { isMulti: isMulti, labels: isMulti ? answerLabels : answerLabels[0] };
                }
                q._shuffledAnswer = shuffledAnswerMap.labels;

                let optsHtml = optionList.map((item) => {
                    const label = item.label;
                    const text = item.text;
                    let checked = false;
                    if (currentAnswer !== null && currentAnswer !== undefined) {
                        if (isMulti) { checked = Array.isArray(currentAnswer) && currentAnswer.includes(
                            label); } else { checked = (currentAnswer === label); }
                    }
                    let cls = 'opt-item';
                    if (status !== null) cls += ' disabled';
                    if (checked && status === null) cls += ' selected';
                    if (status === 'correct' || status === 'wrong') {
                        const ansArr = Array.isArray(q._shuffledAnswer) ? q._shuffledAnswer : [q
                            ._shuffledAnswer];
                        if (ansArr.includes(label)) cls += ' correct';
                        else if (checked) cls += ' wrong';
                    }
                    const shortcut = optionList.indexOf(item) < 9 ? (optionList.indexOf(item) + 1) : '';
                    return `
                        <div class="${cls}" data-label="${label}" data-multi="${isMulti}" data-shortcut="${shortcut}">
                            <span class="opt-label">${label}</span>
                            <span class="opt-text">${text} ${shortcut ? `<span style="font-size:11px;color:var(--text-muted);opacity:0.5;">(${shortcut})</span>` : ''}</span>
                        </div>
                    `;
                }).join('');

                const multiHint = isMulti ? `<div class="multi-hint"><i class="fas fa-check-square"></i> 多选题 · 点击切换选项</div>` : '';
                optionsHtml = `<div class="options" data-qidx="${index}">${optsHtml}</div>`;
                if (isMulti) optionsHtml = multiHint + optionsHtml;

                if (status === null) {
                    const hasAnswer = currentAnswer !== null && currentAnswer !== undefined &&
                        (!Array.isArray(currentAnswer) || currentAnswer.length > 0);
                    actionHtml =
                        `<button class="btn btn-primary" id="submitChoice-${index}" ${!hasAnswer ? 'disabled' : ''}><i class="fas fa-check"></i> 提交答案 <span style="font-size:11px;font-weight:400;opacity:0.6;">(Enter)</span></button>`;
                } else {
                    actionHtml =
                        `<button class="btn btn-success" id="resetChoice-${index}"><i class="fas fa-undo-alt"></i> 重新作答</button>`;
                }
            } else if (q.type === 'fill') {
                const val = (currentAnswer !== null && currentAnswer !== undefined) ? currentAnswer : '';
                optionsHtml =
                    `<input class="fill-input" id="fill-${index}" type="text" placeholder="输入答案…" value="${val}" ${status !== null ? 'disabled' : ''}>`;
                if (status === null) {
                    actionHtml =
                        `<button class="btn btn-primary" id="submitFill-${index}"><i class="fas fa-check"></i> 提交答案 <span style="font-size:11px;font-weight:400;opacity:0.6;">(Enter)</span></button>`;
                } else {
                    actionHtml =
                        `<button class="btn btn-success" id="resetFill-${index}"><i class="fas fa-undo-alt"></i> 重新作答</button>`;
                }
            } else if (q.type === 'essay') {
                actionHtml =
                    `<button class="btn btn-outline" id="showEssay-${index}"><i class="fas fa-eye"></i> 显示参考答案</button>`;
            }

            let expHtml = '';
            let showExp = false;
            if (q.type !== 'essay') showExp = (status !== null);

            if (showExp) {
                const isCorrect = (status === 'correct');
                const ansDisplay = Array.isArray(q.answer) ? q.answer.join('、') : q.answer;
                expHtml = `
                    <div class="explanation show" id="explanation-${index}">
                        <div class="exp-status ${isCorrect ? 'correct' : 'wrong'}">${isCorrect ? '<i class="fas fa-check-circle"></i> 回答正确' : '<i class="fas fa-times-circle"></i> 回答错误'}</div>
                        <div><span class="ans-label">正确答案：</span><span class="ans-value">${ansDisplay}</span></div>
                        ${q.explanation ? `<div class="exp-detail"><strong><i class="fas fa-lightbulb"></i> 解析：</strong>${q.explanation}</div>` : ''}
                    </div>
                `;
            } else if (q.type === 'essay') {
                const isExpanded = CoreModule.getState().essayExpanded[index] || false;
                expHtml = `
                    <div class="explanation ${isExpanded ? 'show' : ''}" id="explanation-${index}">
                        <div><span class="ans-label"><i class="fas fa-book"></i> 参考答案</span></div>
                        <div style="margin-top:8px;padding:14px 16px;background:var(--bg);border-radius:10px;font-size:calc(var(--base-font-size) - 1px);line-height:1.8;color:var(--text-secondary);">${q.answer || '（无参考答案）'}</div>
                        ${q.explanation ? `<div class="exp-detail"><strong><i class="fas fa-lightbulb"></i> 解析：</strong>${q.explanation}</div>` : ''}
                    </div>
                `;
            }

            cardHtml = `
                ${optionsHtml}
                <div class="action-row">${actionHtml}</div>
                ${expHtml}
            `;
        }

        let reviewHint = '';
        if (!reciteMode && status === 'correct' && review) {
            reviewHint =
                `<div class="review-hint show"><i class="fas fa-sync-alt"></i> 下次复习：${review.interval} 天后 (连续正确 ${review.consecutiveCorrect} 次)</div>`;
        } else if (!reciteMode && status === 'wrong') {
            reviewHint = `<div class="review-hint show"><i class="fas fa-exclamation-triangle"></i> 这道题已加入错题集，建议明天重新练习</div>`;
        }

        const shuffleBadge = shuffleOptions && (q.type === 'choice' || q.type === 'multi' || q.type === 'judge') ? `<span class="q-shuffle-badge"><i class="fas fa-random"></i> 选项已乱序</span>` : '';
        const reciteBadge = reciteMode ? `<span class="q-shuffle-badge" style="background:var(--warning-bg);color:var(--warning);"><i class="fas fa-book"></i> 背诵模式</span>` :
            '';
        const timeStr = timeSpent > 0 ? `<span style="font-size:calc(var(--base-font-size) - 4px);color:var(--text-muted);margin-left:auto;"><i class="fas fa-clock"></i> ${formatTime(timeSpent)}</span>` : '';
        const favBtn = `<button class="favorite-btn ${isFav ? 'active' : ''}" id="favBtn-${index}" title="${isFav ? '取消收藏' : '收藏本题'}"><i class="fas fa-star"></i></button>`;

        const html = `
            <div class="question-card">
                <div class="q-header">
                    <span class="q-type"><i class="fas fa-tag"></i> ${typeLabel}</span>
                    <span class="q-id">#${q.id}</span>
                    ${diffLabel ? `<span class="q-difficulty">${diffLabel}</span>` : ''}
                    ${isDue && status !== 'wrong' ? `<span class="q-difficulty" style="background:var(--warning-bg);color:var(--warning);"><i class="fas fa-bell"></i> 待复习</span>` : ''}
                    ${shuffleBadge}
                    ${reciteBadge}
                    ${timeStr}
                    ${favBtn}
                </div>
                <div class="q-text">${q.question}</div>
                ${cardHtml}
                ${reviewHint}
            </div>
        `;

        container.innerHTML = html;
        bindQuestionEvents(index);

        if (reciteMode) {
            const flipCard = document.getElementById('flipCard');
            if (flipCard) {
                flipCard.addEventListener('click', function(e) { this.classList.toggle('flipped'); });
                document.addEventListener('keydown', function(e) {
                    if (e.key === ' ' && !e.target.matches('input, textarea')) {
                        const flip = document.getElementById('flipCard');
                        if (flip && flip.closest('.question-card')) { e.preventDefault();
                            flip.classList.toggle('flipped'); }
                    }
                });
            }
        }

        const total = DataModule.getTotal();
        progressLabel.textContent = `${index + 1} / ${total}`;
        const pct = ((index + 1) / total) * 100;
        progressFill.style.width = Math.min(100, pct) + '%';

        const stats = CoreModule.getStats();
        todayProgress.textContent = stats.todayProgress || 0;
        dailyGoalInput.value = stats.dailyGoal || CONFIG.DEFAULT_DAILY_GOAL;
        renderHeatmap();
    }

    function bindQuestionEvents(index) {
        const qs = DataModule.questions;
        const q = qs[index];
        if (!q) return;
        const reciteMode = CoreModule.getReciteMode();
        if (reciteMode) return;

        const container = document.getElementById('questionContainer');
        if (!container) return;

        const favBtn = document.getElementById(`favBtn-${index}`);
        if (favBtn) {
            favBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const isFav = CoreModule.toggleFavorite(index);
                this.classList.toggle('active', isFav);
                this.title = isFav ? '取消收藏' : '收藏本题';
                updateStats();
                updateModeTabs();
            });
        }

        if (q.type === 'choice' || q.type === 'multi' || q.type === 'judge') {
            const optsDiv = container.querySelector('.options');
            const submitBtn = container.querySelector(`#submitChoice-${index}`);
            const resetBtn = container.querySelector(`#resetChoice-${index}`);

            if (optsDiv) {
                optsDiv.querySelectorAll('.opt-item:not(.disabled)').forEach(el => {
                    el.addEventListener('click', function(e) {
                        if (this.classList.contains('disabled')) return;
                        const label = this.dataset.label;
                        const isMulti = this.dataset.multi === 'true';
                        let current = CoreModule.getUserAnswer(index) ?? (isMulti ? [] : null);
                        if (isMulti) {
                            if (!Array.isArray(current)) current = [];
                            const idx = current.indexOf(label);
                            if (idx >= 0) current.splice(idx, 1);
                            else current.push(label);
                            current.sort();
                            CoreModule.setUserAnswer(index, current);
                        } else {
                            CoreModule.setUserAnswer(index, label);
                        }
                        renderQuestion(index, { shuffleOptions: CoreModule.getShuffleOptions(),
                            reciteMode: CoreModule.getReciteMode() });
                    });
                });
            }

            if (submitBtn) {
                submitBtn.addEventListener('click', function() { handleSubmit(index); });
            }
            if (resetBtn) {
                resetBtn.addEventListener('click', function() { handleReset(index); });
            }
            if (submitBtn) {
                const ans = CoreModule.getUserAnswer(index);
                const hasAnswer = ans !== null && ans !== undefined &&
                    (!Array.isArray(ans) || ans.length > 0);
                submitBtn.disabled = !hasAnswer;
            }
        } else if (q.type === 'fill') {
            const input = container.querySelector(`#fill-${index}`);
            const submitBtn = container.querySelector(`#submitFill-${index}`);
            const resetBtn = container.querySelector(`#resetFill-${index}`);
            if (submitBtn) {
                submitBtn.addEventListener('click', function() {
                    const val = input.value.trim();
                    if (!val) { alert('请输入答案'); return; }
                    const isCorrect = val.toLowerCase() === q.answer.toLowerCase();
                    handleAnswerResult(index, isCorrect);
                });
            }
            if (resetBtn) {
                resetBtn.addEventListener('click', function() { handleReset(index); });
            }
            if (input && submitBtn) {
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault();
                        submitBtn.click(); }
                });
            }
        } else if (q.type === 'essay') {
            const btn = container.querySelector(`#showEssay-${index}`);
            const exp = container.querySelector(`#explanation-${index}`);
            if (btn && exp) {
                const updateText = () => {
                    btn.innerHTML = exp.classList.contains('show') ?
                        '<i class="fas fa-eye-slash"></i> 隐藏参考答案' :
                        '<i class="fas fa-eye"></i> 显示参考答案';
                };
                updateText();
                btn.addEventListener('click', function() {
                    const newState = CoreModule.toggleEssayExpanded(index);
                    exp.classList.toggle('show', newState);
                    updateText();
                });
            }
        }
    }

    function handleSubmit(index) {
        const qs = DataModule.questions;
        const q = qs[index];
        if (!q) return;
        const ans = CoreModule.getUserAnswer(index);
        if (ans === null || ans === undefined || (Array.isArray(ans) && ans.length === 0)) {
            alert('请先选择选项');
            return;
        }
        let isCorrect = false;
        const correctAns = q._shuffledAnswer || q.answer;
        if (q.type === 'choice' || q.type === 'judge') {
            isCorrect = (ans === correctAns);
        } else {
            const a1 = [...ans].sort();
            const a2 = Array.isArray(correctAns) ? [...correctAns].sort() : [correctAns].sort();
            isCorrect = (a1.length === a2.length && a1.every((v, i) => v === a2[i]));
        }
        handleAnswerResult(index, isCorrect);
    }

    function handleReset(index) {
        CoreModule.resetQuestion(index);
        renderQuestion(index, { shuffleOptions: CoreModule.getShuffleOptions(), reciteMode: CoreModule
                .getReciteMode() });
        updateStats();
    }

    function handleAnswerResult(index, isCorrect) {
        CoreModule.recordAnswer(index, isCorrect);
        renderQuestion(index, { shuffleOptions: CoreModule.getShuffleOptions(), reciteMode: CoreModule
                .getReciteMode() });
        updateStats();
    }

    function updateStats() {
        const stats = CoreModule.getStats();
        const total = stats.total;
        const answered = stats.answered;
        const rate = stats.rate;

        progressBadge.textContent = `${answered} / ${total}`;
        const pct = (answered / total) * 100;
        document.getElementById('progressFill').style.width = Math.min(100, pct) + '%';

        document.getElementById('miniStreak').textContent = stats.streak;
        document.getElementById('miniRate').textContent = stats.rate + '%';
        document.getElementById('miniProgress').textContent = `${stats.answered}/${stats.total}`;
        document.getElementById('miniMastered').textContent = stats.mastered;

        dashTotal.textContent = total;
        dashCorrect.textContent = stats.correct;
        dashWrong.textContent = stats.wrong;
        dashRate.textContent = rate + '%';
        dashStreak.textContent = stats.streak;
        dashMastered.textContent = stats.mastered;
        dashTotalTime.textContent = formatTime(stats.totalTime);
        dashAvgTime.textContent = stats.avgTime ? formatTime(stats.avgTime) : '--';

        todayProgress.textContent = stats.todayProgress || 0;
        dailyGoalInput.value = stats.dailyGoal || CONFIG.DEFAULT_DAILY_GOAL;

        updateTypeChart();
        updateMasteryChart();
        updateModeTabs();
        renderHeatmap();
    }

    function updateTypeChart() {
        const qs = DataModule.questions;
        const typeMap = { choice: '单选', multi: '多选', fill: '填空', essay: '问答', judge: '判断' };
        const types = ['choice', 'multi', 'fill', 'essay', 'judge'];
        let html = '';
        for (const type of types) {
            const typeQs = qs.filter(q => q.type === type);
            if (typeQs.length === 0) continue;
            const answeredQs = typeQs.filter(q => {
                const idx = qs.indexOf(q);
                return CoreModule.getQuestionStatus(idx) !== null;
            });
            const correctQs = typeQs.filter(q => {
                const idx = qs.indexOf(q);
                return CoreModule.getQuestionStatus(idx) === 'correct';
            });
            const rate = answeredQs.length ? Math.round((correctQs.length / answeredQs.length) * 100) : 0;
            const color = rate >= 80 ? 'green' : (rate >= 50 ? 'orange' : 'red');
            html += `
                <div class="bar-row">
                    <span class="bar-label">${typeMap[type] || type}</span>
                    <div class="bar-track"><div class="bar-fill ${color}" style="width:${rate}%;"></div></div>
                    <span class="bar-pct">${rate}%</span>
                    <span style="font-size:11px;color:var(--text-muted);min-width:50px;">${correctQs.length}/${answeredQs.length}</span>
                </div>
            `;
        }
        typeChart.innerHTML = html || '<div style="color:var(--text-muted);font-size:13px;">暂无数据</div>';
    }

    function updateMasteryChart() {
        const total = DataModule.getTotal();
        const mastered = CoreModule.getMasteredCount();
        const reviewed = Object.keys(CoreModule.getState().reviewData).length;
        const never = total - reviewed;
        const levels = [
            { label: '⭐ 已掌握', count: mastered, color: 'green' },
            { label: '🔄 复习中', count: Math.max(0, reviewed - mastered), color: 'orange' },
            { label: '📝 未学习', count: Math.max(0, never), color: 'blue' },
        ];
        let html = '';
        for (const level of levels) {
            const pct = total ? Math.round((level.count / total) * 100) : 0;
            html += `
                <div class="bar-row">
                    <span class="bar-label">${level.label}</span>
                    <div class="bar-track"><div class="bar-fill ${level.color}" style="width:${pct}%;"></div></div>
                    <span class="bar-pct">${level.count}</span>
                </div>
            `;
        }
        masteryChart.innerHTML = html;
    }

    function updateModeTabs() {
        const mode = CoreModule.getMode();
        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
        });
        const qs = DataModule.questions;
        const wrongCount = qs.filter((_, i) => CoreModule.getQuestionStatus(i) === 'wrong').length;
        document.getElementById('wrongCountTab').textContent = wrongCount ? `(${wrongCount})` : '';
        const dueCount = CoreModule.getDueReviews().length;
        document.getElementById('reviewCountTab').textContent = dueCount ? `(${dueCount})` : '';
        const favCount = CoreModule.getState().favorites.length;
        document.getElementById('favCountTab').textContent = favCount ? `(${favCount})` : '';
    }

    function renderDrawer(tab) {
        const qs = DataModule.questions;
        const list = document.getElementById('drawerList');
        if (!list) return;

        if (!qs || qs.length === 0) {
            list.innerHTML = `<div class="drawer-empty">📭 暂无题目数据，请检查题库文件</div>`;
            return;
        }

        let items = [];
        if (tab === 'all') {
            items = qs.map((_, i) => i);
        } else if (tab === 'wrong') {
            items = qs.map((_, i) => i).filter(i => CoreModule.getQuestionStatus(i) === 'wrong');
        } else if (tab === 'review') {
            items = CoreModule.getDueReviews().filter(i => i < qs.length);
        } else if (tab === 'favorite') {
            items = CoreModule.getState().favorites.filter(i => i < qs.length);
        }

        if (items.length === 0) {
            const emptyMsg = {
                'wrong': '🎉 没有错题！',
                'review': '✅ 没有待复习的题目！',
                'favorite': '⭐ 还没有收藏的题目',
                'all': '📭 暂无题目'
            };
            list.innerHTML = `<div class="drawer-empty">${emptyMsg[tab] || '暂无题目'}</div>`;
            return;
        }

        let html = '';
        const currentIdx = CoreModule.getCurrentIndex();
        items.forEach(idx => {
            const q = qs[idx];
            if (!q) return;
            const st = CoreModule.getQuestionStatus(idx);
            let statusText = '⏳';
            let statusClass = 'pending';
            if (st === 'correct') { statusText = '✅'; statusClass = 'correct'; }
            else if (st === 'wrong') { statusText = '❌'; statusClass = 'wrong'; }
            const isCurrent = (idx === currentIdx) ? 'current' : '';
            const typeLabel = TYPE_MAP[q.type] || '';
            let previewText = (q.question || '（题目缺失）').replace(/______/g, '___').replace(/\s+/g, ' ');
            if (previewText.length > 28) previewText = previewText.slice(0, 28) + '…';
            let reviewBadge = '';
            const review = CoreModule.getReviewData(idx);
            if (review && st !== 'wrong') {
                const daysSince = (Date.now() - review.lastReview) / (1000 * 60 * 60 * 24);
                if (daysSince >= review.interval) reviewBadge = ' 🔄';
            }
            const isFav = CoreModule.isFavorite(idx);
            html += `
                <div class="drawer-item ${isCurrent}" data-index="${idx}">
                    <span class="idx">${idx + 1}</span>
                    <span class="badge"><i class="fas fa-tag"></i> ${typeLabel}</span>
                    <span class="text">${isFav ? '⭐ ' : ''}${previewText}${reviewBadge}</span>
                    <span class="status ${statusClass}">${statusText}</span>
                </div>
            `;
        });
        list.innerHTML = html;

        list.querySelectorAll('.drawer-item').forEach(el => {
            el.addEventListener('click', function() {
                const idx = parseInt(this.dataset.index);
                if (!isNaN(idx) && idx >= 0 && idx < qs.length) {
                    CoreModule.setCurrentIndex(idx);
                    renderQuestion(idx, { shuffleOptions: CoreModule.getShuffleOptions(),
                        reciteMode: CoreModule.getReciteMode() });
                    updateStats();
                    closeDrawer();
                }
            });
        });
    }

    let drawerTab = 'all';

    function openDrawer() {
        renderDrawer(drawerTab);
        document.getElementById('drawerOverlay').classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
        document.getElementById('drawerOverlay').classList.remove('show');
        document.body.style.overflow = '';
    }

    function exportData(format) {
        const stats = CoreModule.getStats();
        const state = CoreModule.getState();
        const qs = DataModule.questions;
        const data = {
            meta: DataModule.meta,
            stats: stats,
            details: qs.map((q, idx) => ({
                id: q.id,
                type: q.type,
                question: q.question,
                yourAnswer: CoreModule.getUserAnswer(idx),
                correctAnswer: q.answer,
                status: CoreModule.getQuestionStatus(idx),
                explanation: q.explanation,
                review: CoreModule.getReviewData(idx),
                timeSpent: CoreModule.getTimeLog(idx),
            })),
            history: CoreModule.getHistoryLog().slice(-100),
            exportedAt: new Date().toISOString(),
        };
        let content, ext, mime;
        if (format === 'json') {
            content = JSON.stringify(data, null, 2);
            ext = 'json';
            mime = 'application/json';
        } else if (format === 'csv') {
            let lines = ['题号,题型,题目,你的答案,正确答案,状态,解析'];
            data.details.forEach(d => {
                const status = d.status || '未答';
                const yourAns = d.yourAnswer !== null && d.yourAnswer !== undefined ?
                    (Array.isArray(d.yourAnswer) ? d.yourAnswer.join(';') : d.yourAnswer) :
                    '未作答';
                const correctAns = Array.isArray(d.correctAnswer) ? d.correctAnswer.join(';') : d
                .correctAnswer;
                const question = d.question.replace(/,/g, '，');
                lines.push(
                    `${d.id},${d.type},${question},${yourAns},${correctAns},${status},${d.explanation || ''}`
                    );
            });
            content = '\uFEFF' + lines.join('\n');
            ext = 'csv';
            mime = 'text/csv;charset=utf-8;';
        } else {
            let lines = [
                `📘 学习报告 - ${DataModule.meta.title}`,
                `导出时间：${new Date().toLocaleString()}`,
                `—`.repeat(40),
                `总题数：${stats.total}`,
                `已答：${stats.answered}`,
                `正确：${stats.correct}`,
                `错误：${stats.wrong}`,
                `正确率：${stats.rate}%`,
                `已掌握：${stats.mastered}`,
                `连续正确：${stats.streak}`,
                `总学习时间：${formatTime(stats.totalTime)}`,
                `平均每题：${stats.avgTime ? formatTime(stats.avgTime) : '--'}`,
                `—`.repeat(40),
                `详细记录：`,
                '',
            ];
            data.details.forEach(d => {
                const status = d.status || '未答';
                const yourAns = d.yourAnswer !== null && d.yourAnswer !== undefined ?
                    (Array.isArray(d.yourAnswer) ? d.yourAnswer.join('、') : d.yourAnswer) :
                    '未作答';
                const correctAns = Array.isArray(d.correctAnswer) ? d.correctAnswer.join('、') : d
                .correctAnswer;
                lines.push(`[${d.id}] ${d.question}`);
                lines.push(`  你的答案：${yourAns}`);
                lines.push(`  正确答案：${correctAns}`);
                lines.push(`  状态：${status}`);
                if (d.explanation) lines.push(`  解析：${d.explanation}`);
                lines.push('');
            });
            content = lines.join('\n');
            ext = 'txt';
            mime = 'text/plain;charset=utf-8';
        }
        return { content, ext, mime };
    }

    // ---- 修复：exportWrongSet 安全使用 alert ----
    function exportWrongSet() {
        const qs = DataModule.questions;
        const wrongIndices = qs.map((_, i) => i).filter(i => CoreModule.getQuestionStatus(i) === 'wrong');
        if (wrongIndices.length === 0) {
            try {
                if (typeof alert !== 'undefined') {
                    alert('🎉 没有错题！不需要导出。');
                }
            } catch(e) {}
            return null;
        }
        let lines = [
            `📕 错题集 - ${DataModule.meta.title}`,
            `导出时间：${new Date().toLocaleString()}`,
            `错题总数：${wrongIndices.length}`,
            `—`.repeat(50),
            ''
        ];
        wrongIndices.forEach(idx => {
            const q = qs[idx];
            const yourAns = CoreModule.getUserAnswer(idx);
            const yourAnsStr = yourAns !== null && yourAns !== undefined ?
                (Array.isArray(yourAns) ? yourAns.join('、') : yourAns) : '未作答';
            const correctAns = Array.isArray(q.answer) ? q.answer.join('、') : q.answer;
            lines.push(`【题号 ${q.id}】${q.question}`);
            lines.push(`  你的答案：${yourAnsStr}`);
            lines.push(`  正确答案：${correctAns}`);
            if (q.explanation) lines.push(`  解析：${q.explanation}`);
            lines.push('');
        });
        const content = lines.join('\n');
        return { content, ext: 'txt', mime: 'text/plain;charset=utf-8' };
    }

    function downloadFile(content, ext, mime) {
        const blob = new Blob([content], { type: mime });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `学习报告_${new Date().toISOString().slice(0,10)}.${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    function applyFontLevel(level) {
        document.documentElement.className = document.documentElement.className
            .split(' ')
            .filter(c => !c.startsWith('font-'))
            .join(' ');
        if (level && level !== 'medium') {
            document.documentElement.classList.add(`font-${level}`);
        }
    }

    function initUI() {
        const meta = DataModule.meta;
        const title = meta.title;
        const subtitle = meta.subtitle;
        document.title = title + CONFIG.APP_TITLE_SUFFIX;
        mainTitle.textContent = title;
        subTitle.textContent = subtitle;

        const state = CoreModule.initState();
        const currentIndex = state.currentIndex;

        applyFontLevel(CoreModule.getFontLevel());

        const statsBody = document.getElementById('statsBody');
        const statsArrow = document.getElementById('statsArrow');
        if (state.statsOpen) {
            statsBody.classList.add('open');
            statsArrow.classList.add('open');
        }

        renderQuestion(currentIndex, { shuffleOptions: CoreModule.getShuffleOptions(), reciteMode: CoreModule
                .getReciteMode() });
        updateStats();
        updateModeTabs();

        const statsToggle = document.getElementById('statsToggle');
        statsToggle.addEventListener('click', function() {
            const isOpen = statsBody.classList.toggle('open');
            statsArrow.classList.toggle('open', isOpen);
            const currentState = CoreModule.getState();
            currentState.statsOpen = isOpen;
            CoreModule.saveState();
        });

        dailyGoalInput.addEventListener('change', function() {
            let val = parseInt(this.value);
            if (isNaN(val) || val < 1) { this.value = 1;
                val = 1; }
            CoreModule.setDailyGoal(val);
            updateStats();
        });

        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                const mode = this.dataset.mode;
                if (mode === CoreModule.getMode()) return;
                CoreModule.switchMode(mode);
                renderQuestion(CoreModule.getCurrentIndex(), { shuffleOptions: CoreModule
                        .getShuffleOptions(), reciteMode: CoreModule.getReciteMode() });
                updateStats();
                updateModeTabs();
            });
        });

        document.getElementById('shuffleOptionsToggle').addEventListener('click', function() {
            const active = CoreModule.toggleShuffleOptions();
            this.classList.toggle('active', active);
            renderQuestion(CoreModule.getCurrentIndex(), { shuffleOptions: CoreModule
                    .getShuffleOptions(), reciteMode: CoreModule.getReciteMode() });
        });
        document.getElementById('shuffleOptionsToggle').classList.toggle('active', CoreModule
            .getShuffleOptions());

        document.getElementById('reciteModeToggle').addEventListener('click', function() {
            const active = CoreModule.toggleReciteMode();
            this.classList.toggle('active', active);
            renderQuestion(CoreModule.getCurrentIndex(), { shuffleOptions: CoreModule
                    .getShuffleOptions(), reciteMode: CoreModule.getReciteMode() });
        });
        document.getElementById('reciteModeToggle').classList.toggle('active', CoreModule.getReciteMode());

        document.getElementById('prevBtn').addEventListener('click', function() {
            const newIdx = CoreModule.navigate(-1);
            renderQuestion(newIdx, { shuffleOptions: CoreModule.getShuffleOptions(),
                reciteMode: CoreModule.getReciteMode() });
            updateStats();
        });
        document.getElementById('nextBtn').addEventListener('click', function() {
            const newIdx = CoreModule.navigate(1);
            renderQuestion(newIdx, { shuffleOptions: CoreModule.getShuffleOptions(),
                reciteMode: CoreModule.getReciteMode() });
            updateStats();
        });
        document.getElementById('shuffleBtn').addEventListener('click', function() {
            const newIdx = CoreModule.shuffleQueue();
            renderQuestion(newIdx, { shuffleOptions: CoreModule.getShuffleOptions(),
                reciteMode: CoreModule.getReciteMode() });
            updateStats();
        });
        document.getElementById('resetBtn').addEventListener('click', function() {
            handleReset(CoreModule.getCurrentIndex());
        });

        document.addEventListener('keydown', function(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                if (e.key === 'Enter') {
                    const container = document.getElementById('questionContainer');
                    if (container) {
                        const submitBtn = container.querySelector('.btn-primary');
                        if (submitBtn) submitBtn.click();
                    }
                }
                return;
            }
            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    document.getElementById('prevBtn').click();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    document.getElementById('nextBtn').click();
                    break;
                case 'r':
                case 'R':
                    e.preventDefault();
                    document.getElementById('resetBtn').click();
                    break;
                case '1':
                case '2':
                case '3':
                case '4':
                case '5':
                case '6':
                case '7':
                case '8':
                case '9':
                    const num = parseInt(e.key);
                    const container = document.getElementById('questionContainer');
                    if (container) {
                        const opt = container.querySelector(`.opt-item:not(.disabled)[data-shortcut="${num}"]`);
                        if (opt) opt.click();
                    }
                    break;
            }
        });

        const moreDropdown = document.getElementById('moreDropdown');
        document.getElementById('moreToggleBtn').addEventListener('click', function(e) {
            e.stopPropagation();
            moreDropdown.classList.toggle('show');
        });
        document.addEventListener('click', function(e) {
            if (!e.target.closest('#moreDropdown') && !e.target.closest('#moreToggleBtn')) {
                moreDropdown.classList.remove('show');
            }
        });

        document.getElementById('exportTxtBtn').addEventListener('click', function() {
            const { content, ext, mime } = exportData('txt');
            downloadFile(content, ext, mime);
            moreDropdown.classList.remove('show');
        });
        document.getElementById('exportCsvBtn').addEventListener('click', function() {
            const { content, ext, mime } = exportData('csv');
            downloadFile(content, ext, mime);
            moreDropdown.classList.remove('show');
        });
        document.getElementById('exportJsonBtn').addEventListener('click', function() {
            const { content, ext, mime } = exportData('json');
            downloadFile(content, ext, mime);
            moreDropdown.classList.remove('show');
        });
        document.getElementById('exportNoteBtn').addEventListener('click', function() {
            const stats = CoreModule.getStats();
            const qs = DataModule.questions;
            const lines = [
                `📝 背诵笔记 - ${DataModule.meta.title}`,
                `导出时间：${new Date().toLocaleString()}`,
                `—`.repeat(40),
                `已掌握：${stats.mastered} 题`,
                `复习中：${Object.keys(CoreModule.getState().reviewData).length - stats.mastered} 题`,
                `—`.repeat(40),
                '',
            ];
            qs.forEach((q, idx) => {
                const status = CoreModule.getQuestionStatus(idx);
                if (status) {
                    const ansDisplay = Array.isArray(q.answer) ? q.answer.join('、') : q.answer;
                    lines.push(`[${q.id}] ${q.question}`);
                    lines.push(`  答案：${ansDisplay}`);
                    if (q.explanation) lines.push(`  解析：${q.explanation}`);
                    lines.push('');
                }
            });
            const content = lines.join('\n');
            downloadFile(content, 'txt', 'text/plain;charset=utf-8');
            moreDropdown.classList.remove('show');
        });

        document.getElementById('exportWrongBtn').addEventListener('click', function() {
            const result = exportWrongSet();
            if (result) { downloadFile(result.content, result.ext, result.mime);
                moreDropdown.classList.remove('show'); }
        });

        document.getElementById('gotoWrongBtn').addEventListener('click', function() {
            const qs = DataModule.questions;
            const wrongIndices = qs.map((_, i) => i).filter(i => CoreModule.getQuestionStatus(i) === 'wrong');
            if (wrongIndices.length === 0) { alert('🎉 没有错题！继续加油！'); return; }
            CoreModule.switchMode('wrong');
            renderQuestion(CoreModule.getCurrentIndex(), { shuffleOptions: CoreModule
                    .getShuffleOptions(), reciteMode: CoreModule.getReciteMode() });
            updateStats();
            updateModeTabs();
            moreDropdown.classList.remove('show');
        });

        document.getElementById('resetAllBtn').addEventListener('click', function() {
            if (!confirm('⚠️ 确定要重置全部进度吗？此操作不可撤销！')) return;
            CoreModule.resetAll();
            renderQuestion(CoreModule.getCurrentIndex(), { shuffleOptions: CoreModule
                    .getShuffleOptions(), reciteMode: CoreModule.getReciteMode() });
            updateStats();
            updateModeTabs();
            moreDropdown.classList.remove('show');
            alert('✅ 已重置全部进度！');
        });

        document.getElementById('drawerToggleBtn').addEventListener('click', openDrawer);
        document.getElementById('drawerCloseBtn').addEventListener('click', closeDrawer);
        document.getElementById('drawerOverlay').addEventListener('click', function(e) {
            if (e.target === this) closeDrawer();
        });
        document.querySelectorAll('[data-drawer-tab]').forEach(el => {
            el.addEventListener('click', function() {
                drawerTab = this.dataset.drawerTab;
                document.querySelectorAll('[data-drawer-tab]').forEach(b => b.classList.remove(
                    'active'));
                this.classList.add('active');
                renderDrawer(drawerTab);
            });
        });

        let shortcutsVisible = false;
        let shortcutsTimer = null;
        document.getElementById('shortcutsToggle').addEventListener('click', function() {
            const hint = document.getElementById('shortcutsHint');
            if (shortcutsVisible) { hint.classList.remove('show');
                shortcutsVisible = false; if (shortcutsTimer) clearTimeout(shortcutsTimer); return; }
            hint.classList.add('show');
            shortcutsVisible = true;
            if (shortcutsTimer) clearTimeout(shortcutsTimer);
            shortcutsTimer = setTimeout(() => { hint.classList.remove('show');
                shortcutsVisible = false; }, 8000);
        });

        document.getElementById('fontDecBtn').addEventListener('click', function() {
            const level = CoreModule.getNextFontLevel(-1);
            CoreModule.setFontLevel(level);
            applyFontLevel(level);
        });
        document.getElementById('fontIncBtn').addEventListener('click', function() {
            const level = CoreModule.getNextFontLevel(1);
            CoreModule.setFontLevel(level);
            applyFontLevel(level);
        });

        let timerInterval = null;
        const timerDisplay = document.getElementById('timerDisplay');
        const timerBtn = document.getElementById('timerToggle');

        function updateTimerDisplay(seconds) {
            const m = Math.floor(seconds / 60);
            const s = seconds % 60;
            timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        function syncTimerFromState() {
            const state = CoreModule.getTimerState();
            updateTimerDisplay(state.remaining);
            if (state.running) {
                timerBtn.classList.add('active');
                timerBtn.innerHTML =
                    `<i class="fas fa-stop"></i> <span class="timer-display" id="timerDisplay">${timerDisplay.textContent}</span>`;
            } else {
                timerBtn.classList.remove('active');
                const preset = CONFIG.TIMER_PRESETS[state.presetIndex];
                timerBtn.innerHTML =
                    `<i class="fas fa-hourglass-half"></i> <span class="timer-display" id="timerDisplay">${timerDisplay.textContent}</span>`;
            }
        }
        syncTimerFromState();

        timerBtn.addEventListener('click', function() {
            const state = CoreModule.getTimerState();
            if (state.running) {
                CoreModule.setTimerRunning(false);
                if (timerInterval) { clearInterval(timerInterval);
                    timerInterval = null; }
                timerBtn.classList.remove('active');
                timerBtn.innerHTML =
                    `<i class="fas fa-hourglass-half"></i> <span class="timer-display" id="timerDisplay">${timerDisplay.textContent}</span>`;
            } else {
                if (state.remaining <= 0) {
                    const preset = CONFIG.TIMER_PRESETS[state.presetIndex];
                    CoreModule.setTimerRemaining(preset * 60);
                    updateTimerDisplay(preset * 60);
                }
                CoreModule.setTimerRunning(true);
                timerBtn.classList.add('active');
                timerBtn.innerHTML =
                    `<i class="fas fa-stop"></i> <span class="timer-display" id="timerDisplay">${timerDisplay.textContent}</span>`;
                if (timerInterval) clearInterval(timerInterval);
                timerInterval = setInterval(() => {
                    let rem = CoreModule.getTimerState().remaining;
                    if (rem <= 1) {
                        clearInterval(timerInterval);
                        timerInterval = null;
                        CoreModule.setTimerRunning(false);
                        timerBtn.classList.remove('active');
                        timerBtn.innerHTML =
                            `<i class="fas fa-hourglass-half"></i> <span class="timer-display" id="timerDisplay">00:00</span>`;
                        document.getElementById('focusOverlay').classList.add('show');
                        document.getElementById('focusMessage').textContent =
                            `已完成 ${CONFIG.TIMER_PRESETS[CoreModule.getTimerState().presetIndex]} 分钟专注！`;
                        return;
                    }
                    rem = rem - 1;
                    CoreModule.setTimerRemaining(rem);
                    updateTimerDisplay(rem);
                }, 1000);
            }
        });

        let pressTimer = null;
        timerBtn.addEventListener('mousedown', function(e) {
            pressTimer = setTimeout(() => {
                const result = CoreModule.cycleTimerPreset();
                updateTimerDisplay(result.remaining);
                CoreModule.setTimerRunning(false);
                if (timerInterval) { clearInterval(timerInterval);
                    timerInterval = null; }
                timerBtn.classList.remove('active');
                timerBtn.innerHTML =
                    `<i class="fas fa-hourglass-half"></i> <span class="timer-display" id="timerDisplay">${timerDisplay.textContent}</span>`;
                alert(`已切换至 ${CONFIG.TIMER_PRESETS[result.presetIndex]} 分钟专注模式`);
            }, 600);
        });
        timerBtn.addEventListener('mouseup', function() { clearTimeout(pressTimer); });
        timerBtn.addEventListener('mouseleave', function() { clearTimeout(pressTimer); });

        document.getElementById('focusDismissBtn').addEventListener('click', function() {
            document.getElementById('focusOverlay').classList.remove('show');
            const state = CoreModule.getTimerState();
            const preset = CONFIG.TIMER_PRESETS[state.presetIndex];
            CoreModule.setTimerRemaining(preset * 60);
            updateTimerDisplay(preset * 60);
            timerBtn.innerHTML =
                `<i class="fas fa-hourglass-half"></i> <span class="timer-display" id="timerDisplay">${timerDisplay.textContent}</span>`;
        });

        const themeToggle = document.getElementById('themeToggle');
        themeToggle.addEventListener('click', function() {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
            this.innerHTML = isDark ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
            const state = CoreModule.getState();
            state.darkMode = !isDark;
            CoreModule.saveState();
        });
        const savedState = CoreModule.getState();
        if (savedState.darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
            themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        }

        let saveTimeout;
        const originalSave = CoreModule.saveState;
        CoreModule.saveState = function() {
            originalSave();
            const dot = document.getElementById('saveDot');
            const status = document.getElementById('saveStatus');
            if (dot) {
                dot.style.background = 'var(--success)';
            }
            if (status) {
                status.textContent = '已保存';
                status.style.display = 'inline';
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => {
                    if (status) status.style.display = 'none';
                }, 2000);
            }
        };
        setInterval(() => { CoreModule.saveState(); }, 30000);
        window.addEventListener('beforeunload', () => { CoreModule.saveState(); });
    }

    return {
        initUI,
        renderQuestion,
        updateStats,
        updateModeTabs,
        openDrawer,
        closeDrawer,
        exportData,
        exportWrongSet,
    };
})();

// ================================================================
// 启动应用（仅在浏览器环境执行）
// ================================================================
window.__startApp = function() {
    if (typeof UIModule !== 'undefined' && UIModule.initUI) {
        UIModule.initUI();
    } else {
        setTimeout(window.__startApp, 50);
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CoreModule, DataModule, StorageModule, UIModule, CONFIG };
}

if (typeof module === 'undefined' || !module.exports) {
    document.addEventListener('DOMContentLoaded', function() {
        if (window.allQuestions && window.allQuestions.length > 0) {
            window.__startApp();
        } else {
            let attempts = 0;
            const interval = setInterval(function() {
                attempts++;
                if (window.allQuestions && window.allQuestions.length > 0) {
                    clearInterval(interval);
                    window.__startApp();
                } else if (attempts > 50) {
                    clearInterval(interval);
                    console.warn('数据加载超时，请检查 data.js 和 decrypt.js');
                }
            }, 100);
        }
    });
}