import express from 'express';
import { Message } from '../models/messages';
import { cloudinary } from '../config/cloudinary';

const router = express.Router();

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

// Send a message (text, image, audio, video)
router.post('/messages', async (req, res) => {
    try {
        const {
            senderId,
            receiverId,
            messageType,
            content,  // This is either plain text or Cloudinary URL
            timestamp,
            conversationId
        } = req.body;

        // Validation
        if (!senderId || !receiverId || !messageType || !content) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: senderId, receiverId, messageType, content'
            });
        }

        if (!['text', 'image', 'audio', 'video'].includes(messageType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid messageType. Must be: text, image, audio, or video'
            });
        }

        // Create and save message
        const newMessage = new Message({
            senderId,
            receiverId,
            messageType,
            content, // Store the text or URL directly
            timestamp: timestamp || new Date(),
            conversationId: conversationId || [senderId, receiverId].sort().join('-')
        });

        const savedMessage = await newMessage.save();

        res.status(201).json({
            success: true,
            message: 'Message saved successfully',
            data: {
                _id: savedMessage._id,
                senderId: savedMessage.senderId,
                receiverId: savedMessage.receiverId,
                messageType: savedMessage.messageType,
                content: savedMessage.content, // Simple string - text or URL
                timestamp: savedMessage.timestamp,
                conversationId: savedMessage.conversationId,
                isRead: savedMessage.isRead
            }
        });

    } catch (error: any) {
        console.error('Error saving message:', error);
        res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
});

// Delete single message
router.delete('/messages/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { messageType, mediaUrl } = req.body; // mediaUrl is the simple Cloudinary URL

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

        // Delete from database
        try {
            const message = await Message.findById(messageId);
            if (message) {
                messageFoundInDB = true;
                await Message.findByIdAndDelete(messageId);
                console.log('✅ Message deleted from database:', messageId);
            }
        } catch (dbError: any) {
            console.log('Database deletion attempt:', dbError.message);
        }

        // Delete from Cloudinary if media exists
        if (mediaUrl && ['image', 'audio', 'video'].includes(messageType)) {
            const publicId = extractPublicId(mediaUrl);

            if (publicId) {
                try {
                    // Determine resource type for Cloudinary
                    const resourceType = messageType === 'image' ? 'image' : 'video';

                    const result = await cloudinary.uploader.destroy(publicId, {
                        resource_type: resourceType,
                        invalidate: true
                    });

                    if (result.result === 'ok') {
                        cloudinaryDeleted = true;
                        console.log('✅ Cloudinary media deleted');
                    }
                } catch (cloudinaryError) {
                    console.error('Cloudinary deletion error:', cloudinaryError);
                }
            }
        }

        return res.json({
            success: true,
            message: 'Delete operation completed',
            deletedFromDB: messageFoundInDB,
            deletedFromCloudinary: cloudinaryDeleted
        });

    } catch (error: any) {
        console.error('Delete error:', error);
        res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
});

// Get messages between two users
router.get('/messages/:userId/:recipientId', async (req, res) => {
    try {
        const { userId, recipientId } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = parseInt(req.query.skip as string) || 0;

        const conversationId = [userId, recipientId].sort().join('-');

        const messages = await Message.find({ conversationId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .skip(skip);

        // Transform to frontend format
        const formattedMessages = messages.map(msg => ({
            _id: msg._id.toString(),
            messageType: msg.messageType,
            senderId: { _id: msg.senderId },
            timeStamp: msg.timestamp.toISOString(),
            message: msg.messageType === 'text' ? msg.content : undefined,
            imageUrl: msg.messageType === 'image' ? msg.content : undefined,
            audioUrl: msg.messageType === 'audio' ? msg.content : undefined,
            content: msg.content, // The original content (text or URL)
            isRead: msg.isRead
        })).reverse();

        res.json({
            success: true,
            data: formattedMessages
        });

    } catch (error: any) {
        console.error('Error fetching messages:', error);
        res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
});

// Mark message as read
router.put('/:messageId/read', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'userId is required'
            });
        }

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        // Only mark as read if user is the recipient
        if (message.receiverId === userId) {
            message.isRead = true;
            await message.save();
        }

        res.json({
            success: true,
            message: 'Message marked as read'
        });

    } catch (error: any) {
        console.error('Error marking message as read:', error);
        res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
});

// Get unread message count for a user
router.get('/unread/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const unreadCount = await Message.countDocuments({
            receiverId: userId,
            isRead: false
        });

        res.json({
            success: true,
            unreadCount
        });

    } catch (error: any) {
        console.error('Error getting unread count:', error);
        res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
});

export default router;