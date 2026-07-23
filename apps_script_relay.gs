// ============================================================================
//  Water-Level Firebase Relay  —  Google Apps Script Web App
// ============================================================================
//  WHY THIS EXISTS
//  The SIM800L cannot reliably complete a TLS handshake directly with Firebase
//  on weak 2G. This script runs on Google's servers: the ESP posts to THIS
//  script's URL, and the script forwards the data to Firebase over HTTPS from
//  Google's infrastructure (where TLS always works and is fast).
//
//  HOW TO DEPLOY
//  1. Go to https://script.google.com  ->  New project
//  2. Delete the sample code, paste ALL of this file in.
//  3. Click "Deploy" -> "New deployment".
//  4. Click the gear icon -> select "Web app".
//  5. Set:
//        Description:      water-level relay
//        Execute as:       Me (your account)
//        Who has access:   Anyone                <-- REQUIRED (ESP has no login)
//  6. Click "Deploy". Authorize when prompted (choose your account ->
//     "Advanced" -> "Go to <project> (unsafe)" -> Allow). This is safe; it is
//     only warning because the script is yours and unverified.
//  7. Copy the "Web app URL" (looks like:
//        https://script.google.com/macros/s/AKfy..../exec )
//     and paste it into water_level.ino as the relayURL.
//
//  TEST IT (from a browser or phone, no ESP needed):
//     Paste the /exec URL in a browser -> should show: Water-level relay OK
//     That proves the deployment works before you touch the hardware.
// ============================================================================

// Your Firebase Realtime Database history endpoint (unchanged from the sketch).
var FIREBASE_URL =
  "https://water-level-ae453-default-rtdb.asia-southeast1.firebasedatabase.app/water_monitor/history.json";

// Handles the POST the ESP sends. Forwards the JSON body to Firebase.
function doPost(e) {
  try {
    // The ESP sends the raw JSON as the POST body.
    var payload = e.postData.contents;

    var response = UrlFetchApp.fetch(FIREBASE_URL, {
      method: "post",
      contentType: "application/json",
      payload: payload,
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();

    // Return a short, easy-to-parse result the ESP can check for.
    if (code === 200 || code === 201) {
      return ContentService.createTextOutput("OK");
    }
    return ContentService.createTextOutput("ERR " + code);
  } catch (err) {
    return ContentService.createTextOutput("ERR " + err);
  }
}

// Lets you open the /exec URL in a browser to confirm the deployment is live.
function doGet(e) {
  return ContentService.createTextOutput("Water-level relay OK");
}
