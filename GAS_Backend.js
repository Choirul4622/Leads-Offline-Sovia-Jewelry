/**
 * ==============================================================================
 * GOOGLE APPS SCRIPT BACKEND
 * ==============================================================================
 * Instruksi:
 * 1. Buka Google Sheets baru.
 * 2. Buka menu Ekstensi > Apps Script.
 * 3. Hapus semua kode default dan paste kode di bawah ini.
 * 4. (OPSIONAL TAPI SANGAT DISARANKAN) Di bagian atas editor Apps Script, pilih fungsi `initialSetup` pada dropdown, lalu klik tombol "Jalankan" (Run). Ini akan otomatis membuat sheet 'Users', 'Stores', dan 'Visits' dengan format kolom yang benar.
 * 5. Klik "Terapkan" (Deploy) > "Deployment Baru" > Pilih jenis "Aplikasi Web".
 *    - Akses: Siapa saja (Anyone)
 * 6. Salin URL Aplikasi Web yang diberikan, dan masukkan ke file 'js/sync.js' pada variabel GAS_URL.
 * ==============================================================================
 */

/**
 * Fungsi ini digunakan untuk membuat sheet beserta header kolomnya secara otomatis.
 * Jalankan fungsi ini SATU KALI SAJA dari editor Apps Script sebelum melakukan deploy.
 */
function initialSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Setup Users Sheet
  var userSheet = ss.getSheetByName("Users");
  if (!userSheet) {
    userSheet = ss.insertSheet("Users");
    userSheet.appendRow(["ID", "Username", "Password", "Role", "StoreName"]);
    // Tambahkan 1 akun admin default agar bisa login pertama kali
    userSheet.appendRow(["U-001", "admin", "admin123", "Admin", "Semua Store"]);
  }
  
  // Setup Stores Sheet
  var storeSheet = ss.getSheetByName("Stores");
  if (!storeSheet) {
    storeSheet = ss.insertSheet("Stores");
    storeSheet.appendRow(["StoreName", "Target"]);
  }
  
  // Setup Visits Sheet
  var visitSheet = ss.getSheetByName("Visits");
  if (!visitSheet) {
    visitSheet = ss.insertSheet("Visits");
    visitSheet.appendRow(["ID", "Timestamp", "User", "StoreName", "VisitBaru", "DealsOffline", "DealsReferal", "DealsBox", "TotalDeals", "KonversiDeals", "VisitRepair", "VisitBuyback", "PengambilanBaru", "PengambilanRepair", "QtyCincin", "Omset", "KonversiOmset"]);
  }
  
  // Hapus "Sheet1" bawaan jika ada dan kosong
  var defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // Tunggu sampai 10 detik agar tidak ada tabrakan

  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var action = data.action;
    var payload = data.data;

    var result = { status: "error", message: "Unknown action" };

    if (action === "addVisit") {
      result = processAddVisit(payload);
    } else if (action === "saveStoreTarget") {
      result = processSaveStoreTarget(payload);
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var action = e.parameter.action;
  
  if (action === "getInitialData") {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      
      // Ambil data Users
      var userSheet = ss.getSheetByName("Users");
      var users = [];
      if (userSheet) {
        var userData = userSheet.getDataRange().getValues();
        // Skip header
        for (var i = 1; i < userData.length; i++) {
          users.push({
            id: userData[i][0],
            username: userData[i][1],
            password: userData[i][2],
            role: userData[i][3],
            storeName: userData[i][4]
          });
        }
      }
      
      // Ambil data Stores target
      var storeSheet = ss.getSheetByName("Stores");
      var stores = [];
      if (storeSheet) {
        var storeData = storeSheet.getDataRange().getValues();
        for (var j = 1; j < storeData.length; j++) {
          stores.push({
            storeName: storeData[j][0],
            target: storeData[j][1]
          });
        }
      }

      // Ambil data Visits (Terbaru) - Batasi 100 terakhir agar cepat
      var visitSheet = ss.getSheetByName("Visits");
      var recentVisits = [];
      if (visitSheet) {
        var visitData = visitSheet.getDataRange().getValues();
        // Ambil dari bawah ke atas, skip header
        var count = 0;
        for (var k = visitData.length - 1; k > 0 && count < 100; k--) {
          var row = visitData[k];
          recentVisits.push({
            id: row[0],
            timestamp: row[1],
            user: row[2],
            storeName: row[3],
            visitBaru: row[4],
            dealsOffline: row[5],
            dealsReferal: row[6],
            dealsBox: row[7],
            totalDeals: row[8],
            konversiDeals: row[9],
            visitRepair: row[10],
            visitBuyback: row[11],
            pengambilanBaru: row[12],
            pengambilanRepair: row[13],
            qtyCincin: row[14],
            omset: row[15],
            konversiOmset: row[16]
          });
          count++;
        }
      }
      
      var result = {
        status: "success",
        users: users,
        stores: stores,
        recentVisits: recentVisits
      };
      
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
        
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", error: err.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Invalid GET action" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Helper untuk addVisit
function processAddVisit(payload) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Visits");
  
  // Jika sheet belum ada buatkan formatnya
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("Visits");
    sheet.appendRow(["ID", "Timestamp", "User", "StoreName", "VisitBaru", "DealsOffline", "DealsReferal", "DealsBox", "TotalDeals", "KonversiDeals", "VisitRepair", "VisitBuyback", "PengambilanBaru", "PengambilanRepair", "QtyCincin", "Omset", "KonversiOmset"]);
  }

  // Buat ID unik
  var id = new Date().getTime() + "-" + Math.floor(Math.random() * 1000);
  
  sheet.appendRow([
    id,
    payload.timestamp,
    payload.user,
    payload.storeName,
    payload.visitBaru,
    payload.dealsOffline,
    payload.dealsReferal,
    payload.dealsBox,
    payload.totalDeals,
    payload.konversiDeals,
    payload.visitRepair,
    payload.visitBuyback,
    payload.pengambilanBaru,
    payload.pengambilanRepair,
    payload.qtyCincin,
    payload.omset,
    payload.konversiOmset
  ]);
  
  return { status: "success", message: "Visit data inserted" };
}

// Helper untuk saveStoreTarget
function processSaveStoreTarget(payload) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Stores");
  
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("Stores");
    sheet.appendRow(["StoreName", "Target"]);
  }
  
  var data = sheet.getDataRange().getValues();
  var found = false;
  
  // Update jika sudah ada
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === payload.storeName) {
      sheet.getRange(i + 1, 2).setValue(payload.target);
      found = true;
      break;
    }
  }
  
  // Insert jika belum ada
  if (!found) {
    sheet.appendRow([payload.storeName, payload.target]);
  }
  
  return { status: "success", message: "Store target updated" };
}
