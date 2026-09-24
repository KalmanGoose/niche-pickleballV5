/* ═══════════════════════════════════════════════════════════════════
   NCHU Pickleball V5 - 數位孿生、特徵雷達與雲端審計 (Social & Digital Twin)
   ═══════════════════════════════════════════════════════════════════ */
        const AUDIT_LOG = [];

        /* ═══════════════════════════════════════════════
           🪿 社交個人名片、特徵雷達圖與數位孿生系統
           ═══════════════════════════════════════════════ */
        let currentFriendData = null;

        function openPlayerCard(user) {
            currentFriendData = user || {
                nickname: '中興匹克球俠',
                department: '資訊工程學系 四年級',
                avatar: '🪿',
                ig: '',
                score: 5,
                stats: { serve: 85, dink: 78, spin: 92, chain: 88, speed: 82 }
            };
            document.getElementById('sc-avatar').innerText = currentFriendData.avatar || '🪿';
            document.getElementById('sc-name').innerText = currentFriendData.nickname || '匿名球員';
            document.getElementById('sc-dept').innerText = (currentFriendData.department || '國立中興大學') + (currentFriendData.grade ? ' · ' + currentFriendData.grade : '');
            
            const igHandle = currentFriendData.ig || '';
            document.getElementById('sc-ig-tag').innerHTML = igHandle
                ? '<span style="font-size:11px;color:#c084fc;">📸 @' + escapeHtml(igHandle) + '</span>'
                : '<span style="font-size:11px;color:var(--dim);">尚未綁定 IG</span>';
            document.getElementById('sc-ig-btn').style.display = igHandle ? '' : 'none';
            document.getElementById('mc-ig-btn').style.display = igHandle ? '' : 'none';
            document.getElementById('sc-bio').innerText = currentFriendData.bio || ('「熱愛匹克球與體感運動！最高得分 ' + (currentFriendData.score || 0) + ' 分，歡迎切磋！」');

            renderRadarChart(document.getElementById('radar-canvas'), currentFriendData.stats || calculateDigitalTwinStats());
            document.getElementById('social-card-modal').style.display = 'flex';
        }

        function closeSocialCard() {
            document.getElementById('social-card-modal').style.display = 'none';
        }

        function openMockChat() {
            closeSocialCard();
            if (!currentFriendData) return;
            document.getElementById('mc-title').innerText = '💬 與 ' + (currentFriendData.nickname || '球友') + ' 私訊交流';
            document.getElementById('mock-chat-modal').style.display = 'flex';
        }

        function closeMockChat() {
            document.getElementById('mock-chat-modal').style.display = 'none';
        }

        function openFriendIG() {
            const clean = String(currentFriendData && currentFriendData.ig || '').replace(/^@/, '');
            if (!/^[A-Za-z0-9._]{1,30}$/.test(clean)) { toast('對方尚未綁定 IG', ''); return; }
            window.open('https://instagram.com/' + encodeURIComponent(clean), '_blank', 'noopener');
        }

        function calculateDigitalTwinStats() {
            if (!AUDIT_LOG.length) {
                return { serve: 75, dink: 70, spin: 65, chain: 72, speed: 70 };
            }
            let serveSum = 0, serveCount = 0;
            let dinkSum = 0, dinkCount = 0;
            let spinSum = 0, speedSum = 0, chainSum = 0;
            AUDIT_LOG.forEach(r => {
                speedSum += (r.speed || 0);
                spinSum += Math.abs(r.spin || 0) * 100;
                if (r.type === 'SERVE') { serveSum += (r.speed || 0); serveCount++; }
                if (r.type === 'DINK') { dinkSum += 85; dinkCount++; }
                if (r.chain && r.chain.ordered) chainSum += 90;
                else if (r.chain) chainSum += 60;
                else chainSum += 70;
            });
            const n = AUDIT_LOG.length;
            return {
                serve: serveCount ? Math.min(99, Math.round(serveSum / serveCount * 3.2)) : 75,
                dink: dinkCount ? Math.min(99, Math.round(dinkSum / dinkCount)) : 70,
                spin: Math.min(99, Math.round(spinSum / n * 1.6 + 40)),
                chain: Math.min(99, Math.round(chainSum / n)),
                speed: Math.min(99, Math.round(speedSum / n * 2.8))
            };
        }

        function renderRadarChart(canvas, stats) {
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width, h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            const cx = w / 2, cy = h / 2 + 6;
            const r = 70;
            const labels = ['發球 (Serve)', '丁克 (Dink)', '側旋 (Spin)', '動力鏈 (Chain)', '球速 (Speed)'];
            const keys = ['serve', 'dink', 'spin', 'chain', 'speed'];
            const angles = labels.map((_, i) => (i * 2 * Math.PI / 5) - Math.PI / 2);

            // 繪製蜘蛛網同心多邊形
            for (let step = 1; step <= 4; step++) {
                ctx.beginPath();
                const curR = r * (step / 4);
                angles.forEach((ang, idx) => {
                    const x = cx + curR * Math.cos(ang);
                    const y = cy + curR * Math.sin(ang);
                    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                ctx.closePath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // 繪製軸線與標籤
            ctx.font = '10px system-ui, sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.textAlign = 'center';
            angles.forEach((ang, idx) => {
                const x = cx + r * Math.cos(ang);
                const y = cy + r * Math.sin(ang);
                ctx.beginPath();
                ctx.moveTo(cx, cy); ctx.lineTo(x, y);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.stroke();

                const tx = cx + (r + 18) * Math.cos(ang);
                const ty = cy + (r + 14) * Math.sin(ang);
                ctx.fillText(labels[idx], tx, ty);
            });

            // 繪製特徵數據多邊形
            ctx.beginPath();
            angles.forEach((ang, idx) => {
                const val = (stats[keys[idx]] || 70) / 100;
                const curR = r * THREE.MathUtils.clamp(val, 0.2, 1.0);
                const x = cx + curR * Math.cos(ang);
                const y = cy + curR * Math.sin(ang);
                if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
            ctx.fill();
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // 頂點圓點
            angles.forEach((ang, idx) => {
                const val = (stats[keys[idx]] || 70) / 100;
                const curR = r * THREE.MathUtils.clamp(val, 0.2, 1.0);
                const x = cx + curR * Math.cos(ang);
                const y = cy + curR * Math.sin(ang);
                ctx.beginPath();
                ctx.arc(x, y, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = '#34d399';
                ctx.fill();
            });
        }

        let twinBackup = null;
        function restoreTwinParams() {
            if (!twinBackup) return;
            AI_SPEED[4] = twinBackup.speed; AI_MISS[4] = twinBackup.miss;
            twinBackup = null;
        }
        function battleDigitalTwin() {
            closeSocialCard();
            if (!currentFriendData) return;
            toast('⚔️ 載入數位孿生行為模型', '對手匹克鵝已套用「' + currentFriendData.nickname + '」之球風與側旋特徵！');
            if (!twinBackup) twinBackup = { speed: AI_SPEED[4], miss: AI_MISS[4] };
            AI_SPEED[4] = 6.2;
            AI_MISS[4] = 0.08;
            switchStage(4, { keepTwin: true });
        }

        function syncDigitalTwin() {
            if (!API_READY() || !playerProfile.playerId) {
                toast('本地離線模式', '數位孿生資料已儲存於本機快取');
                return;
            }
            toast('⏳ 正在同步數位孿生至 Google Sheets…', '');
            const twinPayload = {
                stats: calculateDigitalTwinStats(),
                recentShots: AUDIT_LOG.slice(-10),
                syncedAt: new Date().toISOString()
            };
            postSigned({
                act: 'sync_twin',
                playerId: playerProfile.playerId,
                twin_data: JSON.stringify(twinPayload)
            }).then(r => {
                if (r && r.ok) toast('✨ 數位孿生已成功同步！', '雲端 Google Sheets twin_data 欄位已更新');
                else toast('同步完成 (本機快取)', '下次連線將自動再次更新');
            });
        }


        let auditSeq = 0;
        function auditLogAdd(entry) {
            entry.id = ++auditSeq;
            entry.time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
            entry.mode = webcamActive ? 'Motion' : 'Manual'; // ★ 區分手動 / 體感
            AUDIT_LOG.push(entry);
            // ★ 前端限制最多儲存最新 20 筆特徵 (FIFO 機制)
            if (AUDIT_LOG.length > 20) AUDIT_LOG.shift();
            try {
                localStorage.setItem('nchu_pickleball_audit_v4', JSON.stringify(AUDIT_LOG));
            } catch (e) {}
            if (document.getElementById('audit-modal') && document.getElementById('audit-modal').style.display !== 'none') {
                renderAuditTable();
            }
        }

        function loadAuditCache() {
            try {
                const c = localStorage.getItem('nchu_pickleball_audit_v4');
                if (c) {
                    const arr = JSON.parse(c);
                    if (Array.isArray(arr)) {
                        AUDIT_LOG.length = 0;
                        AUDIT_LOG.push(...arr.slice(-20));
                        auditSeq = AUDIT_LOG.reduce((m, r) => Math.max(m, r.id || 0), 0);
                    }
                }
            } catch (e) {}
        }

        function updateLastAuditOutcome(outcome, subReason) {
            if (!AUDIT_LOG.length) return;
            const last = AUDIT_LOG[AUDIT_LOG.length - 1];
            if (last && (last.outcome === '發球飛行中' || last.outcome === '處理中…' || !last.outcome)) {
                last.outcome = outcome + (subReason ? ' · ' + subReason : '');
                if (document.getElementById('audit-modal') && document.getElementById('audit-modal').style.display !== 'none') {
                    renderAuditTable();
                }
            }
        }

        function openAuditModal() {
            closePanel();
            clearKeys();
            renderAuditTable();
            document.getElementById('audit-modal').style.display = 'flex';
        }

        function closeAuditModal() {
            document.getElementById('audit-modal').style.display = 'none';
            clearKeys();
        }

        function renderAuditTable() {
            const tbody = document.getElementById('audit-tbody');
            if (!tbody) return;
            if (AUDIT_LOG.length === 0) {
                tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--dim);padding:24px;">尚無擊球紀錄，請揮拍或發球…</td></tr>';
                document.getElementById('aud-total').innerText = '0';
                document.getElementById('aud-order-rate').innerText = '-';
                document.getElementById('aud-elbow-mean').innerText = '-';
                document.getElementById('aud-stance-out').innerText = '-';
                document.getElementById('aud-speed-mean').innerText = '-';
                document.getElementById('aud-curve-count').innerText = '-';
                return;
            }

            let total = AUDIT_LOG.length;
            let chainSwings = 0, orderedCount = 0, elbowSum = 0;
            let stanceSamples = 0, stanceOutCount = 0;
            let speedSum = 0, curveCount = 0;

            let html = '';
            for (let i = AUDIT_LOG.length - 1; i >= 0; i--) {
                const r = AUDIT_LOG[i];
                speedSum += r.speed || 0;
                if (Math.abs(r.spin || 0) >= 0.18) curveCount++;

                let chainBadge = '<span style="color:var(--dim);">-</span>';
                let elbowText = '<span style="color:var(--dim);">-</span>';
                if (r.chain) {
                    chainSwings++;
                    if (r.chain.ordered) orderedCount++;
                    elbowSum += (r.chain.elbowRatio || 0);
                    chainBadge = r.chain.ordered
                        ? '<span class="badge badge-ok">✅ 順暢 (腰→肩→肘)</span>'
                        : '<span class="badge badge-warn">⚠️ 未對齊</span>';
                    elbowText = (r.chain.elbowRatio * 100).toFixed(0) + '%';
                }

                let stanceBadge = '<span style="color:var(--dim);">-</span>';
                if (r.stance && r.stance.ok) {
                    stanceSamples++;
                    const bal = Math.abs(r.stance.bal);
                    if (bal >= 1.0) stanceOutCount++;
                    if (bal < 1.0) stanceBadge = '<span class="badge badge-ok">🟢 穩固 (' + r.stance.bal.toFixed(2) + ')</span>';
                    else if (bal < 1.4) stanceBadge = '<span class="badge badge-warn">🟡 偏離 (' + r.stance.bal.toFixed(2) + ')</span>';
                    else stanceBadge = '<span class="badge badge-bad">🔴 失衡 (' + r.stance.bal.toFixed(2) + ')</span>';
                }

                let spinBadge = '<span style="color:var(--dim);">直球 (0.0)</span>';
                if (Math.abs(r.spin || 0) >= 0.18) {
                    const dir = r.spin > 0 ? '右旋' : '左旋';
                    spinBadge = '<span class="badge badge-curve">🌪️ ' + dir + ' (' + r.spin.toFixed(2) + ')</span>';
                } else if (Math.abs(r.spin || 0) > 0.05) {
                    spinBadge = (r.spin > 0 ? '+' : '') + r.spin.toFixed(2);
                }

                let outcomeBadge = '<span class="badge badge-info">' + escapeHtml(r.outcome || '合法') + '</span>';
                if (r.outcome && (r.outcome.includes('違規') || r.outcome.includes('FAULT') || r.outcome.includes('出界') || r.outcome.includes('掛網') || r.outcome.includes('錯誤'))) {
                    outcomeBadge = '<span class="badge badge-bad">' + escapeHtml(r.outcome) + '</span>';
                } else if (r.outcome && (r.outcome.includes('得分') || r.outcome.includes('過關') || r.outcome.includes('NICE'))) {
                    outcomeBadge = '<span class="badge badge-ok">' + escapeHtml(r.outcome) + '</span>';
                }

                const modeBadge = r.mode === 'Motion'
                    ? '<span class="badge badge-ok">📷 體感</span>'
                    : '<span class="badge badge-info">🎮 手動</span>';
                html += '<tr>' +
                    '<td><b>#' + r.id + '</b></td>' +
                    '<td>' + modeBadge + '</td>' +
                    '<td>' + r.time + '</td>' +
                    '<td>G' + r.stage + '</td>' +
                    '<td><b>' + r.type + '</b></td>' +
                    '<td>' + r.speed + ' mph</td>' +
                    '<td>' + r.power + '%</td>' +
                    '<td>' + spinBadge + '</td>' +
                    '<td>' + chainBadge + '</td>' +
                    '<td>' + elbowText + '</td>' +
                    '<td>' + stanceBadge + '</td>' +
                    '<td>' + outcomeBadge + '</td>' +
                '</tr>';
            }
            tbody.innerHTML = html;

            document.getElementById('aud-total').innerText = total;
            document.getElementById('aud-order-rate').innerText = chainSwings ? (orderedCount / chainSwings * 100).toFixed(1) + '%' : '-';
            document.getElementById('aud-elbow-mean').innerText = chainSwings ? (elbowSum / chainSwings * 100).toFixed(1) + '%' : '-';
            document.getElementById('aud-stance-out').innerText = stanceSamples ? (stanceOutCount / stanceSamples * 100).toFixed(1) + '%' : '-';
            document.getElementById('aud-speed-mean').innerText = (speedSum / total).toFixed(1) + ' mph';
            document.getElementById('aud-curve-count').innerText = curveCount + ' 球 (' + (curveCount / total * 100).toFixed(0) + '%)';
        }

        function exportAuditCSV() {
            if (!AUDIT_LOG.length) { toast('日誌尚無數據', '請先進行發球或揮拍'); return; }
            let csv = '\uFEFF編號,時間,關卡,動作,擊球者,初速(mph),力道(%),側旋量(Spin),動力鏈順暢,手肘角速度佔比(%),重心偏離值,判決結果\n';
            AUDIT_LOG.forEach(r => {
                const chainOrd = r.chain ? (r.chain.ordered ? 'TRUE' : 'FALSE') : '';
                const elbowPct = r.chain ? (r.chain.elbowRatio * 100).toFixed(1) : '';
                const stanceVal = (r.stance && r.stance.ok) ? r.stance.bal.toFixed(2) : '';
                const outcomeClean = (r.outcome || '').replace(/[,\n\r"]/g, ' ');
                csv += [
                    r.id, r.time, 'Stage ' + r.stage, r.type, r.hitter,
                    r.speed, r.power, r.spin, chainOrd, elbowPct, stanceVal,
                    '"' + outcomeClean + '"'
                ].join(',') + '\n';
            });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pickleball_kinematic_audit_' + new Date().toISOString().slice(0, 10) + '.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            toast('📥 審計日誌已匯出 CSV', a.download);
        }

        function exportAuditJSON() {
            if (!AUDIT_LOG.length) { toast('日誌尚無數據', '請先進行發球或揮拍'); return; }
            const exportData = {
                app: 'NCHU Pickleball Lab',
                version: APP_VERSION,
                exportType: 'KinematicAuditLog',
                exportedAt: new Date().toISOString(),
                playerProfile: { nickname: playerProfile.nickname, department: playerProfile.department },
                recordsCount: AUDIT_LOG.length,
                records: AUDIT_LOG
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'pickleball_kinematic_audit_' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            toast('📥 審計日誌已匯出 JSON', a.download);
        }

        function clearAuditLog() {
            if (!confirm('確定要清空當前所有體感與動力鏈審計紀錄嗎？')) return;
            AUDIT_LOG.length = 0;
            renderAuditTable();
            toast('🗑️ 審計日誌已清空', '已重設當前場次紀錄');
        }


        const RIGHT = { padYTarget: 0.78, padXFree: 0 };
        function updatePaddleAssist(dt) {
            if (!webcamActive) return;
            if (AIM.mode === 'RIGHT_FREE') {
                padX += (RIGHT.padXFree - padX) * Math.min(1, dt * 8);
                padY += (RIGHT.padYTarget - padY) * Math.min(1, dt * 9);
                padY = THREE.MathUtils.clamp(padY, 0.22, 2.0);
                return;
            }
            let wantX = 0;
            if (state === 'RALLY' || state === 'SERVE_AIR') {
                if (PH.vel.z > 0) wantX = THREE.MathUtils.clamp(PH.pos.x - pPos.x, -0.95, 0.95);
                else wantX = padX * 0.9;
            }
            padX += (wantX - padX) * Math.min(1, dt * 12);
            padY += (RIGHT.padYTarget - padY) * Math.min(1, dt * 9);
            padY = THREE.MathUtils.clamp(padY, 0.22, 2.0);
        }
        let aimZoneMeshes = [];
        function buildAimZones() {
            const w = (COURT_W / 2 - 0.3) / AIM.zones;
            for (let i = 0; i < AIM.zones; i++) {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.84, HALF_L - KITCHEN_D - 0.3),
                    new THREE.MeshBasicMaterial({
                        color: 0x38bdf8, transparent: true, opacity: 0.06,
                        side: THREE.DoubleSide, depthWrite: false
                    }));
                m.rotation.x = -Math.PI / 2;
                m.position.set(0, 0.007, -(HALF_L + KITCHEN_D) / 2);
                m.visible = false; scene.add(m); aimZoneMeshes.push(m);
            }
        }
        function updateAimZones(dt) {
            const zoneMode = (AIM.mode === 'LEFT_ZONE' || AIM.mode === 'TORSO');
            const show = webcamActive && zoneMode && !demoOn &&
                (state === 'SERVE_READY' || state === 'RALLY' || state === 'SERVE_AIR');
            D.aimHud.classList.toggle('on', show);
            if (show) D.aimName.innerText = AIM_NAMES[AIM.idx];
            for (let i = 0; i < aimZoneMeshes.length; i++) {
                const m = aimZoneMeshes[i];
                m.visible = show; if (!show) continue;
                m.position.x = aimZoneXAt(i);
                const on = (i === AIM.idx);
                const want = on ? 0.26 + 0.07 * Math.abs(Math.sin(pulse)) : 0.05;
                m.material.opacity += (want - m.material.opacity) * Math.min(1, dt * 10);
                m.material.color.setHex(on ? 0x3fe0c4 : 0x38bdf8);
            }
        }
        function syncAimPips() {
            D.aimPips.forEach((p, i) => p.classList.toggle('on', i === AIM.idx));
            if (D.aimName) D.aimName.innerText = AIM_NAMES[AIM.idx];
        }
        function setAimMode(m) {
            AIM.mode = m; AIM.idx = 2; AIM.cand = 2; AIM.dwell = 0;
            document.querySelectorAll('[data-aim]').forEach(b => b.classList.toggle('on', b.dataset.aim === m));
            syncAimPips();
            toast('瞄準模式', {
                LOCKED: '自動瞄準對角發球區中心', LEFT_ZONE: '左手左右移動選 5 格',
                TORSO: '轉動上半身選 5 格(實驗)', RIGHT_FREE: '右手連續自由瞄準'
            }[m]);
        }
        function toggleAimInvert() {
            AIM.invert = !AIM.invert;
            toast('左右方向已' + (AIM.invert ? '反轉' : '還原'), '若動作方向與選格相反就切這個');
        }
        function toggleWebcamAI() { if (!webcamActive) startWebcamAI(); else stopWebcamAI(); }

        function startWebcamAI() {
            const btn = document.getElementById('ai-toggle-btn');
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                btn.innerText = '📷 體感: 不支援';
                toast('此環境無法使用相機', '請用 https:// 或 http://localhost 開啟,不要用 file://');
                return;
            }
            btn.innerText = '⏳ 啟動中…'; S.init();
            const skelCanvas = document.getElementById('skeleton-canvas');
            skelCanvas.style.display = 'block';
            document.getElementById('calibration-box').style.display = 'flex';
            D.waistRow.style.display = 'flex';
            setStanceRowVisible(true);

            if (!poseInstance) {
                poseInstance = new Pose({ locateFile: f => 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/' + f });
                poseInstance.setOptions({
                    modelComplexity: PERF_PRESETS[perfLevel].complexity,
                    smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
                });
                const cx = skelCanvas.getContext('2d');
                const video = document.getElementById('webcam-video');

                poseInstance.onResults(res => {
                    if (skelCanvas.width !== skelCanvas.clientWidth) {
                        skelCanvas.width = skelCanvas.clientWidth;
                        skelCanvas.height = skelCanvas.clientHeight;
                    }
                    cx.save();
                    cx.clearRect(0, 0, skelCanvas.width, skelCanvas.height);
                    cx.scale(-1, 1); cx.translate(-skelCanvas.width, 0);
                    if (video.readyState >= 2) cx.drawImage(video, 0, 0, skelCanvas.width, skelCanvas.height);
                    cx.restore();
                    if (!res.poseLandmarks) return;

                    const lm = res.poseLandmarks;
                    const rS = lm[12], rE = lm[14], rW = lm[16], rH = lm[24];
                    const lS = lm[11], lW = lm[15];
                    drawSkeleton(cx, lm, skelCanvas.width, skelCanvas.height);
                    updateShoulderWidth(lS, rS);
                    updateBodyScale(rS, rH);
                    updateTorsoYaw(lS, rS);
                    updatePalmOpen(lm);
                    updateStance(lm);
                    waistLevel = wristLevel(rW, rH);
                    RIGHT.padYTarget = levelToWorldY(waistLevel);

                    if (!servePrepared) {
                        if (lW && lS && lW.y < lS.y) {
                            if (!calibT0) calibT0 = performance.now();
                            const elapsed = (performance.now() - calibT0) / 1000;
                            document.getElementById('calib-text').innerHTML =
                                '✋ 保持左手舉高… (' + Math.max(0, 1.5 - elapsed).toFixed(1) + 's)';
                            if (elapsed >= 1.5) {
                                servePrepared = true;
                                calibT0 = 0;
                                document.getElementById('calibration-box').style.display = 'none';
                                toast('✅ 左手解鎖完成!', '拍面低於腰 → 向上推拍 → 收拍抬過肩');
                            }
                        } else {
                            calibT0 = 0;
                            document.getElementById('calib-text').innerHTML =
                                '✋ 請將【左手】舉高過頭<br>維持 1.5 秒解鎖球場!';
                        }
                    }

                    if (!(rS && rE && rW && rH)) return;
                    const shA = calculateAngle(rH, rS, rE), elA = calculateAngle(rS, rE, rW);
                    RIGHT.padXFree = THREE.MathUtils.clamp((0.5 - rW.x) * 2.8, -0.95, 0.95);

                    const now = performance.now();
                    const dt = Math.max(0.01, (now - lastWristPos.t) / 1000);
                    const tc = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2, z: ((lS.z || 0) + (rS.z || 0)) / 2 };
                    const SW = NORM.ready ? NORM.W : 1;
                    const relX = (rW.x - tc.x) / SW, relY = (rW.y - tc.y) / SW, relZ = ((rW.z || 0) - tc.z) / SW;
                    const lx = lastWristPos.relX !== undefined ? lastWristPos.relX : relX;
                    const ly = lastWristPos.relY !== undefined ? lastWristPos.relY : relY;
                    const lz = lastWristPos.relZ !== undefined ? lastWristPos.relZ : relZ;

                    const step = nd(relX - lx, relY - ly, relZ - lz);
                    updateKinematics(step, dt);
                    accumulateSwing(step, dt);

                    power = hitPower(KIN.vPeak, SWING.path);
                    const pct = THREE.MathUtils.clamp((power - POWER_W.min) / (POWER_W.max - POWER_W.min) * 100, 0, 100);
                    powerBarDisplay += (pct - powerBarDisplay) * Math.min(1, dt * 10);
                    D.pFill.style.width = powerBarDisplay.toFixed(1) + '%';

                    if (servePrepared) { updateAimFromLeftHand(lW, tc.x, dt); updateAimFromTorso(dt); }
                    updateServeFSM(lm, dt);

                    const shD = Math.abs(shA - lastShoulderAngle), elD = Math.abs(elA - lastWristAngle);
                    const realSwing = (KIN.vPeak >= SFSM.TH_V * tScale() * 0.75 || shD > 30 || elD > 40)
                        && SWING.path > SFSM.TH_D * tScale() * 0.5;
                    if (state === 'RALLY' && realSwing && swingT <= 0 && !locked) {
                        swingT = 0.22; swingP = power; tryHit(); resetSwing();
                    }
                    kcPush(now, torsoYawDeg(), shA, elA);
                    lastWristPos = { relX: relX, relY: relY, relZ: relZ, t: now };
                    lastWristAngle = elA; lastShoulderAngle = shA;
                });
            }

            const video = document.getElementById('webcam-video');
            let fc = 0;
            cameraUtils = new Camera(video, {
                onFrame: async () => {
                    fc++;
                    if (fc % frameSkip === 0 && webcamActive && poseInstance)
                        await poseInstance.send({ image: video });
                },
                width: 320, height: 240
            });
            cameraUtils.start().then(() => {
                webcamActive = true; btn.innerText = '📷 體感: 開'; syncAimPips();
                toast('體感 AI 已啟動', '預設 🔒 自動對角,先專心練揮拍時機');
                syncSubbarStates();
            }).catch(err => {
                console.error(err);
                const name = (err && err.name) || String(err);
                const msg = {
                    NotAllowedError: '剛才按了「封鎖」→ 點網址列相機圖示改成允許,再重載',
                    NotFoundError: '找不到鏡頭 → 確認外接攝影機已插上',
                    NotReadableError: '鏡頭被佔用 → 先關閉 Zoom / Teams / OBS',
                    OverconstrainedError: '鏡頭不支援 320x240 解析度',
                    SecurityError: '需要 https:// 或 localhost 環境'
                }[name] || name;
                btn.innerText = '📷 體感: 失敗';
                skelCanvas.style.display = 'none';
                D.waistRow.style.display = 'none';
                setStanceRowVisible(false);
                document.getElementById('calibration-box').style.display = 'none';
                toast('體感啟動失敗', msg);
                syncSubbarStates();
            });
        }
        function stopWebcamAI() {
            webcamActive = false;
            if (cameraUtils) cameraUtils.stop();
            const video = document.getElementById('webcam-video');
            if (video && video.srcObject) {
                const st = video.srcObject;
                if (st.getTracks) st.getTracks().forEach(t => t.stop());
                video.srcObject = null;
            }
            const sc = document.getElementById('skeleton-canvas');
            if (sc) { sc.getContext('2d').clearRect(0, 0, sc.width, sc.height); sc.style.display = 'none'; }
            document.getElementById('ai-toggle-btn').innerText = '📷 體感: 關';
            document.getElementById('calibration-box').style.display = 'none';
            D.waistRow.style.display = 'none';
            setStanceRowVisible(false);
            D.aimHud.classList.remove('on');
            aimZoneMeshes.forEach(m => m.visible = false);
            resetServeFSM(); kcReset();
            stanceOK = false;
            toast('體感 AI 已關閉', '已切換回滑鼠/鍵盤控制');
            syncSubbarStates();
        }

        /* ═══════════════════════════════════════════════
           ★ 輸入:含輸入框/彈窗守衛 + 自訂視角鍵
           ═══════════════════════════════════════════════ */