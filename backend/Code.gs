/**
 * ═════════════════════════════════════════════════════════════════════════
 * NCHU Pickleball - Google Apps Script (GAS) 企業級安全加固後端
 * 版本：v2.2-hardened
 * 
 * 安全特性：
 * 1. 嚴格 HMAC-SHA256 簽署驗證與時間戳漂移過濾
 * 2. CacheService 隨機數 (Nonce) 防重放攻擊保護 (10 分鐘快取)
 * 3. LockService 併發事務安全排他鎖 (防止多球員併發寫入覆蓋試算表)
 * 4. 數值與物理合理性邊界檢查 (防外掛篡改單場得分)
 * 5. 防 CSV / 試算表公式注入過濾 (Formula Injection Sanitization)
 * ═════════════════════════════════════════════════════════════════════════
 */

var SIGN_SECRET = 'nchu-pickleball-2026-secret';

// 取得或初始化工作表
function getDb() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    players: getOrCreateSheet(ss, 'players', ['playerId', 'avatar', 'nickname', 'department', 'deptCode', 'grade', 'entryYear', 'bestScore', 'likes', 'updatedAt', 'twin_data']),
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
  }
  return sheet;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 試算表公式注入防護：若以 =, +, -, @ 開頭，自動加上前置單引號
function sanitize(val) {
  if (val === null || val === undefined) return '';
  var s = String(val).trim();
  if (/^[=\+\-@]/.test(s)) {
    s = "'" + s;
  }
  return s.slice(0, 100); // 限制長度
}

// 驗證 HMAC-SHA256 簽名
function verifySignature(dataStr, ts, nonce, sig) {
  var message = dataStr + '|' + ts + '|' + nonce;
  var signature = Utilities.computeHmacSha256Signature(message, SIGN_SECRET);
  var expectedSig = Utilities.base64Encode(signature);
  return expectedSig === sig;
}

// ═══════════════════════════════════════════════════════════
// GET 請求處理 (讀取排行榜、個人名片、好友名單)
// ═══════════════════════════════════════════════════════════
function doGet(e) {
  var p = e ? e.parameter : {};
  var act = p.act || 'ping';
  var pid = p.pid ? String(p.pid).trim() : '';

  try {
    var db = getDb();

    if (act === 'ping') {
      return jsonResponse({
        ok: true,
        api: 'nchu-pickleball-v2.2-hardened',
        acts: ['ping', 'leaderboard', 'me', 'friends', 'stats']
      });
    }

    if (act === 'leaderboard') {
      var pData = db.players.getDataRange().getValues();
      var list = [];
      for (var i = 1; i < pData.length; i++) {
        var row = pData[i];
        if (!row[0]) continue;
        list.push({
          playerId: row[0],
          avatar: row[1] || '🪿',
          nickname: row[2] || '匿名球員',
          department: row[3] || '',
          deptCode: row[4] || '',
          score: Number(row[7]) || 0,
          likes: Number(row[8]) || 0,
          twin_data: row[10] || ''
        });
      }

      // 按分數降序排列
      list.sort(function(a, b) { return b.score - a.score; });

      // 附加好友與點讚狀態
      var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
      var likesData = db.likes.getDataRange().getValues();
      var friendsData = db.friends.getDataRange().getValues();

      var result = list.slice(0, 50).map(function(item, idx) {
        var isMe = pid && (item.playerId === pid);
        var liked = false;
        var friendStatus = 'none';

        if (pid && !isMe) {
          // 檢查今日是否已按讚
          for (var j = 1; j < likesData.length; j++) {
            if (likesData[j][1] === pid && likesData[j][2] === item.playerId && likesData[j][3] === today) {
              liked = true;
              break;
            }
          }
          // 檢查好友狀態
          for (var k = 1; k < friendsData.length; k++) {
            var f = friendsData[k];
            if ((f[1] === pid && f[2] === item.playerId) || (f[2] === pid && f[1] === item.playerId)) {
              if (f[3] === 'accepted') {
                friendStatus = 'accepted';
              } else if (f[1] === pid) {
                friendStatus = 'pending';
              } else if (f[2] === pid) {
                friendStatus = 'incoming';
              }
              break;
            }
          }
        }

        return {
          rank: idx + 1,
          playerId: item.playerId,
          avatar: item.avatar,
          nickname: item.nickname,
          department: item.department,
          deptCode: item.deptCode,
          score: item.score,
          likes: item.likes,
          liked: liked,
          friend: friendStatus,
          isMe: isMe
        };
      });

      return jsonResponse({ ok: true, list: result });
    }

    if (act === 'me') {
      if (!pid) return jsonResponse({ ok: false, err: 'PID_REQUIRED' });
      var pData = db.players.getDataRange().getValues();
      var rank = 0, bestScore = 0, likes = 0, sessions = 0;
      var scoresList = [];

      for (var i = 1; i < pData.length; i++) {
        var row = pData[i];
        if (row[0]) scoresList.push({ pid: row[0], score: Number(row[7]) || 0 });
        if (row[0] === pid) {
          bestScore = Number(row[7]) || 0;
          likes = Number(row[8]) || 0;
        }
      }
      scoresList.sort(function(a, b) { return b.score - a.score; });
      for (var j = 0; j < scoresList.length; j++) {
        if (scoresList[j].pid === pid) { rank = j + 1; break; }
      }

      var sData = db.scores.getDataRange().getValues();
      for (var k = 1; k < sData.length; k++) {
        if (sData[k][1] === pid) sessions++;
      }

      return jsonResponse({
        ok: true,
        rank: rank,
        bestScore: bestScore,
        likes: likes,
        sessions: sessions
      });
    }

    if (act === 'friends') {
      if (!pid) return jsonResponse({ ok: false, err: 'PID_REQUIRED' });
      var fData = db.friends.getDataRange().getValues();
      var pData = db.players.getDataRange().getValues();
      var playerMap = {};
      for (var i = 1; i < pData.length; i++) {
        var r = pData[i];
        playerMap[r[0]] = {
          playerId: r[0],
          avatar: r[1] || '🪿',
          nickname: r[2] || '匿名球員',
          department: r[3] || '',
          score: Number(r[7]) || 0,
          stats: r[10] ? JSON.parse(r[10]).stats : null
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

      return jsonResponse({
        ok: true,
        friends: { incoming: inc, accepted: acc, outgoing: out }
      });
    }

    return jsonResponse({ ok: false, err: 'UNKNOWN_GET_ACTION' });
  } catch (err) {
    return jsonResponse({ ok: false, err: 'GET_ERROR: ' + err.toString() });
  }
}

// ═══════════════════════════════════════════════════════════
// POST 請求處理 (成績提交、按讚、好友邀請、個人檔案)
// ═══════════════════════════════════════════════════════════
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // 獲取併發排他鎖 (最多等待 8 秒)
    if (!lock.tryLock(8000)) {
      return jsonResponse({ ok: false, err: 'SERVER_BUSY_PLEASE_RETRY' });
    }

    var body = e && e.postData ? e.postData.contents : '';
    if (!body) return jsonResponse({ ok: false, err: 'EMPTY_BODY' });

    var env;
    try {
      env = JSON.parse(body);
    } catch (_) {
      return jsonResponse({ ok: false, err: 'INVALID_JSON_ENVELOPE' });
    }

    var dataStr = env.data;
    var ts = Number(env.ts);
    var nonce = String(env.nonce || '');
    var sig = String(env.sig || '');

    // 1. 驗證時間戳漂移 (不可大於 10 分鐘)
    var now = Date.now();
    if (!ts || Math.abs(now - ts) > 10 * 60 * 1000) {
      return jsonResponse({ ok: false, err: 'TIMESTAMP_EXPIRED' });
    }

    // 2. 隨機數 (Nonce) 防重放攻擊檢查
    if (!nonce || nonce.length < 4) {
      return jsonResponse({ ok: false, err: 'INVALID_NONCE' });
    }
    var cache = CacheService.getScriptCache();
    var nonceKey = 'pb_nonce_' + nonce;
    if (cache.get(nonceKey)) {
      return jsonResponse({ ok: false, err: 'REPLAY_ATTACK_DETECTED' });
    }
    cache.put(nonceKey, '1', 600); // 記憶 10 分鐘

    // 3. 驗證 HMAC-SHA256 簽名
    if (!verifySignature(dataStr, ts, nonce, sig)) {
      return jsonResponse({ ok: false, err: 'INVALID_SIGNATURE' });
    }

    var payload;
    try {
      payload = JSON.parse(dataStr);
    } catch (_) {
      return jsonResponse({ ok: false, err: 'INVALID_INNER_JSON' });
    }

    var act = payload.act;
    var pid = sanitize(payload.playerId);
    if (!pid) return jsonResponse({ ok: false, err: 'PLAYER_ID_REQUIRED' });

    var db = getDb();
    var isoTime = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

    // ── 提交成績 (act: 'submit') ──
    if (act === 'submit') {
      var score = Math.floor(Number(payload.score));
      var stage = Math.floor(Number(payload.stage));

      // 物理邊界安全檢查
      if (isNaN(score) || score < 0 || score > 21) {
        return jsonResponse({ ok: false, err: 'INVALID_SCORE_RANGE' });
      }
      if (isNaN(stage) || stage < 1 || stage > 6) {
        return jsonResponse({ ok: false, err: 'INVALID_STAGE' });
      }

      var nick = sanitize(payload.nickname) || '匿名球員';
      var dept = sanitize(payload.department) || '';
      var deptCode = sanitize(payload.deptCode) || '';
      var avatar = sanitize(payload.avatar) || '🪿';
      var grade = sanitize(payload.grade) || '';
      var entryYear = sanitize(payload.entryYear) || '';
      var sessionId = sanitize(payload.sessionId) || '';

      // 寫入 scores 記錄表
      var scoreId = 'SC-' + now.toString(36) + '-' + Math.floor(Math.random()*1000);
      db.scores.appendRow([
        scoreId, pid, sessionId, score, stage,
        sanitize(payload.device), payload.webcamUsed ? 'Y' : 'N', isoTime
      ]);

      // 檢查並更新 players 表中的最高分
      var pData = db.players.getDataRange().getValues();
      var foundRow = 0, currentBest = 0;
      for (var i = 1; i < pData.length; i++) {
        if (pData[i][0] === pid) {
          foundRow = i + 1;
          currentBest = Number(pData[i][7]) || 0;
          break;
        }
      }

      var newBest = Math.max(currentBest, score);
      if (foundRow > 0) {
        db.players.getRange(foundRow, 2, 1, 9).setValues([[
          avatar, nick, dept, deptCode, grade, entryYear, newBest, pData[foundRow-1][8] || 0, isoTime
        ]]);
      } else {
        db.players.appendRow([
          pid, avatar, nick, dept, deptCode, grade, entryYear, newBest, 0, isoTime, ''
        ]);
      }

      return jsonResponse({ ok: true, bestScore: newBest });
    }

    // ── 點讚互動 (act: 'like') ──
    if (act === 'like') {
      var toId = sanitize(payload.toId);
      if (!toId || toId === pid) return jsonResponse({ ok: false, err: 'INVALID_TARGET' });

      var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
      var likesData = db.likes.getDataRange().getValues();
      for (var i = 1; i < likesData.length; i++) {
        if (likesData[i][1] === pid && likesData[i][2] === toId && likesData[i][3] === today) {
          return jsonResponse({ ok: false, err: 'ALREADY_LIKED_TODAY' });
        }
      }

      // 新增點讚
      var likeId = 'LK-' + now.toString(36);
      db.likes.appendRow([likeId, pid, toId, today, isoTime]);

      // 更新目標被點讚數
      var pData = db.players.getDataRange().getValues();
      var newLikes = 1;
      for (var j = 1; j < pData.length; j++) {
        if (pData[j][0] === toId) {
          newLikes = (Number(pData[j][8]) || 0) + 1;
          db.players.getRange(j + 1, 9).setValue(newLikes);
          break;
        }
      }

      return jsonResponse({ ok: true, likes: newLikes });
    }

    // ── 好友邀請 (act: 'friendReq') ──
    if (act === 'friendReq') {
      var toId = sanitize(payload.toId);
      if (!toId || toId === pid) return jsonResponse({ ok: false, err: 'INVALID_TARGET' });

      var fData = db.friends.getDataRange().getValues();
      for (var i = 1; i < fData.length; i++) {
        var fr = fData[i];
        if (fr[1] === pid && fr[2] === toId) {
          return jsonResponse({ ok: true, status: fr[3] });
        }
        if (fr[1] === toId && fr[2] === pid) {
          // 對方已邀請，直接結為球友
          db.friends.getRange(i + 1, 4, 1, 2).setValues([['accepted', isoTime]]);
          return jsonResponse({ ok: true, status: 'accepted' });
        }
      }

      var fId = 'FR-' + now.toString(36);
      db.friends.appendRow([fId, pid, toId, 'pending', isoTime]);
      return jsonResponse({ ok: true, status: 'pending' });
    }

    // ── 接受好友 (act: 'friendAccept') ──
    if (act === 'friendAccept') {
      var toId = sanitize(payload.toId);
      var fData = db.friends.getDataRange().getValues();
      for (var i = 1; i < fData.length; i++) {
        var fr = fData[i];
        if (fr[1] === toId && fr[2] === pid) {
          db.friends.getRange(i + 1, 4, 1, 2).setValues([['accepted', isoTime]]);
          return jsonResponse({ ok: true, status: 'accepted' });
        }
      }
      return jsonResponse({ ok: false, err: 'INVITATION_NOT_FOUND' });
    }

    // ── 更新個人設定 (act: 'updateProfile') ──
    if (act === 'updateProfile') {
      var nick = sanitize(payload.nickname);
      var dept = sanitize(payload.department);
      var avatar = sanitize(payload.avatar) || '🪿';

      var pData = db.players.getDataRange().getValues();
      for (var i = 1; i < pData.length; i++) {
        if (pData[i][0] === pid) {
          db.players.getRange(i + 1, 2, 1, 3).setValues([[avatar, nick, dept]]);
          db.players.getRange(i + 1, 10).setValue(isoTime);
          return jsonResponse({ ok: true });
        }
      }

      db.players.appendRow([pid, avatar, nick, dept, '', '', '', 0, 0, isoTime, '']);
      return jsonResponse({ ok: true });
    }

    // ── 數位孿生大數據同步 (act: 'sync_twin') ──
    if (act === 'sync_twin') {
      var twinData = String(payload.twin_data || '').slice(0, 5000); // 限制 5KB 大小
      var pData = db.players.getDataRange().getValues();
      for (var i = 1; i < pData.length; i++) {
        if (pData[i][0] === pid) {
          db.players.getRange(i + 1, 11).setValue(twinData);
          db.players.getRange(i + 1, 10).setValue(isoTime);
          return jsonResponse({ ok: true });
        }
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, err: 'UNKNOWN_POST_ACTION' });

  } catch (err) {
    return jsonResponse({ ok: false, err: 'SERVER_ERROR: ' + err.toString() });
  } finally {
    lock.releaseLock();
  }
}
