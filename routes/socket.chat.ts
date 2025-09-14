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
    activeConversations: string[]; // Array of conversation room IDs
}

const socket_messages = (io: Server) => {
    // Track active conversations and connected users
    const activeConversations = new Map<string, ActiveConversation>();
    const connectedUsers = new Map<string, UserSocket>();

    // Helper function to create conversation room ID
    const createConversationId = (userId1: string, userId2: string): string => {
        return [userId1, userId2].sort().join('_');
    };

    // Helper function to get connected users in a conversation
    const getConnectedUsersInConversation = (conversationId: string): string[] => {
        const conversation = activeConversations.get(conversationId);
        if (!conversation) return [];

        return conversation.participants.filter(userId =>
            connectedUsers.has(userId)
        );
    };

    io.use((socket: any, next) => {
        const token = socket.handshake.auth.token;
        console.log('🔐 Socket connection attempt with token:', token ? 'Present' : 'Missing');

        if (!token) {
            console.log('❌ Authentication error: No token provided');
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const decoded = JWT.verify(token, process.env.JWT_SECRET!) as any;
            socket.data.userId = decoded.userId;
            // console.log('✅ User authenticated:', socket.data.userId);
            next();
        } catch (error) {
            console.log('❌ Authentication error: Invalid token', error);
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const userId = socket.data.userId;

        // Track connected user
        connectedUsers.set(userId, {
            userId,
            socketId: socket.id,
            activeConversations: []
        });

        // Join user to their own room for private messages
        socket.join(userId);

        // Send connection confirmation
        socket.emit('connected', {
            message: 'Successfully connected to socket server',
            userId: userId
        });

        // Handle joining a conversation
        socket.on('join_conversation', (data) => {
            const { otherUserId } = data;
            const conversationId = createConversationId(userId, otherUserId);

            // console.log(`👥 User ${userId} joining conversation with ${otherUserId}`);

            // Join conversation room
            socket.join(conversationId);

            // Track active conversation
            if (!activeConversations.has(conversationId)) {
                activeConversations.set(conversationId, {
                    participants: [userId, otherUserId],
                    roomId: conversationId,
                    lastActivity: new Date()
                });
            } else {
                // Update last activity
                const conversation = activeConversations.get(conversationId)!;
                conversation.lastActivity = new Date();
            }

            // Update user's active conversations
            const userSocket = connectedUsers.get(userId)!;
            if (!userSocket.activeConversations.includes(conversationId)) {
                userSocket.activeConversations.push(conversationId);
            }

            // Get connected users in this conversation
            const connectedInConversation = getConnectedUsersInConversation(conversationId);

            // console.log(`📊 Connected users in conversation ${conversationId}:`, connectedInConversation);

            // Notify both users about who's online in this conversation
            socket.to(conversationId).emit('user_joined_conversation', {
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

        // Handle leaving a conversation
        socket.on('leave_conversation', (data) => {
            const { otherUserId } = data;
            const conversationId = createConversationId(userId, otherUserId);

            console.log(`👋 User ${data.name} leaving conversation with ${data.name}`);

            socket.leave(conversationId);

            // Update user's active conversations
            const userSocket = connectedUsers.get(userId);
            if (userSocket) {
                userSocket.activeConversations = userSocket.activeConversations.filter(
                    id => id !== conversationId
                );
            }

            // Notify other user
            socket.to(conversationId).emit('user_left_conversation', {
                userId: userId,
                conversationId: conversationId
            });
        });

        // Enhanced message handling with conversation tracking
        socket.on('send_message', async (data) => {
            try {
                console.log('📨 Received message:', data);
                const { receiverId, message, messageType } = data;
                const conversationId = createConversationId(userId, receiverId);

                // Ensure conversation exists
                if (!activeConversations.has(conversationId)) {
                    activeConversations.set(conversationId, {
                        participants: [userId, receiverId],
                        roomId: conversationId,
                        lastActivity: new Date()
                    });
                }

                // Update last activity
                const conversation = activeConversations.get(conversationId)!;
                conversation.lastActivity = new Date();

                // Check if receiver is online
                const isReceiverOnline = connectedUsers.has(receiverId);

                console.log(`📊 Message from ${userId} to ${receiverId} - Receiver online: ${isReceiverOnline}`);

                // Emit to conversation room (both users if online)
                socket.to(conversationId).emit('receive_message', {
                    senderId: userId,
                    message,
                    messageType: messageType || 'text',
                    timestamp: new Date(),
                    conversationId: conversationId
                });

                // Send confirmation to sender
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

        // Typing indicators with conversation awareness
        socket.on('typing_start', (data) => {
            const { receiverId } = data;
            const conversationId = createConversationId(userId, receiverId);

            socket.to(conversationId).emit('user_typing', {
                userId: userId,
                isTyping: true,
                conversationId: conversationId
            });
        });

        socket.on('typing_stop', (data) => {
            const { receiverId } = data;
            const conversationId = createConversationId(userId, receiverId);

            socket.to(conversationId).emit('user_typing', {
                userId: userId,
                isTyping: false,
                conversationId: conversationId
            });
        });

        // Get conversation status
        socket.on('get_conversation_status', (data) => {
            const { otherUserId } = data;
            const conversationId = createConversationId(userId, otherUserId);
            const connectedInConversation = getConnectedUsersInConversation(conversationId);

            socket.emit('conversation_status', {
                conversationId: conversationId,
                connectedUsers: connectedInConversation,
                isOtherUserOnline: connectedInConversation.includes(otherUserId),
                totalConnected: connectedInConversation.length
            });
        });

        // Handle disconnect
        socket.on('disconnect', (reason) => {
            console.log('❌ User disconnected:', userId, 'Reason:', reason);

            // Get user's active conversations before removing
            const userSocket = connectedUsers.get(userId);
            const activeConversationIds = userSocket?.activeConversations || [];

            // Notify all active conversations about user leaving
            activeConversationIds.forEach(conversationId => {
                socket.to(conversationId).emit('user_left_conversation', {
                    userId: userId,
                    conversationId: conversationId,
                    reason: 'disconnect'
                });
            });

            // Remove user from connected users
            connectedUsers.delete(userId);

            // Clean up old conversations (optional)
            // You might want to run this periodically instead
            const now = new Date();
            activeConversations.forEach((conversation, id) => {
                const timeDiff = now.getTime() - conversation.lastActivity.getTime();
                // Remove conversations inactive for more than 1 hour
                if (timeDiff > 3600000) {
                    activeConversations.delete(id);
                }
            });
        });
    });
};

export default socket_messages;