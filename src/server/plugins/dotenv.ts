import dotenv from 'dotenv';
import fs from 'fs';

const envFiles = ['.env', '.env.local'];

envFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    try {
      const result = dotenv.config({ path: file });
      // console.info('dotenv RESULT', result.parsed);
      if (result.error) {
        console.warn('dotenv', result.error);
      }
    } catch (error) {
      console.error('dotenv', error);
    }
  }
});
