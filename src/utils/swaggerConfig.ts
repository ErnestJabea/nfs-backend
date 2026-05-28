import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import swaggerDocument from './swagger.json';

export const setupSwagger = (app: Express) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    explorer: true
  }));
  app.get('/test-api', (req, res) => res.send('OK'));
  console.log('📄 Swagger docs available at http://localhost:5000/api-docs');
};
