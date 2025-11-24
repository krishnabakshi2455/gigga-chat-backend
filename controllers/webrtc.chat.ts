import { Server, Socket } from 'socket.io';

export interface CallData {
    callId: string;
    callType: 'video' | 'audio';
    callerId: string;
    callerName: string;
    callerImage?: string;
    recipientId: string;
    timestamp: string;
    status: 'initiated' | 'ringing' | 'accepted' | 'rejected' | 'ended';
}

class CallHandler {
    private activeCalls = new Map<string, CallData>();
    private callTimeouts = new Map<string, NodeJS.Timeout>();

    constructor(private io: Server) { }

    public initializeCallHandlers(socket: Socket) {
        const userId = socket.data.userId;

        // Call initiation
        socket.on('call:initiate', (data: Omit<CallData, 'status'> & { recipientId: string }) => {
            this.handleCallInitiate(socket, data);
        });

        // Call acceptance
        socket.on('call:accept', (data: { callId: string; callerId: string }) => {
            this.handleCallAccept(socket, data);
        });

        // Call rejection
        socket.on('call:reject', (data: { callId: string; callerId: string; reason?: string }) => {
            this.handleCallReject(socket, data);
        });

        // Call ending
        socket.on('call:end', (data: { callId: string; recipientId: string }) => {
            this.handleCallEnd(socket, data);
        });

        // WebRTC signaling
        socket.on('webrtc:offer', (data: { callId: string; recipientId: string; offer: any }) => {
            this.handleWebRTCOffer(socket, data);
        });

        socket.on('webrtc:answer', (data: { callId: string; recipientId: string; answer: any }) => {
            this.handleWebRTCAnswer(socket, data);
        });

        socket.on('webrtc:ice-candidate', (data: { callId: string; recipientId: string; candidate: any }) => {
            this.handleWebRTCIceCandidate(socket, data);
        });

        // Call timeout
        socket.on('call:timeout', (data: { callId: string; recipientId: string }) => {
            this.handleCallTimeout(socket, data);
        });

        // Handle disconnect - clean up calls
        socket.on('disconnect', () => {
            this.handleUserDisconnect(userId);
        });
    }

    private handleCallInitiate(socket: Socket, data: Omit<CallData, 'status'> & { recipientId: string }) {
        const { callId, recipientId, callType, callerId, callerName, callerImage } = data;
        const userId = socket.data.userId;

        console.log(`📞 Call initiated: ${callId} from ${callerId} to ${recipientId}`);

        // Validate caller identity
        if (callerId !== userId) {
            socket.emit('call:failed', {
                callId,
                reason: 'Authentication error'
            });
            return;
        }

        // Check if recipient is already in a call
        const existingCall = Array.from(this.activeCalls.values()).find(
            call => call.recipientId === recipientId && call.status === 'ringing'
        );

        if (existingCall) {
            socket.emit('call:failed', {
                callId,
                reason: 'Recipient is already in a call'
            });
            return;
        }

        // Create call data
        const callData: CallData = {
            callId,
            callType,
            callerId,
            callerName,
            callerImage,
            recipientId,
            timestamp: new Date().toISOString(),
            status: 'ringing'
        };

        // Store call
        this.activeCalls.set(callId, callData);

        // Set call timeout (30 seconds)
        const timeout = setTimeout(() => {
            this.handleCallTimeoutAutomatically(callId);
        }, 30000);

        this.callTimeouts.set(callId, timeout);

        // Send call invitation to recipient
        this.io.to(recipientId).emit('incoming:call', {
            callId,
            callType,
            callerId,
            callerName,
            callerImage,
            timestamp: callData.timestamp
        });

        // Confirm to caller
        socket.emit('call:initiated', {
            callId,
            recipientId,
            status: 'ringing'
        });

        console.log(`🔔 Call invitation sent to ${recipientId}`);
    }

    private handleCallAccept(socket: Socket, data: { callId: string; callerId: string }) {
        const { callId, callerId } = data;
        const userId = socket.data.userId;

        console.log(`✅ Call accepted: ${callId} by ${userId}`);

        const callData = this.activeCalls.get(callId);
        if (!callData) {
            socket.emit('call:error', {
                callId,
                error: 'Call not found'
            });
            return;
        }

        // Validate acceptor is the recipient
        if (callData.recipientId !== userId) {
            socket.emit('call:error', {
                callId,
                error: 'Not authorized to accept this call'
            });
            return;
        }

        // Update call status
        callData.status = 'accepted';
        this.activeCalls.set(callId, callData);

        // Clear timeout
        this.clearCallTimeout(callId);

        // Notify caller
        this.io.to(callerId).emit('call:accepted', {
            callId,
            acceptorId: userId
        });

        console.log(`✅ Call ${callId} accepted successfully`);
    }

    private handleCallReject(socket: Socket, data: { callId: string; callerId: string; reason?: string }) {
        const { callId, callerId, reason } = data;
        const userId = socket.data.userId;

        console.log(`❌ Call rejected: ${callId} by ${userId}, Reason: ${reason}`);

        const callData = this.activeCalls.get(callId);

        // Clean up
        this.activeCalls.delete(callId);
        this.clearCallTimeout(callId);

        // Notify caller
        this.io.to(callerId).emit('call:rejected', {
            callId,
            reason: reason || 'Call rejected',
            rejectedBy: userId
        });

        console.log(`❌ Call ${callId} rejected and cleaned up`);
    }

    private handleCallEnd(socket: Socket, data: { callId: string; recipientId: string }) {
        const { callId, recipientId } = data;
        const userId = socket.data.userId;

        console.log(`📴 Call ended: ${callId} by ${userId}`);

        const callData = this.activeCalls.get(callId);

        // Clean up
        this.activeCalls.delete(callId);
        this.clearCallTimeout(callId);

        // Calculate call duration
        const duration = callData ? this.getCallDuration(callData.timestamp) : 0;

        // Notify other participant
        this.io.to(recipientId).emit('call:ended', {
            callId,
            endedBy: userId,
            duration
        });

        console.log(`📴 Call ${callId} ended and cleaned up`);
    }

    private handleWebRTCOffer(socket: Socket, data: { callId: string; recipientId: string; offer: any }) {
        const { callId, recipientId, offer } = data;
        const userId = socket.data.userId;

        console.log(`📤 Forwarding WebRTC offer for call: ${callId}`);

        if (!this.activeCalls.has(callId)) {
            socket.emit('webrtc:error', {
                callId,
                error: 'Call not found'
            });
            return;
        }

        this.io.to(recipientId).emit('webrtc:offer', {
            callId,
            offer,
            senderId: userId
        });
    }

    private handleWebRTCAnswer(socket: Socket, data: { callId: string; recipientId: string; answer: any }) {
        const { callId, recipientId, answer } = data;
        const userId = socket.data.userId;

        console.log(`📤 Forwarding WebRTC answer for call: ${callId}`);

        if (!this.activeCalls.has(callId)) {
            socket.emit('webrtc:error', {
                callId,
                error: 'Call not found'
            });
            return;
        }

        this.io.to(recipientId).emit('webrtc:answer', {
            callId,
            answer,
            senderId: userId
        });
    }

    private handleWebRTCIceCandidate(socket: Socket, data: { callId: string; recipientId: string; candidate: any }) {
        const { callId, recipientId, candidate } = data;
        const userId = socket.data.userId;

        if (!this.activeCalls.has(callId)) {
            return;
        }

        this.io.to(recipientId).emit('webrtc:ice-candidate', {
            callId,
            candidate,
            senderId: userId
        });
    }

    private handleCallTimeout(socket: Socket, data: { callId: string; recipientId: string }) {
        const { callId, recipientId } = data;

        console.log(`⏰ Call timeout: ${callId}`);

        this.activeCalls.delete(callId);
        this.clearCallTimeout(callId);

        this.io.to(recipientId).emit('call:timeout', {
            callId
        });
    }

    private handleCallTimeoutAutomatically(callId: string) {
        const callData = this.activeCalls.get(callId);
        if (callData && callData.status === 'ringing') {
            console.log(`⏰ Auto timeout for call: ${callId}`);

            // Notify caller
            this.io.to(callData.callerId).emit('call:timeout', {
                callId,
                reason: 'No answer from recipient'
            });

            // Notify recipient
            this.io.to(callData.recipientId).emit('call:timeout', {
                callId,
                reason: 'Call timed out'
            });

            this.activeCalls.delete(callId);
            this.callTimeouts.delete(callId);
        }
    }

    private handleUserDisconnect(userId: string) {
        console.log(`🔌 Cleaning up calls for disconnected user: ${userId}`);

        // End all active calls for this user
        this.activeCalls.forEach((callData, callId) => {
            if (callData.callerId === userId || callData.recipientId === userId) {
                const otherUserId = callData.callerId === userId ? callData.recipientId : callData.callerId;

                this.io.to(otherUserId).emit('call:ended', {
                    callId,
                    endedBy: userId,
                    reason: 'User disconnected',
                    duration: this.getCallDuration(callData.timestamp)
                });

                this.activeCalls.delete(callId);
                this.clearCallTimeout(callId);
                console.log(`📴 Call ${callId} ended due to user disconnect`);
            }
        });
    }

    private clearCallTimeout(callId: string) {
        const timeout = this.callTimeouts.get(callId);
        if (timeout) {
            clearTimeout(timeout);
            this.callTimeouts.delete(callId);
        }
    }

    private getCallDuration(startTime: string): number {
        return Math.floor((new Date().getTime() - new Date(startTime).getTime()) / 1000);
    }
}

export default CallHandler;