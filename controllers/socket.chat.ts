import { Server, Socket } from 'socket.io';
import JWT from 'jsonwebtoken';

interface ActiveConversation {
    participants: string[];
    roomId: string;
    lastActivity: Date;
}

interface UserSocket {
    userId: string;
    socketId: string;
    activeConversations: string[];
}

interface CallData {
    callId: string;
    callType: 'video' | 'audio';
    callerId: string;
    callerName: string;
    callerImage?: string;
    recipientId: string;
    recipientName: string;
    timestamp: string;
}

class SocketManager {
    private activeConversations = new Map<string, ActiveConversation>();
    private connectedUsers = new Map<string, UserSocket>();
    private activeCalls = new Map<string, CallData>();
    private callTimeouts = new Map<string, NodeJS.Timeout>();

    private createConversationId(userId1: string, userId2: string): string {
        return [userId1, userId2].sort().join('_');
    }

    private getConnectedUsersInConversation(conversationId: string): string[] {
        const conversation = this.activeConversations.get(conversationId);
        if (!conversation) return [];

        return conversation.participants.filter(userId =>
            this.connectedUsers.has(userId)
        );
    }

    private getCallDuration(startTime: string): number {
        return Math.floor((new Date().getTime() - new Date(startTime).getTime()) / 1000);
    }

    private clearCallTimeout(callId: string) {
        const timeout = this.callTimeouts.get(callId);
        if (timeout) {
            clearTimeout(timeout);
            this.callTimeouts.delete(callId);
        }
    }

    public authMiddleware = (socket: any, next: Function) => {
        try {
            const token = socket.handshake.auth.token;
            console.log('🔐 Socket connection attempt with token:', token ? 'Present' : 'Missing');

            if (!token) {
                console.log('❌ Authentication error: No token provided');
                return next(new Error('Authentication error: No token provided'));
            }

            const decoded = JWT.verify(token, process.env.JWT_SECRET!) as any;
            socket.data.userId = decoded.userId;
            console.log('✅ User authenticated:', socket.data.userId);
            next();
        } catch (error) {
            console.log('❌ Authentication error: Invalid token', error);
            next(new Error('Authentication error: Invalid token'));
        }
    }

    public handleConnection = (io: Server, socket: Socket) => {
        const userId = socket.data.userId;
        console.log(`🎯 New socket connection - User: ${userId}, Socket ID: ${socket.id}`);

        this.connectedUsers.set(userId, {
            userId,
            socketId: socket.id,
            activeConversations: []
        });

        socket.join(userId);

        socket.emit('connected', {
            message: 'Successfully connected to socket server',
            userId: userId,
            socketId: socket.id,
            timestamp: new Date().toISOString()
        });

        socket.emit('test_event', {
            message: 'Connection test successful',
            timestamp: new Date().toISOString()
        });

        console.log(`✅ User ${userId} connected. Total users: ${this.connectedUsers.size}`);

        socket.on('ping', (cb) => {
            if (typeof cb === 'function') {
                cb('pong');
            }
        });

        socket.on('join_conversation', (data: { otherUserId: string }) => {
            const { otherUserId } = data;
            const conversationId = this.createConversationId(userId, otherUserId);

            console.log(`👥 User ${userId} joining conversation with ${otherUserId}`);

            socket.join(conversationId);

            if (!this.activeConversations.has(conversationId)) {
                this.activeConversations.set(conversationId, {
                    participants: [userId, otherUserId],
                    roomId: conversationId,
                    lastActivity: new Date()
                });
            } else {
                const conversation = this.activeConversations.get(conversationId)!;
                conversation.lastActivity = new Date();
            }

            const userSocket = this.connectedUsers.get(userId);
            if (userSocket && !userSocket.activeConversations.includes(conversationId)) {
                userSocket.activeConversations.push(conversationId);
            }

            const connectedInConversation = this.getConnectedUsersInConversation(conversationId);

            console.log(`📊 Connected users in conversation ${conversationId}:`, connectedInConversation);

            io.to(conversationId).emit('user_joined_conversation', {
                userId: userId,
                conversationId: conversationId,
                connectedUsers: connectedInConversation
            });

            socket.emit('conversation_joined', {
                conversationId: conversationId,
                otherUserId: otherUserId,
                connectedUsers: connectedInConversation,
                isOtherUserOnline: connectedInConversation.includes(otherUserId)
            });
        });

        socket.on('leave_conversation', (data: { otherUserId: string }) => {
            const { otherUserId } = data;
            const conversationId = this.createConversationId(userId, otherUserId);

            console.log(`👋 User ${userId} leaving conversation with ${otherUserId}`);

            socket.leave(conversationId);

            const userSocket = this.connectedUsers.get(userId);
            if (userSocket) {
                userSocket.activeConversations = userSocket.activeConversations.filter(
                    id => id !== conversationId
                );
            }

            io.to(conversationId).emit('user_left_conversation', {
                userId: userId,
                conversationId: conversationId
            });
        });

        socket.on('send_message', async (data: { receiverId: string; message: string; messageType?: string }) => {
            try {
                console.log('📨 Received message:', data);
                const { receiverId, message, messageType } = data;
                const conversationId = this.createConversationId(userId, receiverId);

                if (!this.activeConversations.has(conversationId)) {
                    this.activeConversations.set(conversationId, {
                        participants: [userId, receiverId],
                        roomId: conversationId,
                        lastActivity: new Date()
                    });
                }

                const conversation = this.activeConversations.get(conversationId)!;
                conversation.lastActivity = new Date();

                const isReceiverOnline = this.connectedUsers.has(receiverId);

                console.log(`📊 Message from ${userId} to ${receiverId} - Receiver online: ${isReceiverOnline}`);

                io.to(conversationId).emit('receive_message', {
                    senderId: userId,
                    message,
                    messageType: messageType || 'text',
                    timestamp: new Date(),
                    conversationId: conversationId
                });

                socket.emit('message_sent', {
                    success: true,
                    message: 'Message sent successfully',
                    isReceiverOnline: isReceiverOnline,
                    conversationId: conversationId
                });

                console.log('✅ Message delivered to conversation:', conversationId);

            } catch (error) {
                console.error('❌ Error sending message:', error);
                socket.emit('message_error', { error: 'Failed to send message' });
            }
        });

        socket.on('typing_start', (data: { receiverId: string }) => {
            const { receiverId } = data;
            const conversationId = this.createConversationId(userId, receiverId);

            io.to(conversationId).emit('user_typing', {
                userId: userId,
                isTyping: true,
                conversationId: conversationId
            });
        });

        socket.on('typing_stop', (data: { receiverId: string }) => {
            const { receiverId } = data;
            const conversationId = this.createConversationId(userId, receiverId);

            io.to(conversationId).emit('user_typing', {
                userId: userId,
                isTyping: false,
                conversationId: conversationId
            });
        });

        socket.on('call:initiate', (data: Omit<CallData, 'timestamp'>) => {
            const { callId, recipientId, callType, callerId, callerName, callerImage, recipientName } = data;

            console.log(`📞 Call initiated: ${callId} from ${callerId} to ${recipientId}`);

            if (callerId !== userId) {
                socket.emit('call:failed', {
                    callId,
                    reason: 'Authentication error'
                });
                return;
            }

            const recipientSocket = this.connectedUsers.get(recipientId);
            if (!recipientSocket) {
                socket.emit('call:failed', {
                    callId,
                    reason: 'Recipient is offline'
                });
                return;
            }

            const existingCall = Array.from(this.activeCalls.values()).find(
                call => call.recipientId === recipientId
            );

            if (existingCall) {
                socket.emit('call:failed', {
                    callId,
                    reason: 'Recipient is already in a call'
                });
                return;
            }

            const callData: CallData = {
                callId,
                callType,
                callerId,
                callerName,
                callerImage,
                recipientId,
                recipientName,
                timestamp: new Date().toISOString()
            };

            this.activeCalls.set(callId, callData);

            const timeout = setTimeout(() => {
                const call = this.activeCalls.get(callId);
                if (call) {
                    console.log(`⏰ Auto timeout for call: ${callId}`);

                    io.to(call.callerId).emit('call:timeout', {
                        callId,
                        reason: 'No answer from recipient'
                    });

                    io.to(call.recipientId).emit('call:timeout', {
                        callId,
                        reason: 'Call timed out'
                    });

                    this.activeCalls.delete(callId);
                    this.callTimeouts.delete(callId);
                }
            }, 30000);

            this.callTimeouts.set(callId, timeout);

            io.to(recipientId).emit('call:incoming', callData);

            socket.emit('call:initiated', {
                callId,
                recipientId,
                status: 'ringing'
            });

            console.log(`🔔 Call invitation sent to ${recipientId}`);
        });

        socket.on('call:accept', (data: { callId: string; callerId: string }) => {
            const { callId, callerId } = data;

            console.log(`✅ Call accepted: ${callId} by ${userId}`);

            const callData = this.activeCalls.get(callId);
            if (!callData) {
                socket.emit('call:error', {
                    callId,
                    error: 'Call not found'
                });
                return;
            }

            if (callData.recipientId !== userId) {
                socket.emit('call:error', {
                    callId,
                    error: 'Not authorized to accept this call'
                });
                return;
            }

            this.clearCallTimeout(callId);

            io.to(callerId).emit('call:accepted', {
                callId,
                acceptorId: userId,
                acceptorName: 'User'
            });

            console.log(`✅ Call ${callId} accepted successfully`);
        });

        socket.on('call:reject', (data: { callId: string; callerId: string; reason?: string }) => {
            const { callId, callerId, reason } = data;

            console.log(`❌ Call rejected: ${callId} by ${userId}, Reason: ${reason}`);

            const callData = this.activeCalls.get(callId);

            this.activeCalls.delete(callId);
            this.clearCallTimeout(callId);

            io.to(callerId).emit('call:rejected', {
                callId,
                reason: reason || 'Call rejected',
                rejectedBy: userId
            });

            console.log(`❌ Call ${callId} rejected and cleaned up`);
        });

        socket.on('call:end', (data: { callId: string; recipientId: string }) => {
            const { callId, recipientId } = data;

            console.log(`📴 Call ended: ${callId} by ${userId}`);

            const callData = this.activeCalls.get(callId);

            this.activeCalls.delete(callId);
            this.clearCallTimeout(callId);

            io.to(recipientId).emit('call:ended', {
                callId,
                endedBy: userId,
                duration: callData ? this.getCallDuration(callData.timestamp) : 0
            });

            console.log(`📴 Call ${callId} ended and cleaned up`);
        });

        socket.on('call:timeout', (data: { callId: string; recipientId: string }) => {
            const { callId, recipientId } = data;

            console.log(`⏰ Manual call timeout: ${callId}`);

            this.activeCalls.delete(callId);
            this.clearCallTimeout(callId);

            io.to(recipientId).emit('call:timeout', {
                callId
            });
        });

        socket.on('webrtc:offer', (data: { callId: string; recipientId: string; offer: any }) => {
            const { callId, recipientId, offer } = data;

            console.log(`📤 Forwarding WebRTC offer for call: ${callId}`);

            if (!this.activeCalls.has(callId)) {
                socket.emit('webrtc:error', {
                    callId,
                    error: 'Call not found'
                });
                return;
            }

            io.to(recipientId).emit('webrtc:offer', {
                callId,
                offer,
                senderId: userId
            });
        });

        socket.on('webrtc:answer', (data: { callId: string; recipientId: string; answer: any }) => {
            const { callId, recipientId, answer } = data;

            console.log(`📤 Forwarding WebRTC answer for call: ${callId}`);

            if (!this.activeCalls.has(callId)) {
                socket.emit('webrtc:error', {
                    callId,
                    error: 'Call not found'
                });
                return;
            }

            io.to(recipientId).emit('webrtc:answer', {
                callId,
                answer,
                senderId: userId
            });
        });

        socket.on('webrtc:ice-candidate', (data: { callId: string; recipientId: string; candidate: any }) => {
            const { callId, recipientId, candidate } = data;

            if (!this.activeCalls.has(callId)) {
                return;
            }

            io.to(recipientId).emit('webrtc:ice-candidate', {
                callId,
                candidate,
                senderId: userId
            });
        });

        socket.on('disconnect', (reason) => {
            console.log('❌ User disconnected:', userId, 'Reason:', reason, 'Socket ID:', socket.id);

            const userSocket = this.connectedUsers.get(userId);
            const activeConversationIds = userSocket?.activeConversations || [];

            activeConversationIds.forEach(conversationId => {
                io.to(conversationId).emit('user_left_conversation', {
                    userId: userId,
                    conversationId: conversationId,
                    reason: 'disconnect'
                });
            });

            this.activeCalls.forEach((callData, callId) => {
                if (callData.callerId === userId || callData.recipientId === userId) {
                    const otherUserId = callData.callerId === userId ? callData.recipientId : callData.callerId;

                    io.to(otherUserId).emit('call:ended', {
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

            this.connectedUsers.delete(userId);

            console.log(`👋 User ${userId} fully disconnected. Remaining users: ${this.connectedUsers.size}`);
        });
    }
}

export const socketManager = new SocketManager();

const socket_messages = (io: Server) => {
    io.use(socketManager.authMiddleware);

    io.on('connection', (socket: Socket) => {
        socketManager.handleConnection(io, socket);
    });
};

export default socket_messages;