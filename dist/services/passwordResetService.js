"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issuePasswordResetCode = exports.hashPasswordResetCode = void 0;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const security_1 = require("../config/security");
const hashPasswordResetCode = (email, code) => crypto_1.default
    .createHmac('sha256', (0, security_1.getOtpHmacSecret)())
    .update(`password-reset:${email}:${code}`)
    .digest('hex');
exports.hashPasswordResetCode = hashPasswordResetCode;
const issuePasswordResetCode = (email) => __awaiter(void 0, void 0, void 0, function* () {
    const code = crypto_1.default.randomInt(10000000, 100000000).toString();
    yield prisma_1.default.passwordReset.deleteMany({ where: { email } });
    yield prisma_1.default.passwordReset.create({
        data: {
            email,
            code: (0, exports.hashPasswordResetCode)(email, code),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
    });
    return code;
});
exports.issuePasswordResetCode = issuePasswordResetCode;
