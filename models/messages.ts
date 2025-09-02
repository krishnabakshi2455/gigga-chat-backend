import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    senderId: { type: String, required: true },
    receiverId: { type: String, required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    messageType: { type: String, enum: ['text', 'image', 'file'], default: 'text' },
    isRead: { type: Boolean, default: false },
    conversationId: { type: String, required: true }
});

export const Message = mongoose.model('Message', messageSchema);




