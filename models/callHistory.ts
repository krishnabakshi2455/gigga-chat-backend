import mongoose from "mongoose";

const callHistorySchema = new mongoose.Schema({
    callerId: { type: String, required: true },
    calleeId: { type: String, required: true },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    duration: { type: Number }, // in seconds
    callType: { type: String, enum: ['audio', 'video'], required: true },
    status: { type: String, enum: ['completed', 'missed', 'declined'], required: true }
});

export const CallHistory = mongoose.model('CallHistory', callHistorySchema);