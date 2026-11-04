'use strict';

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

function configureSecurity(app, express, isVercel) {
  app.set('trust proxy', isVercel ? 1 : false);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      reportOnly: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://script.google.com', 'https://*.googleusercontent.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://script.google.com', 'https://*.googleusercontent.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
}

function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง' }
  });
}

module.exports = { configureSecurity, createLoginLimiter };
