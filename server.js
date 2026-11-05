'use strict';

const ENV = require('./src/config/env');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const PORT = Number(ENV.PORT || 3000);
const {PUBLIC, DATA_DIR, UPLOADS, PUBLIC_UPLOADS, PRIVATE_SLIPS, IS_VERCEL} = require('./src/config/paths');
const hasAppsScriptConfig = Boolean(ENV.APPS_SCRIPT_URL && ENV.APPS_SCRIPT_SHARED_SECRET);
const gatewayMode = hasAppsScriptConfig;

if (!gatewayMode && (IS_VERCEL || ENV.NODE_ENV === 'production')) {
  throw new Error('APPS_SCRIPT_URL and APPS_SCRIPT_SHARED_SECRET are required for production. SQLite/local uploads are disabled.');
}

// Upload directories are temporary staging only in gateway mode; final media and order data
// are persisted in private Google Drive and Google Sheets.
if (!gatewayMode) fs.mkdirSync(DATA_DIR, {recursive:true});
fs.mkdirSync(UPLOADS, {recursive:true});
fs.mkdirSync(PUBLIC_UPLOADS, {recursive:true});
fs.mkdirSync(PRIVATE_SLIPS, {recursive:true});

const {configureSecurity, createLoginLimiter} = require('./src/middleware/security');
configureSecurity(app, express, IS_VERCEL);
app.use(express.static(PUBLIC));

const createUpload = require('./src/middleware/uploads');
const upload = createUpload(PUBLIC_UPLOADS);
const slipUpload = createUpload(PRIVATE_SLIPS);
const errorHandler = require('./src/middleware/error-handler');
const loginLimiter = createLoginLimiter();

if (gatewayMode) {
  const {createAppsScriptClient} = require('./src/clients/apps-script.client');
  const {createGatewaySession} = require('./src/middleware/gateway-session');
  const client = createAppsScriptClient({
    url:ENV.APPS_SCRIPT_URL,
    secret:ENV.APPS_SCRIPT_SHARED_SECRET,
    timeoutMs:ENV.APPS_SCRIPT_TIMEOUT_MS
  });
  const gatewaySession = createGatewaySession(client);
  const getPaymentInfo = require('./src/services/payment-info.service')(ENV.PROMPTPAY_ID);

  const createGatewayPublicRouter = require('./src/routes/gateway-public.routes');
  app.use(createGatewayPublicRouter({
    client, slipUpload, getPaymentInfo, loginLimiter, gatewaySession
  }));

  const createGatewayAdminRouter = require('./src/routes/gateway-admin.routes');
  app.use(createGatewayAdminRouter({
    client,
    requireAdmin:gatewaySession.requireAdmin,
    loginLimiter,
    upload,
    gatewaySession
  }));
} else {
  // SQLite remains a local characterization/development fallback only.
  // It is deliberately unavailable on Vercel and in production.
  const sessionMiddleware = require('./src/middleware/session');
  app.use(sessionMiddleware);
  app.use('/uploads', express.static(PUBLIC_UPLOADS, {
    maxAge:'1h', dotfiles:'deny', index:false
  }));

  const db = require('./src/db/sqlite');
  const asyncRoute = require('./src/utils/async-route');
  const requireAdmin = require('./src/middleware/admin-auth');
  const {bool, validDate} = require('./src/utils/validation');
  const getCatalog = require('./src/services/catalog.service')(db);
  const validateCoupon = require('./src/services/coupon.service')(db);
  const orderLifecycle = require('./src/services/order.service')({db, validateCoupon});
  const {createPendingOrder, submitSlip, expirePendingOrders} = orderLifecycle;
  app.use((req, res, next) => {
    try { expirePendingOrders(); next(); } catch (error) { next(error); }
  });
  const getPaymentInfo = require('./src/services/payment-info.service')(ENV.PROMPTPAY_ID);
  const setOrderStatus = require('./src/services/order-status.service')(db);

  const createPublicRouter = require('./src/routes/public.routes');
  app.use(createPublicRouter({
    db, slipUpload, asyncRoute, validateCoupon, getCatalog, getPaymentInfo,
    createPendingOrder, submitSlip
  }));

  const createAdminRouter = require('./src/routes/admin.routes');
  app.use(createAdminRouter({
    db, requireAdmin, loginLimiter, upload, bool, validDate,
    privateSlipsDir:PRIVATE_SLIPS, legacyUploadsDir:UPLOADS, setOrderStatus
  }));
}

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'nobitopup.html')));
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => console.log('Nobi Topup running on port ' + PORT));
}

module.exports = app;
