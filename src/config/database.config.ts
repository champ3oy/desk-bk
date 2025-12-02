import { registerAs } from '@nestjs/config';

export default registerAs('database', () => {
  // If MONGODB_URI is provided, use it directly (preferred method)
  if (process.env.MONGODB_URI) {
    return {
      uri: process.env.MONGODB_URI,
    };
  }

  // Otherwise, construct URI from individual components (fallback)
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '27017';
  const username = process.env.DB_USERNAME;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_DATABASE || 'ticketing_db';

  let uri = `mongodb://${host}:${port}/${database}`;
  
  if (username && password) {
    uri = `mongodb://${username}:${password}@${host}:${port}/${database}?authSource=admin`;
  }

  return {
    uri,
  };
});

