/**
 * ============================================================================
 * BUKU WORKSPACE — REST API (Google Apps Script)
 * CMS Kelas Membaca & Bangun Kebiasaan Membaca
 * ============================================================================
 * Deploy as Web App:
 *   - Execute as: Me
 *   - Who has access: Anyone
 *
 * First run: execute setupDatabase() once from Apps Script editor.
 * Optional Script Properties:
 *   - SPREADSHEET_ID : target spreadsheet id (default: active/bound spreadsheet)
 *   - DRIVE_FOLDER_ID: folder for uploaded images
 *   - ADMIN_EMAILS   : comma-separated emails auto-promoted to Admin
 */

const BW = Object.freeze({
  VERSION: '2.0.0',
  APP_NAME: 'Buku Workspace',
  SESSION_TTL_SECONDS: 21600, // 6 hours
  SESSION_PREFIX: 'bw2:sess:',
  SCHEMA_CACHE_KEY: 'bw2:schema:v1',
  RATE_PREFIX: 'bw2:rl:',
  MAX_PAYLOAD_BYTES: 6 * 1024 * 1024,
  MAX_IMAGE_BYTES: 4 * 1024 * 1024,
  DEFAULT_SETTINGS: {
    workspace_name: 'Buku Workspace',
    workspace_tagline: 'CMS Kelas Membaca untuk membangun kebiasaan membaca bersama.',
    workspace_description: 'Platform kelas membaca modern untuk mencatat progres, berdiskusi, dan menumbuhkan kebiasaan membaca setiap hari.',
    logo_url: '',
    hero_image_url: '',
    announcement: 'Selamat datang di Buku Workspace! Mulai perjalanan membaca Anda hari ini.',
    allow_registration: 'true',
    drive_folder_id: '',
    contact_email: 'halo@bukuws.id',
    contact_whatsapp: '',
    instagram_url: '',
    youtube_url: '',
    landing_cta_label: 'Mulai Membaca',
    landing_cta_url: '#/register'
  },
  TABLES: {
    Users: ['id','name','email','pin_hash','pin_salt','role','avatar_url','avatar_file_id','bio','status','created_at','updated_at'],
    Books: ['id','title','author','category','total_pages','cover_url','cover_file_id','synopsis','status','featured','created_by','created_at','updated_at'],
    Chapters: ['id','book_id','chapter_number','title','content_html','discussion_prompt','read_time_mins','created_at','updated_at'],
    ReadingLogs: ['id','user_id','book_id','start_page','end_page','pages_read','duration_mins','quote','reflection','is_public','created_at','updated_at'],
    Discussions: ['id','book_id','parent_id','user_id','title','content','likes_json','is_pinned','created_at','updated_at'],
    Quizzes: ['id','book_id','title','description','questions_json','created_at','updated_at'],
    QuizResults: ['id','quiz_id','user_id','score','total_questions','answers_json','completed_at'],
    Settings: ['key','value']
  }
});

const BW_WRITE_ACTIONS = new Set([
  'register','login','logout','saveBook','deleteBook','saveChapter','deleteChapter',
  'saveReadingLog','deleteReadingLog','saveDiscussion','toggleLikeDiscussion','togglePinDiscussion',
  'deleteDiscussion','saveQuiz','deleteQuiz','submitQuizResult','saveUser','deleteUser',
  'updateSettings','uploadImage','deleteImage'
]);

/* ============================== ENTRY POINTS ============================== */

function doGet(e) {
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    var action = String(p.action || 'health').trim();
    if (action === 'health') {
      return bwJson_(bwOk_('Buku Workspace API aktif.', { version: BW.VERSION, status: 'online', time: bwNow_() }));
    }
    if (action === 'publicLanding') {
      bwEnsureDatabase_();
      return bwJson_(bwOk_('Landing data loaded.', bwPublicLanding_()));
    }
    if (action === 'initApp') {
      bwEnsureDatabase_();
      var token = String(p.token || '').trim();
      return bwJson_(bwOk_('Init OK.', bwInitApp_(token)));
    }
    if (action === 'getBookDetail') {
      bwEnsureDatabase_();
      return bwJson_(bwOk_('Detail buku dimuat.', bwGetBookDetail_(String(p.book_id || '').trim(), String(p.token || '').trim())));
    }
    if (action === 'getUserDashboard') {
      bwEnsureDatabase_();
      return bwJson_(bwOk_('Dashboard dimuat.', bwGetUserDashboard_(String(p.user_id || '').trim(), String(p.token || '').trim())));
    }
    if (action === 'getAdminStats') {
      bwEnsureDatabase_();
      return bwJson_(bwOk_('Statistik admin dimuat.', bwGetAdminStats_(String(p.token || '').trim())));
    }
    return bwJson_(bwErr_('Action GET tidak dikenali.', 'UNKNOWN_ACTION'));
  } catch (err) {
    return bwJson_(bwErrObj_(err));
  }
}

function doPost(e) {
  var req;
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    if (raw.length > BW.MAX_PAYLOAD_BYTES) {
      return bwJson_(bwErr_('Payload terlalu besar.', 'PAYLOAD_TOO_LARGE'));
    }
    req = JSON.parse(raw);
  } catch (err) {
    return bwJson_(bwErr_('Format JSON tidak valid.', 'INVALID_JSON'));
  }
  try {
    var action = String(req.action || '').trim();
    if (!action) return bwJson_(bwErr_('Parameter action wajib diisi.', 'MISSING_ACTION'));
    bwEnsureDatabase_();

    if (BW_WRITE_ACTIONS.has(action)) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(15000)) {
        return bwJson_(bwErr_('Server sedang sibuk. Coba lagi beberapa detik.', 'BUSY'));
      }
      try {
        var result = bwRoute_(action, req);
        return bwJson_(bwOk_(result && result._message ? result._message : 'Berhasil.', bwStripMeta_(result)));
      } finally {
        lock.releaseLock();
      }
    }
    var readResult = bwRoute_(action, req);
    return bwJson_(bwOk_('Berhasil.', bwStripMeta_(readResult)));
  } catch (err2) {
    return bwJson_(bwErrObj_(err2));
  }
}

function setupDatabase() {
  CacheService.getScriptCache().remove(BW.SCHEMA_CACHE_KEY);
  bwEnsureDatabase_(true);
  return 'Buku Workspace database siap: ' + Object.keys(BW.TABLES).join(', ');
}

/* ================================ ROUTER ================================= */

function bwRoute_(action, req) {
  var data = (req && req.data && typeof req.data === 'object') ? req.data : {};
  var token = String(req.token || data.token || '').trim();

  switch (action) {
    case 'health': return { version: BW.VERSION, status: 'online' };
    case 'publicLanding': return bwPublicLanding_();
    case 'initApp': return bwInitApp_(token);
    case 'register': return bwRegister_(data);
    case 'login': return bwLogin_(data);
    case 'logout': return bwLogout_(token);
    case 'getBookDetail': return bwGetBookDetail_(String(data.book_id || req.book_id || '').trim(), token);
    case 'getUserDashboard': return bwGetUserDashboard_(String(data.user_id || req.user_id || '').trim(), token);
    case 'getAdminStats': return bwGetAdminStats_(token);

    case 'saveBook': return bwSaveBook_(bwRequireUser_(token), data);
    case 'deleteBook': return bwDeleteBook_(bwRequireUser_(token), data);
    case 'saveChapter': return bwSaveChapter_(bwRequireUser_(token), data);
    case 'deleteChapter': return bwDeleteChapter_(bwRequireUser_(token), data);
    case 'saveReadingLog': return bwSaveReadingLog_(bwRequireUser_(token), data);
    case 'deleteReadingLog': return bwDeleteReadingLog_(bwRequireUser_(token), data);
    case 'saveDiscussion': return bwSaveDiscussion_(bwRequireUser_(token), data);
    case 'toggleLikeDiscussion': return bwToggleLikeDiscussion_(bwRequireUser_(token), data);
    case 'togglePinDiscussion': return bwTogglePinDiscussion_(bwRequireUser_(token), data);
    case 'deleteDiscussion': return bwDeleteDiscussion_(bwRequireUser_(token), data);
    case 'saveQuiz': return bwSaveQuiz_(bwRequireUser_(token), data);
    case 'deleteQuiz': return bwDeleteQuiz_(bwRequireUser_(token), data);
    case 'submitQuizResult': return bwSubmitQuizResult_(bwRequireUser_(token), data);
    case 'saveUser': return bwSaveUser_(bwRequireUser_(token), data);
    case 'deleteUser': return bwDeleteUser_(bwRequireUser_(token), data);
    case 'updateSettings': return bwUpdateSettings_(bwRequireUser_(token), data);
    case 'uploadImage': return bwUploadImageAction_(bwRequireUser_(token), data);
    case 'deleteImage': return bwDeleteImageAction_(bwRequireUser_(token), data);
    default:
      throw bwErrObj_({ code: 'UNKNOWN_ACTION', message: 'Action tidak dikenali: ' + action });
  }
}

/* ============================ RESPONSE HELPERS ============================ */

function bwOk_(message, data) {
  return { success: true, message: String(message || 'OK'), data: data === undefined ? null : data, timestamp: bwNow_() };
}
function bwErr_(message, code, data) {
  return { success: false, message: String(message || 'Error'), code: String(code || 'ERROR'), data: data === undefined ? null : data, timestamp: bwNow_() };
}
function bwErrObj_(err) {
  var code = err && err.code ? String(err.code) : 'SERVER_ERROR';
  var msg = err && err.message ? String(err.message) : 'Terjadi kesalahan pada server.';
  try { console.error('[BW]', code, msg, err && err.stack ? err.stack : ''); } catch (e) {}
  return bwErr_(msg, code);
}
function bwJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function bwStripMeta_(obj) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj._message) {
    var c = {};
    Object.keys(obj).forEach(function (k) { if (k !== '_message') c[k] = obj[k]; });
    return c;
  }
  return obj;
}
function bwNow_() { return new Date().toISOString(); }
function bwId_(prefix) {
  return String(prefix || 'id') + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}
function bwClean_(v, max) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\u0000/g, '').trim();
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}
function bwEmail_(v) { return bwClean_(v, 120).toLowerCase(); }
function bwBool_(v, def) {
  if (v === true || v === false) return v;
  var s = String(v === undefined || v === null ? '' : v).toLowerCase().trim();
  if (['true','1','yes','ya'].indexOf(s) >= 0) return true;
  if (['false','0','no','tidak',''].indexOf(s) >= 0) return s === '' ? !!def : false;
  return !!def;
}
function bwInt_(v, def) {
  var n = parseInt(v, 10);
  return isFinite(n) ? n : (def || 0);
}
function bwNum_(v, def) {
  var n = Number(v);
  return isFinite(n) ? n : (def || 0);
}
function bwJsonParse_(s, fallback) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(String(s || '')); } catch (e) { return fallback; }
}
function bwClampText_(s, max) { s = String(s || ''); return s.length > max ? s.slice(0, max) : s; }
function bwEscHtml_(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ============================== SPREADSHEET ============================== */

function bwGetSs_() {
  var props = PropertiesService.getScriptProperties();
  var id = String(props.getProperty('SPREADSHEET_ID') || BW.DEFAULT_SETTINGS.drive_folder_id && '' || '').trim();
  // SPREADSHEET_ID may be stored explicitly
  id = String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) {}
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw bwErrObj_({ code: 'NO_SPREADSHEET', message: 'SPREADSHEET_ID belum diset dan script tidak terikat ke Spreadsheet.' });
}

function bwEnsureDatabase_(force) {
  var cache = CacheService.getScriptCache();
  if (!force) {
    var cached = cache.get(BW.SCHEMA_CACHE_KEY);
    if (cached === '1') return;
  }
  var ss = bwGetSs_();
  var tables = BW.TABLES;
  Object.keys(tables).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = tables[name];
    var lastCol = Math.max(sh.getLastColumn(), headers.length);
    var existing = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var needUpdate = false;
    for (var i = 0; i < headers.length; i++) {
      if (String(existing[i] || '').trim() !== headers[i]) { needUpdate = true; break; }
    }
    if (needUpdate) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#F1F5F9');
      sh.setFrozenRows(1);
    }
  });
  // Seed settings & admin if empty
  bwSeedDefaults_();
  cache.put(BW.SCHEMA_CACHE_KEY, '1', 600);
}

function bwSeedDefaults_() {
  var settings = bwReadTable_('Settings');
  if (!settings.length) {
    var rows = [];
    Object.keys(BW.DEFAULT_SETTINGS).forEach(function (k) {
      rows.push([k, BW.DEFAULT_SETTINGS[k]]);
    });
    bwAppendRows_('Settings', rows);
  } else {
    // ensure all keys exist
    var existing = {};
    settings.forEach(function (r) { existing[String(r.key)] = true; });
    var missing = [];
    Object.keys(BW.DEFAULT_SETTINGS).forEach(function (k) {
      if (!existing[k]) missing.push([k, BW.DEFAULT_SETTINGS[k]]);
    });
    if (missing.length) bwAppendRows_('Settings', missing);
  }

  var users = bwReadTable_('Users');
  if (!users.length) {
    var salt = bwSalt_();
    var now = bwNow_();
    var admin = {
      id: bwId_('USR'),
      name: 'Admin Buku Workspace',
      email: 'admin@bukuws.id',
      pin_hash: bwHashPin_('123456', salt),
      pin_salt: salt,
      role: 'admin',
      avatar_url: '',
      avatar_file_id: '',
      bio: 'Administrator ruang baca Buku Workspace.',
      status: 'active',
      created_at: now,
      updated_at: now
    };
    bwAppendRows_('Users', [bwObjToRow_('Users', admin)]);
  }
}

function bwSheet_(name) {
  var ss = bwGetSs_();
  var sh = ss.getSheetByName(name);
  if (!sh) { bwEnsureDatabase_(true); sh = ss.getSheetByName(name); }
  if (!sh) throw bwErrObj_({ code: 'SHEET_MISSING', message: 'Sheet tidak ditemukan: ' + name });
  return sh;
}

function bwReadTable_(name) {
  var sh = bwSheet_(name);
  var lastRow = sh.getLastRow();
  var headers = BW.TABLES[name];
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row) {
    var obj = {};
    for (var i = 0; i < headers.length; i++) obj[headers[i]] = row[i];
    return obj;
  }).filter(function (obj) {
    // skip fully empty rows
    return headers.some(function (h) { return String(obj[h] !== null && obj[h] !== undefined ? obj[h] : '').trim() !== ''; });
  });
}

function bwAppendRows_(name, rows2d) {
  if (!rows2d || !rows2d.length) return;
  var sh = bwSheet_(name);
  sh.getRange(sh.getLastRow() + 1, 1, rows2d.length, BW.TABLES[name].length).setValues(rows2d);
}

function bwObjToRow_(name, obj) {
  return BW.TABLES[name].map(function (h) {
    var v = obj[h];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  });
}

function bwUpdateRowById_(name, idField, idValue, patchObj) {
  var sh = bwSheet_(name);
  var headers = BW.TABLES[name];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  var idCol = headers.indexOf(idField) + 1;
  var ids = sh.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(idValue)) {
      var rowNum = i + 2;
      var current = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];
      var obj = {};
      headers.forEach(function (h, idx) { obj[h] = current[idx]; });
      Object.keys(patchObj).forEach(function (k) { if (headers.indexOf(k) >= 0) obj[k] = patchObj[k]; });
      sh.getRange(rowNum, 1, 1, headers.length).setValues([bwObjToRow_(name, obj)]);
      return obj;
    }
  }
  return null;
}

function bwDeleteRowById_(name, idField, idValue) {
  var sh = bwSheet_(name);
  var headers = BW.TABLES[name];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return false;
  var idCol = headers.indexOf(idField) + 1;
  var ids = sh.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(idValue)) {
      sh.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

function bwDeleteRowsByField_(name, field, value) {
  var sh = bwSheet_(name);
  var headers = BW.TABLES[name];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var col = headers.indexOf(field) + 1;
  if (col < 1) return 0;
  var vals = sh.getRange(2, col, lastRow - 1, 1).getValues();
  var deleted = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(value)) {
      sh.deleteRow(i + 2);
      deleted++;
    }
  }
  return deleted;
}

function bwFindById_(rows, id) {
  id = String(id || '');
  for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) return rows[i];
  return null;
}

/* ================================ AUTH =================================== */

function bwSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().slice(0, 8);
}

function bwHashPin_(pin, salt) {
  var raw = String(salt || '') + '::' + String(pin || '');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function bwSessionKey_(token) { return BW.SESSION_PREFIX + String(token || '').trim(); }

function bwNewSession_(user) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var payload = { userId: String(user.id), role: String(user.role || 'member'), authVersion: String(user.updated_at || user.created_at || '1') };
  CacheService.getScriptCache().put(bwSessionKey_(token), JSON.stringify(payload), BW.SESSION_TTL_SECONDS);
  return { token: token, expiresIn: BW.SESSION_TTL_SECONDS };
}

function bwRequireUser_(token) {
  token = String(token || '').trim();
  if (!token) throw bwErrObj_({ code: 'UNAUTHENTICATED', message: 'Sesi tidak ditemukan. Silakan login kembali.' });
  var raw = CacheService.getScriptCache().get(bwSessionKey_(token));
  if (!raw) throw bwErrObj_({ code: 'SESSION_EXPIRED', message: 'Sesi telah berakhir. Silakan login kembali.' });
  var sess = bwJsonParse_(raw, null);
  if (!sess || !sess.userId) throw bwErrObj_({ code: 'SESSION_INVALID', message: 'Sesi tidak valid.' });
  var users = bwReadTable_('Users');
  var user = bwFindById_(users, sess.userId);
  if (!user) throw bwErrObj_({ code: 'SESSION_INVALID', message: 'Pengguna tidak ditemukan. Silakan login kembali.' });
  if (String(user.status || 'active') !== 'active') throw bwErrObj_({ code: 'FORBIDDEN', message: 'Akun Anda nonaktif.' });
  return user;
}

function bwRequireAdmin_(user) {
  if (!user || String(user.role).toLowerCase() !== 'admin') {
    throw bwErrObj_({ code: 'FORBIDDEN', message: 'Aksi ini khusus Admin/Mentor.' });
  }
}

function bwIsAdmin_(user) { return user && String(user.role).toLowerCase() === 'admin'; }

function bwPublicUser_(u) {
  if (!u) return null;
  return {
    id: String(u.id || ''),
    name: String(u.name || ''),
    email: String(u.email || ''),
    role: String(u.role || 'member'),
    avatar_url: String(u.avatar_url || ''),
    bio: String(u.bio || ''),
    status: String(u.status || 'active'),
    created_at: String(u.created_at || '')
  };
}

function bwRateLimit_(key, maxAttempts, windowSec) {
  var cache = CacheService.getScriptCache();
  var ck = BW.RATE_PREFIX + key;
  var raw = cache.get(ck);
  var now = Date.now();
  var bucket = raw ? bwJsonParse_(raw, null) : null;
  if (!bucket || now > bucket.resetAt) bucket = { count: 0, resetAt: now + windowSec * 1000 };
  if (bucket.count >= maxAttempts) throw bwErrObj_({ code: 'RATE_LIMITED', message: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  bucket.count++;
  cache.put(ck, JSON.stringify(bucket), Math.max(60, Math.ceil((bucket.resetAt - now) / 1000)));
}
function bwClearRateLimit_(key) { try { CacheService.getScriptCache().remove(BW.RATE_PREFIX + key); } catch (e) {} }

function bwConfiguredAdminEmails_() {
  var raw = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '');
  return raw.split(/[;,\s]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
}
function bwIsConfiguredAdmin_(email) { return bwConfiguredAdminEmails_().indexOf(bwEmail_(email)) >= 0; }

/* ================================ SETTINGS =============================== */

function bwGetSettings_() {
  var rows = bwReadTable_('Settings');
  var obj = {};
  Object.keys(BW.DEFAULT_SETTINGS).forEach(function (k) { obj[k] = BW.DEFAULT_SETTINGS[k]; });
  rows.forEach(function (r) {
    var k = String(r.key || '').trim();
    if (k) obj[k] = String(r.value === undefined || r.value === null ? '' : r.value);
  });
  return obj;
}

function bwSaveSettings_(patch) {
  var current = bwGetSettings_();
  var keys = Object.keys(patch || {});
  keys.forEach(function (k) {
    if (!BW.DEFAULT_SETTINGS.hasOwnProperty(k)) return;
    var val = String(patch[k] === undefined || patch[k] === null ? '' : patch[k]);
    current[k] = val;
    var existing = bwUpdateRowById_('Settings', 'key', k, { key: k, value: val });
    if (!existing) bwAppendRows_('Settings', [[k, val]]);
  });
  return bwGetSettings_();
}

/* ============================ DRIVE IMAGE HELPERS ======================== */

function bwGetUploadFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = String(props.getProperty('DRIVE_FOLDER_ID') || bwGetSettings_().drive_folder_id || '').trim();
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  var name = 'Buku Workspace Uploads';
  var it = DriveApp.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  // persist for future
  try { PropertiesService.getScriptProperties().setProperty('DRIVE_FOLDER_ID', folder.getId()); } catch (e2) {}
  try { bwSaveSettings_({ drive_folder_id: folder.getId() }); } catch (e3) {}
  return folder;
}

function bwExtractDriveFileId_(url) {
  var s = String(url || '').trim();
  if (!s) return '';
  var m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return '';
}

function bwDriveUrlFromId_(fileId) {
  fileId = String(fileId || '').trim();
  if (!fileId) return '';
  return 'https://lh3.googleusercontent.com/d/' + fileId;
}

function bwDeleteDriveFile_(fileIdOrUrl) {
  var fileId = String(fileIdOrUrl || '').trim();
  if (!fileId) return false;
  if (fileId.indexOf('http') === 0) fileId = bwExtractDriveFileId_(fileId);
  if (!fileId) return false;
  try {
    var file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    return true;
  } catch (e) {
    console.warn('Delete drive file failed', fileId, e);
    return false;
  }
}

function bwUploadImageToDrive_(data, opts) {
  opts = opts || {};
  var base64 = String(data.image_base64 || data.base64 || data.cover_image_base64 || data.avatar_image_base64 || '').trim();
  var mimeType = String(data.mime_type || data.mimeType || '').trim().toLowerCase();
  var filename = bwClean_(data.filename || data.file_name || 'image', 120) || 'image';
  if (!base64) throw bwErrObj_({ code: 'VALIDATION', message: 'Data gambar (base64) wajib diisi.' });

  // strip data URL prefix
  var m = base64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (m) { mimeType = m[1].toLowerCase(); base64 = m[2]; }
  base64 = base64.replace(/\s+/g, '');

  var allowed = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  if (!allowed[mimeType]) {
    // try to infer from filename
    if (/\.png$/i.test(filename)) mimeType = 'image/png';
    else if (/\.webp$/i.test(filename)) mimeType = 'image/webp';
    else if (/\.gif$/i.test(filename)) mimeType = 'image/gif';
    else if (/\.jpe?g$/i.test(filename)) mimeType = 'image/jpeg';
  }
  if (!allowed[mimeType]) throw bwErrObj_({ code: 'VALIDATION', message: 'Format gambar harus JPG, PNG, WEBP, atau GIF.' });

  // size estimate
  var estBytes = Math.floor((base64.length * 3) / 4);
  if (estBytes > BW.MAX_IMAGE_BYTES) throw bwErrObj_({ code: 'VALIDATION', message: 'Ukuran gambar maksimal 4MB.' });

  var bytes;
  try { bytes = Utilities.base64Decode(base64); } catch (e) {
    throw bwErrObj_({ code: 'VALIDATION', message: 'Data base64 gambar tidak valid.' });
  }
  if (bytes.length > BW.MAX_IMAGE_BYTES) throw bwErrObj_({ code: 'VALIDATION', message: 'Ukuran gambar maksimal 4MB.' });

  var ext = allowed[mimeType];
  var safeName = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  var finalName = safeName + '-' + Utilities.getUuid().slice(0, 8) + '.' + ext;
  var blob = Utilities.newBlob(bytes, mimeType, finalName);

  var folder = bwGetUploadFolder_();
  // If replacing existing file, trash old
  var oldFileId = String(opts.replaceFileId || data.replace_file_id || data.old_file_id || '').trim();
  if (oldFileId) bwDeleteDriveFile_(oldFileId);

  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {
    // If sharing fails (domain policy), still return file id - display may be limited
    console.warn('setSharing failed', e2);
  }

  var fileId = file.getId();
  return {
    fileId: fileId,
    url: bwDriveUrlFromId_(fileId),
    name: finalName,
    mimeType: mimeType,
    size: bytes.length
  };
}

function bwUploadImageAction_(user, data) {
  // Any logged in user can upload (for avatar/journal); admin check not strictly required, but we keep it open for members.
  var result = bwUploadImageToDrive_(data, {});
  result._message = 'Gambar berhasil diunggah ke Google Drive.';
  return result;
}

function bwDeleteImageAction_(user, data) {
  var fileId = bwClean_(data.file_id || data.fileId || '', 120);
  var url = bwClean_(data.url || '', 500);
  if (!fileId && url) fileId = bwExtractDriveFileId_(url);
  if (!fileId) throw bwErrObj_({ code: 'VALIDATION', message: 'file_id atau url gambar wajib diisi.' });
  // Admin can delete any; member can delete only if it belongs to their avatar/log - for simplicity, allow admin or own avatar.
  if (!bwIsAdmin_(user)) {
    // check if this file belongs to user avatar
    if (String(user.avatar_file_id || '') !== fileId) {
      throw bwErrObj_({ code: 'FORBIDDEN', message: 'Anda tidak memiliki izin menghapus gambar ini.' });
    }
  }
  var ok = bwDeleteDriveFile_(fileId);
  return { deleted: ok, fileId: fileId, _message: ok ? 'Gambar berhasil dihapus.' : 'Gambar tidak ditemukan atau sudah dihapus.' };
}

/* ============================ AUTH ACTIONS =============================== */

function bwRegister_(data) {
  var settings = bwGetSettings_();
  if (!bwBool_(settings.allow_registration, true) && !data._adminCreate) {
    throw bwErrObj_({ code: 'FORBIDDEN', message: 'Pendaftaran publik sedang dinonaktifkan.' });
  }
  var name = bwClean_(data.name, 100);
  var email = bwEmail_(data.email);
  var pin = String(data.pin || data.password || '').trim();
  var bio = bwClean_(data.bio || 'Pembaca aktif di Buku Workspace', 300);

  if (name.length < 2) throw bwErrObj_({ code: 'VALIDATION', message: 'Nama minimal 2 karakter.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bwErrObj_({ code: 'VALIDATION', message: 'Format email tidak valid.' });
  if (!/^\d{6}$/.test(pin)) throw bwErrObj_({ code: 'VALIDATION', message: 'PIN harus 6 digit angka.' });

  bwRateLimit_('reg:' + email, 8, 3600);
  var users = bwReadTable_('Users');
  if (users.some(function (u) { return bwEmail_(u.email) === email; })) {
    throw bwErrObj_({ code: 'EMAIL_TAKEN', message: 'Email sudah terdaftar. Silakan login.' });
  }

  var isFirst = users.length === 0;
  var salt = bwSalt_();
  var now = bwNow_();
  var role = (isFirst || bwIsConfiguredAdmin_(email)) ? 'admin' : 'member';
  var user = {
    id: bwId_('USR'),
    name: name,
    email: email,
    pin_hash: bwHashPin_(pin, salt),
    pin_salt: salt,
    role: role,
    avatar_url: '',
    avatar_file_id: '',
    bio: bio,
    status: 'active',
    created_at: now,
    updated_at: now
  };

  // optional avatar upload on register
  if (data.avatar_image_base64) {
    try {
      var up = bwUploadImageToDrive_(data.avatar_image_base64 && typeof data.avatar_image_base64 === 'object' ? data.avatar_image_base64 : { image_base64: data.avatar_image_base64, filename: 'avatar-' + name });
      user.avatar_url = up.url;
      user.avatar_file_id = up.fileId;
    } catch (e) { console.warn('avatar upload failed', e); }
  }

  bwAppendRows_('Users', [bwObjToRow_('Users', user)]);
  bwClearRateLimit_('reg:' + email);
  var sess = bwNewSession_(user);
  return { _message: 'Akun berhasil dibuat. Selamat datang!', user: bwPublicUser_(user), token: sess.token, expiresIn: sess.expiresIn };
}

function bwLogin_(data) {
  var email = bwEmail_(data.email);
  var pin = String(data.pin || data.password || '').trim();
  if (!email || !pin) throw bwErrObj_({ code: 'VALIDATION', message: 'Email dan PIN wajib diisi.' });

  var users = bwReadTable_('Users');
  var user = null;
  for (var i = 0; i < users.length; i++) {
    if (bwEmail_(users[i].email) === email) { user = users[i]; break; }
  }
  var rlKey = 'login:' + (user ? String(user.id) : email);
  bwRateLimit_(rlKey, 10, 900);

  if (!user) throw bwErrObj_({ code: 'INVALID_CREDENTIALS', message: 'Email atau PIN tidak cocok.' });
  var hash = bwHashPin_(pin, String(user.pin_salt || ''));
  if (hash !== String(user.pin_hash || '')) throw bwErrObj_({ code: 'INVALID_CREDENTIALS', message: 'Email atau PIN tidak cocok.' });
  if (String(user.status || 'active') !== 'active') throw bwErrObj_({ code: 'FORBIDDEN', message: 'Akun Anda nonaktif. Hubungi admin.' });

  // auto-promote configured admin emails
  if (bwIsConfiguredAdmin_(user.email) && String(user.role).toLowerCase() !== 'admin') {
    bwUpdateRowById_('Users', 'id', user.id, { role: 'admin', updated_at: bwNow_() });
    user.role = 'admin';
  }

  bwClearRateLimit_(rlKey);
  var sess = bwNewSession_(user);
  return { _message: 'Login berhasil.', user: bwPublicUser_(user), token: sess.token, expiresIn: sess.expiresIn };
}

function bwLogout_(token) {
  token = String(token || '').trim();
  if (token) CacheService.getScriptCache().remove(bwSessionKey_(token));
  return { loggedOut: true, _message: 'Anda telah keluar.' };
}

/* ============================ DATA SHAPERS =============================== */

function bwUserMap_(users) {
  var m = {};
  users.forEach(function (u) { m[String(u.id)] = bwPublicUser_(u); });
  return m;
}

function bwShapeBook_(b, usersById) {
  var u = usersById ? usersById[String(b.created_by)] : null;
  return {
    id: String(b.id || ''),
    title: String(b.title || ''),
    author: String(b.author || ''),
    category: String(b.category || ''),
    total_pages: bwInt_(b.total_pages, 0),
    cover_url: String(b.cover_url || ''),
    cover_file_id: String(b.cover_file_id || ''),
    synopsis: String(b.synopsis || ''),
    status: String(b.status || 'active'),
    featured: bwBool_(b.featured, false),
    created_by: String(b.created_by || ''),
    created_by_name: u ? u.name : '',
    created_at: String(b.created_at || ''),
    updated_at: String(b.updated_at || '')
  };
}

function bwShapeChapter_(c) {
  return {
    id: String(c.id || ''),
    book_id: String(c.book_id || ''),
    chapter_number: bwInt_(c.chapter_number, 0),
    title: String(c.title || ''),
    content_html: String(c.content_html || ''),
    discussion_prompt: String(c.discussion_prompt || ''),
    read_time_mins: bwInt_(c.read_time_mins, 0),
    created_at: String(c.created_at || ''),
    updated_at: String(c.updated_at || '')
  };
}

function bwShapeLog_(l, usersById, booksById) {
  var u = usersById ? usersById[String(l.user_id)] : null;
  var b = booksById ? booksById[String(l.book_id)] : null;
  return {
    id: String(l.id || ''),
    user_id: String(l.user_id || ''),
    user_name: u ? u.name : 'Pembaca',
    user_avatar: u ? u.avatar_url : '',
    book_id: String(l.book_id || ''),
    book_title: b ? b.title : '',
    start_page: bwInt_(l.start_page, 0),
    end_page: bwInt_(l.end_page, 0),
    pages_read: bwInt_(l.pages_read, 0),
    duration_mins: bwInt_(l.duration_mins, 0),
    quote: String(l.quote || ''),
    reflection: String(l.reflection || ''),
    is_public: bwBool_(l.is_public, true),
    created_at: String(l.created_at || ''),
    updated_at: String(l.updated_at || '')
  };
}

function bwShapeDiscussion_(d, usersById) {
  var u = usersById ? usersById[String(d.user_id)] : null;
  var likes = bwJsonParse_(d.likes_json, []);
  if (!Array.isArray(likes)) likes = [];
  return {
    id: String(d.id || ''),
    book_id: String(d.book_id || ''),
    parent_id: String(d.parent_id || ''),
    user_id: String(d.user_id || ''),
    user_name: u ? u.name : 'Pembaca',
    user_avatar: u ? u.avatar_url : '',
    title: String(d.title || ''),
    content: String(d.content || ''),
    likes: likes.map(function (x) { return String(x); }),
    likes_count: likes.length,
    is_pinned: bwBool_(d.is_pinned, false),
    created_at: String(d.created_at || ''),
    updated_at: String(d.updated_at || '')
  };
}

function bwShapeQuiz_(q) {
  var questions = bwJsonParse_(q.questions_json, []);
  if (!Array.isArray(questions)) questions = [];
  return {
    id: String(q.id || ''),
    book_id: String(q.book_id || ''),
    title: String(q.title || ''),
    description: String(q.description || ''),
    questions: questions,
    question_count: questions.length,
    created_at: String(q.created_at || ''),
    updated_at: String(q.updated_at || '')
  };
}

function bwShapeQuizResult_(r, usersById) {
  var u = usersById ? usersById[String(r.user_id)] : null;
  return {
    id: String(r.id || ''),
    quiz_id: String(r.quiz_id || ''),
    user_id: String(r.user_id || ''),
    user_name: u ? u.name : 'Pembaca',
    score: bwInt_(r.score, 0),
    total_questions: bwInt_(r.total_questions, 0),
    answers_json: bwJsonParse_(r.answers_json, []),
    completed_at: String(r.completed_at || '')
  };
}

/* ============================ INIT / PUBLIC ============================== */

function bwPublicLanding_() {
  var settings = bwGetSettings_();
  var books = bwReadTable_('Books').map(function (b) { return bwShapeBook_(b, null); })
    .filter(function (b) { return b.status !== 'archived'; })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var users = bwReadTable_('Users');
  var logs = bwReadTable_('ReadingLogs');
  var discussions = bwReadTable_('Discussions').filter(function (d) { return !String(d.parent_id || '').trim(); });
  var stats = {
    members: users.filter(function (u) { return String(u.status) === 'active'; }).length,
    books: books.length,
    reading_logs: logs.length,
    discussions: discussions.length
  };
  return { settings: settings, featured_books: books.slice(0, 8), stats: stats };
}

function bwInitApp_(token) {
  var settings = bwGetSettings_();
  var users = bwReadTable_('Users');
  var usersById = bwUserMap_(users);
  var books = bwReadTable_('Books').map(function (b) { return bwShapeBook_(b, usersById); })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var booksById = {};
  books.forEach(function (b) { booksById[b.id] = b; });
  var chapters = bwReadTable_('Chapters').map(bwShapeChapter_)
    .sort(function (a, b) { return a.chapter_number - b.chapter_number; });
  var discussions = bwReadTable_('Discussions').map(function (d) { return bwShapeDiscussion_(d, usersById); })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var quizzes = bwReadTable_('Quizzes').map(bwShapeQuiz_)
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });

  var currentUser = null;
  var myLogs = [];
  var myQuizResults = [];
  if (token) {
    try {
      var u = bwRequireUser_(token);
      currentUser = bwPublicUser_(u);
      var allLogs = bwReadTable_('ReadingLogs');
      myLogs = allLogs.filter(function (l) { return String(l.user_id) === String(u.id); })
        .map(function (l) { return bwShapeLog_(l, usersById, booksById); })
        .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
      var allResults = bwReadTable_('QuizResults');
      myQuizResults = allResults.filter(function (r) { return String(r.user_id) === String(u.id); })
        .map(function (r) { return bwShapeQuizResult_(r, usersById); })
        .sort(function (a, b) { return String(b.completed_at).localeCompare(String(a.completed_at)); });
      // Admin gets full user list
      if (bwIsAdmin_(u)) {
        currentUser._isAdmin = true;
      }
    } catch (e) { /* token invalid - treat as guest */ }
  }

  // public logs for social proof/feed (only public)
  var publicLogs = bwReadTable_('ReadingLogs')
    .filter(function (l) { return bwBool_(l.is_public, true); })
    .map(function (l) { return bwShapeLog_(l, usersById, booksById); })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); })
    .slice(0, 30);

  var payload = {
    settings: settings,
    currentUser: currentUser,
    books: books,
    chapters: chapters,
    discussions: discussions,
    quizzes: quizzes,
    myLogs: myLogs,
    myQuizResults: myQuizResults,
    publicLogs: publicLogs,
    stats: {
      members: users.filter(function (u) { return String(u.status) === 'active'; }).length,
      books: books.length,
      discussions: discussions.filter(function (d) { return !d.parent_id; }).length,
      reading_logs: bwReadTable_('ReadingLogs').length
    }
  };

  // admin-only extras
  if (currentUser && String(currentUser.role).toLowerCase() === 'admin') {
    payload.users = users.map(bwPublicUser_);
    payload.allLogs = bwReadTable_('ReadingLogs').map(function (l) { return bwShapeLog_(l, usersById, booksById); })
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    payload.allQuizResults = bwReadTable_('QuizResults').map(function (r) { return bwShapeQuizResult_(r, usersById); });
  }

  return payload;
}

/* ========================== DETAIL / DASHBOARD =========================== */

function bwGetBookDetail_(bookId, token) {
  bookId = String(bookId || '').trim();
  if (!bookId) throw bwErrObj_({ code: 'VALIDATION', message: 'book_id wajib diisi.' });
  var users = bwReadTable_('Users');
  var usersById = bwUserMap_(users);
  var books = bwReadTable_('Books');
  var book = bwFindById_(books, bookId);
  if (!book) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Buku tidak ditemukan.' });
  var booksById = {}; booksById[bookId] = bwShapeBook_(book, usersById);
  var chapters = bwReadTable_('Chapters').filter(function (c) { return String(c.book_id) === bookId; })
    .map(bwShapeChapter_).sort(function (a, b) { return a.chapter_number - b.chapter_number; });
  var logs = bwReadTable_('ReadingLogs').filter(function (l) { return String(l.book_id) === bookId && bwBool_(l.is_public, true); })
    .map(function (l) { return bwShapeLog_(l, usersById, booksById); })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var discussions = bwReadTable_('Discussions').filter(function (d) { return String(d.book_id) === bookId; })
    .map(function (d) { return bwShapeDiscussion_(d, usersById); })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var quizzes = bwReadTable_('Quizzes').filter(function (q) { return String(q.book_id) === bookId; }).map(bwShapeQuiz_);
  return {
    book: bwShapeBook_(book, usersById),
    chapters: chapters,
    publicLogs: logs.slice(0, 50),
    discussions: discussions,
    quizzes: quizzes,
    stats: { chapters: chapters.length, logs: logs.length, discussions: discussions.filter(function(d){return !d.parent_id;}).length }
  };
}

function bwGetUserDashboard_(userId, token) {
  var actor = bwRequireUser_(token);
  userId = String(userId || actor.id).trim();
  if (String(actor.id) !== userId && !bwIsAdmin_(actor)) throw bwErrObj_({ code: 'FORBIDDEN', message: 'Tidak memiliki akses.' });
  var users = bwReadTable_('Users');
  var usersById = bwUserMap_(users);
  var books = bwReadTable_('Books').map(function (b) { return bwShapeBook_(b, usersById); });
  var booksById = {}; books.forEach(function (b) { booksById[b.id] = b; });
  var logs = bwReadTable_('ReadingLogs').filter(function (l) { return String(l.user_id) === userId; })
    .map(function (l) { return bwShapeLog_(l, usersById, booksById); })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var results = bwReadTable_('QuizResults').filter(function (r) { return String(r.user_id) === userId; })
    .map(function (r) { return bwShapeQuizResult_(r, usersById); });
  var pagesRead = logs.reduce(function (s, l) { return s + bwInt_(l.pages_read, 0); }, 0);
  var minutes = logs.reduce(function (s, l) { return s + bwInt_(l.duration_mins, 0); }, 0);
  // streak (days with logs)
  var daySet = {};
  logs.forEach(function (l) { var d = String(l.created_at || '').slice(0, 10); if (d) daySet[d] = true; });
  var streak = bwCalcStreak_(Object.keys(daySet));
  return {
    user: usersById[userId] || null,
    logs: logs,
    quizResults: results,
    stats: { totalLogs: logs.length, pagesRead: pagesRead, minutes: minutes, streak: streak, quizzes: results.length }
  };
}

function bwCalcStreak_(days) {
  if (!days.length) return 0;
  days.sort().reverse();
  var today = new Date();
  function fmt(d) { return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Jakarta', 'yyyy-MM-dd'); }
  var cur = fmt(today);
  var yesterday = new Date(today.getTime() - 86400000);
  var y = fmt(yesterday);
  // allow streak starting today or yesterday
  if (days.indexOf(cur) < 0 && days.indexOf(y) < 0) return 0;
  var count = 0;
  var ptr = new Date(days.indexOf(cur) >= 0 ? today.getTime() : yesterday.getTime());
  while (true) {
    var ds = fmt(ptr);
    if (days.indexOf(ds) >= 0) { count++; ptr = new Date(ptr.getTime() - 86400000); }
    else break;
  }
  return count;
}

function bwGetAdminStats_(token) {
  var actor = bwRequireUser_(token);
  bwRequireAdmin_(actor);
  var users = bwReadTable_('Users');
  var books = bwReadTable_('Books');
  var logs = bwReadTable_('ReadingLogs');
  var discussions = bwReadTable_('Discussions');
  var quizzes = bwReadTable_('Quizzes');
  var results = bwReadTable_('QuizResults');
  var pages = logs.reduce(function (s, l) { return s + bwInt_(l.pages_read, 0); }, 0);
  return {
    totals: {
      users: users.length,
      activeUsers: users.filter(function (u) { return String(u.status) === 'active'; }).length,
      books: books.length,
      chapters: bwReadTable_('Chapters').length,
      logs: logs.length,
      discussions: discussions.filter(function (d) { return !String(d.parent_id || '').trim(); }).length,
      replies: discussions.filter(function (d) { return !!String(d.parent_id || '').trim(); }).length,
      quizzes: quizzes.length,
      quizResults: results.length,
      pagesRead: pages
    },
    recentLogs: logs.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).slice(0, 10).map(function (l) {
      return bwShapeLog_(l, bwUserMap_(users), (function(){ var m={}; books.forEach(function(b){m[String(b.id)]=bwShapeBook_(b,null);}); return m; })());
    })
  };
}

/* ============================== BOOK CRUD ================================ */

function bwSaveBook_(actor, data) {
  bwRequireAdmin_(actor);
  var id = bwClean_(data.id, 60);
  var books = bwReadTable_('Books');
  var existing = id ? bwFindById_(books, id) : null;
  var now = bwNow_();

  var title = bwClean_(data.title, 200);
  var author = bwClean_(data.author, 120);
  var category = bwClean_(data.category, 80);
  var totalPages = Math.max(1, bwInt_(data.total_pages, 0));
  var synopsis = bwClean_(data.synopsis, 5000);
  var status = bwClean_(data.status || 'active', 30).toLowerCase();
  if (['active','upcoming','archived'].indexOf(status) < 0) status = 'active';
  var featured = bwBool_(data.featured, false);

  if (!title) throw bwErrObj_({ code: 'VALIDATION', message: 'Judul buku wajib diisi.' });
  if (!author) throw bwErrObj_({ code: 'VALIDATION', message: 'Penulis wajib diisi.' });

  var coverUrl = existing ? String(existing.cover_url || '') : '';
  var coverFileId = existing ? String(existing.cover_file_id || '') : '';

  // remove cover
  if (bwBool_(data.remove_cover, false)) {
    if (coverFileId) bwDeleteDriveFile_(coverFileId);
    coverUrl = ''; coverFileId = '';
  }

  // upload new cover
  var coverBase64 = data.cover_image_base64 || data.image_base64 || '';
  if (coverBase64) {
    var up = bwUploadImageToDrive_(
      typeof coverBase64 === 'object' ? coverBase64 : { image_base64: coverBase64, filename: data.cover_filename || ('cover-' + title), mime_type: data.cover_mime_type || data.mime_type || '' },
      { replaceFileId: coverFileId }
    );
    coverUrl = up.url;
    coverFileId = up.fileId;
  } else if (data.cover_url !== undefined && !bwBool_(data.remove_cover, false)) {
    // allow setting external URL (no fileId) - but only if explicitly provided
    var newUrl = bwClean_(data.cover_url, 500);
    if (newUrl && newUrl !== coverUrl) {
      // if replacing drive-managed image with external url, delete old managed file
      if (coverFileId && !newUrl.indexOf('lh3.googleusercontent.com/d/' + coverFileId)) {
        // keep
      }
      coverUrl = newUrl;
      if (!bwExtractDriveFileId_(newUrl)) { /* external url */ }
      else { coverFileId = bwExtractDriveFileId_(newUrl); }
    }
  }

  var obj = {
    id: existing ? String(existing.id) : bwId_('BK'),
    title: title,
    author: author,
    category: category,
    total_pages: totalPages,
    cover_url: coverUrl,
    cover_file_id: coverFileId,
    synopsis: synopsis,
    status: status,
    featured: featured ? 'true' : 'false',
    created_by: existing ? String(existing.created_by || actor.id) : String(actor.id),
    created_at: existing ? String(existing.created_at || now) : now,
    updated_at: now
  };

  if (existing) {
    bwUpdateRowById_('Books', 'id', obj.id, obj);
  } else {
    bwAppendRows_('Books', [bwObjToRow_('Books', obj)]);
  }

  var usersById = bwUserMap_(bwReadTable_('Users'));
  return { _message: existing ? 'Buku berhasil diperbarui.' : 'Buku berhasil ditambahkan.', book: bwShapeBook_(obj, usersById) };
}

function bwDeleteBook_(actor, data) {
  bwRequireAdmin_(actor);
  var id = bwClean_(data.id || data.book_id, 60);
  if (!id) throw bwErrObj_({ code: 'VALIDATION', message: 'id buku wajib diisi.' });
  var books = bwReadTable_('Books');
  var book = bwFindById_(books, id);
  if (!book) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Buku tidak ditemukan.' });

  // delete cover file
  if (String(book.cover_file_id || '')) bwDeleteDriveFile_(String(book.cover_file_id));

  // cascade delete related data
  bwDeleteRowsByField_('Chapters', 'book_id', id);
  bwDeleteRowsByField_('ReadingLogs', 'book_id', id);
  bwDeleteRowsByField_('Discussions', 'book_id', id);
  var quizzes = bwReadTable_('Quizzes').filter(function (q) { return String(q.book_id) === id; });
  quizzes.forEach(function (q) { bwDeleteRowsByField_('QuizResults', 'quiz_id', String(q.id)); });
  bwDeleteRowsByField_('Quizzes', 'book_id', id);
  bwDeleteRowById_('Books', 'id', id);

  return { _message: 'Buku dan data terkait berhasil dihapus.', id: id };
}

/* ============================= CHAPTER CRUD ============================== */

function bwSaveChapter_(actor, data) {
  bwRequireAdmin_(actor);
  var id = bwClean_(data.id, 60);
  var bookId = bwClean_(data.book_id, 60);
  if (!bookId) throw bwErrObj_({ code: 'VALIDATION', message: 'book_id wajib diisi.' });
  var book = bwFindById_(bwReadTable_('Books'), bookId);
  if (!book) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Buku tidak ditemukan.' });

  var chapters = bwReadTable_('Chapters');
  var existing = id ? bwFindById_(chapters, id) : null;
  var now = bwNow_();
  var title = bwClean_(data.title, 200);
  if (!title) throw bwErrObj_({ code: 'VALIDATION', message: 'Judul bab wajib diisi.' });
  var chapterNumber = Math.max(1, bwInt_(data.chapter_number, 1));
  var contentHtml = bwClampText_(String(data.content_html || ''), 200000);
  var discussionPrompt = bwClean_(data.discussion_prompt, 1000);
  var readTimeMins = Math.max(0, bwInt_(data.read_time_mins, 0));

  var obj = {
    id: existing ? String(existing.id) : bwId_('CH'),
    book_id: bookId,
    chapter_number: chapterNumber,
    title: title,
    content_html: contentHtml,
    discussion_prompt: discussionPrompt,
    read_time_mins: readTimeMins,
    created_at: existing ? String(existing.created_at || now) : now,
    updated_at: now
  };
  if (existing) bwUpdateRowById_('Chapters', 'id', obj.id, obj);
  else bwAppendRows_('Chapters', [bwObjToRow_('Chapters', obj)]);
  return { _message: existing ? 'Bab berhasil diperbarui.' : 'Bab berhasil ditambahkan.', chapter: bwShapeChapter_(obj) };
}

function bwDeleteChapter_(actor, data) {
  bwRequireAdmin_(actor);
  var id = bwClean_(data.id || data.chapter_id, 60);
  if (!id) throw bwErrObj_({ code: 'VALIDATION', message: 'id bab wajib diisi.' });
  var ok = bwDeleteRowById_('Chapters', 'id', id);
  if (!ok) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Bab tidak ditemukan.' });
  return { _message: 'Bab berhasil dihapus.', id: id };
}

/* =========================== READING LOG CRUD ============================ */

function bwSaveReadingLog_(actor, data) {
  var id = bwClean_(data.id, 60);
  var logs = bwReadTable_('ReadingLogs');
  var existing = id ? bwFindById_(logs, id) : null;
  if (existing && String(existing.user_id) !== String(actor.id) && !bwIsAdmin_(actor)) {
    throw bwErrObj_({ code: 'FORBIDDEN', message: 'Anda tidak dapat mengubah log ini.' });
  }

  var bookId = bwClean_(data.book_id, 60);
  if (!bookId) throw bwErrObj_({ code: 'VALIDATION', message: 'Pilih buku terlebih dahulu.' });
  var book = bwFindById_(bwReadTable_('Books'), bookId);
  if (!book) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Buku tidak ditemukan.' });

  var startPage = Math.max(0, bwInt_(data.start_page, 0));
  var endPage = Math.max(0, bwInt_(data.end_page, 0));
  if (endPage < startPage) throw bwErrObj_({ code: 'VALIDATION', message: 'Halaman akhir tidak boleh lebih kecil dari halaman awal.' });
  var pagesRead = bwInt_(data.pages_read, endPage - startPage);
  if (pagesRead <= 0) pagesRead = Math.max(0, endPage - startPage);
  var totalPages = Math.max(1, bwInt_(book.total_pages, 1));
  if (endPage > totalPages + 50) throw bwErrObj_({ code: 'VALIDATION', message: 'Halaman akhir melebihi total halaman buku.' });

  var durationMins = Math.max(0, bwInt_(data.duration_mins, 0));
  var quote = bwClean_(data.quote, 1000);
  var reflection = bwClean_(data.reflection, 5000);
  var isPublic = bwBool_(data.is_public, true);
  var now = bwNow_();

  var obj = {
    id: existing ? String(existing.id) : bwId_('LOG'),
    user_id: existing ? String(existing.user_id) : String(actor.id),
    book_id: bookId,
    start_page: startPage,
    end_page: endPage,
    pages_read: pagesRead,
    duration_mins: durationMins,
    quote: quote,
    reflection: reflection,
    is_public: isPublic ? 'true' : 'false',
    created_at: existing ? String(existing.created_at || now) : now,
    updated_at: now
  };
  if (existing) bwUpdateRowById_('ReadingLogs', 'id', obj.id, obj);
  else bwAppendRows_('ReadingLogs', [bwObjToRow_('ReadingLogs', obj)]);

  var usersById = bwUserMap_(bwReadTable_('Users'));
  var booksById = {}; booksById[bookId] = bwShapeBook_(book, usersById);
  return { _message: existing ? 'Log baca berhasil diperbarui.' : 'Log baca berhasil disimpan.', log: bwShapeLog_(obj, usersById, booksById) };
}

function bwDeleteReadingLog_(actor, data) {
  var id = bwClean_(data.id || data.log_id, 60);
  if (!id) throw bwErrObj_({ code: 'VALIDATION', message: 'id log wajib diisi.' });
  var logs = bwReadTable_('ReadingLogs');
  var existing = bwFindById_(logs, id);
  if (!existing) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Log baca tidak ditemukan.' });
  if (String(existing.user_id) !== String(actor.id) && !bwIsAdmin_(actor)) {
    throw bwErrObj_({ code: 'FORBIDDEN', message: 'Anda tidak dapat menghapus log ini.' });
  }
  bwDeleteRowById_('ReadingLogs', 'id', id);
  return { _message: 'Log baca berhasil dihapus.', id: id };
}

/* =========================== DISCUSSION CRUD ============================= */

function bwSaveDiscussion_(actor, data) {
  var id = bwClean_(data.id, 60);
  var discussions = bwReadTable_('Discussions');
  var existing = id ? bwFindById_(discussions, id) : null;
  if (existing && String(existing.user_id) !== String(actor.id) && !bwIsAdmin_(actor)) {
    throw bwErrObj_({ code: 'FORBIDDEN', message: 'Anda tidak dapat mengubah diskusi ini.' });
  }
  var now = bwNow_();
  var bookId = bwClean_(data.book_id, 60);
  var parentId = bwClean_(data.parent_id, 60);
  var title = bwClean_(data.title, 200);
  var content = bwClean_(data.content, 5000);
  if (!content) throw bwErrObj_({ code: 'VALIDATION', message: 'Isi diskusi wajib diisi.' });
  if (!parentId && !title) throw bwErrObj_({ code: 'VALIDATION', message: 'Judul topik wajib diisi.' });
  if (bookId && !bwFindById_(bwReadTable_('Books'), bookId)) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Buku tidak ditemukan.' });
  if (parentId) {
    var parent = bwFindById_(discussions, parentId);
    if (!parent) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Topik induk tidak ditemukan.' });
  }

  var obj = {
    id: existing ? String(existing.id) : bwId_('DSC'),
    book_id: bookId,
    parent_id: parentId,
    user_id: existing ? String(existing.user_id) : String(actor.id),
    title: parentId ? '' : title,
    content: content,
    likes_json: existing ? String(existing.likes_json || '[]') : '[]',
    is_pinned: existing ? String(existing.is_pinned || 'false') : 'false',
    created_at: existing ? String(existing.created_at || now) : now,
    updated_at: now
  };
  if (existing) bwUpdateRowById_('Discussions', 'id', obj.id, obj);
  else bwAppendRows_('Discussions', [bwObjToRow_('Discussions', obj)]);
  var usersById = bwUserMap_(bwReadTable_('Users'));
  return { _message: existing ? 'Diskusi diperbarui.' : (parentId ? 'Balasan terkirim.' : 'Topik diskusi dibuat.'), discussion: bwShapeDiscussion_(obj, usersById) };
}

function bwToggleLikeDiscussion_(actor, data) {
  var id = bwClean_(data.id || data.discussion_id, 60);
  if (!id) throw bwErrObj_({ code: 'VALIDATION', message: 'id diskusi wajib diisi.' });
  var rows = bwReadTable_('Discussions');
  var d = bwFindById_(rows, id);
  if (!d) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Diskusi tidak ditemukan.' });
  var likes = bwJsonParse_(d.likes_json, []);
  if (!Array.isArray(likes)) likes = [];
  var uid = String(actor.id);
  var idx = likes.map(String).indexOf(uid);
  if (idx >= 0) likes.splice(idx, 1); else likes.push(uid);
  bwUpdateRowById_('Discussions', 'id', id, { likes_json: JSON.stringify(likes), updated_at: bwNow_() });
  return { _message: idx >= 0 ? 'Like dibatalkan.' : 'Diskusi disukai.', id: id, likes: likes, likes_count: likes.length, liked: idx < 0 };
}

function bwTogglePinDiscussion_(actor, data) {
  bwRequireAdmin_(actor);
  var id = bwClean_(data.id || data.discussion_id, 60);
  var d = bwFindById_(bwReadTable_('Discussions'), id);
  if (!d) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Diskusi tidak ditemukan.' });
  if (String(d.parent_id || '').trim()) throw bwErrObj_({ code: 'VALIDATION', message: 'Hanya topik utama yang bisa dipin.' });
  var pinned = !bwBool_(d.is_pinned, false);
  bwUpdateRowById_('Discussions', 'id', id, { is_pinned: pinned ? 'true' : 'false', updated_at: bwNow_() });
  return { _message: pinned ? 'Topik dipin.' : 'Pin dilepas.', id: id, is_pinned: pinned };
}

function bwDeleteDiscussion_(actor, data) {
  var id = bwClean_(data.id || data.discussion_id, 60);
  var d = bwFindById_(bwReadTable_('Discussions'), id);
  if (!d) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Diskusi tidak ditemukan.' });
  if (String(d.user_id) !== String(actor.id) && !bwIsAdmin_(actor)) {
    throw bwErrObj_({ code: 'FORBIDDEN', message: 'Anda tidak dapat menghapus diskusi ini.' });
  }
  // delete replies if top-level
  if (!String(d.parent_id || '').trim()) {
    bwDeleteRowsByField_('Discussions', 'parent_id', id);
  }
  bwDeleteRowById_('Discussions', 'id', id);
  return { _message: 'Diskusi berhasil dihapus.', id: id };
}

/* ============================== QUIZ CRUD ================================ */

function bwSaveQuiz_(actor, data) {
  bwRequireAdmin_(actor);
  var id = bwClean_(data.id, 60);
  var quizzes = bwReadTable_('Quizzes');
  var existing = id ? bwFindById_(quizzes, id) : null;
  var bookId = bwClean_(data.book_id, 60);
  if (!bookId) throw bwErrObj_({ code: 'VALIDATION', message: 'book_id wajib diisi.' });
  if (!bwFindById_(bwReadTable_('Books'), bookId)) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Buku tidak ditemukan.' });
  var title = bwClean_(data.title, 200);
  if (!title) throw bwErrObj_({ code: 'VALIDATION', message: 'Judul kuis wajib diisi.' });
  var description = bwClean_(data.description, 1000);
  var questions = data.questions_json || data.questions || [];
  if (typeof questions === 'string') questions = bwJsonParse_(questions, []);
  if (!Array.isArray(questions)) throw bwErrObj_({ code: 'VALIDATION', message: 'Format soal tidak valid.' });
  // sanitize questions
  questions = questions.map(function (q, i) {
    var opts = Array.isArray(q.options) ? q.options.map(function (o) { return bwClean_(o, 300); }).filter(function(o){return o;}) : [];
    return {
      id: bwClean_(q.id || ('Q' + (i + 1)), 40),
      question: bwClean_(q.question, 1000),
      options: opts.slice(0, 6),
      correctIndex: Math.max(0, bwInt_(q.correctIndex, 0)),
      explanation: bwClean_(q.explanation, 1000)
    };
  }).filter(function (q) { return q.question && q.options.length >= 2; });

  var now = bwNow_();
  var obj = {
    id: existing ? String(existing.id) : bwId_('QZ'),
    book_id: bookId,
    title: title,
    description: description,
    questions_json: JSON.stringify(questions),
    created_at: existing ? String(existing.created_at || now) : now,
    updated_at: now
  };
  if (existing) bwUpdateRowById_('Quizzes', 'id', obj.id, obj);
  else bwAppendRows_('Quizzes', [bwObjToRow_('Quizzes', obj)]);
  return { _message: existing ? 'Kuis diperbarui.' : 'Kuis dibuat.', quiz: bwShapeQuiz_(obj) };
}

function bwDeleteQuiz_(actor, data) {
  bwRequireAdmin_(actor);
  var id = bwClean_(data.id || data.quiz_id, 60);
  if (!id) throw bwErrObj_({ code: 'VALIDATION', message: 'id kuis wajib diisi.' });
  bwDeleteRowsByField_('QuizResults', 'quiz_id', id);
  var ok = bwDeleteRowById_('Quizzes', 'id', id);
  if (!ok) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Kuis tidak ditemukan.' });
  return { _message: 'Kuis berhasil dihapus.', id: id };
}

function bwSubmitQuizResult_(actor, data) {
  var quizId = bwClean_(data.quiz_id, 60);
  var quiz = bwFindById_(bwReadTable_('Quizzes'), quizId);
  if (!quiz) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Kuis tidak ditemukan.' });
  var questions = bwJsonParse_(quiz.questions_json, []);
  if (!Array.isArray(questions)) questions = [];
  var answers = data.answers_json || data.answers || [];
  if (typeof answers === 'string') answers = bwJsonParse_(answers, []);
  if (!Array.isArray(answers)) answers = [];

  var correct = 0;
  var detail = questions.map(function (q, i) {
    var selected = bwInt_(answers[i], -1);
    var ok = selected === bwInt_(q.correctIndex, -1);
    if (ok) correct++;
    return { questionId: q.id, selected: selected, correctIndex: bwInt_(q.correctIndex, 0), isCorrect: ok };
  });
  var total = questions.length;
  var score = total > 0 ? Math.round((correct / total) * 100) : 0;
  var now = bwNow_();
  var obj = {
    id: bwId_('QR'),
    quiz_id: quizId,
    user_id: String(actor.id),
    score: score,
    total_questions: total,
    answers_json: JSON.stringify(detail),
    completed_at: now
  };
  bwAppendRows_('QuizResults', [bwObjToRow_('QuizResults', obj)]);
  return { _message: 'Hasil kuis tersimpan.', result: bwShapeQuizResult_(obj, bwUserMap_(bwReadTable_('Users'))), correct: correct, total: total, score: score };
}

/* ============================== USER CRUD ================================ */

function bwSaveUser_(actor, data) {
  var id = bwClean_(data.id, 60);
  var users = bwReadTable_('Users');
  var existing = id ? bwFindById_(users, id) : null;
  var isSelf = existing && String(existing.id) === String(actor.id);
  if (!bwIsAdmin_(actor) && !isSelf) throw bwErrObj_({ code: 'FORBIDDEN', message: 'Anda tidak memiliki akses.' });
  if (!existing && !bwIsAdmin_(actor)) throw bwErrObj_({ code: 'FORBIDDEN', message: 'Hanya admin yang dapat menambah pengguna.' });

  var now = bwNow_();
  var name = bwClean_(data.name, 100);
  var email = bwEmail_(data.email);
  var bio = bwClean_(data.bio, 500);
  var status = bwClean_(data.status || 'active', 20).toLowerCase();
  if (['active','inactive'].indexOf(status) < 0) status = 'active';
  var role = bwClean_(data.role || 'member', 20).toLowerCase();
  if (['admin','member'].indexOf(role) < 0) role = 'member';

  if (!name || name.length < 2) throw bwErrObj_({ code: 'VALIDATION', message: 'Nama minimal 2 karakter.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bwErrObj_({ code: 'VALIDATION', message: 'Email tidak valid.' });

  // email uniqueness
  var emailClash = users.some(function (u) { return String(u.id) !== String(id || '') && bwEmail_(u.email) === email; });
  if (emailClash) throw bwErrObj_({ code: 'EMAIL_TAKEN', message: 'Email sudah digunakan pengguna lain.' });

  // non-admin cannot change role/status
  if (!bwIsAdmin_(actor)) { role = String(existing.role || 'member'); status = String(existing.status || 'active'); }

  var obj = {};
  if (existing) {
    obj = JSON.parse(JSON.stringify(existing));
    obj.name = name; obj.email = email; obj.bio = bio; obj.role = role; obj.status = status; obj.updated_at = now;
  } else {
    var pin = String(data.pin || '123456').trim();
    if (!/^\d{6}$/.test(pin)) throw bwErrObj_({ code: 'VALIDATION', message: 'PIN harus 6 digit angka.' });
    var salt = bwSalt_();
    obj = {
      id: bwId_('USR'), name: name, email: email, pin_hash: bwHashPin_(pin, salt), pin_salt: salt,
      role: role, avatar_url: '', avatar_file_id: '', bio: bio, status: status, created_at: now, updated_at: now
    };
  }

  // PIN change
  if (existing && data.pin) {
    var newPin = String(data.pin).trim();
    if (!/^\d{6}$/.test(newPin)) throw bwErrObj_({ code: 'VALIDATION', message: 'PIN baru harus 6 digit angka.' });
    // self needs old pin unless admin
    if (isSelf && !bwIsAdmin_(actor)) {
      var oldPin = String(data.old_pin || '').trim();
      if (!oldPin) throw bwErrObj_({ code: 'VALIDATION', message: 'PIN lama wajib diisi untuk mengganti PIN.' });
      if (bwHashPin_(oldPin, String(existing.pin_salt || '')) !== String(existing.pin_hash || '')) {
        throw bwErrObj_({ code: 'INVALID_CREDENTIALS', message: 'PIN lama tidak cocok.' });
      }
    }
    var newSalt = bwSalt_();
    obj.pin_salt = newSalt;
    obj.pin_hash = bwHashPin_(newPin, newSalt);
  }

  // avatar remove
  if (bwBool_(data.remove_avatar, false)) {
    if (String(obj.avatar_file_id || '')) bwDeleteDriveFile_(String(obj.avatar_file_id));
    obj.avatar_url = ''; obj.avatar_file_id = '';
  }
  // avatar upload
  var avatarBase64 = data.avatar_image_base64 || data.image_base64 || '';
  if (avatarBase64) {
    var up = bwUploadImageToDrive_(
      typeof avatarBase64 === 'object' ? avatarBase64 : { image_base64: avatarBase64, filename: data.avatar_filename || ('avatar-' + name), mime_type: data.avatar_mime_type || data.mime_type || '' },
      { replaceFileId: String(obj.avatar_file_id || '') }
    );
    obj.avatar_url = up.url;
    obj.avatar_file_id = up.fileId;
  }

  if (existing) bwUpdateRowById_('Users', 'id', obj.id, obj);
  else bwAppendRows_('Users', [bwObjToRow_('Users', obj)]);
  return { _message: existing ? 'Pengguna berhasil diperbarui.' : 'Pengguna berhasil ditambahkan.', user: bwPublicUser_(obj) };
}

function bwDeleteUser_(actor, data) {
  bwRequireAdmin_(actor);
  var id = bwClean_(data.id || data.user_id, 60);
  if (!id) throw bwErrObj_({ code: 'VALIDATION', message: 'id pengguna wajib diisi.' });
  if (String(id) === String(actor.id)) throw bwErrObj_({ code: 'VALIDATION', message: 'Anda tidak dapat menghapus akun sendiri.' });
  var users = bwReadTable_('Users');
  var target = bwFindById_(users, id);
  if (!target) throw bwErrObj_({ code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan.' });
  // prevent deleting last admin
  var admins = users.filter(function (u) { return String(u.role).toLowerCase() === 'admin' && String(u.status) === 'active'; });
  if (String(target.role).toLowerCase() === 'admin' && admins.length <= 1) {
    throw bwErrObj_({ code: 'VALIDATION', message: 'Tidak dapat menghapus admin terakhir.' });
  }
  if (String(target.avatar_file_id || '')) bwDeleteDriveFile_(String(target.avatar_file_id));
  bwDeleteRowById_('Users', 'id', id);
  // clean up user data
  bwDeleteRowsByField_('ReadingLogs', 'user_id', id);
  bwDeleteRowsByField_('QuizResults', 'user_id', id);
  // discussions: keep but anonymize? simpler delete their discussions/replies
  var discs = bwReadTable_('Discussions').filter(function (d) { return String(d.user_id) === id; });
  discs.forEach(function (d) {
    if (!String(d.parent_id || '').trim()) bwDeleteRowsByField_('Discussions', 'parent_id', String(d.id));
    bwDeleteRowById_('Discussions', 'id', String(d.id));
  });
  return { _message: 'Pengguna berhasil dihapus.', id: id };
}

/* ============================= SETTINGS CRUD ============================= */

function bwUpdateSettings_(actor, data) {
  bwRequireAdmin_(actor);
  var patch = {};
  var allowed = Object.keys(BW.DEFAULT_SETTINGS);
  allowed.forEach(function (k) {
    if (data[k] !== undefined) patch[k] = bwClean_(data[k], 1000);
  });

  // logo upload
  if (data.logo_image_base64) {
    var oldLogo = bwGetSettings_().logo_url;
    var oldLogoId = bwExtractDriveFileId_(oldLogo);
    var upLogo = bwUploadImageToDrive_(typeof data.logo_image_base64 === 'object' ? data.logo_image_base64 : { image_base64: data.logo_image_base64, filename: 'logo-workspace' }, { replaceFileId: oldLogoId });
    patch.logo_url = upLogo.url;
  }
  if (bwBool_(data.remove_logo, false)) {
    var curLogo = bwGetSettings_().logo_url;
    var lid = bwExtractDriveFileId_(curLogo);
    if (lid) bwDeleteDriveFile_(lid);
    patch.logo_url = '';
  }
  // hero upload
  if (data.hero_image_base64) {
    var oldHero = bwGetSettings_().hero_image_url;
    var oldHeroId = bwExtractDriveFileId_(oldHero);
    var upHero = bwUploadImageToDrive_(typeof data.hero_image_base64 === 'object' ? data.hero_image_base64 : { image_base64: data.hero_image_base64, filename: 'hero-workspace' }, { replaceFileId: oldHeroId });
    patch.hero_image_url = upHero.url;
  }
  if (bwBool_(data.remove_hero, false)) {
    var curHero = bwGetSettings_().hero_image_url;
    var hid = bwExtractDriveFileId_(curHero);
    if (hid) bwDeleteDriveFile_(hid);
    patch.hero_image_url = '';
  }

  var settings = bwSaveSettings_(patch);
  return { _message: 'Pengaturan workspace diperbarui.', settings: settings };
}

// PRD alias
function initialSetup() { return setupDatabase(); }
