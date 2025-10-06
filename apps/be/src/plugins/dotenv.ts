import * as dotenv from 'dotenv';
import path from 'path';

if (process.env.NODE_ENV !== 'development') {
  const envPath = path.resolve(__dirname, '.env');
  try {
    const result = dotenv.config({
      path: envPath,
    });
    // console.info('dotenv RESULT', result.parsed);
    if (result.error) {
      console.warn('dotenv', result.error);
    }
  } catch (error) {
    console.error('dotenv', error);
  }
}
