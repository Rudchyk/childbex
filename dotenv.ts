import dotenv from 'dotenv';

try {
  const result = dotenv.config();
  console.info('dotenv RESULT', result.parsed);
  if (result.error) {
    console.warn('dotenv', result.error);
  }
} catch (error) {
  console.error('dotenv', error);
}
