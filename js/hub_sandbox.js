/**
 * ═══════════════════════════════════════════════════════════
 * 🍃 中興湖 2.5D 動態活沙盤引擎 (NCHU Lake Living Sandbox)
 * 正宗《動物森友會》自然木質風格 + 活體生態巡邏系統 + 互動氣泡
 * ═══════════════════════════════════════════════════════════
 */
(function(window) {
    'use strict';

    let pCanvas = null;
    let pCtx = null;
    let animId = null;
    let isRunning = false;
    let lastTime = 0;
    let timeAcc = 0;

    // 視差微動偏移
    let targetParallaxX = 0, targetParallaxY = 0;

    // 櫻花／落葉粒子池
    const MAX_PARTICLES = 22;
    const particles = [];

    // 湖面黑天鵝與鴨鴨家族狀態 (沿中興湖開闊水道巡游，嚴格避開中心島、大樹與兩座球場)
    const swanWaypoints = [
        { x: 30.0, y: 45.0 }, // 0: 西北開闊水灣 (避開西南第二球場)
        { x: 47.0, y: 39.5 }, // 1: 北側無障礙水道 (高過中心島與大樹)
        { x: 58.0, y: 53.0 }, // 2: 東北中央通道 (避開東北第一球場)
        { x: 68.0, y: 60.0 }, // 3: 東南碧波水灣 (廣闊無障礙水面)
        { x: 56.0, y: 65.5 }, // 4: 南側水域 (遠離圖書館與拱橋)
        { x: 48.0, y: 58.5 }, // 5: 中央南水道 (避開西南第二球場)
        { x: 42.0, y: 49.0 }  // 6: 中央西水道 (避開西南球場與中心島)
    ];
    let swanProgress = 0;
    let lastRippleTime = 0;
    const ripplesPool = [];

    // Catmull-Rom 閉合曲線平滑內插演算法
    function getCatmullRomPoint(p0, p1, p2, p3, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        const f0 = -0.5 * t3 + t2 - 0.5 * t;
        const f1 =  1.5 * t3 - 2.5 * t2 + 1.0;
        const f2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
        const f3 =  0.5 * t3 - 0.5 * t2;
        return {
            x: p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3,
            y: p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3
        };
    }

    function getCatmullRomLoop(pts, prog) {
        const n = pts.length;
        const p = ((prog % n) + n) % n;
        const idx1 = Math.floor(p);
        const t = p - idx1;
        const idx0 = (idx1 - 1 + n) % n;
        const idx2 = (idx1 + 1) % n;
        const idx3 = (idx1 + 2) % n;
        return getCatmullRomPoint(pts[idx0], pts[idx1], pts[idx2], pts[idx3], t);
    }

    // 背包柴犬步道巡邏狀態
    const shibaWaypoints = [
        { x: 18.0, y: 38.0 },
        { x: 22.5, y: 55.0 },
        { x: 25.5, y: 72.0 }
    ];
    let shibaSegment = 0;
    let shibaDir = 1;
    let shibaT = 0;
    let shibaPauseTimer = 0;

    // 珍奶貓咪步道漫步狀態
    const catWaypoints = [
        { x: 33.0, y: 83.5 },
        { x: 50.0, y: 84.0 },
        { x: 67.0, y: 83.0 }
    ];
    let catSegment = 0;
    let catDir = 1;
    let catT = 0;
    let catPauseTimer = 0;

    // DOM 快取
    let domCache = null;
    let actorAudioCtx = null;

    // 角色對話台詞庫
    const actorQuotes = {
        swan: [
            "👑 嘎！我是中興湖村長鵝！今天湖面微風，適合打第三桿放短 (Drop)！",
            "👑 咕咕！誰在偷偷摸本村長的金色皇冠？小心我用雙翅截擊！",
            "👑 嘎啊！生科大樓的果蠅大腦連接組剛剛算出了 38% 突觸抑制！",
            "👑 嘎！要進小碼頭闖關嗎？第一關發球記得要過網落在發球區喔！",
            "👑 嘎～中興湖水色今日特別碧綠，看來是練習對角長抽的好日子！"
        ],
        duck1: [
            "🦆 呱呱！我是鵝老大的第一巡邏副手！隨時保持中興湖航道暢通！",
            "🦆 呱！剛剛看到水底有一顆 40 孔亮黃色室外匹克球耶！",
            "🦆 呱呱呱！千萬不要踩進廚房區凌空抽擊，會被裁判抓犯規的！",
            "🦆 呱！緊跟在村長鵝後面游動，可以吃到最多新鮮水草～"
        ],
        duck2: [
            "🐥 嗶嗶！中興湖的水草真好吃～肚子飽飽才有力氣打球！",
            "🐥 嗶！小碼頭的小熊跟小兔已經激戰 50 回合啦！加油加油！",
            "🐥 嗶嗶嗶！按左上角頭貼可以換成動森柴柴或水豚造型喔！",
            "🐥 嗶～浮台碼頭晃呀晃的，好想跳上去當球僮呀！"
        ],
        shiba: [
            "🐕 汪汪！我的後背包裝滿了匹克球拍跟補給水壺！",
            "🐕 汪！今天去社管大樓測動力鏈，軀幹發力與轉體得分 98 分！",
            "🐕 汪嗚～散步去看看名人堂英雄榜，我也要衝上第一名！",
            "🐕 汪！在後場深球擊球時，記得身體重心向前壓，球才會扎實！",
            "🐕 汪汪！天氣真好，今天一定要在湖畔連擊賽突破 20 球！"
        ],
        cat: [
            "🐈 喵～圖書館前喝一杯半糖微冰珍珠奶茶，人生一大享受喵～",
            "🐈 喵嗚～旋球是匹克球的精髓，手指向上滑動刷出漂亮上旋！",
            "🐈 喵！剛才看到行政大樓的學號綁定，雲端進度隨時同步喵～",
            "🐈 喵～中興湖的微風好溫柔，躺在草皮上曬太陽最舒服了喵～",
            "🐈 喵嗚～剛剛社管大樓的柴柴一直盯著我的吸管看，真好笑！"
        ],
        dock: [
            "🐻 熊熊：看我的第三桿放短 (Drop Shot)！精準過網落入廚房區！",
            "🐰 兔兔：接招！大角度反手挑球直攻底線！",
            "🏓 雙方激戰中！點擊右側碼頭圖標，挑戰水上 5 大歷險關卡！",
            "🐻 熊熊：雙彈跳規則要記牢！發球與接發球都必須落地一次才能擊球！",
            "🐰 兔兔：看我輕巧放短，再伺機在廚房線前打出追身球！"
        ],
        court_sw: [
            "🦊 狐狸：近網切球 (Dink) 要放鬆手腕，輕輕推過網帶！",
            "🐧 企鵝：看我的反手提拉！球在廚房線前剛剛好落地！",
            "🏓 雙方切磋中！第二球場是選手們每天清晨的特訓秘密基地～",
            "🦊 狐狸：千萬不要著急抽球，耐心等待對手失誤放高！"
        ]
    };
    const quoteIndexMap = { swan: 0, duck1: 0, duck2: 0, shiba: 0, cat: 0, dock: 0, court_sw: 0 };

    // 初始化粒子
    function initParticles(w, h) {
        particles.length = 0;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            particles.push({
                x: Math.random() * (w || 600),
                y: Math.random() * (h || 1000),
                vx: 0.35 + Math.random() * 0.45,
                vy: 0.55 + Math.random() * 0.75,
                size: 3 + Math.random() * 4.5,
                angle: Math.random() * Math.PI * 2,
                vRot: (Math.random() - 0.5) * 0.035,
                flutter: Math.random() * Math.PI * 2,
                color: Math.random() > 0.45 
                    ? 'rgba(255, 183, 197, 0.75)'  // 櫻花粉
                    : 'rgba(168, 218, 140, 0.75)'   // 動森草葉綠
            });
        }
    }

    // 動態產生水波漣漪 (DOM 擴散)
    function spawnWaterRipple(pctX, pctY) {
        const viewport = domCache ? domCache.viewport : document.getElementById('hub-map-viewport');
        if (!viewport) return;

        // 控制場上最大漣漪數量
        if (ripplesPool.length > 7) {
            const oldRip = ripplesPool.shift();
            if (oldRip && oldRip.parentNode) oldRip.parentNode.removeChild(oldRip);
        }

        const rip = document.createElement('div');
        rip.className = 'ac-water-ripple';
        rip.style.left = pctX.toFixed(2) + '%';
        rip.style.top = pctY.toFixed(2) + '%';
        viewport.appendChild(rip);
        ripplesPool.push(rip);

        setTimeout(() => {
            const idx = ripplesPool.indexOf(rip);
            if (idx !== -1) ripplesPool.splice(idx, 1);
            if (rip.parentNode) rip.parentNode.removeChild(rip);
        }, 2200);
    }

    // 繪製飄落花瓣與綠葉粒子
    function drawParticles(ctx, w, h) {
        ctx.save();
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.x += p.vx + Math.sin(p.flutter) * 0.5;
            p.y += p.vy;
            p.angle += p.vRot;
            p.flutter += 0.035;

            if (p.y > h + 15 || p.x > w + 15) {
                p.x = Math.random() * (w * 0.75);
                p.y = -12;
            }

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 0.48, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
    }

    // 快取 DOM 節點
    function refreshDomCache() {
        domCache = {
            viewport: document.getElementById('hub-map-viewport'),
            bgImg: document.getElementById('hub-map-bg-img'),
            actorSwan: document.getElementById('actor-swan'),
            actorSwanFlip: document.getElementById('actor-swan-flip'),
            actorDuck1: document.getElementById('actor-duck-1'),
            actorDuck1Flip: document.getElementById('actor-duck-1-flip'),
            actorDuck2: document.getElementById('actor-duck-2'),
            actorDuck2Flip: document.getElementById('actor-duck-2-flip'),
            actorShiba: document.getElementById('actor-shiba'),
            actorShibaFlip: document.getElementById('actor-shiba-flip'),
            actorCat: document.getElementById('actor-cat'),
            actorCatFlip: document.getElementById('actor-cat-flip'),
            courtDuelNE: document.getElementById('court-duel-ne'),
            courtDuelSW: document.getElementById('court-duel-sw')
        };
    }

    // 活體演員動態移動運算核心
    function updateActors(dt) {
        if (!domCache || !domCache.viewport) refreshDomCache();
        if (!domCache) return;

        // ════ 1. 👑 黑天鵝與小鴨家族巡游 (全開闊水道無障礙巡弋) ════
        const nSwan = swanWaypoints.length;
        swanProgress = (swanProgress + 0.042 * dt) % nSwan;

        const pSwan = getCatmullRomLoop(swanWaypoints, swanProgress);
        const pNext = getCatmullRomLoop(swanWaypoints, swanProgress + 0.03);
        const svx = pNext.x - pSwan.x;

        if (domCache.actorSwan) {
            domCache.actorSwan.style.left = pSwan.x.toFixed(2) + '%';
            domCache.actorSwan.style.top = pSwan.y.toFixed(2) + '%';
            if (domCache.actorSwanFlip) {
                // 🦢 預設朝左：svx > 0 向右移動時水平翻轉
                domCache.actorSwanFlip.style.transform = svx > 0.005 ? 'scaleX(-1)' : 'scaleX(1)';
            }
        }

        // 定時產生水波漣漪
        if (timeAcc - lastRippleTime > 0.85) {
            spawnWaterRipple(pSwan.x, pSwan.y + 1.2);
            lastRippleTime = timeAcc;
        }

        // 🦆 小水鴨跟班 1
        const d1Prog = (swanProgress - 0.22 + nSwan) % nSwan;
        const pDuck1 = getCatmullRomLoop(swanWaypoints, d1Prog);
        const pD1Next = getCatmullRomLoop(swanWaypoints, d1Prog + 0.03);
        const d1vx = pD1Next.x - pDuck1.x;
        if (domCache.actorDuck1) {
            domCache.actorDuck1.style.left = pDuck1.x.toFixed(2) + '%';
            domCache.actorDuck1.style.top = pDuck1.y.toFixed(2) + '%';
            if (domCache.actorDuck1Flip) {
                domCache.actorDuck1Flip.style.transform = d1vx > 0.005 ? 'scaleX(-1)' : 'scaleX(1)';
            }
        }

        // 🐥 小雛鴨跟班 2
        const d2Prog = (swanProgress - 0.44 + nSwan) % nSwan;
        const pDuck2 = getCatmullRomLoop(swanWaypoints, d2Prog);
        const pD2Next = getCatmullRomLoop(swanWaypoints, d2Prog + 0.03);
        const d2vx = pD2Next.x - pDuck2.x;
        if (domCache.actorDuck2) {
            domCache.actorDuck2.style.left = pDuck2.x.toFixed(2) + '%';
            domCache.actorDuck2.style.top = pDuck2.y.toFixed(2) + '%';
            if (domCache.actorDuck2Flip) {
                domCache.actorDuck2Flip.style.transform = d2vx > 0.005 ? 'scaleX(-1)' : 'scaleX(1)';
            }
        }

        // ════ 2. 🎒 背包柴犬步道巡邏 ════
        if (shibaPauseTimer > 0) {
            shibaPauseTimer -= dt;
        } else {
            const pStart = shibaDir === 1 ? shibaWaypoints[shibaSegment] : shibaWaypoints[shibaSegment + 1];
            const pEnd = shibaDir === 1 ? shibaWaypoints[shibaSegment + 1] : shibaWaypoints[shibaSegment];
            const dx = pEnd.x - pStart.x;
            const dy = pEnd.y - pStart.y;
            const dist = Math.hypot(dx, dy) || 1;
            const speed = 4.0; // 百分比 / 秒
            shibaT += (speed / dist) * dt;

            if (shibaT >= 1) {
                shibaT = 0;
                if (shibaDir === 1) {
                    shibaSegment++;
                    if (shibaSegment >= shibaWaypoints.length - 1) {
                        shibaDir = -1;
                        shibaSegment = shibaWaypoints.length - 2;
                        shibaPauseTimer = 1.8; // 端點停頓張望
                    }
                } else {
                    shibaSegment--;
                    if (shibaSegment < 0) {
                        shibaDir = 1;
                        shibaSegment = 0;
                        shibaPauseTimer = 1.8; // 端點停頓張望
                    }
                }
            }

            const clampedT = Math.min(1, Math.max(0, shibaT));
            const shibaCurX = pStart.x + dx * clampedT;
            const shibaCurY = pStart.y + dy * clampedT;

            if (domCache.actorShiba) {
                domCache.actorShiba.style.left = shibaCurX.toFixed(2) + '%';
                domCache.actorShiba.style.top = shibaCurY.toFixed(2) + '%';
                if (domCache.actorShibaFlip) {
                    domCache.actorShibaFlip.style.transform = dx > 0.05 ? 'scaleX(-1)' : 'scaleX(1)';
                }
            }
        }

        // ════ 3. 🧋 珍奶貓咪步道漫遊 ════
        if (catPauseTimer > 0) {
            catPauseTimer -= dt;
        } else {
            const cpStart = catDir === 1 ? catWaypoints[catSegment] : catWaypoints[catSegment + 1];
            const cpEnd = catDir === 1 ? catWaypoints[catSegment + 1] : catWaypoints[catSegment];
            const cdx = cpEnd.x - cpStart.x;
            const cdy = cpEnd.y - cpStart.y;
            const cdist = Math.hypot(cdx, cdy) || 1;
            const cspeed = 3.6; // 百分比 / 秒
            catT += (cspeed / cdist) * dt;

            if (catT >= 1) {
                catT = 0;
                if (catDir === 1) {
                    catSegment++;
                    if (catSegment >= catWaypoints.length - 1) {
                        catDir = -1;
                        catSegment = catWaypoints.length - 2;
                        catPauseTimer = 2.2; // 端點停頓喝珍奶
                    }
                } else {
                    catSegment--;
                    if (catSegment < 0) {
                        catDir = 1;
                        catSegment = 0;
                        catPauseTimer = 2.2; // 端點停頓喝珍奶
                    }
                }
            }

            const cClampedT = Math.min(1, Math.max(0, catT));
            const catCurX = cpStart.x + cdx * cClampedT;
            const catCurY = cpStart.y + cdy * cClampedT;

            if (domCache.actorCat) {
                domCache.actorCat.style.left = catCurX.toFixed(2) + '%';
                domCache.actorCat.style.top = catCurY.toFixed(2) + '%';
                if (domCache.actorCatFlip) {
                    domCache.actorCatFlip.style.transform = cdx > 0.05 ? 'scaleX(-1)' : 'scaleX(1)';
                }
            }
        }
    }

    // 主渲染循環
    function render(now) {
        if (!isRunning) return;

        if (!lastTime) lastTime = now;
        let dt = (now - lastTime) / 1000;
        if (dt > 0.1) dt = 0.1; // 防止標籤頁切換時步長過大
        lastTime = now;
        timeAcc += dt;

        // 1. 繪製微風吹拂櫻花與夏日綠葉
        if (pCtx && pCanvas) {
            pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
            drawParticles(pCtx, pCanvas.width, pCanvas.height);
        }

        // 2. 更新活體演員走動與水面巡游
        updateActors(dt);

        animId = requestAnimationFrame(render);
    }

    // 視窗調整大小
    function resizeCanvas() {
        if (!pCanvas) return;
        const rect = pCanvas.parentElement ? pCanvas.parentElement.getBoundingClientRect() : null;
        if (rect && rect.width > 0 && rect.height > 0) {
            const w = Math.round(rect.width);
            const h = Math.round(rect.height);
            pCanvas.width = w;
            pCanvas.height = h;
            initParticles(w, h);
        }
    }

    // 播放動森島民可愛語音叫聲 (Web Audio 合成音階)
    function playAnimaleseChirp(freq) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            if (!actorAudioCtx) actorAudioCtx = new AudioContext();
            if (actorAudioCtx.state === 'suspended') actorAudioCtx.resume();

            const baseF = freq || 560;
            const now = actorAudioCtx.currentTime;

            const osc = actorAudioCtx.createOscillator();
            const gain = actorAudioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(baseF, now);
            osc.frequency.exponentialRampToValueAtTime(baseF * 1.55, now + 0.12);

            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

            osc.connect(gain);
            gain.connect(actorAudioCtx.destination);

            osc.start(now);
            osc.stop(now + 0.19);
        } catch (err) {}
    }

    // 點擊島民與動物互動彈出氣泡
    function interactActor(actorId, event) {
        if (event && event.stopPropagation) event.stopPropagation();

        const quotes = actorQuotes[actorId] || actorQuotes.swan;
        const idx = quoteIndexMap[actorId] || 0;
        const text = quotes[idx % quotes.length];
        quoteIndexMap[actorId] = idx + 1;

        // 叫聲頻率微調
        const freqMap = { swan: 440, duck1: 620, duck2: 780, shiba: 520, cat: 680, dock: 480, court_sw: 560 };
        playAnimaleseChirp(freqMap[actorId] || 560);

        // 尋找目標容器
        const targetActor = event && event.currentTarget 
            ? event.currentTarget 
            : (document.getElementById(actorId === 'dock' ? 'court-duel-ne' : (actorId === 'court_sw' ? 'court-duel-sw' : 'actor-' + actorId)));

        if (!targetActor) return;

        // 移除先前的舊氣泡
        const existingBubble = targetActor.querySelector('.ac-bubble');
        if (existingBubble && existingBubble.parentNode) {
            existingBubble.parentNode.removeChild(existingBubble);
        }

        // 建立新氣泡
        const bubble = document.createElement('div');
        bubble.className = 'ac-bubble';
        bubble.innerText = text;
        targetActor.appendChild(bubble);

        // 2.5 秒後淡出消失
        setTimeout(() => {
            if (bubble.parentNode) {
                bubble.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                bubble.style.opacity = '0';
                bubble.style.transform = 'translateX(-50%) translateY(4px) scale(0.85)';
                setTimeout(() => {
                    if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
                }, 220);
            }
        }, 2500);
    }

    // 微視差追蹤
    function onPointerMove(e) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        targetParallaxX = ((e.clientX - cx) / cx) * 5;
        targetParallaxY = ((e.clientY - cy) / cy) * 5;
        const bgImg = domCache ? domCache.bgImg : document.getElementById('hub-map-bg-img');
        if (bgImg) {
            bgImg.style.transform = `scale(1.025) translate(${targetParallaxX * 0.3}px, ${targetParallaxY * 0.3}px)`;
        }
    }

    // 啟動沙盤動態
    function start() {
        if (isRunning) return;
        refreshDomCache();

        pCanvas = document.getElementById('hub-particle-canvas');
        pCtx = pCanvas ? pCanvas.getContext('2d') : null;

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('pointermove', onPointerMove, { passive: true });

        isRunning = true;
        lastTime = 0;
        animId = requestAnimationFrame(render);
    }

    // 停止沙盤動態 (進入球場時 100% 釋放 CPU/GPU)
    function stop() {
        isRunning = false;
        if (animId) {
            cancelAnimationFrame(animId);
            animId = null;
        }
        if (pCtx && pCanvas) {
            pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        }
        // 清除場上殘留漣漪
        for (let i = ripplesPool.length - 1; i >= 0; i--) {
            const rip = ripplesPool[i];
            if (rip && rip.parentNode) rip.parentNode.removeChild(rip);
        }
        ripplesPool.length = 0;

        window.removeEventListener('resize', resizeCanvas);
        window.removeEventListener('pointermove', onPointerMove);
    }

    // 匯出全域介面
    window.HubSandbox = {
        start: start,
        stop: stop,
        isRunning: function() { return isRunning; },
        interactActor: interactActor
    };

})(window);
