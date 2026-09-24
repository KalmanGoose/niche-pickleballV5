/**
 * NCHU Pickleball - Google Apps Script 後端  v3.0
 * 1. HMAC-SHA256 驗簽（金鑰存於「指令碼屬性」SIGN_SECRET）
 * 2. 時間戳 ±10 分鐘 + nonce 防重放（先驗簽，再記錄 nonce）
 * 3. 玩家 token 驗證：公開 playerId + 私密 token（只存 SHA-256 雜湊）
 * 4. LockService 排他鎖、公式注入過濾、分數邊界檢查
 * 需要 V8 執行環境
 */

var PLAYER_HEADERS = ['playerId', 'avatar', 'nickname', 'department', 'deptCode', 'grade',
    'entryYear', 'bestScore', 'likes', 'updatedAt', 'twin_data', 'ig', 'tokenHash'];
var COL = { PID: 0, AVATAR: 1, NICK: 2, DEPT: 3, DEPTCODE: 4, GRADE: 5, ENTRY: 6,
    BEST: 7, LIKES: 8, UPDATED: 9, TWIN: 10, IG: 11, TOKEN: 12 };

var SCORE_STAGES = [5, 6];
var MAX_SCORE = 5;
var MAX_TWIN_CHARS = 30000;
var POST_ACTS = ['submit', 'like', 'friendReq', 'friendAccept', 'updateProfile', 'sync_twin'];

function getSecret() {
    var s = PropertiesService.getScriptProperties().getProperty('SIGN_SECRET');
    if (!s) throw new Error('SIGN_SECRET_NOT_CONFIGURED');
    return s;
}

function getDb() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return {
        players: getOrCreateSheet(ss, 'players', PLAYER_HEADERS),
        scores: getOrCreateSheet(ss, 'scores', ['id', 'playerId', 'sessionId', 'score', 'stage', 'device', 'webcam', 'createdAt']),
        friends: getOrCreateSheet(ss, 'friends', ['id', 'fromId', 'toId', 'status', 'updatedAt']),
        likes: getOrCreateSheet(ss, 'likes', ['id', 'fromId', 'toId', 'date', 'createdAt'])
    };
}

function getOrCreateSheet(ss, name, headers) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.appendRow(headers);
        sheet.setFrozenRows(1);
        return sheet;
    }
    var n = sheet.getLastColumn();
    var cur = n > 0 ? sheet.getRange(1, 1, 1, n).getValues()[0] : [];
    for (var i = 0; i < cur.length && i < headers.length; i++) {
        if (String(cur[i]) !== headers[i]) throw new Error('SCHEMA_MISMATCH ' + name + ' col ' + (i + 1));
    }
    if (n < headers.length) {
        sheet.getRange(1, n + 1, 1, headers.length - n).setValues([headers.slice(n)]);
    }
    return sheet;
}

function setupTextFormats() {
    var db = getDb();
    [db.players, db.scores, db.friends, db.likes].forEach(function (sh) {
        sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
    });
}

function jsonResponse(data) {
    return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function sanitize(val, maxLen) {
    if (val === null || val === undefined) return '';
    var s = String(val).trim();
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return Array.from(s).slice(0, maxLen || 100).join('');
}

function sanitizeIg(val) {
    var s = String(val || '').trim().replace(/^@/, '');
    return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : '';
}

function safeParse(str) {
    if (!str) return null;
    try { return JSON.parse(str); } catch (_) { return null; }
}

function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Utilities.getUuid().slice(0, 8);
}

function writeCells(sheet, dataRow, startCol, values) {
    sheet.getRange(dataRow + 1, startCol + 1, 1, values.length).setValues([values]);
}

function findRow(pData, pid) {
    for (var i = 1; i < pData.length; i++) if (pData[i][COL.PID] === pid) return i;
    return -1;
}

function verifySignature(dataStr, ts, nonce, sig) {
    var mac = Utilities.computeHmacSha256Signature(
        dataStr + '|' + ts + '|' + nonce, getSecret(), Utilities.Charset.UTF_8);
    return Utilities.base64Encode(mac) === sig;
}

function hashToken(token) {
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
    return 'h' + Utilities.base64Encode(d);
}

var _sheetTz = null;
function dayStr(v) {
    if (v instanceof Date) {
        _sheetTz = _sheetTz || SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
        return Utilities.formatDate(v, _sheetTz, 'yyyy-MM-dd');
    }
    return String(v || '');
}

function authorize(db, pData, pid, token, isoTime) {
    if (!/^[A-Za-z0-9_\-]{6,40}$/.test(pid)) return { err: 'INVALID_PLAYER_ID' };
    if (!/^[a-f0-9]{32,64}$/.test(token)) return { err: 'TOKEN_REQUIRED' };
    var h = hashToken(token);
    var i = findRow(pData, pid);
    if (i > 0) {
        var stored = pData[i][COL.TOKEN];
        if (!stored) {
            db.players.getRange(i + 1, COL.TOKEN + 1).setValue(h);
            pData[i][COL.TOKEN] = h;
            return { row: i };
        }
        return stored === h ? { row: i } : { err: 'UNAUTHORIZED' };
    }
    var row = [];
    for (var c = 0; c < PLAYER_HEADERS.length; c++) row.push('');
    row[COL.PID] = pid; row[COL.AVATAR] = '🪿'; row[COL.NICK] = '匿名球員';
    row[COL.BEST] = 0; row[COL.LIKES] = 0; row[COL.UPDATED] = isoTime; row[COL.TOKEN] = h;
    db.players.appendRow(row);
    pData.push(row);
    return { row: pData.length - 1 };
}

function doGet(e) {
    var p = e ? e.parameter : {};
    var act = p.act || 'ping';
    var pid = p.pid ? String(p.pid).trim() : '';
    try {
        var db = getDb();

        if (act === 'ping') {
            return jsonResponse({ ok: true, api: 'nchu-pickleball-v3.0', acts: ['ping', 'leaderboard', 'me', 'friends'] });
        }

        if (act === 'leaderboard') {
            var pData = db.players.getDataRange().getValues();
            var list = [];
            for (var i = 1; i < pData.length; i++) {
                var row = pData[i];
                var sc = Number(row[COL.BEST]) || 0;
                if (!row[COL.PID] || sc <= 0) continue;
                list.push({
                    playerId: row[COL.PID], avatar: String(row[COL.AVATAR] || '🪿'),
                    nickname: String(row[COL.NICK] || '匿名球員'), department: String(row[COL.DEPT] || ''),
                    deptCode: String(row[COL.DEPTCODE] || ''), ig: String(row[COL.IG] || ''),
                    score: sc, likes: Number(row[COL.LIKES]) || 0
                });
            }
            list.sort(function (a, b) { return b.score - a.score; });

            var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
            var likesData = pid ? db.likes.getDataRange().getValues() : [];
            var friendsData = pid ? db.friends.getDataRange().getValues() : [];

            var result = list.slice(0, 50).map(function (item, idx) {
                var isMe = !!pid && item.playerId === pid;
                var liked = false, friendStatus = 'none';
                if (pid && !isMe) {
                    for (var j = 1; j < likesData.length; j++) {
                        if (likesData[j][1] === pid && likesData[j][2] === item.playerId && dayStr(likesData[j][3]) === today) {
                            liked = true; break;
                        }
                    }
                    for (var k = 1; k < friendsData.length; k++) {
                        var f = friendsData[k];
                        if ((f[1] === pid && f[2] === item.playerId) || (f[2] === pid && f[1] === item.playerId)) {
                            if (f[3] === 'accepted') friendStatus = 'accepted';
                            else if (f[1] === pid) friendStatus = 'pending';
                            else friendStatus = 'incoming';
                            break;
                        }
                    }
                }
                item.rank = idx + 1; item.liked = liked; item.friend = friendStatus; item.isMe = isMe;
                return item;
            });
            return jsonResponse({ ok: true, list: result });
        }

        if (act === 'me') {
            if (!pid) return jsonResponse({ ok: false, err: 'PID_REQUIRED' });
            var pData = db.players.getDataRange().getValues();
            var bestScore = 0, likes = 0, scoresList = [];
            for (var i = 1; i < pData.length; i++) {
                var row = pData[i];
                var sc = Number(row[COL.BEST]) || 0;
                if (row[COL.PID] && sc > 0) scoresList.push({ pid: row[COL.PID], score: sc });
                if (row[COL.PID] === pid) { bestScore = sc; likes = Number(row[COL.LIKES]) || 0; }
            }
            scoresList.sort(function (a, b) { return b.score - a.score; });
            var rank = 0;
            for (var j = 0; j < scoresList.length; j++) if (scoresList[j].pid === pid) { rank = j + 1; break; }
            var sData = db.scores.getDataRange().getValues(), sessions = 0;
            for (var k = 1; k < sData.length; k++) if (sData[k][1] === pid) sessions++;
            return jsonResponse({ ok: true, rank: rank, bestScore: bestScore, likes: likes, sessions: sessions });
        }

        if (act === 'friends') {
            if (!pid) return jsonResponse({ ok: false, err: 'PID_REQUIRED' });
            var fData = db.friends.getDataRange().getValues();
            var pData = db.players.getDataRange().getValues();
            var playerMap = {};
            for (var i = 1; i < pData.length; i++) {
                var r = pData[i];
                if (!r[COL.PID]) continue;
                var twin = safeParse(r[COL.TWIN]);
                playerMap[r[COL.PID]] = {
                    playerId: r[COL.PID], avatar: String(r[COL.AVATAR] || '🪿'),
                    nickname: String(r[COL.NICK] || '匿名球員'), department: String(r[COL.DEPT] || ''),
                    ig: String(r[COL.IG] || ''), score: Number(r[COL.BEST]) || 0,
                    stats: twin && twin.stats ? twin.stats : null
                };
            }
            var inc = [], acc = [], out = [];
            for (var j = 1; j < fData.length; j++) {
                var fr = fData[j];
                if (fr[3] === 'accepted') {
                    if (fr[1] === pid && playerMap[fr[2]]) acc.push(playerMap[fr[2]]);
                    else if (fr[2] === pid && playerMap[fr[1]]) acc.push(playerMap[fr[1]]);
                } else if (fr[3] === 'pending') {
                    if (fr[1] === pid && playerMap[fr[2]]) out.push(playerMap[fr[2]]);
                    else if (fr[2] === pid && playerMap[fr[1]]) inc.push(playerMap[fr[1]]);
                }
            }
            return jsonResponse({ ok: true, friends: { incoming: inc, accepted: acc, outgoing: out } });
        }

        return jsonResponse({ ok: false, err: 'UNKNOWN_GET_ACTION' });
    } catch (err) {
        console.error(err);
        return jsonResponse({ ok: false, err: 'SERVER_ERROR' });
    }
}

function doPost(e) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(8000)) return jsonResponse({ ok: false, err: 'SERVER_BUSY_PLEASE_RETRY' });
    try {
        var body = e && e.postData ? e.postData.contents : '';
        if (!body) return jsonResponse({ ok: false, err: 'EMPTY_BODY' });
        var env = safeParse(body);
        if (!env) return jsonResponse({ ok: false, err: 'INVALID_JSON_ENVELOPE' });

        var dataStr = String(env.data || ''), ts = Number(env.ts);
        var nonce = String(env.nonce || ''), sig = String(env.sig || '');
        var now = Date.now();

        if (!ts || Math.abs(now - ts) > 10 * 60 * 1000) return jsonResponse({ ok: false, err: 'TIMESTAMP_EXPIRED' });
        if (nonce.length < 8 || !verifySignature(dataStr, ts, nonce, sig)) {
            return jsonResponse({ ok: false, err: 'INVALID_SIGNATURE' });
        }
        var cache = CacheService.getScriptCache(), nonceKey = 'pb_nonce_' + nonce;
        if (cache.get(nonceKey)) return jsonResponse({ ok: false, err: 'REPLAY_ATTACK_DETECTED' });
        cache.put(nonceKey, '1', 1200);

        var payload = safeParse(dataStr);
        if (!payload) return jsonResponse({ ok: false, err: 'INVALID_INNER_JSON' });
        var act = payload.act;
        if (POST_ACTS.indexOf(act) < 0) return jsonResponse({ ok: false, err: 'UNKNOWN_POST_ACTION' });

        var db = getDb();
        var isoTime = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
        var pData = db.players.getDataRange().getValues();

        var pid = String(payload.playerId || '').trim();
        var auth = authorize(db, pData, pid, String(payload.token || ''), isoTime);
        if (auth.err) return jsonResponse({ ok: false, err: auth.err });
        var me = auth.row;

        if (act === 'submit') {
            var score = Math.floor(Number(payload.score));
            var stage = Math.floor(Number(payload.stage));
            if (SCORE_STAGES.indexOf(stage) < 0) return jsonResponse({ ok: false, err: 'INVALID_STAGE' });
            if (isNaN(score) || score < 0 || score > MAX_SCORE) return jsonResponse({ ok: false, err: 'INVALID_SCORE_RANGE' });

            db.scores.appendRow([newId('SC'), pid, sanitize(payload.sessionId, 40), score, stage,
                sanitize(payload.device, 20), payload.webcamUsed ? 'Y' : 'N', isoTime]);

            var newBest = Math.max(Number(pData[me][COL.BEST]) || 0, score);
            writeCells(db.players, me, COL.AVATAR, [
                sanitize(payload.avatar, 8) || '🪿',
                sanitize(payload.nickname, 30) || '匿名球員',
                sanitize(payload.department, 40),
                sanitize(payload.deptCode, 10),
                sanitize(payload.grade, 10),
                sanitize(payload.entryYear, 6),
                newBest
            ]);
            writeCells(db.players, me, COL.UPDATED, [isoTime]);
            return jsonResponse({ ok: true, bestScore: newBest });
        }

        if (act === 'like') {
            var toId = String(payload.toId || '').trim();
            var target = findRow(pData, toId);
            if (target < 0 || toId === pid) return jsonResponse({ ok: false, err: 'INVALID_TARGET' });
            var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
            var likesData = db.likes.getDataRange().getValues();
            for (var i = 1; i < likesData.length; i++) {
                if (likesData[i][1] === pid && likesData[i][2] === toId && dayStr(likesData[i][3]) === today) {
                    return jsonResponse({ ok: false, err: 'ALREADY_LIKED_TODAY' });
                }
            }
            db.likes.appendRow([newId('LK'), pid, toId, today, isoTime]);
            var newLikes = (Number(pData[target][COL.LIKES]) || 0) + 1;
            writeCells(db.players, target, COL.LIKES, [newLikes]);
            return jsonResponse({ ok: true, likes: newLikes });
        }

        if (act === 'friendReq') {
            var toId = String(payload.toId || '').trim();
            if (findRow(pData, toId) < 0 || toId === pid) return jsonResponse({ ok: false, err: 'INVALID_TARGET' });
            var fData = db.friends.getDataRange().getValues();
            for (var i = 1; i < fData.length; i++) {
                var fr = fData[i];
                if (fr[1] === pid && fr[2] === toId) return jsonResponse({ ok: true, status: fr[3] });
                if (fr[1] === toId && fr[2] === pid) {
                    db.friends.getRange(i + 1, 4, 1, 2).setValues([['accepted', isoTime]]);
                    return jsonResponse({ ok: true, status: 'accepted' });
                }
            }
            db.friends.appendRow([newId('FR'), pid, toId, 'pending', isoTime]);
            return jsonResponse({ ok: true, status: 'pending' });
        }

        if (act === 'friendAccept') {
            var toId = String(payload.toId || '').trim();
            var fData = db.friends.getDataRange().getValues();
            for (var i = 1; i < fData.length; i++) {
                if (fData[i][1] === toId && fData[i][2] === pid && fData[i][3] === 'pending') {
                    db.friends.getRange(i + 1, 4, 1, 2).setValues([['accepted', isoTime]]);
                    return jsonResponse({ ok: true, status: 'accepted' });
                }
            }
            return jsonResponse({ ok: false, err: 'INVITATION_NOT_FOUND' });
        }

        if (act === 'updateProfile') {
            writeCells(db.players, me, COL.AVATAR, [
                sanitize(payload.avatar, 8) || '🪿',
                sanitize(payload.nickname, 30) || '匿名球員',
                sanitize(payload.department, 40)
            ]);
            writeCells(db.players, me, COL.UPDATED, [isoTime]);
            writeCells(db.players, me, COL.IG, [sanitizeIg(payload.ig)]);
            return jsonResponse({ ok: true });
        }

        if (act === 'sync_twin') {
            var twinData = String(payload.twin_data || '');
            if (twinData.length > MAX_TWIN_CHARS) return jsonResponse({ ok: false, err: 'TWIN_DATA_TOO_LARGE' });
            if (!safeParse(twinData)) return jsonResponse({ ok: false, err: 'INVALID_TWIN_JSON' });
            writeCells(db.players, me, COL.UPDATED, [isoTime, twinData]);
            return jsonResponse({ ok: true });
        }

        return jsonResponse({ ok: false, err: 'UNKNOWN_POST_ACTION' });
    } catch (err) {
        console.error(err);
        return jsonResponse({ ok: false, err: 'SERVER_ERROR' });
    } finally {
        lock.releaseLock();
    }
}
