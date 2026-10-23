/* Game balance only: rally strokes, including the serve; reset by resetServe(). */
(function (root) {
    'use strict';
    const budgets = Object.freeze({ easy: 8, medium: 18, hard: 30, fly: 24 });
    function capacity(level, stage) {
        const base = budgets[level] || budgets.easy;
        return stage === 7 ? Math.max(base, 36) : stage === 5 ? Math.max(base, 30) : base;
    }
    function evaluate(hits, level, stage) {
        const limit = capacity(level, stage);
        const used = Math.max(0, Number(hits) || 0);
        const exhausted = used >= limit;
        return {
            capacity: limit, hits: used,
            percent: Math.max(0, Math.ceil(100 * (1 - used / limit))),
            exhausted,
            speedScale: exhausted ? 0.72 : 1 - 0.15 * used / limit,
            errorChance: exhausted ? Math.min(0.82, 0.28 + (used - limit) * 0.06) : 0
        };
    }
    const api = Object.freeze({ budgets, capacity, evaluate });
    root.OpponentStamina = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
