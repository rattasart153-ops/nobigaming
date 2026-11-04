/** Nobi Topup Apps Script HTTP entry point.
 * Browser traffic belongs to the Vercel REST API. This project exposes no embedded browser UI.
 * Do not deploy until the Sheets/Drive migration and runtime verification are complete.
 */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok:true,
    service:'Nobi Topup Apps Script Gateway',
    version:1,
    transport:'signed-post'
  })).setMimeType(ContentService.MimeType.JSON);
}
