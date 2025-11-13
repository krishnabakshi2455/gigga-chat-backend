import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    senderId: { type: String, required: true },
    messageType: {
        type: String,
        enum: ['text', 'image', 'audio', 'video'],
        required: true
    },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    isRead: { type: Boolean, default: false }
});

const conversationSchema = new mongoose.Schema({
    participants: [{ type: String, required: true }], // Array of user IDs [userA, userB]
    conversation_id:[{ type: String}],
    messages: [messageSchema], // Array of messages
    lastMessage: { type: Date, default: Date.now },
    lastMessageContent: { type: String },
    lastMessageType: { type: String }
});

export const Conversation = mongoose.model('Conversation', conversationSchema);
