import express from 'express';
import { cloudinary } from '../config/cloudinary';
import { Conversation } from '../models/messages';

const router = express.Router();

const extractPublicId = (url: string): string | null => {
    try {
        const matches = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
        return matches ? matches[1] : null;
    } catch (error) {
        console.error('Error extracting public_id:', error);
        return null;
    }
};

const generateConversationId = (userId1: string, userId2: string): string => {
    return [userId1, userId2].sort().join('_');
};

router.post('/messages', async (req, res) => {
    try {
        const {
            senderId,
            receiverId,
            messageType,
            content,
            timestamp
        } = req.body;

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
        const participants = [senderId, receiverId].sort();

        let conversation = await Conversation.findOne({ participants });

        if (!conversation) {
            conversation = new Conversation({
                participants,
                messages: []
            });
        }

        const newMessage = {
            senderId,
            messageType,
            content,
            timestamp: timestamp || new Date(),
            isRead: false
        };

        conversation.messages.push(newMessage);

        conversation.lastMessage = new Date();
        conversation.lastMessageContent = content;
        conversation.lastMessageType = messageType;

        const savedConversation = await conversation.save();

        const savedMessage = savedConversation.messages[savedConversation.messages.length - 1];

        res.status(201).json({
            success: true,
            message: 'Message saved successfully',
            data: {
                conversation_id: conversation._id.toString(),
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

router.get('/messages/:userId/:recipientId', async (req, res) => {
    try {
        const { userId, recipientId } = req.params;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = parseInt(req.query.skip as string) || 0;

        const participants = [userId, recipientId].sort();

        const conversation = await Conversation.findOne({ participants });

        if (!conversation) {
            return res.json({
                success: true,
                data: []
            });
        }

        const messages = conversation.messages
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(skip, skip + limit);

        const formattedMessages = messages.map(msg => ({
            conversation_id: conversation._id.toString(),
            _id: msg._id.toString(),
            messageType: msg.messageType,
            senderId: { _id: msg.senderId },
            timeStamp: msg.timestamp.toISOString(),
            message: msg.messageType === 'text' ? msg.content : undefined,
            imageUrl: msg.messageType === 'image' ? msg.content : undefined,
            audioUrl: msg.messageType === 'audio' ? msg.content : undefined,
            content: msg.content,
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

        const message = conversation.messages.id(messageId);
        if (message && message.senderId !== userId) {
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