/**
 * ═══════════════════════════════════════════════════════════
 * 🍃 中興湖 2.5D 動態活沙盤引擎 (NCHU Lake Living Sandbox)
 * 100% 純代碼生成：Canvas 2.5D 動態水體 + 生態巡邏 + 風吹落葉粒子
 * ═══════════════════════════════════════════════════════════
 */
(function(window) {
    'use strict';

    let canvas = null;
    let ctx = null;
    let pCanvas = null;
    let pCtx = null;
    let animId = null;
    let isRunning = false;
    let lastTime = 0;
    let timeAcc = 0;

    // 視差微動偏移
    let parallaxX = 0, parallaxY = 0;
    let targetParallaxX = 0, targetParallaxY = 0;

    // 櫻花／落葉粒子池
    const MAX_PARTICLES = 18;
    const particles = [];

    // 黑天鵝與小鴨家族狀態
    let swanT = 0;
    const ripples = [];

    // 湖心水上小碼頭起伏物理
    let dockBobY = 0;
    let dockBobRot = 0;

    // 初始化粒子
    function initParticles(w, h) {
        particles.length = 0;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            particles.push({
                x: Math.random() * (w || 450),
                y: Math.random() * (h || 800),
                vx: 0.35 + Math.random() * 0.45,
                vy: 0.55 + Math.random() * 0.75,
                size: 3 + Math.random() * 4,
                angle: Math.random() * Math.PI * 2,
                vRot: (Math.random() - 0.5) * 0.04,
                flutter: Math.random() * Math.PI * 2,
                color: Math.random() > 0.45 
                    ? 'rgba(255, 183, 197, 0.75)'  // 櫻花粉
                    : 'rgba(168, 218, 140, 0.75)'   // 動森草葉綠
            });
        }
    }

    // 產生天鵝水波尾跡
    function addRipple(x, y) {
        if (ripples.length > 25) ripples.shift();
        ripples.push({ x, y, r: 2, alpha: 0.6, maxR: 16 + Math.random() * 8 });
    }

    // 繪製秋海棠中興湖動態水面
    function drawLakeWater(ctx, w, h, t) {
        // 中興湖在 450x800 基準下的秋海棠外廓 (保持真實比例)
        const scaleX = w / 450;
        const scaleY = h / 800;

        ctx.save();
        ctx.scale(scaleX, scaleY);

        // 湖岸草皮陰影
        ctx.beginPath();
        ctx.ellipse(225, 430, 152, 132, 0.08, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(46, 125, 50, 0.12)';
        ctx.fill();

        // 湖底漸層
        const lakeGrad = ctx.createRadialGradient(225, 420, 20, 225, 425, 140);
        lakeGrad.addColorStop(0, '#48cae4');
        lakeGrad.addColorStop(0.5, '#0096c7');
        lakeGrad.addColorStop(1, '#023e8a');

        ctx.beginPath();
        // 秋海棠湖泊多段貝茲曲線
        ctx.moveTo(110, 410);
        ctx.bezierCurveTo(90, 480, 160, 560, 250, 545);
        ctx.bezierCurveTo(340, 530, 375, 470, 360, 400);
        ctx.bezierCurveTo(350, 340, 290, 310, 225, 320);
        ctx.bezierCurveTo(170, 330, 125, 360, 110, 410);
        ctx.closePath();

        ctx.fillStyle = lakeGrad;
        ctx.fill();

        // 湖岸白色波浪滾邊
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.stroke();

        // 裁剪湖水區域，只在湖面上繪製動態波光水斑 (Caustics)
        ctx.clip();

        // 繪製動態波光紋理 (Sine / Cosine 疊加流動)
        ctx.lineWidth = 1.5;
        const waveCount = 8;
        for (let i = 0; i < waveCount; i++) {
            const phase = t * 1.8 + i * 1.1;
            const baseY = 330 + i * 26;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.18 + Math.sin(phase) * 0.12})`;
            for (let x = 110; x <= 360; x += 12) {
                const dy = Math.sin(x * 0.045 + phase) * 4.5 + Math.cos(x * 0.08 - phase * 0.7) * 2.5;
                if (x === 110) ctx.moveTo(x, baseY + dy);
                else ctx.lineTo(x, baseY + dy);
            }
            ctx.stroke();
        }

        // 湖面水波尾跡 (Ripples)
        for (let i = ripples.length - 1; i >= 0; i--) {
            const rip = ripples[i];
            ctx.beginPath();
            ctx.ellipse(rip.x, rip.y, rip.r * 1.2, rip.r * 0.6, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${rip.alpha})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            rip.r += 0.25;
            rip.alpha -= 0.008;
            if (rip.alpha <= 0 || rip.r >= rip.maxR) {
                ripples.splice(i, 1);
            }
        }

        // 湖心綠樹小島 (台灣島形狀)
        ctx.save();
        ctx.translate(225, 420);
        ctx.beginPath();
        ctx.ellipse(0, 0, 26, 16, -0.2, 0, Math.PI * 2);
        ctx.fillStyle = '#2d6a4f';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ebd8ba';
        ctx.stroke();
        // 小島中心茂密大樹
        ctx.beginPath();
        ctx.arc(0, -6, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#40916c';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(6, -4, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#52b788';
        ctx.fill();
        ctx.restore();

        ctx.restore();
    }

    // 繪製黑天鵝與小鴨家族
    function drawSwansAndDucks(ctx, w, h, t) {
        const scaleX = w / 450;
        const scaleY = h / 800;

        ctx.save();
        ctx.scale(scaleX, scaleY);

        // 黑天鵝橢圓航線
        swanT += 0.007;
        const swanX = 185 + Math.cos(swanT) * 48;
        const swanY = 380 + Math.sin(swanT * 1.4) * 22;
        const swanVx = -Math.sin(swanT) * 48;

        if (Math.random() < 0.15) addRipple(swanX, swanY + 3);

        // 畫黑天鵝
        ctx.save();
        ctx.translate(swanX, swanY);
        if (swanVx < 0) ctx.scale(-1, 1);

        // 鵝身
        ctx.beginPath();
        ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#1c1917';
        ctx.fill();
        // 鵝脖子與頭
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.quadraticCurveTo(8, -8, 6, -11);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = '#1c1917';
        ctx.stroke();
        // 紅嘴
        ctx.beginPath();
        ctx.arc(8, -10, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        // 金色小皇冠
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(5, -14, 3, 2);
        ctx.restore();

        // 綠頭鴨家族跟在後方
        const duckLag = swanT - 0.45;
        const duckX = 185 + Math.cos(duckLag) * 44;
        const duckY = 380 + Math.sin(duckLag * 1.4) * 20;

        ctx.save();
        ctx.translate(duckX, duckY);
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fef08a';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(3, -1, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f97316';
        ctx.fill();
        ctx.restore();

        ctx.restore();
    }

    // 繪製水上小碼頭 (隨水波起伏)
    function drawFloatingCourt(ctx, w, h, t) {
        const scaleX = w / 450;
        const scaleY = h / 800;

        ctx.save();
        ctx.scale(scaleX, scaleY);

        // 隨波浪輕微起伏公式
        dockBobY = Math.sin(t * 2.2) * 2.5;
        dockBobRot = Math.cos(t * 1.8) * 0.02;

        ctx.translate(170, 465 + dockBobY);
        ctx.rotate(dockBobRot);

        // 木浮台陰影
        ctx.beginPath();
        ctx.roundRect(-42, -18, 84, 46, 6);
        ctx.fillStyle = 'rgba(2, 62, 138, 0.35)';
        ctx.fill();

        // 木質平台
        ctx.beginPath();
        ctx.roundRect(-42, -22, 84, 44, 6);
        ctx.fillStyle = '#f5deb3';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#b45309';
        ctx.stroke();

        // 平台木板條紋
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#d97706';
        for (let x = -36; x <= 36; x += 9) {
            ctx.beginPath();
            ctx.moveTo(x, -22);
            ctx.lineTo(x, 22);
            ctx.stroke();
        }

        // 匹克球微縮球場 (藍綠動森色)
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(-32, -16, 64, 32);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(-12, -16, 24, 32); // 廚房區
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(-32, -16, 64, 32);

        // 球網
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(0, 18);
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // 正在打球的小島民
        ctx.beginPath();
        ctx.arc(-20, Math.sin(t * 4) * 2, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#f97316';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(20, -Math.sin(t * 4) * 2, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();

        ctx.restore();
    }

    // 繪製動森飄落櫻花瓣與落葉粒子
    function drawParticles(ctx, w, h) {
        ctx.save();
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.x += p.vx + Math.sin(p.flutter) * 0.5;
            p.y += p.vy;
            p.angle += p.vRot;
            p.flutter += 0.035;

            if (p.y > h + 10 || p.x > w + 10) {
                p.x = Math.random() * (w * 0.7);
                p.y = -10;
            }

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
    }

    // 主渲染循環
    function render(now) {
        if (!isRunning) return;

        if (!lastTime) lastTime = now;
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        timeAcc += dt;

        // 平滑視差微動
        parallaxX += (targetParallaxX - parallaxX) * 0.08;
        parallaxY += (targetParallaxY - parallaxY) * 0.08;

        if (ctx && canvas) {
            const w = canvas.width;
            const h = canvas.height;

            ctx.clearRect(0, 0, w, h);

            // 1. 繪製秋海棠中興湖動態活水與流動光斑
            drawLakeWater(ctx, w, h, timeAcc);

            // 2. 繪製游動黑天鵝與小鴨
            drawSwansAndDucks(ctx, w, h, timeAcc);

            // 3. 繪製浮動小碼頭
            drawFloatingCourt(ctx, w, h, timeAcc);
        }

        // 4. 繪製動森飄花瓣與夏日綠葉粒子 (若有專屬粒子層則繪製於粒子層，否則繪製於主水體層)
        if (pCtx && pCanvas) {
            pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
            drawParticles(pCtx, pCanvas.width, pCanvas.height);
        } else if (ctx && canvas) {
            drawParticles(ctx, canvas.width, canvas.height);
        }

        animId = requestAnimationFrame(render);
    }

    // 視窗調整大小
    function resizeCanvas() {
        if (!canvas) return;
        const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : null;
        if (rect && rect.width > 0 && rect.height > 0) {
            canvas.width = Math.round(rect.width);
            canvas.height = Math.round(rect.height);
            if (pCanvas) {
                pCanvas.width = canvas.width;
                pCanvas.height = canvas.height;
            }
            initParticles(canvas.width, canvas.height);
        }
    }

    // 啟動沙盤動態
    function start() {
        if (isRunning) return;
        canvas = document.getElementById('hub-water-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        pCanvas = document.getElementById('hub-particle-canvas');
        pCtx = pCanvas ? pCanvas.getContext('2d') : null;

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // 綁定陀螺儀或手指滑動微視差
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
        window.removeEventListener('resize', resizeCanvas);
        window.removeEventListener('pointermove', onPointerMove);
    }

    function onPointerMove(e) {
        if (!canvas) return;
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        targetParallaxX = ((e.clientX - cx) / cx) * 6;
        targetParallaxY = ((e.clientY - cy) / cy) * 6;
    }

    // 匯出全域介面
    window.HubSandbox = {
        start: start,
        stop: stop,
        isRunning: function() { return isRunning; }
    };

})(window);
