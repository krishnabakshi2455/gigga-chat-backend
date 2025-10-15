import { Router, Request, Response } from 'express';
import { cloudinary } from '../config/cloudinary';
import { CloudinaryDeleteResult, DeleteMediaRequest, DeleteMediaResponse } from '../types';
import { Conversation } from '../models/messages';

const router = Router();

// Helper function to extract public_id from Cloudinary URL
const extractPublicId = (url: string): string | null => {
    try {
        const matches = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
        return matches ? matches[1] : null;
    } catch (error) {
        console.error('Error extracting public_id:', error);
        return null;
    }
};

// Helper function to determine resource type from URL or messageType
const getResourceType = (messageType: string, url?: string): 'image' | 'video' | 'raw' => {
    if (messageType === 'image') return 'image';
    if (messageType === 'audio') return 'video';
    if (messageType === 'video') return 'video';

    if (url) {
        if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(url)) return 'image';
        if (/\.(mp3|wav|m4a|aac|ogg|mp4|avi|mov|webm)$/i.test(url)) return 'video';
    }

    return 'raw';
};

// Delete single message
router.delete('/messages/:messageId', async (req: Request, res: Response) => {
    try {
        const { messageId } = req.params;
        const { messageType, mediaUrl } = req.body;

        console.log('📝 Delete request received:', {
            messageId,
            messageType,
            mediaUrl
        });

        if (!messageId) {
            return res.status(400).json({
                success: false,
                message: 'Message ID is required'
            });
        }

        let messageFoundInDB = false;
        let cloudinaryDeleted = false;

        // Try to find and delete from database (if it exists)
        try {
            const message = await Conversation.findById(messageId);

            if (message) {
                messageFoundInDB = true;
                await Conversation.findByIdAndDelete(messageId);
                console.log('✅ Message deleted from database:', messageId);
            } else {
                console.log('⚠️ Message not found in database (may be temporary):', messageId);
            }
        } catch (dbError: any) {
            // If it's a Cast error (invalid ObjectId), it's likely a temp message
            if (dbError.name === 'CastError') {
                console.log('⚠️ Invalid ObjectId (temporary message):', messageId);
            } else {
                console.error('❌ Database error:', dbError);
            }
            // Continue to delete from Cloudinary anyway
        }

        // Delete from Cloudinary if media exists (regardless of DB status)
        if (mediaUrl && ['image', 'audio', 'video'].includes(messageType)) {
            const publicId = extractPublicId(mediaUrl);

            if (publicId) {
                const resourceType = getResourceType(messageType, mediaUrl);

                console.log(`🗑️ Deleting media from Cloudinary:`, {
                    publicId,
                    resourceType,
                    messageId,
                    originalUrl: mediaUrl
                });

                try {
                    const result: CloudinaryDeleteResult = await cloudinary.uploader.destroy(
                        publicId,
                        {
                            resource_type: resourceType,
                            invalidate: true
                        }
                    );

                    console.log('Cloudinary deletion result:', result);

                    if (result.result === 'ok') {
                        console.log('✅ Successfully deleted from Cloudinary:', publicId);
                        cloudinaryDeleted = true;
                    } else if (result.result === 'not found') {
                        console.log('⚠️ Media not found in Cloudinary (may already be deleted):', publicId);
                    } else {
                        console.warn('⚠️ Unexpected Cloudinary result:', result);
                    }
                } catch (cloudinaryError: any) {
                    console.error('❌ Cloudinary deletion error:', cloudinaryError);
                    return res.status(500).json({
                        success: false,
                        message: `Cloudinary deletion failed: ${cloudinaryError.message}`
                    });
                }
            } else {
                console.warn('⚠️ Could not extract public_id from URL:', mediaUrl);
            }
        }

        // Return success if either DB or Cloudinary deletion succeeded
        if (messageFoundInDB || cloudinaryDeleted) {
            return res.json({
                success: true,
                message: messageFoundInDB
                    ? 'Message deleted from database and Cloudinary'
                    : 'Media deleted from Cloudinary',
                deletedMessageId: messageId,
                deletedFromDB: messageFoundInDB,
                deletedFromCloudinary: cloudinaryDeleted
            });
        } else {
            return res.status(404).json({
                success: false,
                message: 'Message not found in database and no media to delete'
            });
        }

    } catch (error: any) {
        console.error('❌ Message deletion error:', error);
        return res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
});

// Batch delete multiple messages
router.post('/messages/batch-delete', async (req: Request, res: Response) => {
    try {
        const { messages } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Messages array is required'
            });
        }

        let deletedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        for (const msg of messages) {
            try {
                let deleted = false;

                // Try to delete from database
                try {
                    const message = await Conversation.findById(msg.messageId);
                    if (message) {
                        await Conversation.findByIdAndDelete(msg.messageId);
                        deleted = true;
                    }
                } catch (dbError: any) {
                    if (dbError.name !== 'CastError') {
                        console.error('DB error:', dbError);
                    }
                }

                // Delete from Cloudinary
                if (msg.mediaUrl && ['image', 'audio', 'video'].includes(msg.messageType)) {
                    const publicId = extractPublicId(msg.mediaUrl);
                    if (publicId) {
                        const resourceType = getResourceType(msg.messageType, msg.mediaUrl);

                        try {
                            const result = await cloudinary.uploader.destroy(publicId, {
                                resource_type: resourceType,
                                invalidate: true
                            });

                            if (result.result === 'ok') {
                                console.log('✅ Deleted from Cloudinary:', publicId);
                                deleted = true;
                            }
                        } catch (cloudinaryError) {
                            console.error('❌ Cloudinary error for:', publicId, cloudinaryError);
                        }
                    }
                }

                if (deleted) {
                    deletedCount++;
                } else {
                    failedCount++;
                    errors.push(`Nothing to delete for ${msg.messageId}`);
                }

            } catch (error: any) {
                failedCount++;
                errors.push(`Failed to delete ${msg.messageId}: ${error.message}`);
            }
        }

        return res.json({
            success: true,
            deletedCount,
            failedCount,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error: any) {
        console.error('❌ Batch deletion error:', error);
        return res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
});

export default router;