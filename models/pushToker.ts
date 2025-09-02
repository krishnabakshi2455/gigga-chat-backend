import mongoose from "mongoose";

const pushTokenSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    token: { type: String, required: true },
    deviceType: { type: String, enum: ['android', 'ios'] },
    lastUpdated: { type: Date, default: Date.now }
});

export const PushToken = mongoose.model('PushToken', pushTokenSchema);