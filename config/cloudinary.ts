import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.Cloudinary_Root_API_Key || !process.env.Cloudinary_Root_API_Secret) {
    throw new Error('Missing Cloudinary environment variables');
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.Cloudinary_Root_API_Key,
    api_secret: process.env.Cloudinary_Root_API_Secret,
});

console.log('✅ Cloudinary configured successfully');

export { cloudinary };