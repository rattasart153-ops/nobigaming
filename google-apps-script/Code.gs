/** Nobi Topup HtmlService web entry point.
 * Rendering a page does not initialize Sheets, create Drive resources, or bootstrap Admin.
 * Browser data access is restricted to the named functions in BrowserFacade.gs.
 */

function doGet(e) {
  var requestedPage = String(
    e && e.parameter && e.parameter.page ? e.parameter.page : 'storefront'
  ).trim().toLowerCase();
  var pathInfo = String(e && e.pathInfo || '').replace(/^\\/+|\\/+$/g, '').toLowerCase();
  if (pathInfo === 'member') requestedPage = 'member';
  var isAdmin = requestedPage === 'admin';
  var isMember = requestedPage === 'member';
  var templateName = isAdmin ? 'Admin' : isMember ? 'Member' : 'Storefront';
  var pageTitle = isAdmin ? 'Nobi Topup · Admin' : isMember ? 'Nobi Topup · สมาชิก' : 'Nobi Topup — เติมเกมออนไลน์';

  return HtmlService.createTemplateFromFile(templateName)
    .evaluate()
    .setTitle(pageTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}


/** HtmlService include helper with a fixed local partial allowlist. */
function include(filename) {
  if (String(filename || '') !== 'QrCode') throw new Error('ไม่อนุญาตให้เรียกไฟล์ Template นี้');
  return HtmlService.createHtmlOutputFromFile('QrCode').getContent();
}
