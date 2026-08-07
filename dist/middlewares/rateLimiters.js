"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.otpResendRateLimiter = exports.otpVerificationRateLimiter = exports.transactionIntentRateLimiter = exports.passwordResetRateLimiter = exports.authRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const tooManyRequests = {
    error: 'Trop de tentatives. Veuillez patienter quelques minutes avant de reessayer.',
    code: 'RATE_LIMITED',
};
exports.authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT || 20),
    standardHeaders: true,
    legacyHeaders: false,
    message: tooManyRequests,
});
exports.passwordResetRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.PASSWORD_RESET_RATE_LIMIT || 5),
    standardHeaders: true,
    legacyHeaders: false,
    message: tooManyRequests,
});
exports.transactionIntentRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.TRANSACTION_INTENT_RATE_LIMIT || 20),
    standardHeaders: true,
    legacyHeaders: false,
    message: tooManyRequests,
});
exports.otpVerificationRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 10 * 60 * 1000,
    limit: Number(process.env.OTP_VERIFY_RATE_LIMIT || 15),
    standardHeaders: true,
    legacyHeaders: false,
    message: tooManyRequests,
});
exports.otpResendRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.OTP_RESEND_RATE_LIMIT || 5),
    standardHeaders: true,
    legacyHeaders: false,
    message: tooManyRequests,
});
