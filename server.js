const ENV = require('./src/config/env');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(ENV.PORT || 3000);
// Keep path resolution centralized; preserve the existing locations and overrides.
const { PUBLIC, DATA_DIR, UPLOADS, PUBLIC_UPLOADS, PRIVATE_SLIPS, IS_VERCEL } = require('./src/config/paths');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(PUBLIC_UPLOADS, { recursive: true });
fs.mkdirSync(PRIVATE_SLIPS, { recursive: true });
if (IS_VERCEL) console.warn('[Nobi Topup] Vercel is using ephemeral /tmp storage. Orders, sessions, SQLite data and uploads will not persist across instance replacement. Do not use for production transactions.');
// Initialize middleware only after its backing directories exist.
const sessionMiddleware = require('./src/middleware/session');
const createUpload = require('./src/middleware/uploads');
const upload = createUpload(PUBLIC_UPLOADS);
const slipUpload = createUpload(PRIVATE_SLIPS);
const errorHandler = require('./src/middleware/error-handler');
const { configureSecurity, createLoginLimiter } = require('./src/middleware/security');
configureSecurity(app, express, IS_VERCEL);
app.use(sessionMiddleware);
app.use('/uploads', express.static(PUBLIC_UPLOADS, { maxAge: '1h', dotfiles: 'deny', index: false }));
app.use(express.static(PUBLIC));

const db = require('./src/db/sqlite');
const loginLimiter = createLoginLimiter();

const asyncRoute = require('./src/utils/async-route');
const requireAdmin = require('./src/middleware/admin-auth');
const { bool, validDate } = require('./src/utils/validation');
const getCatalog = require('./src/services/catalog.service')(db);
const validateCoupon = require('./src/services/coupon.service')(db);
const createPendingOrder = require('./src/services/order.service')({ db, validateCoupon });
const getPaymentInfo = require('./src/services/payment-info.service')(ENV.PROMPTPAY_ID);
const setOrderStatus = require('./src/services/order-status.service')(db);

const createPublicRouter = require('./src/routes/public.routes');
app.use(createPublicRouter({ db, slipUpload, asyncRoute, validateCoupon, getCatalog, getPaymentInfo, createPendingOrder }));

const createAdminRouter = require('./src/routes/admin.routes');
app.use(createAdminRouter({ db, requireAdmin, loginLimiter, upload, bool, validDate, privateSlipsDir: PRIVATE_SLIPS, legacyUploadsDir: UPLOADS, setOrderStatus }));

app.get('/admin', (req,res) => res.sendFile(path.join(PUBLIC,'admin.html')));
app.get('/', (req,res) => res.sendFile(path.join(PUBLIC,'nobitopup.html')));
app.use(errorHandler);
// Vercel invokes the exported handler; local development starts its own HTTP listener.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Nobi Topup running at http://localhost:${PORT}`));
}

module.exports = app;
