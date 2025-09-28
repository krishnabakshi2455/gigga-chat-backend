import { Router, Request, Response } from 'express';
import { cloudinary } from '../config/cloudinary';
// import { auth } from '../middleware/auth';
import { CloudinaryDeleteResult, DeleteMediaRequest, DeleteMediaResponse } from '../types';

const router = Router();

router.delete('/delete-media', async (
    req: Request<{}, DeleteMediaResponse, DeleteMediaRequest>,
    res: Response<DeleteMediaResponse>
) => {
    try {
        const { publicId, resourceType = 'image' } = req.body;

        if (!publicId) {
            return res.status(400).json({
                success: false,
                message: 'Public ID is required'
            });
        }

        // Validate resourceType
        const validResourceTypes: Array<'image' | 'video' | 'raw' | 'auto'> = ['image', 'video', 'raw', 'auto'];
        if (!validResourceTypes.includes(resourceType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid resource type'
            });
        }

        console.log(`🗑️ Deleting media from Cloudinary:`, {
            publicId,
            resourceType,
            userId: (req as any).user.userId
        });

        const result: CloudinaryDeleteResult = await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType,
            invalidate: true // CDN cache invalidation
        });

        console.log('Cloudinary deletion result:', result);

        if (result.result === 'ok') {
            console.log('✅ Successfully deleted from Cloudinary:', publicId);
            return res.json({
                success: true,
                message: 'Media deleted successfully',
                result
            });
        } else if (result.result === 'not found') {
            console.log('⚠️ Media not found in Cloudinary (may already be deleted):', publicId);
            return res.json({
                success: true,
                message: 'Media not found (may already be deleted)',
                result
            });
        } else {
            console.log('❌ Cloudinary deletion failed:', result);
            return res.status(500).json({
                success: false,
                message: `Failed to delete media from Cloudinary: ${result.result}`
            });
        }
    } catch (error: any) {
        console.error('❌ Cloudinary deletion error:', error);
        return res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
});

export default router;