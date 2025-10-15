import express from 'express';
import { cloudinary } from '../config/cloudinary';
import { Conversation } from '../models/messages';

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

// Generate conversation ID from user IDs
const generateConversationId = (userId1: string, userId2: string): string => {
    return [userId1, userId2].sort().join('_');
};

// Send a message (text, image, audio, video)
router.post('/messages', async (req, res) => {
    try {
        const {
            senderId,
            receiverId,
            messageType,
            content,
            timestamp
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

        const conversationId = generateConversationId(senderId, receiverId);
        const participants = [senderId, receiverId].sort();

        // Find or create conversation
        let conversation = await Conversation.findOne({ participants });

        if (!conversation) {
            // Create new conversation
            conversation = new Conversation({
                participants,
                messages: []
            });
        }

        // Create new message
        const newMessage = {
            senderId,
            messageType,
            content,
            timestamp: timestamp || new Date(),
            isRead: false
        };

        // Add message to conversation
        conversation.messages.push(newMessage);

        // Update last message info
        conversation.lastMessage = new Date();
        conversation.lastMessageContent = content;
        conversation.lastMessageType = messageType;

        const savedConversation = await conversation.save();

        // Get the newly added message
        const savedMessage = savedConversation.messages[savedConversation.messages.length - 1];

        res.status(201).json({
            success: true,
            message: 'Message saved successfully',
            data: {
                _id: savedMessage._id.toString(),
                senderId: savedMessage.senderId,
                messageType: savedMessage.messageType,
                content: savedMessage.content,
                timestamp: savedMessage.timestamp,
                isRead: savedMessage.isRead,
                conversationId: savedConversation._id.toString()
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

// Get messages between two users
router.get('/messages/:userId/:recipientId', async (req, res) => {
    try {
        const { userId, recipientId } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = parseInt(req.query.skip as string) || 0;

        const participants = [userId, recipientId].sort();

        // Find conversation
        const conversation = await Conversation.findOne({ participants });

        if (!conversation) {
            return res.json({
                success: true,
                data: [] // No conversation exists yet
            });
        }

        // Get messages with pagination
        const messages = conversation.messages
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(skip, skip + limit);

        // Transform to frontend format
        const formattedMessages = messages.map(msg => ({
            _id: msg._id.toString(),
            messageType: msg.messageType,
            senderId: { _id: msg.senderId },
            timeStamp: msg.timestamp.toISOString(),
            message: msg.messageType === 'text' ? msg.content : undefined,
            imageUrl: msg.messageType === 'image' ? msg.content : undefined,
            audioUrl: msg.messageType === 'audio' ? msg.content : undefined,
            content: msg.content,
            isRead: msg.isRead
        })).reverse(); // Reverse to get chronological order

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

// Delete single message
router.delete('/messages/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { conversationId, messageType, mediaUrl } = req.body;

        console.log('📝 Delete request received:', {
            messageId,
            conversationId,
            messageType,
            mediaUrl
        });

        if (!messageId || !conversationId) {
            return res.status(400).json({
                success: false,
                message: 'Message ID and Conversation ID are required'
            });
        }

        let messageFound = false;
        let cloudinaryDeleted = false;

        // Find conversation and remove message
        const conversation = await Conversation.findById(conversationId);

        if (conversation) {
            const messageIndex = conversation.messages.findIndex(
                msg => msg._id.toString() === messageId
            );

            if (messageIndex !== -1) {
                conversation.messages.splice(messageIndex, 1);
                await conversation.save();
                messageFound = true;
                console.log('✅ Message deleted from conversation:', messageId);
            }
        }

        // Delete from Cloudinary if media exists
        if (mediaUrl && ['image', 'audio', 'video'].includes(messageType)) {
            const publicId = extractPublicId(mediaUrl);

            if (publicId) {
                try {
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
            deletedFromDB: messageFound,
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

// Get all conversations for a user
router.get('/conversations/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const conversations = await Conversation.find({
            participants: userId
        }).sort({ lastMessage: -1 });

        const formattedConversations = conversations.map(conv => ({
            _id: conv._id.toString(),
            participants: conv.participants,
            lastMessage: conv.lastMessage,
            lastMessageContent: conv.lastMessageContent,
            lastMessageType: conv.lastMessageType,
            messageCount: conv.messages.length
        }));

        res.json({
            success: true,
            data: formattedConversations
        });

    } catch (error: any) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({
            success: false,
            message: `Internal server error: ${error.message}`
        });
    }
});

// Keep your other routes (mark as read, unread count) with similar updates
router.put('/:messageId/read', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { userId, conversationId } = req.body;

        if (!userId || !conversationId) {
            return res.status(400).json({
                success: false,
                message: 'userId and conversationId are required'
            });
        }

        const conversation = await Conversation.findById(conversationId);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Conversation not found'
            });
        }

        // Find and mark message as read
        const message = conversation.messages.id(messageId);
        if (message && message.senderId !== userId) { // Only mark if user is not the sender
            message.isRead = true;
            await conversation.save();
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

export default router;