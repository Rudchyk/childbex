import path from 'path';

export const IMAGE_RX = /\.(png|jpe?g|webp|gif)$/i;

export const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

export const ARCHIVES_ROOT = path.join(process.cwd(), 'data', 'archives');
