
        let ecoModeActive = false;
        function setEcoMode(active) {
            ecoModeActive = !!active;
            frameSkip = ecoModeActive ? 3 : (PERF_PRESETS[perfLevel].skip || 1);
        }
        window.setEcoMode = setEcoMode;

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
            let wantX = (typeof RIGHT !== 'undefined' && typeof RIGHT.padXFree === 'number') ? RIGHT.padXFree : 0;
            if (state === 'RALLY' || state === 'SERVE_AIR') {
                if (PH.vel.z > 0) {
                    const ballRelX = THREE.MathUtils.clamp(PH.pos.x - pPos.x, -0.95, 0.95);
                    // 柔和磁吸輔助：以真人手部 (65%) 為主導，輔以 35% 迎球導引，不再 100% 強行吸球
                    wantX = wantX * 0.65 + ballRelX * 0.35;
                } else {
                    wantX = wantX * 0.85;
                }
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
            if (typeof D !== 'undefined' && D && Array.isArray(D.aimPips)) {
                D.aimPips.forEach((p, i) => p.classList.toggle('on', i === AIM.idx));
            }
            if (typeof D !== 'undefined' && D && D.aimName && typeof AIM !== 'undefined') D.aimName.innerText = AIM_NAMES[AIM.idx];
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
        let webcamStarting = false;
        let webcamLaunchToken = 0;
        let lastCameraError = null;
        let lastPoseTimestamp = 0;
        let lastPoseSnapshot = {
            hasPoseData: false,
            keypointsPresent: false,
            lastSeenTime: 0
        };

        function getWebcamStatus() {
            if (webcamActive) return 'ACTIVE';
            if (webcamStarting) return 'STARTING';
            return 'STOPPED';
        }

        // ★ TASK-V8-606: 體感短效揮拍事件 (250ms 生存期、擊球單次消耗、單一動作僅發單一事件直至結束再武裝)
        let swingEventGen = 0;
        let currentSwingEvent = null;
        let swingArmed = true;

        function rearmSwing() {
            swingArmed = true;
        }

        function isSwingArmed() {
            return swingArmed;
        }

        function registerSwingEvent(proxySpeed, now) {
            if (!swingArmed) return null;
            swingArmed = false;
            swingEventGen++;
            currentSwingEvent = {
                generation: swingEventGen,
                t: (typeof now === 'number') ? now : performance.now(),
                proxySpeed: (typeof proxySpeed === 'number') ? proxySpeed : 1.0,
                consumed: false
            };
            if (typeof window !== 'undefined') window.currentSwingEvent = currentSwingEvent;
            return currentSwingEvent;
        }

        function revokeSwingEvent() {
            if (currentSwingEvent) {
                currentSwingEvent.consumed = true;
                currentSwingEvent = null;
            }
            if (typeof window !== 'undefined') window.currentSwingEvent = null;
            swingArmed = true;
        }

        function consumeSwingEvent() {
            if (currentSwingEvent && !currentSwingEvent.consumed) {
                currentSwingEvent.consumed = true;
                const ev = currentSwingEvent;
                currentSwingEvent = null;
                if (typeof window !== 'undefined') window.currentSwingEvent = null;
                return ev;
            }
            return null;
        }

        window.registerSwingEvent = registerSwingEvent;
        window.revokeSwingEvent = revokeSwingEvent;
        window.consumeSwingEvent = consumeSwingEvent;
        window.rearmSwing = rearmSwing;
        window.isSwingArmed = isSwingArmed;
        window.currentSwingEvent = null;

        function getMotionTrackingStatus() {
            const status = getWebcamStatus();
            const now = performance.now();
            const isStale = (now - lastPoseTimestamp) > 400;
            const hasFreshPose = status === 'ACTIVE' && lastPoseSnapshot.hasPoseData && !isStale;
            const keypointsOk = hasFreshPose && lastPoseSnapshot.keypointsPresent;

            let reason = 'stopped';
            if (status === 'STARTING') reason = 'starting';
            else if (status === 'ACTIVE') {
                if (!lastPoseSnapshot.hasPoseData) reason = 'no-body';
                else if (isStale) reason = 'stale';
                else if (!keypointsOk) reason = 'missing-keypoints';
                else reason = 'ok';
            } else if (lastCameraError) {
                reason = 'error';
            }

            return {
                status: status,
                error: lastCameraError,
                hasPoseData: hasFreshPose,
                keypointsPresent: keypointsOk,
                isStale: isStale,
                reason: reason
            };
        }

        function updateQuickCameraFab() {
            const fab = document.getElementById('quick-camera-fab');
            const lbl = document.getElementById('quick-cam-lbl');
            const icon = document.getElementById('quick-cam-icon');
            if (!fab) return;
            if (webcamActive) {
                fab.classList.add('active');
                if (lbl) lbl.innerText = '體感ON';
                if (icon) icon.innerText = '🟢';
            } else if (webcamStarting) {
                fab.classList.remove('active');
                if (lbl) lbl.innerText = '啟動中';
                if (icon) icon.innerText = '⏳';
            } else {
                fab.classList.remove('active');
                if (lbl) lbl.innerText = '體感';
                if (icon) icon.innerText = '📷';
            }
        }

        function toggleWebcamAI() {
            if (webcamStarting) {
                stopWebcamAI();
                return;
            }
            if (!webcamActive) startWebcamAI();
            else stopWebcamAI();
        }
        let lastWristAngle = 0, lastShoulderAngle = 0;
        let calibProgress = 0, lastCalibTime = 0;
        let activeVideoElement = null;

        function startWebcamAI() {
            const btn = document.getElementById('ai-toggle-btn');
            if (webcamStarting || webcamActive) return;
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                if (btn) btn.innerText = '📷 體感: 不支援';
                lastCameraError = 'NotSupportedError';
                toast('此環境無法使用相機', '請用 https:// 或 http://localhost 開啟,不要用 file://');
                return;
            }
            const currentLaunchToken = ++webcamLaunchToken;
            webcamStarting = true;
            lastCameraError = null;
            if (btn) btn.innerText = '⏳ 啟動中…';
            updateQuickCameraFab();
            if (typeof S !== 'undefined' && S.init) S.init();
            const skelCanvas = document.getElementById('skeleton-canvas');
            if (skelCanvas) skelCanvas.style.display = 'block';
            const mHud = document.getElementById('motion-hud');
            if (mHud) mHud.style.display = 'block';
            const cb = document.getElementById('calibration-box');
            if (cb) cb.style.display = 'flex';
            if (typeof D !== 'undefined' && D.waistRow) D.waistRow.style.display = 'flex';
            if (typeof setStanceRowVisible === 'function') setStanceRowVisible(true);

            if (!poseInstance) {
                poseInstance = new Pose({ locateFile: f => 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/' + f });
                poseInstance.setOptions({
                    modelComplexity: PERF_PRESETS[perfLevel].complexity,
                    smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
                });
                const cx = skelCanvas.getContext('2d');
                const video = document.getElementById('webcam-video');

                poseInstance.onResults(res => {
                    if (!webcamActive) return;
                    if (skelCanvas.width !== skelCanvas.clientWidth) {
                        skelCanvas.width = skelCanvas.clientWidth;
                        skelCanvas.height = skelCanvas.clientHeight;
                    }
                    cx.save();
                    cx.clearRect(0, 0, skelCanvas.width, skelCanvas.height);
                    cx.scale(-1, 1); cx.translate(-skelCanvas.width, 0);
                    const drawVid = activeVideoElement || video || document.getElementById('webcam-video');
                    if (drawVid && drawVid.readyState >= 2) cx.drawImage(drawVid, 0, 0, skelCanvas.width, skelCanvas.height);
                    cx.restore();
                    if (!res.poseLandmarks) {
                        lastPoseSnapshot = { hasPoseData: false, keypointsPresent: false, lastSeenTime: performance.now() };
                        revokeSwingEvent();
                        lastWristPos = { relX: undefined, relY: undefined, relZ: undefined, t: 0 };
                        lastWristAngle = undefined;
                        lastShoulderAngle = undefined;
                        swingArmed = true;
                        if (typeof updatePracticeInstructionBar === 'function') updatePracticeInstructionBar();
                        return;
                    }

                    const rawLm = res.poseLandmarks;
                    const lm = (typeof filterLandmarks === 'function') ? filterLandmarks(rawLm, performance.now()) : rawLm;
                    const rS = lm[12], rE = lm[14], rW = lm[16], rH = lm[24];
                    const lS = lm[11], lW = lm[15], lH = lm[23];
                    const hasKeypoints = !!(rS && rE && rW && rH && lS);
                    const visRS = (rS && typeof rS.visibility === 'number') ? rS.visibility : 1.0;
                    const visLS = (lS && typeof lS.visibility === 'number') ? lS.visibility : 1.0;
                    const hasVisiblePerson = hasKeypoints && (visRS >= 0.45 && visLS >= 0.45);

                    if (!hasVisiblePerson) {
                        lastPoseSnapshot = { hasPoseData: false, keypointsPresent: false, lastSeenTime: performance.now() };
                        revokeSwingEvent();
                        lastWristPos = { relX: undefined, relY: undefined, relZ: undefined, t: 0 };
                        lastWristAngle = undefined;
                        lastShoulderAngle = undefined;
                        swingArmed = true;
                        cx.clearRect(0, 0, skelCanvas.width, skelCanvas.height);
                        if (typeof updatePracticeInstructionBar === 'function') updatePracticeInstructionBar();
                        return;
                    }

                    lastPoseTimestamp = performance.now();
                    lastPoseSnapshot = {
                        hasPoseData: true,
                        keypointsPresent: true,
                        lastSeenTime: lastPoseTimestamp
                    };
                    if (typeof updatePracticeInstructionBar === 'function') updatePracticeInstructionBar();
                    drawSkeleton(cx, lm, skelCanvas.width, skelCanvas.height);
                    const statusEl = document.getElementById('motion-hud-status');
                    if (statusEl) {
                        statusEl.innerText = servePrepared ? '🟢 姿態就緒 (可揮拍)' : '🟡 調整站位中';
                        statusEl.style.color = servePrepared ? '#34d399' : '#fbbf24';
                    }
                    updateShoulderWidth(lS, rS);
                    updateBodyScale(rS, rH);
                    updateTorsoYaw(lS, rS, lH, rH);
                    updatePalmOpen(lm);
                    updateStance(lm);
                    waistLevel = wristLevel(rW, rH);
                    RIGHT.padYTarget = levelToWorldY(waistLevel);

                    if (!servePrepared) {
                        const now = performance.now();
                        let dt = lastCalibTime ? (now - lastCalibTime) / 1000 : 0.033;
                        if (dt > 0.1) dt = 0.1;
                        lastCalibTime = now;

                        if (lW && lS && lW.y < lS.y) {
                            calibProgress += dt;
                        } else {
                            calibProgress -= dt * 1.5;
                        }
                        calibProgress = Math.max(0, Math.min(calibProgress, 0.6));

                        if (calibProgress >= 0.58) { // small tolerance for floating point
                            servePrepared = true;
                            calibProgress = 0;
                            lastCalibTime = 0;
                            document.getElementById('calibration-box').style.display = 'none';
                            toast('✅ 左手解鎖完成!', '拍面低於腰 → 向上推拍 → 收拍抬過肩');
                        } else if (calibProgress > 0.05) {
                            document.getElementById('calib-text').innerHTML =
                                '✋ 保持左手舉高… (' + Math.max(0, 0.6 - calibProgress).toFixed(1) + 's)';
                        } else {
                            document.getElementById('calib-text').innerHTML =
                                '✋ 請將【左手】舉高過頭<br>維持 0.6 秒解鎖球場!';
                        }
                    } else {
                        lastCalibTime = 0;
                    }

                    if (!(rS && rE && rW && rH)) return;
                    const shA = calculateAngle(rH, rS, rE), elA = calculateAngle(rS, rE, rW);
                    RIGHT.padXFree = THREE.MathUtils.clamp((0.5 - rW.x) * 2.8, -0.95, 0.95);

                    const now = performance.now();
                    const isResumeFrame = (lastWristPos.relX === undefined || lastWristPos.t === 0 || (now - lastWristPos.t) > 350);
                    const dt = isResumeFrame ? 0.033 : Math.max(0.01, (now - lastWristPos.t) / 1000);
                    const tc = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2, z: ((lS.z || 0) + (rS.z || 0)) / 2 };
                    const SW = NORM.ready ? NORM.W : 1;
                    const relX = (rW.x - tc.x) / SW, relY = (rW.y - tc.y) / SW, relZ = ((rW.z || 0) - tc.z) / SW;

                    // ★ TASK-V8-606: 重新入鏡跳躍防護 (Resume Frame Guard)
                    // 姿態中斷後第一幀僅初始化參考基準，跳過差分位移與動力學計算，杜絕假性爆發揮拍！
                    if (isResumeFrame) {
                        lastWristPos = { relX: relX, relY: relY, relZ: relZ, t: now };
                        lastWristAngle = elA;
                        lastShoulderAngle = shA;
                        return;
                    }

                    const lx = lastWristPos.relX, ly = lastWristPos.relY, lz = lastWristPos.relZ;
                    const dRelX = relX - lx, dRelY = relY - ly, dRelZ = relZ - lz;
                    const step = nd(dRelX, dRelY, dRelZ);
                    updateKinematics(step, dt);
                    accumulateSwing(step, dt);

                    // ★ TASK-V8-606: 揮拍意圖評估 (無量綱方向位移與速度門檻)
                    const hasStrokeIntent = (typeof evalStrokeIntent === 'function')
                        ? evalStrokeIntent(dRelX, dRelY, dRelZ, KIN.vPeak)
                        : (KIN.vPeak >= 0.85 && (dRelZ < -0.025 || dRelY < -0.025 || Math.abs(dRelX) > 0.045));

                    power = hitPower(KIN.vPeak, SWING.path);
                    const pct = THREE.MathUtils.clamp((power - POWER_W.min) / (POWER_W.max - POWER_W.min) * 100, 0, 100);
                    powerBarDisplay += (pct - powerBarDisplay) * Math.min(1, dt * 10);
                    D.pFill.style.width = powerBarDisplay.toFixed(1) + '%';

                    if (servePrepared) { updateAimFromLeftHand(lW, tc.x, dt); updateAimFromTorso(dt); }
                    updateServeFSM(lm, dt);

                    const shD = Math.abs(shA - (lastShoulderAngle !== undefined ? lastShoulderAngle : shA));
                    const elD = Math.abs(elA - (lastWristAngle !== undefined ? lastWristAngle : elA));
                    // ★ 防抖手作弊檢測已移除：舊版單幀角度差分會誤判所有正常揮拍

                    // ★ TASK-V8-606: 體感主動揮拍意圖事件生成 (杜絕手臂微動/轉體誤判為自動接球)
                    // 嚴格要求符合 evalStrokeIntent 定義之速度 (vPeak >= 0.85) 與方向位移 (推拍 dy/dz < -0.025 或刷拍 |dx| > 0.045)
                    // 徹底移除舊版單純關節角度位移 (shD > 30, elD > 40) 導致之「球來自動接球」誤觸發！
                    const isSwingMotion = hasStrokeIntent && !locked;
                    if (isSwingMotion) {
                        if (swingArmed) {
                            registerSwingEvent(KIN.vPeak, now);
                            swingArmed = false;
                            tryHit();
                        } else {
                            // 同一揮拍動作持續中：不重複註冊新事件，但允許 tryHit 判定擊球
                            tryHit();
                        }
                    } else {
                        // 只要未處於前向出拍狀態 (如引拍、收拍、停頓)，立即就緒重新武裝，確保向前揮擊必定觸發！
                        swingArmed = true;
                    }
                    kcPush(now, torsoYawDeg(), shA, elA);
                    lastWristPos = { relX: relX, relY: relY, relZ: relZ, t: now };
                    lastWristAngle = elA; lastShoulderAngle = shA;
                });
            }

            // 隔離每次相機啟動的影片來源，杜絕共用 video 元素遭晚到回呼覆蓋串流
            const launchVideo = (typeof document !== 'undefined' && document.createElement)
                ? document.createElement('video')
                : (document.getElementById('webcam-video') || {});
            launchVideo.playsInline = true;
            launchVideo.muted = true;
            launchVideo.width = 320;
            launchVideo.height = 240;

            let fc = 0;
            const instanceCamera = new Camera(launchVideo, {
                onFrame: async () => {
                    fc++;
                    if (fc % frameSkip === 0 && webcamActive && poseInstance && cameraUtils === instanceCamera)
                        await poseInstance.send({ image: launchVideo });
                },
                width: 320, height: 240
            });
            cameraUtils = instanceCamera;
            instanceCamera.start().then(() => {
                if (currentLaunchToken !== webcamLaunchToken || !webcamStarting) {
                    try { instanceCamera.stop(); } catch (e) {}
                    if (launchVideo && launchVideo.srcObject && launchVideo.srcObject.getTracks) {
                        launchVideo.srcObject.getTracks().forEach(t => t.stop());
                        launchVideo.srcObject = null;
                    }
                    if (cameraUtils === instanceCamera) {
                        cameraUtils = null;
                        if (activeVideoElement === launchVideo) activeVideoElement = null;
                        const v = document.getElementById('webcam-video');
                        if (v && v.srcObject && v.srcObject.getTracks) {
                            v.srcObject.getTracks().forEach(t => t.stop());
                            v.srcObject = null;
                        }
                    }
                    return;
                }
                cameraUtils = instanceCamera;
                activeVideoElement = launchVideo;
                const domVideo = document.getElementById('webcam-video');
                if (domVideo) {
                    domVideo.srcObject = launchVideo.srcObject;
                    if (typeof domVideo.play === 'function') domVideo.play().catch(() => {});
                }
                webcamStarting = false;
                webcamActive = true;
                servePrepared = false;
                if (btn) btn.innerText = '📷 體感: 開';
                updateQuickCameraFab();
                syncAimPips();
                document.body.classList.add('distant-hud-active');
                if (typeof speakReferee === 'function') speakReferee('體感模式已啟動，請退後三公尺開打！');
                toast('體感 AI 已啟動', '預設 🔒 自動對角,先專心練揮拍時機');
                syncSubbarStates();
                if (typeof updatePracticeInstructionBar === 'function') updatePracticeInstructionBar();
            }).catch(err => {
                if (launchVideo && launchVideo.srcObject && launchVideo.srcObject.getTracks) {
                    launchVideo.srcObject.getTracks().forEach(t => t.stop());
                    launchVideo.srcObject = null;
                }
                if (currentLaunchToken !== webcamLaunchToken) {
                    try { instanceCamera.stop(); } catch (e) {}
                    if (cameraUtils === instanceCamera) {
                        cameraUtils = null;
                    }
                    return;
                }
                webcamStarting = false;
                webcamActive = false;
                updateQuickCameraFab();
                if (cameraUtils === instanceCamera) {
                    cameraUtils = null;
                }
                if (activeVideoElement === launchVideo) {
                    activeVideoElement = null;
                }
                const domVideo = document.getElementById('webcam-video');
                if (domVideo && domVideo.srcObject && domVideo.srcObject.getTracks) {
                    domVideo.srcObject.getTracks().forEach(t => t.stop());
                    domVideo.srcObject = null;
                }
                console.error(err);
                const name = (err && err.name) || String(err);
                lastCameraError = name;
                const msg = {
                    NotAllowedError: '剛才按了「封鎖」→ 點網址列相機圖示改成允許,再重載',
                    NotFoundError: '找不到鏡頭 → 確認外接攝影機已插上',
                    NotReadableError: '鏡頭被佔用 → 先關閉 Zoom / Teams / OBS',
                    OverconstrainedError: '鏡頭不支援 320x240 解析度',
                    SecurityError: '需要 https:// 或 localhost 環境'
                }[name] || name;
                if (btn) btn.innerText = '📷 體感: 失敗';
                skelCanvas.style.display = 'none';
                const mHudErr = document.getElementById('motion-hud');
                if (mHudErr) mHudErr.style.display = 'none';
                if (typeof D !== 'undefined' && D.waistRow) D.waistRow.style.display = 'none';
                if (typeof setStanceRowVisible === 'function') setStanceRowVisible(false);
                const cb = document.getElementById('calibration-box');
                if (cb) cb.style.display = 'none';
                toast('體感啟動失敗', msg);
                syncSubbarStates();
                if (typeof updatePracticeInstructionBar === 'function') updatePracticeInstructionBar();
            });
        }
        function stopWebcamAI() {
            webcamLaunchToken++;
            webcamStarting = false;
            webcamActive = false;
            lastCameraError = null;
            lastPoseTimestamp = 0;
            lastPoseSnapshot = { hasPoseData: false, keypointsPresent: false, lastSeenTime: 0 };
            revokeSwingEvent();
            lastWristPos = { relX: undefined, relY: undefined, relZ: undefined, t: 0 };
            lastWristAngle = undefined;
            lastShoulderAngle = undefined;
            servePrepared = true;
            document.body.classList.remove('distant-hud-active');
            if (cameraUtils) {
                try { cameraUtils.stop(); } catch (e) {}
                cameraUtils = null;
            }
            if (activeVideoElement) {
                if (activeVideoElement.srcObject && activeVideoElement.srcObject.getTracks) {
                    activeVideoElement.srcObject.getTracks().forEach(t => t.stop());
                }
                activeVideoElement.srcObject = null;
                activeVideoElement = null;
            }
            const video = document.getElementById('webcam-video');
            if (video && video.srcObject) {
                const st = video.srcObject;
                if (st.getTracks) st.getTracks().forEach(t => t.stop());
                video.srcObject = null;
            }
            const sc = document.getElementById('skeleton-canvas');
            if (sc) { sc.getContext('2d').clearRect(0, 0, sc.width, sc.height); sc.style.display = 'none'; }
            const mHud = document.getElementById('motion-hud');
            if (mHud) mHud.style.display = 'none';
            const btn = document.getElementById('ai-toggle-btn');
            if (btn) btn.innerText = '📷 體感: 關';
            updateQuickCameraFab();
            const cb = document.getElementById('calibration-box');
            if (cb) cb.style.display = 'none';
            if (typeof D !== 'undefined' && D.waistRow) D.waistRow.style.display = 'none';
            if (typeof setStanceRowVisible === 'function') setStanceRowVisible(false);
            if (typeof D !== 'undefined' && D.aimHud) D.aimHud.classList.remove('on');
            if (typeof aimZoneMeshes !== 'undefined') aimZoneMeshes.forEach(m => m.visible = false);
            resetServeFSM(); kcReset();
            stanceOK = false;
            toast('體感 AI 已關閉', '已切換回滑鼠/鍵盤控制');
            syncSubbarStates();
            if (typeof updatePracticeInstructionBar === 'function') updatePracticeInstructionBar();
        }

        window.getWebcamStatus = getWebcamStatus;
        window.getMotionTrackingStatus = getMotionTrackingStatus;
        window.isWebcamStarting = () => webcamStarting;
        window.isWebcamActive = () => webcamActive;
        window.toggleWebcamAI = toggleWebcamAI;
        window.startWebcamAI = startWebcamAI;
        window.stopWebcamAI = stopWebcamAI;
        window.updateQuickCameraFab = updateQuickCameraFab;
        window.getActiveVideoElement = () => activeVideoElement;

        if (typeof module !== 'undefined' && module.exports) {
            module.exports = {
                getWebcamStatus,
                getMotionTrackingStatus,
                getActiveVideoElement: () => activeVideoElement,
                isWebcamStarting: () => webcamStarting,
                isWebcamActive: () => webcamActive,
                toggleWebcamAI,
                startWebcamAI,
                stopWebcamAI,
                updateQuickCameraFab
            };
        }

        /* ═══════════════════════════════════════════════
           ★ 輸入:含輸入框/彈窗守衛 + 自訂視角鍵
           ═══════════════════════════════════════════════ */