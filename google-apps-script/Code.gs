/** Nobi Topup HtmlService web entry point.
 * Rendering a page does not initialize Sheets, create Drive resources, or bootstrap Admin.
 * Browser data access is restricted to the named functions in BrowserFacade.gs.
 */

function doGet(e) {
  var requestedPage = String(
    e && e.parameter && e.parameter.page ? e.parameter.page : 'storefront'
  ).trim().toLowerCase();
  var isAdmin = requestedPage === 'admin';
  var templateName = isAdmin ? 'Admin' : 'Storefront';
  var pageTitle = isAdmin ? 'Nobi Topup · Admin' : 'Nobi Topup — เติมเกมออนไลน์';

  return HtmlService.createTemplateFromFile(templateName)
    .evaluate()
    .setTitle(pageTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
