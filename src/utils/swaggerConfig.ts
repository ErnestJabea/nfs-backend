import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';

export const setupSwagger = (app: Express) => {
  const swaggerFile = path.resolve(__dirname, './swagger.json');
  const swaggerData = fs.readFileSync(swaggerFile, 'utf8');
  const swaggerDocument = JSON.parse(swaggerData);
  
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    explorer: true
  }));
  app.get('/test-api', (req, res) => res.send('OK'));
  console.log('📄 Swagger docs available at http://localhost:5000/api-docs');
};
