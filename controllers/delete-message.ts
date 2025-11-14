import { Router, Request, Response } from 'express';
import { cloudinary } from '../config/cloudinary';
import { CloudinaryDeleteResult } from '../types';
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
    if (messageType === 'audio') return 'video'; // Audio files are stored as 'video' in Cloudinary
    if (messageType === 'video') return 'video';

    // Fallback: determine from URL extension
    if (url) {
        if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(url)) return 'image';
        if (/\.(mp3|wav|m4a|aac|ogg|mp4|avi|mov|webm)$/i.test(url)) return 'video';
    }

    return 'raw';
};

// Delete single message (handles both MongoDB and Cloudinary deletion)
router.delete('/messages/:messageId', async (req: Request, res: Response) => {
    try {
        const { messageId } = req.params;
        const { messageType, mediaUrl, conversation_id } = req.body;

        console.log('📝 Delete request received:', {
            messageId,
            conversation_id,
            messageType,
            hasMedia: !!mediaUrl
        });

        if (!messageId) {
            return res.status(400).json({
                success: false,
                message: 'Message ID is required'
            });
        }

        if (!conversation_id) {
            return res.status(400).json({
                success: false,
                message: 'Conversation ID is required'
            });
        }

        let messageFoundInDB = false;
        let cloudinaryDeleted = false;
        let cloudinaryAttempted = false;

        // STEP 1: Delete from Cloudinary FIRST (if media exists)
        // This ensures media is deleted even if DB deletion fails
        if (mediaUrl && ['image', 'audio', 'video'].includes(messageType)) {
            cloudinaryAttempted = true;
            const publicId = extractPublicId(mediaUrl);

            if (publicId) {
                const resourceType = getResourceType(messageType, mediaUrl);

                console.log(`☁️ Deleting from Cloudinary:`, {
                    publicId,
                    resourceType,
                    messageType,
                    messageId
                });

                try {
                    const result: CloudinaryDeleteResult = await cloudinary.uploader.destroy(
                        publicId,
                        {
                            resource_type: resourceType,
                            invalidate: true
                        }
                    );

                    console.log('📥 Cloudinary deletion result:', result);

                    if (result.result === 'ok') {
                        console.log('✅ Successfully deleted from Cloudinary:', publicId);
                        cloudinaryDeleted = true;
                    } else if (result.result === 'not found') {
                        console.log('⚠️ Media not found in Cloudinary (may already be deleted):', publicId);
                        cloudinaryDeleted = true; // Consider this a success
                    } else {
                        console.warn('⚠️ Unexpected Cloudinary result:', result);
                    }
                } catch (cloudinaryError: any) {
                    console.error('❌ Cloudinary deletion error:', cloudinaryError);
                    // Don't return error here - continue to delete from DB
                }
            } else {
                console.warn('⚠️ Could not extract public_id from URL:', mediaUrl);
            }
        }

        // STEP 2: Delete message from MongoDB
        try {
            const result = await Conversation.findByIdAndUpdate(
                conversation_id,
                {
                    $pull: {
                        messages: { _id: messageId }
                    }
                },
                { new: true }
            );

            if (result) {
                messageFoundInDB = true;
                console.log('✅ Message deleted from database:', messageId);

                // Update lastMessage metadata if needed
                if (result.messages.length > 0) {
                    const lastMsg = result.messages[result.messages.length - 1];
                    await Conversation.findByIdAndUpdate(conversation_id, {
                        lastMessage: lastMsg.timestamp,
                        lastMessageContent: lastMsg.content,
                        lastMessageType: lastMsg.messageType
                    });
                } else {
                    // No messages left, clear lastMessage fields
                    await Conversation.findByIdAndUpdate(conversation_id, {
                        lastMessage: null,
                        lastMessageContent: null,
                        lastMessageType: null
                    });
                }
            } else {
                console.log('⚠️ Conversation not found:', conversation_id);
            }
        } catch (dbError: any) {
            if (dbError.name === 'CastError') {
                console.log('⚠️ Invalid ObjectId:', messageId);
            } else {
                console.error('❌ Database error:', dbError);
            }
            // If Cloudinary deletion succeeded but DB failed, still return partial success
        }

        // STEP 3: Return appropriate response
        if (cloudinaryAttempted && !cloudinaryDeleted && !messageFoundInDB) {
            // Both operations failed
            return res.status(500).json({
                success: false,
                message: 'Failed to delete message from both database and cloud storage'
            });
        }

        if (!messageFoundInDB && !cloudinaryAttempted) {
            // Nothing to delete
            return res.status(404).json({
                success: false,
                message: 'Message not found in database'
            });
        }

        // At least one operation succeeded
        return res.json({
            success: true,
            message: messageFoundInDB && cloudinaryDeleted
                ? 'Message deleted from database and cloud storage'
                : messageFoundInDB
                    ? 'Message deleted from database'
                    : 'Media deleted from cloud storage',
            deletedMessageId: messageId,
            deletedFromDB: messageFoundInDB,
            deletedFromCloudinary: cloudinaryDeleted
        });

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

        console.log(`🗑️ Batch delete request for ${messages.length} message(s)`);

        let deletedCount = 0;
        let failedCount = 0;
        const errors: string[] = [];

        for (const msg of messages) {
            try {
                let deleted = false;
                let cloudinaryDeleted = false;

                // Delete from Cloudinary first (if media exists)
                if (msg.mediaUrl && ['image', 'audio', 'video'].includes(msg.messageType)) {
                    const publicId = extractPublicId(msg.mediaUrl);
                    if (publicId) {
                        const resourceType = getResourceType(msg.messageType, msg.mediaUrl);

                        try {
                            const result = await cloudinary.uploader.destroy(publicId, {
                                resource_type: resourceType,
                                invalidate: true
                            });

                            if (result.result === 'ok' || result.result === 'not found') {
                                console.log('✅ Deleted from Cloudinary:', publicId);
                                cloudinaryDeleted = true;
                                deleted = true;
                            }
                        } catch (cloudinaryError) {
                            console.error('❌ Cloudinary error for:', publicId, cloudinaryError);
                        }
                    }
                }

                // Delete from database
                if (msg.conversation_id) {
                    try {
                        const result = await Conversation.findByIdAndUpdate(
                            msg.conversation_id,
                            {
                                $pull: {
                                    messages: { _id: msg.messageId }
                                }
                            },
                            { new: true }
                        );

                        if (result) {
                            deleted = true;

                            // Update lastMessage metadata if needed
                            if (result.messages.length > 0) {
                                const lastMsg = result.messages[result.messages.length - 1];
                                await Conversation.findByIdAndUpdate(msg.conversation_id, {
                                    lastMessage: lastMsg.timestamp,
                                    lastMessageContent: lastMsg.content,
                                    lastMessageType: lastMsg.messageType
                                });
                            } else {
                                await Conversation.findByIdAndUpdate(msg.conversation_id, {
                                    lastMessage: null,
                                    lastMessageContent: null,
                                    lastMessageType: null
                                });
                            }
                        }
                    } catch (dbError: any) {
                        if (dbError.name !== 'CastError') {
                            console.error('DB error:', dbError);
                        }
                    }
                }

                if (deleted) {
                    deletedCount++;
                } else {
                    failedCount++;
                    errors.push(`Failed to delete message ${msg.messageId}`);
                }

            } catch (error: any) {
                failedCount++;
                errors.push(`Failed to delete ${msg.messageId}: ${error.message}`);
            }
        }

        console.log('✅ Batch delete completed:', {
            total: messages.length,
            deleted: deletedCount,
            failed: failedCount
        });

        return res.json({
            success: deletedCount > 0,
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