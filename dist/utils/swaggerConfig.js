"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSwagger = void 0;
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_json_1 = __importDefault(require("./swagger.json"));
const setupSwagger = (app) => {
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_SWAGGER !== 'true') {
        return;
    }
    app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_json_1.default, {
        explorer: true
    }));
    app.get('/test-api', (req, res) => res.send('OK'));
    console.log('📄 Swagger docs available at http://localhost:5000/api-docs');
};
exports.setupSwagger = setupSwagger;
