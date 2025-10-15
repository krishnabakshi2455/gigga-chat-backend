import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    senderId: { type: String, required: true },
    receiverId: { type: String, required: true },
    messageType: {
        type: String,
        enum: ['text', 'image', 'audio', 'video'],
        required: true
    },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    conversationId: { type: String, required: true },
    isRead: { type: Boolean, default: false }
});

export const Message = mongoose.model('Message', messageSchema);